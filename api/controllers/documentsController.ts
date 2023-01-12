import { StringArrayDictionary } from 'foundation-ts/types';
import { $count, $length, $ok, $strings, $unsigned } from 'foundation-ts/commons';
import { $map } from 'foundation-ts/array'
import { $ext, $filename, $isfile, $path, $realMoveFile } from 'foundation-ts/fs'

import { NotFoundError, ConflictError, ManifestDataError, FileError, BadRequestError, InternalError } from '../../utils/errors'

import Session from '../../model/Session'
import Upload from '../../model/Upload'
import FileRef from '../../model/FileRef'
import SessionDocument from '../../model/SessionDocument';
import { sessionWithPublicID, checkSessionMutability } from './sessionController'
import { APIServer } from '../../server'
import { FileStatus, NO_CONTEXT } from '../../model/DBConstants';
import { APIAuth, CreateDocumentBody, DocumentsQuery } from '../APIInterfaces';
import { uploadWithURL } from './uploadController';
import { $lid } from '../APIIDs';
import { Automat, automatSigningDocuments, SigningNodeDictionary } from '../automat/automat';
import { DocumentInterface, EditingContext } from '../../model/DBInterfaces';
import { SigningNode } from '../automat/automatNode';


export const getSessionDocumentList = async (auth:APIAuth, sessionPublicID:number, q:DocumentsQuery) : Promise<object> => {
	let mask = $unsigned(q['status_mask']) ;
	let tags = $strings(q.tags) ;
	let aid = $lid(q.actor)
	let actorOrTags = false ;

	if (($count(tags) > 0 || aid > 0)) {
		if (mask > 0) {
			throw new ConflictError("Cannot have 'status_mask' tag positionned with 'actor' or 'tags' at the same time") ;
		}
		actorOrTags = true ;
	}

	let session = await sessionWithPublicID(auth, sessionPublicID, { prefetchings:'[documents, activeScenario]'}) ; // we load the documents and active scenario

	if (actorOrTags) {
		let documentURLsByTag:StringArrayDictionary = {} ;
		if (session.isActive()) {
			let automat = session.activeScenario?.otherData.automat ;
			if ($ok(automat)) {
				let taggedDocuments = automatSigningDocuments(<Automat>automat) ;
				if ($ok(taggedDocuments)) {
					const tdocs = <SigningNodeDictionary>taggedDocuments ;
					const api = APIServer.api() ;
					if ($count(tags)) {
						// here we can have tags only or tags + an actor ID
						tags.forEach(t => {
							let nodes = tdocs[t] ;
							if ($count(nodes)) {
								let docs = $map<SigningNode, string>(nodes, n => {
									return !aid || n.aids.includes(aid) ? api.url('session', sessionPublicID, 'document', n.did) : null ;
								}) ;
								if ($count(docs)) { documentURLsByTag[t] = docs ; }								
							}
						}) ;
					}
					else {
						// here we only can have an actor ID
						for (let t in tdocs) {
							let nodes = tdocs[t] ;
							if ($count(nodes)) {
								let docs = $map<SigningNode, string>(nodes, n => {
									return n.aids.includes(aid) ? api.url('session', sessionPublicID, 'document', n.did) : null ;
								}) ;
								if ($count(docs)) { documentURLsByTag[t] = <string[]>docs ; }	
							}
						}
	
					}
				}
	
			}
		}
		return documentURLsByTag ;
	}
	else if ($count(session.documents)) {
		let list = session.documents as SessionDocument[] ;
		if (mask > 0) {
			let newList:SessionDocument[] = [] ;
			for (let d of list) {
				const status = await d.documentStatus(NO_CONTEXT) ;
				if ((status & mask) > 0) {
					newList.push(d) ;
				}
			}
			list = newList ;
		}
		if ($count(list)) { return { documents:session.documents?.map((d:SessionDocument) => d.url(sessionPublicID)) } ; }
	}

	return { documents:[] } ;
}

function _missingErrorsInDocumentBody(b:CreateDocumentBody) : string {
	let u:string[] = [] ;

	if (!$length(b['file-name'])) { u.push('file-name') ; }
	if (!$length(b['title'])) { u.push('title') ; }

	return $count(u) > 0 ? `Unspecified or inconcistent items : ${u.join(', ')}`:'' ;

}


