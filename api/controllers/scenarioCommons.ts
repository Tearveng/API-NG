import { $count, $isobject, $ok, $unsigned } from "foundation-ts/commons";

import {
    NotFoundError,
    ConflictError,
    DatabaseError,
    ForbiddenError,
    BadRequestError,
    HTTPClientError,
    InternalError
} from "../../utils/errors";


import Actor from "../../model/Actor";
import Scenario from "../../model/Scenario";
import Session from "../../model/Session";
import SessionDocument  from "../../model/SessionDocument";
import { APIServer } from "../../server";
import {
	RoleType,
	ScenarioStatus,
	SignatureFormat,
	SignatureLevel,
	SignatureType,
	SigningProcess
} from "../APIConstants";
import { $lid, $url2lid, DocumentList, LocalID } from "../APIIDs";
import { ScenarioBody, StepNode } from "../APIInterfaces";
import { addAutomatNode, Automat, newAutomat } from "../automat/automat";
import { EditingContext, LastFilesDictionary } from "../../model/DBInterfaces";


export function missingErrorsInScenarioBody(api:APIServer, b:ScenarioBody) : [string, HTTPClientError|null]
{
	let u:string[] = [] ;
	let v:string[] = [] ;
	let format = $unsigned(b.format) ;
	let level = $unsigned(b.level) ;

	if (!format || !Object.values(SignatureFormat).includes(format)) { u.push('bad signature format') ; }
	if (!level || !Object.values(SignatureLevel).includes(level)) { u.push('bad signature level') ; }
	if (!$count(b.documents)) { u.push('documents') ; }
	if (!$count(b.steps)) { u.push('steps') ; }
	else {
		const signatureTypes = Object.values(SignatureType) ;
		b.steps.forEach((step, index) => {
			if (!$isobject(step)) { u.push(`bad step[${index}] definition`) ; }
			else {
				const roleType = api.roleType(step.process) ;

				// the signing process 'Sign' is only available for actors
				if (roleType === null || step.process === SigningProcess.Sign) { u.push(`bad step[${index}].process tag '${step.process}'`) ; }
				else if (roleType === undefined) { u.push(`step[${index}].process`) ; }

				if (roleType === RoleType.Signature) {
					let type = $unsigned(step.signatureType) ;
					if (!type || !signatureTypes.includes(type)) { u.push(`bad step[${index}].signatureType:${type}`) ; }
					if (((type == SignatureType.Detached || type == SignatureType.Envelopping) && format === SignatureFormat.PAdES) ||
					    (type == SignatureType.Envelopped && format === SignatureFormat.CAdES)) {
							v.push(`bad step[${index}].signatureType/format:${type}/${format}`) ;
					}
				}
				if (!$count(step.steps)) { u.push(`step[${index}].steps`) ; }
			}
		}) ;
	}

	if ($count(u)) { return [`Unspecified or inconcistent items : ${u.join(', ')}`, new BadRequestError()] ;}
	if ($count(v)) { return [`Conflicted items : ${v.join(', ')}`, new ConflictError()] ;}

	return ['', null];
}

// this function is meant to be used inside a database transaction
export const updatedCanceledScenario = async (scenario:Scenario, c:EditingContext) : Promise<Scenario> =>
{

	if (!$ok(c.trx)) {
		throw new InternalError('updatedCanceledScenario() should be called inside a transaction with a valid api server') ;
	}

	await scenario.destroyScenarioFiles(true, c) ;
	let data = {... scenario.otherData } ; // copy of the old scenario object data

	// we remove all trace of files
	// because when a scenario is cancelled
	// we SHOULD NOT download documents from it !
	data.generatedFiles = {} ;
	data.sourceFiles = {} ;
	data.originalLastFiles = {} ;

	return await scenario.$q(c).patchAndFetch({
		status:ScenarioStatus.Canceled,
		otherData:data,
	}) ;
}

