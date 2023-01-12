import { $count, $length, $ok, $unsigned } from 'foundation-ts/commons';
import { $inspect } from 'foundation-ts/utils';

import { ConflictError, HTTPClientError, ManifestDataError } from '../../utils/errors' ;

import Scenario from '../../model/Scenario';
import { APIServer } from '../../server';
import { ScenarioStatus } from '../APIConstants';
import { APIAuth, ScenarioBody } from '../APIInterfaces';
import { Automat } from '../automat/automat';
import { missingErrorsInScenarioBody, validateScenarioSteps } from './scenarioCommons';
import { checkSessionMutability, sessionWithPublicID } from './sessionController';
import { ScenarioInterface } from '../../model/DBInterfaces';


export const getSessionScenariosList = async (auth:APIAuth, sessionPublicID:number) : Promise<string[]> => {
	let session = await sessionWithPublicID(auth, sessionPublicID, {prefetchings: 'scenarios(orderByRank)' }) ; 
	// we did load the scenarios with our session and did sort them by rank
	return $count(session.scenarios) ? (<Scenario[]>(session.scenarios)).map((s:Scenario) => s.url(sessionPublicID)) : [] ;
} ;

export const addScenarioToSession = async (auth:APIAuth, sessionPublicID:number, body:ScenarioBody) : Promise<Scenario> => {

	let returnValue = undefined ;
	const api = APIServer.api() ;
	let [message, error] = missingErrorsInScenarioBody(api, body) ;

	if ($length(message)) {
		(<HTTPClientError>error).message = `Impossible to add scenario to session ${sessionPublicID}. ${message}.` ;
		throw error;
	}

	if (!api.verifyManifestData(body['manifest-data'], api.conf.scenarioManifestData)) {
		throw new ManifestDataError(`manifest-data did not match allowed keys.`);
	}

	try {
		returnValue = await Scenario.transaction(async trx => {
			const context = {trx:trx} ;
			let session = await sessionWithPublicID(auth, sessionPublicID, context) ;
			await checkSessionMutability(session) ;
			console.log("addScenarioToSessionX1",session,body.documents,body.steps);
			let infos = await validateScenarioSteps(api, session, body.documents, body.steps, context) ;
			console.log("addScenarioToSessionX2",infos);
			let previousScenarios = await session.$rq('scenarios', context)
												 .select('status')
												 .orderBy('rank') ;
			console.log("addScenarioToSessionX2");
			const n = $count(previousScenarios) ;
			if (n && previousScenarios[n-1].status != ScenarioStatus.WellTerminated /*&& results[n-1].status != ScenarioStatus.WellExpiredAfterSplit*/) {
				throw new ConflictError('Trying to insert new scenario after a non terminated or bad terminated scenario') ;
			}

			const maxRank = await session.maxScenarioRank(context) ;

			const resource:ScenarioInterface = {
				otherData: {
					documentURLs:body.documents,
					dids:<number[]>(infos?.dids),
					aids:<number[]>(infos?.aids),
					automat:<Automat>(infos?.automat)
				},
				publicId:session.sessionNextPublicID(), // for now it's not an asyn fn here
				rank:maxRank+1,
				sessionId:session.id,
				signatureFormat:$unsigned(body.format),
				signatureLevel:$unsigned(body.level),
				status:ScenarioStatus.UnderConstruction,
				stepsDefinition:body.steps
			}
			if ($ok(body['manifest-data'])) resource.manifestData = body['manifest-data'] ;
			if ($ok(body['user-data'])) resource.userData = body['user-data'] ;

			APIServer.api().log(`addScenarioToSession(${session.publicId},${$inspect(resource)})`)
		
			let scenario = await Scenario.query(trx).insert(resource) ;
		
			session = await session.$q(context).patchAndFetch({ 
				lastPubObject:session.lastPubObject,				
			}) ; 
			scenario.session = session ; // we want our graph straight

			return scenario ;
		}) ;
	}
	catch (e) {
		console.log("addScenarioToSessionXE");
		APIServer.api().error(e);
		throw e ;
	}
	return <Scenario>returnValue ;
}
