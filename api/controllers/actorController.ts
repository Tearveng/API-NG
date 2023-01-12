
import { $isnumber, $ok } from 'foundation-ts/commons';

import { NotFoundError, ForbiddenError } from '../../utils/errors'

import Actor from '../../model/Actor';
import { sessionWithPublicID } from './sessionController'
import { GlobalID, LocalID } from '../APIIDs';
import { APIAuth } from '../APIInterfaces';
import Session from '../../model/Session';
import { EditingContext } from '../../model/DBInterfaces';
import { APIServer } from '../../server';

export const getSessionActorByID = async (auth:APIAuth, sessionOrID:GlobalID|Session, aid:LocalID, c:EditingContext) : Promise<Actor> => {
	let session = $isnumber(sessionOrID) ? await sessionWithPublicID(auth, <GlobalID>sessionOrID, {trx:c.trx}) : <Session>sessionOrID  ;
	let actor = await Actor.sessionObjectWithPublicID<Actor>(session, aid, c) ;
	if (!$ok(actor)) {
		throw new NotFoundError(`Actor with IDs (${session.publicId},${aid}) was not found.`);
	}
	return <Actor>actor ; 
}

export const removeSessionActor = async (auth:APIAuth, sessionPublicID:GlobalID, aid:LocalID) : Promise<string> =>
{
	let returnValue = undefined ;
	try {
		returnValue = await Actor.transaction(async trx => {
			const context = {trx:trx} ;
			let actor = await getSessionActorByID(auth, sessionPublicID, aid, context) ;
			if (!(await actor.canBeDeleted(context))) {
				throw new ForbiddenError(`Actor with IDs (${sessionPublicID},${aid}) cannot be deleted.`);
			}
			const url = (<Actor>actor).url(sessionPublicID) ;
			await actor.$delete(context) ;
			return url ;
		}) ;
	}
	catch (e) {
		// here we have a rollback
		APIServer.api().error(e);
		throw e ;
	}

	return returnValue ;
}
