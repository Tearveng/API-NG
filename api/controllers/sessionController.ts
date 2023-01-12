import { $ok, $length } from 'foundation-ts/commons'
import { $removeFile } from 'foundation-ts/fs'
import { Resp } from 'foundation-ts/tsrequest'
import { $uuid } from 'foundation-ts/crypto'

import { $now, $finalDateString } from '../../utils/commons'
import { 
	NotFoundError, 
	ForbiddenError, 
	ConflictError, 
	ManifestDataError, 
	InternalError,
	FileError,
	BadRequestError
} from '../../utils/errors'

import Session from '../../model/Session'
import Download from '../../model/Download';
import { APIServer } from '../../server'
import { APIFileType, APIRoleNames, SessionStatus } from '../APIConstants'
import { ManifestData, APIAuth } from '../APIInterfaces';
import { updatedCanceledScenario } from './scenarioCommons';
import { Manifest } from '../../classes/Manifest';
import FileRef from '../../model/FileRef';
import { EditingContext, FileInterface, SessionContextEventType } from '../../model/DBInterfaces';

export const sessionWithPublicID = async (auth:APIAuth, sessionPublicID:number, c:EditingContext) : Promise<Session> => {
	let session = await Session.objectWithPublicID<Session>(sessionPublicID, c) ;
	
	if (!$ok(session)) {
		throw new NotFoundError(`Session with ID ${sessionPublicID} was not found.`);
	}
	if (!(await session?.acceptsUser(auth.apiRole, auth.user, auth.role, c))) {
		throw new ForbiddenError(`Session with ID ${sessionPublicID} does not accept user ${auth.user} for action ${APIRoleNames[auth.apiRole]}.`);
	}

	return <Session>session ;
};
export const getSessionByID = sessionWithPublicID ; // getSessionByID is meant to be used only in session.ts routes definitions

// this a private function
function _closingSessionStatus(s:SessionStatus) : SessionStatus
{
	return s === SessionStatus.Genuine ? 
					SessionStatus.Deleted :
					(s === SessionStatus.UnderConstruction || s === SessionStatus.Idle ? 
						SessionStatus.WellTerminated : 
						SessionStatus.Canceled
					) ;
}

// this function SHOULD be called inside a transaction
async function _manifest(auth:APIAuth, session:Session, c:EditingContext) : Promise<Download> {

	if (!$ok(c.trx)) {
		throw new InternalError('_manifest() should be called inside a transaction') ;
	}

	const api = APIServer.api() ;

	let fileRef = await session.$rq('manifestFile', c) ;
	if (!$ok(fileRef)) {
		// we need to generate the manifest
		const producer = Manifest.producer() ;
		const manifestFile = await producer.generateManifest(auth, session, c, undefined, APIServer.api().conf.manifestOptions) ;
		if (!$ok(manifestFile)) {
			throw new InternalError('Impossible to generate or sign manifest file') ;
		}
		const newFileStruct = await FileRef.fileWithBuffer(auth, <Buffer>manifestFile, api.conf.storagePath, $now(), $uuid(), APIFileType.PDF)
		if (!$ok(newFileStruct)) {
			throw new FileError('Impossible to save signed PDF manifest file') ;
		}
		fileRef = await FileRef.query(c.trx).insert(<FileInterface>newFileStruct) ;
		if (!$ok(fileRef)) {
			$removeFile(newFileStruct?.path) ;
			$removeFile(newFileStruct?.sealPath) ;
		}
		await session.$rq('manifestFile', c).relate(fileRef) ;			
	}
	let pid = await Download.nextGlobalPublicID(c) ; // this method updates NGConfig table

	// this function always returns a new download
	let download = await Download.query(c.trx).insert({
		publicId:pid,
		sessionId:session.id,
		size:fileRef.size,
		ttl:api.conf.downloadTtl,
		user:auth.user
	}) ;
	await download.$rq('file', c).relate(fileRef) ;			
	download.session = session ; // we want our graph straight
	return download ;
}

