import { $count, $isstring, $length, $ok, $unsigned } from 'foundation-ts/commons';
import { $removeFile } from 'foundation-ts/fs';
import { $password, $uuid, HashMethod } from 'foundation-ts/crypto';
import { $inspect } from 'foundation-ts/utils';

import { $now } from '../../utils/commons';
import {
	ConflictError,
	ForbiddenError,
	InternalError,
	NotFoundError,
	FileError,
	DatabaseError,
	CertignaRequestError,
	BadRequestError
} from '../../utils/errors';

import { APIServer } from '../../server';
import {
	APIFileType,
	RoleType,
	ScenarioStatus,
	SessionStatus,
	SigningProcess
} from '../APIConstants';
import { $url2gid, $url2lid, $urls2lids, DocumentList, LocalID } from '../APIIDs';
import {
	APIAuth,
	SessionCheckOTPBody,
	SessionOTPBody,
	SessionApproveDocumentsBody,
	SessionSignDocumentsBody,
	SessionSignDocumentNode,
	SigningVisualParameters,
	SigningResource,
	SignatureResource
} from '../APIInterfaces';
import { automatCurrentNode, isAutomatAtEnd } from '../automat/automat';
import { sessionWithPublicID } from './sessionController';
import { checkOTPConformity, checkSigningAndApprobation, certignaVisualParameters } from './signatureCommons';
import Session from '../../model/Session';
import SessionDocument from '../../model/SessionDocument';
import Token from '../../model/Token';
import { getSessionCertificate } from './certificateController';
import { Certigna } from '../../classes/CertignaEndPoint';
import { AutomatNode } from '../automat/automatNode';
import FileRef from '../../model/FileRef';
import { FileInterface, LastFile, LastFilesDictionary, SessionContextEvent, SessionContextEventType, SignedDocument, TokenOtherData } from '../../model/DBInterfaces';
import { fillDocumentsLastFiles } from './scenarioCommons';
import { NO_CONTEXT } from '../../model/DBConstants';
import { getSessionActorByID } from './actorController';
import Actor from '../../model/Actor';
import CAToken from '../../model/CAToken';


export const checkOTP = async (auth:APIAuth, sessionPublicID:number, body:SessionCheckOTPBody) : Promise<boolean> => {
	let [token, session] = await checkOTPConformity(auth, sessionPublicID, body, NO_CONTEXT) ;
	let returnValue = undefined ;
	const mustDelete = $ok(body.delete) && body.delete ;
	try {
		returnValue = await Session.transaction(async trx => {
			const context = {trx:trx} ;

			let docs:DocumentList = $urls2lids(body.documents) ;

			let sessionOtherData = { ...session.otherData } ;
			let event:SessionContextEvent = {
				user:auth.user,
				date:token.creationDate(),
				'event-type':SessionContextEventType.CheckOTP,
				'operation-id':$uuid(),
				token:token.otp
			}
			const aid = $url2lid(body.actor) ;
			if (aid) { event['actor-id'] = aid ; }
			if (docs.length) { event['document-ids'] = docs ; }
			if ($length(body.tag)) { event.tag = <string>(body.tag) ; }

			sessionOtherData.sessionContextEvents.push(event) ;

			await session.$q(context).patch({
				otherData:sessionOtherData,
			}) ;

			if (mustDelete) {
				await token.$delete(context) ;
			}

			return mustDelete ;
		}) ;
	}
	catch (e) {
		APIServer.api().error(e);
		throw e ;
	}
	return $ok(returnValue) ? <boolean>returnValue : false ;
}