/*
	Use this method during a transaction
	on a terminated scenario which means
	that generatedFiles are empty
	and sourceFiles contains the future
	documents' last files.
	The scenario.session is loaded is not
	present in our objects' graph
*/
export const fillDocumentsLastFiles = async (scenario:Scenario, c:EditingContext) : Promise<SessionDocument[]> =>
{
	// here we use the scenario sourceFiles in order to
	// populate the scenario documents last files
	let ret:SessionDocument[] = [] ;
	if ($ok(scenario.otherData.sourceFiles)) {
		const sourceFiles = <LastFilesDictionary>scenario.otherData.sourceFiles ;
		const session = await scenario.mySession({trx:c.trx}) ;
		for (let source in sourceFiles) {
			const did = $lid(source) ; // a real document id is key (as as string!) of the sourceFiles dictionary
			if (!did) {
				throw new NotFoundError(`Document with bad id)`)
			}
			let realDoc = await SessionDocument.sessionObjectWithPublicID<SessionDocument>(session, did, c) ;
			if (!$ok(realDoc)) {
				throw new NotFoundError(`Document with id (${session.publicId}, ${did}) not found`)
			}
			let newDocument = await (<SessionDocument>realDoc).$q(c).patchAndFetch({
				otherData:{ lastFiles:[...sourceFiles[source]] } // WARNING: if otherData of document structure evolves, so should this
			})
			if (!$ok(newDocument)) {
				throw new DatabaseError('Impossible to update document with generated files') ;
			}
			ret.push(newDocument) ;
		}
	}
	return ret ;
}

/**
 * this function is used on non-active session
 * to add or patch a scenario. It will verify if the given
 * documents carn be signed or approved in the manner describe
 * in steps and that the actor have not already signe or approved
 * one of these documents in the same manner that is described here.
 * This function assumes that session, documents and steps are OK
 * vars and well formed.
 * In the first version of the API, this functions returns a simple
 * linear structure for a linear automat
 */

export interface ScenarioInfos {
	aids:number[] ;
	dids:number[] ;
	automat:Automat ;
}

function _verifyRoleRights(roleType:RoleType | null | undefined, tag:string, roles:string[], user:string) {
	switch (roleType) {
		case RoleType.Approval:
			if (!roles.includes(SigningProcess.Approval) && !roles.includes(tag)) {
				throw new ForbiddenError(`Actor with URL '${user}' cannot aprove with tag '${tag}'`) ;
			}
			break ;
		case RoleType.Signature:
			if (!roles.includes(SigningProcess.Sign) && !roles.includes(tag)) {
				throw new ForbiddenError(`Actor with URL '${user}' cannot sign with tag '${tag}'`) ;
			}
			break ;
		case RoleType.Expedition:
			if (!roles.includes(tag)) {
				// TODO: may be we want just to check if the role is cc and to for now
				throw new ForbiddenError(`Actor with URL '${user}' cannot send with tag '${tag}'`) ;
			}
			break ;
		default:
			throw new BadRequestError(`Bad signing process type for tag ${tag}.`);
	}
}

