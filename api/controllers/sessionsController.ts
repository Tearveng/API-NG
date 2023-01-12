import { $ok, $count, $unsigned } from 'foundation-ts/commons'

import { ConflictError, ManifestDataError, BadRequestError, ForbiddenError } from '../../utils/errors'

import Session from '../../model/Session'
import { SessionStatus, UserRole } from '../APIConstants'
import { APIAuth, SessionsQuery, CreateSessionBody } from '../APIInterfaces'
import { APIServer } from '../../server'
import { SessionInterface } from '../../model/DBInterfaces'
import { NO_CONTEXT } from '../../model/DBConstants'

export interface SessionListNode {
	publicId:number ;
	status:number ;
}

export const getSessionList = async (auth:APIAuth, q:SessionsQuery) : Promise<string[]> => {
	const query = Session.expirationAwareListQuery<SessionsQuery, Session>(auth, q, NO_CONTEXT) ;

	
	if (auth.role === UserRole.Action) {
		query.where('user', '=', auth.user)
			 .joinRelated('actors')
			 .orWhere('actors.login', '=', auth.user).distinct() ;
	}
	query.select('session.publicId', 'status').orderBy('session.publicId') ;

	let list = <SessionListNode[]>await query ;

	// TODO: here we can verify if we have a single bit status_mak which can
	// directly relate to database status value and put it in the request
	// instead of making post treatment
	let mask = $unsigned(q['status_mask']) ;
	if ($count(list) && mask > 0) {
		list = list.filter((n:SessionListNode) => ((n.status & mask) > 0)) ;
	}
	const api = APIServer.api() ;
	return $count(list) ? list.map((n:SessionListNode) => api.url('session', n.publicId)) : [] ;
};

export const createSession = async (auth:APIAuth, body:CreateSessionBody) : Promise<Session> => {
	if (auth.role === UserRole.Request) {
		// a request user cannot create sessions
		throw new ForbiddenError() ;
	} 
	const api = APIServer.api() ;
	if (!api.verifyManifestData(body['manifest-data'], api.conf.sessionManifestData)) {
		throw new ManifestDataError(`manifest-data did not match allowed keys.`);
	}

	const ttl = $unsigned(body.ttl) ;
	if (!ttl) { throw new BadRequestError('ttl undefined') ; }

	if (ttl < api.conf.ttlMin || ttl > api.conf.ttlMax) {
		throw new ConflictError(`Bad session ttl ${ttl}.`);
	}
	let returnValue = undefined ;
	try {
		returnValue = await Session.transaction(async trx => {
			const context = {trx:trx} ;
			let n = await Session.nextGlobalPublicID(context) ; // this method updates NGConfig table
			let newSession:SessionInterface = {
				publicId:n,
				status:SessionStatus.Genuine,
				ttl:ttl,
				user:auth.user,
				otherData:{ sessionContextEvents:[] },
			} ;
			if ($ok(body['manifest-data'])) newSession.manifestData = body['manifest-data'] ;
			if ($ok(body['user-data'])) newSession.userData = body['user-data'] ;
			let session = await Session.query(trx).insert(newSession);
			
			return session ;
		}) ;
	}
	catch (e) {
		// here we have a rollback
		APIServer.api().error(e);
		throw e ;
	}
	return <Session>returnValue ;
	
};