export const generateOtp = async (auth:APIAuth, sessionPublicID:number, body:SessionOTPBody) : Promise<Token> =>
{
	const len = $unsigned(body.length) ;
	if (!len || len > 256) {
		throw new NotFoundError(`OTP length ${len} not in range [1..256]`) ;
	}

	const letters = !body.numeric ;
	const otp = $password(len, {hasNumeric:true, hasUppercase:letters, hasLowercase:letters}) ;
	if ($length(otp) !== len) {
		throw new InternalError()
	}

	let returnValue = undefined ;
	try {
		returnValue = await Session.transaction(async trx => {
			const context = {trx:trx} ;
			let session = await sessionWithPublicID(auth, sessionPublicID, context) ;
			const api = APIServer.api() ;
			if (session.isClosed() || session.isExpired()) {
				throw new ForbiddenError(`Session ${sessionPublicID} is closed or already expired.`);
			}

			const aid = $url2lid(body.actor) ;
			let realActor = await getSessionActorByID(auth, session, aid, context) ;

			let documents:DocumentList = [] ;
			let documentsSet = new Set<LocalID>() ;
			let ttl = $unsigned(body.ttl) ;

			for (let url of body.documents) {
				const did = $url2lid(url) ;
				if (!did) {
					throw new BadRequestError("One of the document url was malformed") ;
				}
				if (documentsSet.has(did)) {
					throw new ConflictError(`Try to add the same document twice.`);
				}
				let realDoc = await SessionDocument.sessionObjectWithPublicID<SessionDocument>(session, did, context) ;
				if (!$ok(realDoc)) {
					throw new NotFoundError(`Document with URL '${url}' not found`) ;
				}
				documents.push(did) ;
				documentsSet.add(did) ;
			}
			let otherData:TokenOtherData = {
				dids:documents
			}
			if ($length(body.tag)) { otherData.tag = <string>(body.tag) ; }

			const token = await Token.query(trx).insert({
				actorId:realActor.id,
				ttl:ttl ? ttl : api.conf.otpTtl,
				otp:<string>otp,
				otherData: otherData
			}) ;

			let sessionOtherData = { ...session.otherData } ;

			let event:SessionContextEvent = {
				user:auth.user,
				date:token.creationDate(),
				'event-type':SessionContextEventType.GenerateOTP,
				'actor-id':aid,
				'operation-id':$uuid(),
				'document-ids':documents,
				token:<string>otp,
			}
			if ($length(body.tag)) { event.tag = <string>(body.tag) ; }


			sessionOtherData.sessionContextEvents.push(event) ;

			await session.$q(context).patch({
				otherData:sessionOtherData,
			}) ;

			return token ;
		}) ;
	}
	catch (e) {
		APIServer.api().error(e);
		throw e ;
	}

	return <Token>returnValue ;
}

export const approveDocuments = async (auth:APIAuth, sessionPublicID:number, requestID:number|string, body:SessionApproveDocumentsBody) : Promise<SigningResource> => {
	const api = APIServer.api() ;


	// 4 things should be done :
	// 1) we have to update the automat scenario and may be its status and save it
	// 2) we need to add the "signature" (even if it's an approbation) in the session
	// 3) we need to add the approval event with its manifest-data in the event list of the session
	// 4) save the session
	let returnValue = undefined ;
	try {
		returnValue = await Session.transaction(async trx => {
			// WARNING: here context is an interface extending EditingContext
			let context = await checkSigningAndApprobation(api, auth, trx, sessionPublicID, body, 'approve', api.conf.approveManifestData, SigningProcess.Approval) ;
			let patchedScenarioData = { ... context.scenario.otherData } ;
			patchedScenarioData.automat = context.nextAutomat ;
			let scenarioFinished = isAutomatAtEnd(patchedScenarioData.automat) ;

			// ============= 1) update the scenario
			// in approbation mode we don't update the files
			let updatedScenario = await context.scenario.$q(context).patchAndFetch({
				otherData:patchedScenarioData,
				status:scenarioFinished ? ScenarioStatus.WellTerminated : context.scenario.status
			}) ;

			updatedScenario.session = context.session ; // strait graph
			let now = $now() ;

			let otherData = { ...context.session.otherData } ;

			// ============= 2) add the signatures objects in the session
			const actorURL = api.url('session', sessionPublicID, 'actor', context.aid) ;
			const operationID = $uuid() ;
			if (!$ok(otherData.signatures)) { otherData.signatures = [] ; }
			const signatures = <SignedDocument[]>(otherData.signatures) ;
			const signaturesResponses:SignatureResource[] = [] ;
			context.dids.forEach(did => {
				const signatureID =$uuid() ;
				const signature = {
					tag:context.tag,
					did:did,
					aid:context.aid,
					date:now,
					dsigid:signatureID,
					sigid:signatureID,
					threadid:operationID,
					roleType:RoleType.Approval,
					otp:body.otp,
					requesId:`${requestID}`
				} ;
				signatures.push(signature) ;
				signaturesResponses.push({
					tag:context.tag,
					signatureId:signatureID,
					actor:actorURL,
					document:api.url('session', sessionPublicID, 'document', did)
				}) ;
			}) ;

			// ============= 3) add the approval event in the session
			otherData.sessionContextEvents.push({
				user:auth.user,
				date:now,
				'event-type':SessionContextEventType.ApproveDocuments,
				'actor-id':context.aid,
				'scenario-id':context.scenario.publicId,
				'operation-id':operationID,
				'document-ids':context.dids,
				'manifest-data':context.manifestData,
				token:body.otp
			}) ;

			// ============= 4) save the session
			await context.session.$q(context).patchAndFetch({
				otherData:otherData,
				status: scenarioFinished ? SessionStatus.Idle : context.session.status
			}) ;

			return {
				threadId:operationID,
				signatures:signaturesResponses,
				otp:body.otp
			} ;
		}) ;
	}
	catch (e) {
		api.error(e);
		throw e ;
	}

	return <SigningResource>returnValue ;
}

