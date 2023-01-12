import { StringArrayDictionary } from 'foundation-ts/types';
import { $count, $length, $ok, $strings } from 'foundation-ts/commons';
import { $trim } from 'foundation-ts/strings';

import { $phone } from "../../utils/commons";
import { BadRequestError, ConflictError, InternalError, ManifestDataError } from '../../utils/errors'

import Actor from '../../model/Actor';
import Session from '../../model/Session'
import { sessionWithPublicID, checkSessionMutability } from './sessionController'
import { ActorType, AuthType } from '../APIConstants'
import { APICountries } from '../APICountries';
import { APIServer } from '../../server'
import { GlobalID, LocalID } from '../APIIDs';
import { APIAuth, CreateActorBody, ActorsQuery } from '../APIInterfaces';
import { Automat, automatSigningDocuments, SigningNodeDictionary } from '../automat/automat';
import { ActorInterface, EditingContext } from '../../model/DBInterfaces';
import { Certigna } from '../../classes/CertignaEndPoint';
import { apiGlobals } from '../../model/DBConstants';


export const getSessionActorList = async (auth:APIAuth,sessionPublicID:GlobalID, q:ActorsQuery) : Promise<object> => 
{
	let session = await sessionWithPublicID(auth, sessionPublicID, {prefetchings:'[activeScenario, actors]'}) ; // we load the actors and the active scenario with our session
	let tags = $strings(q.tags) ;

	if ($count(tags)) {
		let returnedValue:StringArrayDictionary = {} ;
		if (session.isActive()) {
			let automat = session.activeScenario?.otherData.automat ;
			if ($ok(automat)) {
				let taggedDocuments = automatSigningDocuments(<Automat>automat) ;
				if ($ok(taggedDocuments)) {
					const tdocs = <SigningNodeDictionary>taggedDocuments ;
					const api = APIServer.api() ;
					tags.forEach (t => {
						let actorSet = new Set<LocalID>() ;
						let documents = tdocs[t] ;
						documents.forEach(d => {
							d.aids.forEach(u => actorSet.add(u)) ;
						}) ;
						let actorIDs = Array.from(actorSet) ;
						if ($count(actorIDs)) {
							returnedValue[t] = actorIDs.map(aid => api.url('session', sessionPublicID, 'actor', aid)) ;
						}
					}) ;	
				}	
	
			}
		}
		return returnedValue ;
	}
	return { actors: $count(session.actors) ? session.actors?.map((a:Actor) => a.url(sessionPublicID)) : [] } ;
}

// private function
function _roles(param:string[] | string | null | undefined) : string[]
{
	// TODO: we also should validate roles against an API list
	let a = $strings(param) ;
	let roles:string[] = [] ;
	if ($count(a)) {
		a.forEach(s => { 
			s = $trim(s) ; 
			if ($length(s) > 0) roles.push(s) ; 
		}) ;
	}
	return roles ;
}

function _missingErrorsInActorBody(b:CreateActorBody) : string
{
	let u:string[] = [] ;
	let roles = _roles(b.roles) ;

	if (!$count(roles)) { u.push('roles') ; }
	if (!$length(b['name'])) { u.push('name') ; }
	if (!$length(b['country']) || !$ok((<any>APICountries)[b['country'].toUpperCase()])) { u.push('country') ; }
	if (!$length(b['email'])) { u.push('email') ; }
	if (b.type == ActorType.Entity && !$length(b['adm-id'])) { u.push('adm-id') ; }
	return $count(u) > 0 ? `Unspecified or inconsistent items : ${u.join(', ')}`:'' ;
}



// this a private function
async function _addActor(session:Session, body:CreateActorBody, roles:string[], authType:AuthType, c:EditingContext) : Promise <Actor> 
{
	if (!$ok(c.trx)) {
		throw new InternalError('_addActor() should be called inside a transaction') ;
	}

	let newActor:ActorInterface = {
		publicId:session.sessionNextPublicID(), // for now it's not an asyn fn here
		sessionId:session.id,
		name: body.name,
		email:body.email,
		type: body.type,
		country: body.country,
		rolesArray: roles,
		authType:authType
	} ;

	console.log("BODY:XXX::",body);

	if ($length(body.login)) {
		if (await session.hasActorWithLogin(<string>body.login, c)) {
			throw new ConflictError(`Trying to insert actor with same login '${body.login}' as others.`) ;
		} 
		newActor.login = body.login ;
	}

	if ($length(body['adm-id'])) newActor.administrativeCode = body['adm-id'] ;
	if ($length(body['first-name'])) newActor.firstName = body['first-name'] ;
	if ($ok(body['manifest-data'])) newActor.manifestData = body['manifest-data'] ;
	if ($length(body.mobile)) newActor.mobile = body.mobile ;
	if ($ok(body['user-data'])) newActor.userData = body['user-data'] ;

	session = await session.$q(c).patchAndFetch({ 
		lastPubObject:session.lastPubObject,				
	}) ; 
	let actor = await Actor.query(c.trx).insert(newActor) ;
	actor.session = session ; // we want our graph straight

	return actor ;
}

export const addActorToSession = async (auth:APIAuth, sessionPublicID:number, body:CreateActorBody) : Promise<Actor> => {

	// we format the phone and if the result is empty it may issue an error
	let country = (<any>APICountries)[body.country.toUpperCase()] ;
	body.mobile = $phone(body.mobile, country?.dial) ;

	let message = _missingErrorsInActorBody(body) ;
	if ($length(message)) {
		throw new BadRequestError(`Impossible to add actor to session ${sessionPublicID}. ${message}.`);
	}
	
	if (body.type == ActorType.Entity && $length(body['first-name'])) { 
		throw new ConflictError("First name should not be used for actor's entities") ;
	}

	const el = $length(body.email) ;
	if (el > apiGlobals.emailLength || el > Certigna.endPoint().emailSizeMax) {
		throw new BadRequestError(`Email of actor is too large (${el} characters).`);
	}

	const api = APIServer.api() ;

	let checkedRoles = api.checkRoles(body.roles, true, true, true) ;
	if (checkedRoles.nulls > 0) {
		throw new BadRequestError(`Impossible to add actor to session ${sessionPublicID}. Found empty roles.`);
	}
	if ($count(checkedRoles.rejecteds) > 0) {
		throw new BadRequestError(`Impossible to add actor to session ${sessionPublicID}. Roles ${checkedRoles.rejecteds.join(', ')} are not valid.`);
	}
	if (!$count(checkedRoles.roles)) {
		throw new BadRequestError(`Impossible to add actor to session ${sessionPublicID}. No roles are specified.`);
	}

	if (!api.verifyManifestData(body['manifest-data'], api.conf.actorManifestData)) {
		throw new ManifestDataError(`manifest-data did not match allowed keys.`);
	}

	let returnValue = undefined ;
	try {
		returnValue = await Session.transaction(async trx => {
			const context = {trx:trx}
			let session = await sessionWithPublicID(auth, sessionPublicID, context) ;
			await checkSessionMutability(session) 
			return await _addActor(session, body, checkedRoles.roles, checkedRoles.authType, context) ;
		}) ;
	}
	catch (e) {
		// here we have a rollback
		APIServer.api().error(e);
		throw e ;
	}
	return returnValue ;
}