export async function validateScenarioSteps(
	api:APIServer,
	session:Session,
	documentURLs:string[],
	steps:StepNode[],
	c:EditingContext
) : Promise<ScenarioInfos>
{
	let documents:DocumentList = [] ;
	let documentsSet = new Set<LocalID>() ;
	let actorsSet = new Set<LocalID>() ;

	for (let url of documentURLs) {
		const did = $url2lid(url) ;
		if (documentsSet.has(did)) {
			throw new ConflictError(`Document with URL '${url}' cannot be added twice.`)
		}
		let realDoc = await SessionDocument.sessionObjectWithPublicID<SessionDocument>(session, did, {trx:c.trx}) ;
		if (!$ok(realDoc)) {
			throw new NotFoundError(`Document with URL '${url}' not found`) ;
		}
		documents.push(did) ;
		documentsSet.add(did) ;
	}

	let signedDocs:{ [key: string]: { approvers:Set<LocalID>, signers:Set<LocalID>, expeditors:Set<LocalID> }} = {} ;

	// we put in, the same dictionary per document id, all signers, aprovers and expeditors
	if ($count(session.otherData?.signatures)) {
		session.otherData?.signatures?.forEach(sign => {
			let node = signedDocs[sign.did] ;
			if (!$ok(node)) {
				node = { approvers:new Set<LocalID>(), signers:new Set<LocalID>(), expeditors:new Set<LocalID>()} ;
				signedDocs[sign.did] = node ;
			}
			switch (sign.roleType) {
				case RoleType.Approval:
					node.approvers.add(sign.aid) ;
					break ;
				case RoleType.Signature:
					node.signers.add(sign.aid) ;
					break ;
				case RoleType.Expedition:
					node.expeditors.add(sign.aid) ;
			}
		})
	}

	// we prepare the signing dictionary for each document we have, even for thoses not
	// already signed in this session
	for(let did of documents) {
		if (!$ok(signedDocs[did])) {
			signedDocs[did] = { approvers:new Set<LocalID>(), signers:new Set<LocalID>(), expeditors:new Set<LocalID>()} ;
		}
	}
	let automat = newAutomat() ;
	let n = $count(steps) ;
	for (let i = 0 ; i < n ; i++) {
		const step = steps[i] ;
		const process = step.process ;
		const roleType = api.roleType(process) ;

		if (!$ok(roleType) || process === SigningProcess.Sign) {
			throw new BadRequestError(`bad step[${i}].process tag '${process}'`) ;
		}

		const stepActorIDs:LocalID[] = [] ;
		let localActorSet = new Set<LocalID>() ;

		//	we verify the actors first
		for (let url of step.steps) {
			const aid = $url2lid(url) ;
			if (localActorSet.has(aid)) {
				throw new NotFoundError(`Actor with URL '${url}' is used twice `)  ;
			}
			let realActor = await Actor.sessionObjectWithPublicID<Actor>(session, aid, {trx:c.trx}) ;
			if (!$ok(realActor)) {
				throw new NotFoundError(`Actor with URL '${url}' not found`) ;
			}

			_verifyRoleRights(roleType, process, <string[]>(realActor?.rolesArray), url) ;

			stepActorIDs.push(aid) ;
			localActorSet.add(aid) ;
			actorsSet.add(aid) ;
		}

		// then we verify the step coherence itself
		const acount = $count(stepActorIDs) ;
		let card = 0 ;

		if (!$ok(step.cardinality)) {
			card = roleType === RoleType.Signature && process !== SigningProcess.Cosign ? acount : 1 ;
		}
		else {
			card = step.cardinality === 'one' ? 1 : (step.cardinality === 'all' ? acount : $unsigned(step.cardinality)) ;
		}

		if (!card || card > acount ||
			(card !== acount && (process === SigningProcess.Countersign || process === SigningProcess.OrderedCosign))) {
			throw new ConflictError(`bad step[${i}].cardinality (${card}) with process ${process}`) ;
		}

		switch (roleType) {
			case RoleType.Approval:
				for (let did of documents) {
					if (signedDocs[did].signers.size) {
						throw new ConflictError(`Cannot approve document with id (${session.publicId}, ${did}) because It is already signed.`);
					}
					for (let aid of stepActorIDs) {
						if (signedDocs[did].approvers.has(aid)) {
							throw new ConflictError(`Cannot approve document with id (${session.publicId}, ${did}) twice.`);
						}
						signedDocs[did].approvers.add(aid) ;
					}
				}

				addAutomatNode(automat, {
					roleType:roleType,
					tag:process,
					aids:stepActorIDs,
					concernedActors:card,
					dids:documents,
					stepIndex:i
				}) ;

				break ;
			case RoleType.Signature:
				for (let did of documents) {
					for (let aid of stepActorIDs) {
						if (signedDocs[did].signers.has(aid)) {
							throw new ConflictError(`Cannot sign document with id (${session.publicId}, ${did}) twice.`);
						}
						signedDocs[did].signers.add(aid) ;
					}
				}
				switch (process) {
					case SigningProcess.IndividualSign:
					case SigningProcess.Cosign:
						addAutomatNode(automat, {
							roleType:roleType,
							tag:process,
							aids:stepActorIDs,
							concernedActors:card,
							dids:documents,
							stepIndex:i
						}) ;
						break ;
					case SigningProcess.Countersign:
					case SigningProcess.OrderedCosign:
						// here we have card === acount
						for (let j = 0 ; j < acount ; j++) {
							addAutomatNode(automat, {
								roleType:roleType,
								tag:process,
								aids:[stepActorIDs[j]],
								concernedActors:1,
								dids:documents,
								stepIndex:i
							}) ;
						}
						break ;
					default:
						throw new BadRequestError(`Signing process ${process} not found.`);
				}
				break ;
			case RoleType.Expedition:
				for (let did of documents) {
					if (signedDocs[did].signers.size == 0) {
						throw new ConflictError(`Cannot send document with id (${session.publicId}, ${did}) if it's not signed.`);
					}

					for (let aid of stepActorIDs) {
						if (signedDocs[did].expeditors.has(aid)) {
							throw new ConflictError(`Cannot send document with id (${session.publicId}, ${did}) twice.`);
						}
						signedDocs[did].expeditors.add(aid) ;
					}
				}
				addAutomatNode(automat, {
					roleType:roleType,
					tag:process,
					aids:stepActorIDs,
					concernedActors:stepActorIDs.length,
					dids:documents,
					stepIndex:i
				}) ;
				break ;
			default:
				throw new BadRequestError(`Bad signing process type.`);
			}
	}

	return {
		aids:Array.from(actorsSet),
		dids:documents,
		automat:automat
	} ;
}