async function _closeAndManifest(
	api:APIServer,
	auth:APIAuth, 
	session:Session, 
	reason:string, 
	manifestData:ManifestData, 
	newStatus:SessionStatus | 0, 
	manifest:boolean, 
	c:EditingContext) : Promise <Download|null> 
{

	if (!$ok(api) || !$ok(c.trx)) {
		throw new InternalError('_closeAndManifest() should be called inside a transaction with a valid api server') ;
	}
	if (newStatus) {
		let otherData = { ...session.otherData } ;
		const now = $now() ;
		otherData.sessionContextEvents.push({
			user:auth.user,
			date:now,
			'event-type':SessionContextEventType.Closure,
			reason:reason,
			'manifest-data':manifestData
		}) ;
		const updatedSession = await session.$q(c).patchAndFetch({ 
			expires_at: now, // with that a closed session is always an expired one
			otherData: otherData,
			status: newStatus
		});
		let scenario = await updatedSession.$rq('activeScenario', c)  ;
		
		// it means that we have an active scenario that we need to stop it
		if ($ok(scenario)) {
			await updatedCanceledScenario(scenario, c) ; // we don't use the returned scenario here
			await updatedSession.$rq('activeScenario', c).unrelate() ;
		}
		if (SessionStatus.WellTerminated && manifest) {
			return await _manifest(auth, session, c) ;
		}
		return null ;
	}
	return await _manifest(auth, session, c) ;
}

export const checkSessionMutability = async(session:Session) => {
	if (session.isClosed()) {
		throw new ForbiddenError(`Session ${session.publicId} is closed.`);
	}
	if (session.isActive()) {
		throw new ForbiddenError(`Session ${session.publicId} is active.`);
	}
	if (session.isExpired()) {
		throw new ForbiddenError(`Session ${session.publicId} is expired.`);
	}
}


export const closeSession = async (
	auth:APIAuth, 
	sessionPublicID:number, 
	force:boolean, 
	reason:string, 
	manifestData:ManifestData
) 
: Promise<{download:Download|null, code:number, status:number}> => 
{
	let returnValue = null ;
	console.log("REASON:",reason);
	if (!$length(reason)) {
		throw new BadRequestError(`No reason was given to close the session.`);
	}
	const api = APIServer.api() ;

	if (!api.verifyManifestData(manifestData, api.conf.closureManifestData)) {
		throw new ManifestDataError(`manifest-data for session ${sessionPublicID} did not match allowed keys.`);
	}

	try {
		returnValue = await Session.transaction(async trx => {
			const context = {trx:trx} ;
			let session = await sessionWithPublicID(auth, sessionPublicID, context) ;
			
			if (session.isClosed()) {
				throw new ForbiddenError(`Session ${sessionPublicID} was already closed.`);
			}

			if (session.isActive() && (!force || !api.conf.acceptsForcedClosure)) {
				throw new ForbiddenError(`Session ${sessionPublicID} is active and cannot be closed.`);
			}
		
			const manifestDownload = await _closeAndManifest(
				api, 
				auth, 
				session, 
				reason, 
				manifestData, 
				_closingSessionStatus(session.status), 
				api.conf.manifestOnClosure,
				context) ;
			return {download:manifestDownload, code:($ok(manifestDownload) ? Resp.Created : Resp.OK), status:session.status} ;
		}) ;
	}
	catch (e) {
		api.error(e);
		throw e ;
	}
	
	return returnValue ;
} ;

export const extendSession = async (auth:APIAuth, sessionPublicID:number, newttl:number) : Promise<Session> => {
	let returnValue = null ;
	const api = APIServer.api() ;
	try {
		returnValue = await Session.transaction(async trx => {
			const context = {trx:trx} ;
			let session = await sessionWithPublicID(auth, sessionPublicID, context) ;
			if (session.isClosed() || session.isExpired()) {
				throw new ForbiddenError(`Session ${sessionPublicID} is closed or already expired.`);
			}
			if (newttl <= session.ttl || newttl > api.conf.ttlMax) {
				throw new ConflictError(`Bad new ttl ${newttl} for session ${sessionPublicID}.`);
			}
			let newFinalDate = $finalDateString(session.created_at, newttl) ;
			return await session.$q(context).patchAndFetch({ 
				expires_at: newFinalDate,
				ttl: newttl
			});
		}) ;
	}
	catch (e) {
		api.error(e);
		throw e ;
	}
	return returnValue ;
} ;

export const getSessionManifestDownload = async (auth:APIAuth, sessionPublicID:number) : Promise<Download> => {
	let returnValue = null ;
	const api = APIServer.api() ;

	try {
		returnValue = await Session.transaction(async trx => {
			const context = {trx:trx} ;
			let session = await sessionWithPublicID(auth, sessionPublicID, context) ;

			if (session.isOpened()) {
				throw new ForbiddenError(`Session ${sessionPublicID} is not closed.`);
			}

			const ret = await _closeAndManifest(api, auth, session, '', null, 0, false, context) ;
			if (!$ok(ret)) {
				throw new InternalError() ;
			}
			return <Download>ret ;
		}) ;
	}
	catch (e) {
		api.error(e);
		throw e ;
	}
	console.log("RETURN getSessionManifestDownloadX",returnValue);
	return returnValue ;
} ;