interface LocalDocumentNode {
	url:string,
	did:LocalID,
	parameters?:SigningVisualParameters
}

export const signDocuments = async (auth:APIAuth, sessionPublicID:number, requestID:number|string, body:SessionSignDocumentsBody) : Promise<SigningResource> => {
	let returnValue = undefined ;
	const api = APIServer.api() ;
	let localDocuments:LocalDocumentNode[] = [] ;

	// we first normalize our documents
	for (let element of body.documents)	{
		let node:LocalDocumentNode ;
		if ($isstring(element)) {
			node = {
				url: <string>element,
				did:$url2lid(<string>element)
			}
		}
		else {
			const u = (<SessionSignDocumentNode>element)['document-url'] ;
			node = {
				url:u,
				did:$url2lid(u),
				parameters:(<SessionSignDocumentNode>element)['visual-parameters']
			}
		}
		if (node.did === 0) {
			throw new BadRequestError('Bad document id to be signed') ;
		}
		localDocuments.push(node) ;
	}

	// here we verify our parameters and calculate the new automat step (if it's possible)
	const checkedBody = {
		actor:body.actor,
		documents:localDocuments.map(node => node.url),
		'manifest-data':body['manifest-data'],
		otp:$length(body.otp)?<string>(body.otp):'',
		tag:body.tag
	}


	let signedFilePaths:string[] = [] ;
	try {
		returnValue = await Session.transaction(async trx => {
			// the returned context of the next function is a subclass of EditingContext
			let context = await checkSigningAndApprobation(api, auth, trx, sessionPublicID, checkedBody, 'sign', api.conf.signatureManifestData) ; // no default tag specified here

			// then we get our certificate
			api.log(`will load certificate with ID (${sessionPublicID}, ${$url2gid(body.certificate)})`)

			let certificate = await getSessionCertificate(
				auth,
				sessionPublicID,
				$url2gid(body.certificate),
				{trx:trx}
			) ; // loading the token with the certificate
			api.log(`Found certificate = ${$inspect(certificate)}`)
			let token:CAToken = await certificate.$rq('caToken', context) ;
			let actor:Actor = await token.$rq('actor', context) ;
			if (actor.publicId !== context.aid) {
				throw new ConflictError('Impossible to use given certificate URL with this actor') ;
			}

			// then begin to sign our documents and update our database accordingly
			let currentAutomat = context.scenario.otherData.automat ;
			let currentNode = automatCurrentNode(currentAutomat) ;

			if (!$ok(currentNode)) {
				throw new ConflictError(`Bad automat node for signing documents.`);
			}
			const currentStep = context.scenario.stepsDefinition[(<AutomatNode>currentNode).stepIndex]

			let requestBase = {
				format:context.scenario.signatureFormat,
				login:auth.user,
				password:auth.password,
				hashMethod:HashMethod.SHA256,
				level:context.scenario.signatureLevel,
				type:currentStep.signatureType
			} ;

			const operationID = $uuid() ;
			let certigna = Certigna.endPoint() ;
			let patchedScenarioData = { ... context.scenario.otherData } ;
			patchedScenarioData.automat = context.nextAutomat ;

			let genuineFiles = <LastFilesDictionary>(patchedScenarioData?.originalLastFiles) ;
			let targetFiles = <LastFilesDictionary>(patchedScenarioData?.generatedFiles) ;
			let futureSourceFiles = <LastFilesDictionary>(patchedScenarioData?.generatedFiles) ;

			if (!$ok(patchedScenarioData.generatedFiles)) patchedScenarioData.generatedFiles = {} ;

			let scenarioFinished = isAutomatAtEnd(patchedScenarioData.automat) ;
			let otherData = { ...context.session.otherData } ;

			// let sign all our documents for the current step of our automat
			const signatures:SignedDocument[] = [] ;
			const signaturesResponses:SignatureResource[] = [] ;
			const now = $now() ;
			for (let node of localDocuments) {
				let fileIdSet = new Set<number>() ;
				genuineFiles[node.did].forEach(lf => { fileIdSet.add(lf.fileId)}) ;

				let nodeRequestBase = $ok(node.parameters) ?
					{ ...requestBase, visibleSignatureParameters:certignaVisualParameters(<SigningVisualParameters>node.parameters)} :
					{ ...requestBase } ;

				// here is the trick. In the general case of the automat
				// there's may be several files to be signed for the same document
				// (for example when an individual step occured before a countersign step)
				// so we need to get all the files available in our scenario for the document
				// we are willing to sign
				const filesToSign = context.scenario.sourceFileReferences(node.did, context.aid) ;
				if (!$count(filesToSign)) {
					throw new ConflictError(`No files to sign for document/actor IDs (${sessionPublicID},${node.did}/${context.aid})`) ;
				}
				const documentSignatureID = $uuid() ;
				let lastFiles:LastFile[] = [] ;
				for (let f of filesToSign) {
					const file = await FileRef.query(trx).findById(f.fileId) ;
					const signatureID = $uuid() ;
					if (!$ok(file)) {
						throw new NotFoundError(`Source file ${f.fileId} of document with ID (${sessionPublicID},${node.did}) is not found`)
					}

					// for now we consider that we have only a envelopped or envelopping signature,
					// so the f.signatureFileId field is not used
					let response = await certigna.signDocument(file.path, {
						fileName:file.fileName,
						...nodeRequestBase
					})
					console.log("SIGNATURES X:",file.fileName,file.path);

					if (!$length(response)) {
						throw new CertignaRequestError('Signature endpoint error') ;
					}

					// here our document is signed with the Certigna endpoint.
					// we will now write the files on disk. Seal them and create corresponding
					// objects in database
					const fileName = `${$uuid()}.pdf`
					const newFileStruct =  await FileRef.fileWithBuffer(auth, <Buffer>response, api.conf.storagePath, now, fileName, APIFileType.PDF) ;
					if (!$ok(newFileStruct)) {
						throw new FileError('Impossible to create signed file') ;
					}
					const fileRef = await FileRef.query(trx).insert(<FileInterface>newFileStruct) ;
					if (!$ok(fileRef)) {
						signedFilePaths.push((<FileInterface>newFileStruct).path) ;
						const sp = (<FileInterface>newFileStruct).sealPath ;
						if ($length(sp)) signedFilePaths.push(<string>sp) ;
						throw new DatabaseError('Impossible to create signed file reference in database') ;
					}
					fileRef.fillPathsIn(signedFilePaths) ;
					let lastFile:LastFile =  {
						fileId:fileRef.id
					} ;

					if (currentStep.process === SigningProcess.IndividualSign) {
						lastFile.aid = context.aid ; // in a context of individual signature, the actor should be put in files
					}
					lastFiles.push(lastFile) ;
					signatures.push({
						tag:context.tag,
						did:node.did,
						aid:context.aid,
						date:now,
						dsigid:documentSignatureID,
						sigid:signatureID,
						threadid:operationID,
						roleType:RoleType.Signature,
						otp:body.otp,
						requesId:`${requestID}`
					}) ;
				}
				targetFiles[node.did] = lastFiles ;
				if (!currentNode?.dids.includes(node.did)) {
					// we are done with this document
					// its files need to be removed from source files
					// and eventually removed from database and files
					// we do that because we don't want to keep intermediary files
					for (let lf of futureSourceFiles[node.did]) {
						if (!fileIdSet.has(lf.fileId)) {
							let fileToDelete = await FileRef.query(trx).findById(lf.fileId) ;
							if ($ok(fileToDelete)) {
								$removeFile(fileToDelete.path) ;
								if ($ok(fileToDelete.sealPath)) { $removeFile(fileToDelete.sealPath) ; }
							}
							await fileToDelete.$delete(context) ;
							fileIdSet.add(lf.fileId) ;
						}
					}
					delete futureSourceFiles[node.did] ;
				}

				signaturesResponses.push({
					tag:context.tag,
					signatureId:documentSignatureID,
					actor:api.url('session', sessionPublicID, 'actor', context.aid),
					document:api.url('session', sessionPublicID, 'document', node.did)
				}) ;
			}

			if (scenarioFinished) {
				// if our scenario is finished
				// it means that the remaining source files and the generated source files
				// need to be put back in documents
				await fillDocumentsLastFiles(context.scenario, context) ;
			}
			else if (currentNode?.stepIndex != automatCurrentNode(context.nextAutomat)?.stepIndex) {
				// our automat did go to another step defined by the user
				// our generated files shouls become the source files
				// and we reset the generated files for the step to come
				patchedScenarioData.sourceFiles = patchedScenarioData.generatedFiles ;
				patchedScenarioData.generatedFiles = {}
			}
			else {
				// this is the most complicated case. Whether the documents stay
				// as generated files or go back to source files depends on what
				// we are doing or more precisely what kind of process we are
				// following here
				switch (currentStep.process) {
					case SigningProcess.IndividualSign:
					case SigningProcess.Cosign:
						// cosign and individual sign means that we have
						// one automat step for one user step. So the generated files
						// and the source files stay as they are until the end
						// of the real step. So we do nothing here.
						break ;
					case SigningProcess.Countersign:
					case SigningProcess.OrderedCosign:
						// Countersign and Ordered cosign means we have one automat step
						// for each actor to sign. Wich means that
						// the generated source files are reseted after
						// each automat step completion
						if (currentAutomat.index != context.nextAutomat.index) {
							patchedScenarioData.sourceFiles = patchedScenarioData.generatedFiles ;
							patchedScenarioData.generatedFiles = {}
						}
						break ;
					default:
						throw new InternalError('Found bad signing process during signature process') ;
				}
			}

			// here we update our current scenario
			let updatedScenario = await context.scenario.$q(context).patchAndFetch({
				otherData:patchedScenarioData,
				status:scenarioFinished ? ScenarioStatus.WellTerminated : context.scenario.status
			}) ;
			updatedScenario.session = context.session ; // strait graph

			// here we modify and save the session
			otherData.sessionContextEvents.push({
				user:auth.user,
				date:now,
				'event-type':SessionContextEventType.SignDocuments,
				'actor-id':context.aid,
				'scenario-id':context.scenario.publicId,
				'operation-id':operationID,
				'document-ids':context.dids,
				'manifest-data':context.manifestData,
				token:body.otp
			}) ;


			if (!$ok(otherData.signatures)) { otherData.signatures = [] ; }

			signatures.forEach(s => otherData.signatures?.push(s)) ;

			await context.session.$q(context).patchAndFetch({
				otherData:otherData,
				status: scenarioFinished ? SessionStatus.Idle : context.session.status
			}) ;

			signedFilePaths = [] ;
			return {
				threadId:operationID,
				signatures:signaturesResponses,
				otp:body.otp,
				token:token.token
			} ;
		}) ;
	}
	catch (e) {
		APIServer.api().error(e) ;
		signedFilePaths.forEach(f => $removeFile(f)) ;
		throw e ;
	}
	return <SigningResource>returnValue ;

}