async function _addDocument(session:Session, body:CreateDocumentBody, upload:Upload, c:EditingContext) : Promise <SessionDocument>
{

	if (!$ok(c.trx)) {
		throw new InternalError('_addActor() should be called inside a transaction') ;
	}

	let exists = $isfile(upload.path) ;
	const api = APIServer.api() ;

	if (exists && $length(upload.sealPath)) {
		exists = $isfile(upload.sealPath) ;
	}
	if (!exists) {
		throw new NotFoundError(`Upload ${upload.publicId} files are not found.`);
	}

	let verification = $length(upload.sealPath) ? await (upload.verifyFileSeal()) : false ;
	if (!verification) {
		throw new FileError(`Upload file seal could not be verified.`);				
	}

	let destinationPath = $path(api.storagePathFiles, $filename(upload.path)) ;
	if (!$realMoveFile(upload.path, destinationPath)) {
		throw new FileError(`Impossible to move upload file to storage.`);			
	}

	let destinationSealPath = $path(api.storagePathSeals, $filename(<string>(upload.sealPath))) ;
	if (!$realMoveFile(upload.sealPath, destinationSealPath)) {
		throw new FileError(`Impossible to move upload seal path to storage.`);	
	}

	// we first, need to create a file object
	let file = await FileRef.query(c.trx).insert({
		fileName:body['file-name'],
		fileType:upload.fileType,
		hash:upload.hash,
		path:destinationPath,
		sealPath:destinationSealPath,
		size:upload.size,
		status:FileStatus.Valid,
		timestamped_at:upload.uploaded_at,
		uploaded_at:upload.uploaded_at,
		user:upload.user
	}) ;

	let newDocument:DocumentInterface = {
		publicId:session.sessionNextPublicID(), // for now it's not an async fn here
		sessionId:session.id,
		fileName:body['file-name'], // this is the genuine file name here
		title:body.title
	} ;
	if ($length(body.abstract)) newDocument.abstract = body.abstract ;
	if ($ok(body['manifest-data'])) newDocument.manifestData = body['manifest-data'] ;
	if ($ok(body['user-data'])) newDocument.userData = body['user-data'] ;

	let doc = await SessionDocument.query(c.trx).insert(newDocument) ;
	await doc.$rq('files', c)
					.for(doc.id)
					.relate(<any>{
					id:file.id,
					status:FileStatus.Valid // TODO: a better status here
					}
	) ;			
	await doc.$rq('genuineFile', c).relate(file) ;			
	session = await session.$q(c).patchAndFetch({ 
		lastPubObject:session.lastPubObject,				
	}) ; 
	doc.session = session ; // we want our graph straight

	await upload.cleanAndDelete(c) ;

	return doc ;
} 

export const addDocumentToSession = async (auth:APIAuth, sessionPublicID:number, body:CreateDocumentBody) : Promise<SessionDocument> => 
{
	let message = _missingErrorsInDocumentBody(body) ;
	if ($length(message)) {
		throw new BadRequestError(`Impossible to add document to session ${sessionPublicID}. ${message}.`);
	}
	const api = APIServer.api() ;

	if (!api.verifyManifestData(body['manifest-data'], api.conf.documentManifestData)) {
		throw new ManifestDataError(`manifest-data did not match allowed keys.`);
	}

	let returnValue = undefined ;
	try {
		returnValue = await Session.transaction(async trx => {
			const ctx = {trx:trx} ;
			const upload = await uploadWithURL(body.upload, ctx) ;

			if ($ext(body['file-name']).toLowerCase() !== $ext(upload.path)) { 
				throw new ConflictError("'file-name' extension is incompatible with upload extension") ;
			}


			let session = await sessionWithPublicID(auth, sessionPublicID, ctx) ;

			await checkSessionMutability(session) ;
			return await _addDocument(session, body, <Upload>upload, ctx) ;
		}) ;
	}
	catch (e) {
		// here we have a rollback
		APIServer.api().error(e);
		throw e ;
	}
	return returnValue ;

}
