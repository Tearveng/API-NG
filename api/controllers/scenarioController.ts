import { $isnumber, $length, $ok, $unsigned } from 'foundation-ts/commons';
import { $inspect } from 'foundation-ts/utils';

import { $now } from '../../utils/commons';
import { 
	NotFoundError, 
	ForbiddenError, 
	ConflictError, 
	ManifestDataError, 
	HTTPClientError
} from '../../utils/errors'

import Scenario from '../../model/Scenario'
import { checkSessionMutability, sessionWithPublicID } from './sessionController'
import { ScenarioStatus, SessionStatus } from '../APIConstants'
import { APIServer } from '../../server';
import { 
	APIAuth, 
	ManifestDataBody, 
	ScenarioBody, 
	ScenarioCancelBody, 
	ScenarioSplitBody
} from '../APIInterfaces';
import { 
	missingErrorsInScenarioBody, 
	validateScenarioSteps, 
	updatedCanceledScenario 
} from './scenarioCommons';
import { aidsForAutomat, Automat, splitedAutomats } from '../automat/automat';
import { EditingContext, ScenarioInterface, ScenarioUpdateInterface, SessionContextEventType } from '../../model/DBInterfaces';
import { GlobalID, LocalID } from '../APIIDs';
import Session from '../../model/Session';

export const getSessionScenarioByID = async (
	auth:APIAuth, 
	sessionOrID:GlobalID|Session, 
	sid:LocalID,
	c:EditingContext) : Promise<Scenario> => 
{	
	let session = $isnumber(sessionOrID) ? await sessionWithPublicID(auth, <GlobalID>sessionOrID, {trx:c.trx}) : <Session>sessionOrID  ;
	let scenario = null ;
	if ($ok(session)) {
		scenario = await Scenario.sessionObjectWithPublicID<Scenario>(session, sid, c) ; 
	}
	if (!$ok(scenario)) {
		throw new NotFoundError(`Scenario with IDs (${session.publicId}, ${sid}) was not found.`);
	}
	return <Scenario>scenario ; 
}

export const updateSessionScenario = async (auth:APIAuth, sessionPublicID:number, sid:number, body:ScenarioBody) : Promise<Scenario> =>
{
	let ret = undefined ;
	try {
		ret = await Scenario.transaction(async trx => {
			const context = { trx: trx } ;
			const session = await sessionWithPublicID(auth, sessionPublicID, context) ;
			let scenario = await getSessionScenarioByID(auth, session, sid, context) ;

			if (!scenario.isUnderConstruction()) {
				throw new ConflictError(`Scenario with ID (${sessionPublicID},${sid}) cannot be modified.`);
			}

			const api = APIServer.api() ;
			let [message, error] = missingErrorsInScenarioBody(api, body) ;

			if ($length(message)) {
				(<HTTPClientError>error).message = `Impossible to update scenario with ID (${sessionPublicID}, ${sid}). ${message}.` ;
				throw error;
			}

			if (!api.verifyManifestData(body['manifest-data'], api.conf.scenarioManifestData)) {
				throw new ManifestDataError(`manifest-data did not match allowed keys.`);
			}

			await checkSessionMutability(session) ;
			let infos = await validateScenarioSteps(api, session, body.documents, body.steps, context) ;

			const update:ScenarioUpdateInterface = {
				otherData:{
					dids:<number[]>(infos?.dids),
					aids:<number[]>(infos?.aids),
					documentURLs:body.documents,
					automat:<Automat>(infos?.automat)
				},
				signatureFormat:$unsigned(body.format),
				signatureLevel:$unsigned(body.level),
				status:scenario.status,
				stepsDefinition:body.steps
			} ;
			scenario = await scenario.$q(context).patchAndFetch(update) ;
			scenario.session = session ; // we keep our graph strait
			return scenario ;
		}) ;
	}
	catch (e) {
		APIServer.api().error(e);
		throw e ;
	}

	return ret ;
}

export const activateScenario = async (auth:APIAuth, sessionPublicID:number, sid:number, body:ManifestDataBody) : Promise<Scenario> =>
{
	let api = APIServer.api() ;
	const manifestData = body['manifest-data'] ;

	api.log(`******* ACTIVATE MANIFEST DATA REFERENCE:\n${$inspect(api.conf.activateManifestData)}`) ;
	api.log(`******* ACTIVATE MANIFEST DATA          :\n${$inspect(manifestData)}`) ;

	if (!api.verifyManifestData(manifestData, api.conf.activateManifestData)) {
		throw new ManifestDataError(`manifest-data for activating scenario (${sessionPublicID},${sid}) did not match allowed keys.`);
	}		

	let ret = undefined ;
	try {
		ret = await Scenario.transaction(async trx => {
			const context = { trx: trx } ;
			const session = await sessionWithPublicID(auth, sessionPublicID, context) ;
			let scenario = await getSessionScenarioByID(auth, session, sid, context) ;

			if (!scenario.isUnderConstruction()) {
				throw new ConflictError(`Scenario with IDs (${sessionPublicID},${sid}) cannot be activated (#1).`);
			}

			const maxRank = await session.maxScenarioRank(context) ;
			if (maxRank !== scenario.rank) {
				throw new ConflictError(`Scenario with IDs (${sessionPublicID},${sid}) cannot be activated (#2).`);
			}
		
			let scenarioOtherData = {... scenario.otherData } ;
			const lastFiles = await scenario.fetchLastFilesFromDocuments(context) ;
			let otherData = { ...session.otherData } ;
			
			scenarioOtherData.originalLastFiles = {...lastFiles} ; // here we take a copy
			scenarioOtherData.sourceFiles = lastFiles ;
			scenarioOtherData.generatedFiles = {} ;

			// the scenario manifest data is included in the event chain at activation
			// at its last modification date (keep it here before the next scenario update)
			otherData.sessionContextEvents.push({
				user:auth.user,
				date:scenario.modificationDate(),
				'event-type':SessionContextEventType.CreateScenario,
				'scenario-id':scenario.publicId,
				'manifest-data':scenario.manifestData
			}) ;

			scenario = await scenario.$q(context).patchAndFetch({
				status:ScenarioStatus.ActiveScenario,
				otherData:scenarioOtherData
			}) ;
			scenario.session = session ; // strait graph


			otherData.sessionContextEvents.push({
				user:auth.user,
				date:$now(),
				'event-type':SessionContextEventType.ActivateScenario,
				'scenario-id':scenario.publicId,
				'manifest-data':manifestData
			}) ;

			let updatedSession = await session.$q(context).patchAndFetch({ 
				status:SessionStatus.Active,
				otherData:otherData
			}) ; 
			scenario.session = updatedSession ; // strait graph

			await updatedSession.$rq('activeScenario', context).relate(scenario) ;

			return scenario ;
		}) ;
	}
	catch (e) {
		APIServer.api().error(e);
		throw e ;
	}
	return ret ;
}

export const removeSessionScenario = async (auth:APIAuth, sessionPublicID:number, sid:number) : Promise<string> =>
{
	let returnValue = undefined ;
	try {
		returnValue = await Scenario.transaction(async trx => {
			const context = {trx:trx} ;
			let scenario = await getSessionScenarioByID(auth, sessionPublicID, sid, context) ;
			if (!scenario.isUnderConstruction()) {
				throw new ForbiddenError(`Scenario with IDs (${sessionPublicID},${sid}) cannot be deleted.`);
			}
			let url = (<Scenario>scenario).url(sessionPublicID) ;
			await scenario.$delete(context) ;
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


export const cancelScenario = async (auth:APIAuth, sessionPublicID:number, sid:number, body:ScenarioCancelBody) : Promise<Scenario> =>
{
	let returnedValue = undefined ;

	if (!$length(body.reason)) {
		throw new ConflictError(`No reason was given to cancel the scenario.`);
	}

	let api = APIServer.api() ;
	const manifestData = body['manifest-data'] ;
	if (!api.verifyManifestData(manifestData, api.conf.cancelManifestData)) {
		throw new ManifestDataError(`manifest-data for cancelling scenario (${sessionPublicID},${sid}) did not match allowed keys.`);
	}

	try {
		returnedValue = await Scenario.transaction(async trx => {
			const context = {trx:trx} ;
			let session = await sessionWithPublicID(auth, sessionPublicID, context) ;
			let scenario = await getSessionScenarioByID(auth, session, sid, context) ;

			if (!scenario.isActive()) {
				throw new ConflictError(`Scenario with IDs (${sessionPublicID},${sid}) cannot be canceled.`);
			}
			
			scenario = await updatedCanceledScenario(scenario, context) ;
			scenario.session = session ; // strait graph

			let otherData = { ...session.otherData } ;
			otherData.sessionContextEvents.push({
				user:auth.user,
				date:$now(),
				'event-type':SessionContextEventType.CancelScenario,
				'scenario-id':scenario.publicId,
				reason:body.reason,
				'manifest-data':manifestData
			}) ;

			let updatedSession = await session.$q(context).patchAndFetch({ 
				status:SessionStatus.Canceled,
				otherData:otherData
			}) ; 

			await updatedSession.$rq('activeScenario', context).unrelate() ;
			return scenario ;
		}) ;
	}
	catch (e) {
		APIServer.api().error(e);
		throw e ;
	}
	return returnedValue ;
}

export const splitScenario = async (auth:APIAuth, sessionPublicID:number, sid:number, body:ScenarioSplitBody) : Promise<Scenario> =>
{
	let returnValue = undefined ;
	const api = APIServer.api() ;

	if (!$length(body.reason)) {
		throw new ConflictError(`No reason was given to split the scenario.`);
	}

	const manifestData = body['manifest-data'] ;
	if (!api.verifyManifestData(body['manifest-data'], api.conf.scenarioManifestData)) {
		throw new ManifestDataError(`manifest-data did not match allowed keys for activated scenario by split operation.`);
	}

	try {
		returnValue = await Scenario.transaction(async trx => {
			const context = {trx:trx} ;
			let session = await sessionWithPublicID(auth, sessionPublicID, context) ;
			let scenario = await getSessionScenarioByID(auth, session, sid, context) ;

			if (!scenario.isActive()) {
				throw new ConflictError(`Scenario with IDs (${sessionPublicID},${sid}) is not active and cannot be splitted.`);
			}
			let splittedAutomats = splitedAutomats(scenario.otherData.automat) ;

			if (!$ok(splittedAutomats)) {
				throw new ConflictError(`Scenario with IDs (${sessionPublicID},${sid}) cannot be splited.`);
			}
			const firstStep = <number>splittedAutomats?.next.index ;
					
			let patchedOtherData = { ... scenario.otherData } ;

			patchedOtherData.aids = aidsForAutomat(<Automat>(splittedAutomats?.previous)) ;
			patchedOtherData.automat = <Automat>(splittedAutomats?.previous) ;
			
			const resource:ScenarioInterface = {
				otherData: {
					dids:scenario.otherData.dids,
					aids:aidsForAutomat(<Automat>(splittedAutomats?.next)),
					documentURLs:scenario.otherData.documentURLs,
					automat:<Automat>(splittedAutomats?.next)
				},
				publicId:session.sessionNextPublicID(), // for now it's not an asyn fn here
				rank:scenario.rank+1,
				sessionId:session.id,
				signatureFormat:scenario.signatureFormat,
				signatureLevel:scenario.signatureFormat,
				status:ScenarioStatus.ActiveScenario, // the new scenario is already active
				stepsDefinition:scenario.stepsDefinition.slice(firstStep)
			}

			if ($ok(manifestData)) resource.manifestData = manifestData ;
			if ($ok(body['user-data'])) resource.userData = body['user-data'] ;

			// there is no cancel ManifestData for the old scenario nor any activate ManifestData data for
			// the new one. We nethertheless need to register the new activation Event on the session
			let otherData = { ...session.otherData } ;

			// we truncate the old scenario and we cancel it
			const updatedScenario = await scenario.$q(context).patchAndFetch({
				otherData:patchedOtherData,
				stepsDefinition:scenario.stepsDefinition.slice(0, firstStep),
				status:ScenarioStatus.WellTerminated
			}) ;

			const newScenario = await Scenario.query(trx).insert(resource) ;

			// updating session context events.
			// 1) to indicate that the old scenario did split
			// 2) to add the new scenario creation event
			// 3) to add the simulateneous scenario activation event
			otherData.sessionContextEvents.push({
				user:auth.user,
				date:updatedScenario.modificationDate(),
				'event-type':SessionContextEventType.SplitScenario,
				'scenario-id':updatedScenario.publicId,
				reason:body.reason,
			}) ;

			otherData.sessionContextEvents.push({
				user:auth.user,
				date:newScenario.creationDate(),
				'event-type':SessionContextEventType.CreateScenario,
				'scenario-id':newScenario.publicId,
				'manifest-data':newScenario.manifestData
			}) ;

			otherData.sessionContextEvents.push({
				user:auth.user,
				date:newScenario.creationDate(),
				'event-type':SessionContextEventType.ActivateScenario,
				'scenario-id':newScenario.publicId,
			}) ;

			let updatedSession = await session.$q(context).patchAndFetch({ 
				lastPubObject:session.lastPubObject,				
				otherData:otherData
			}) ;

			newScenario.session = updatedSession ; // strait graph 

			// new active scenario is now related to the session :
			await updatedSession.$rq('activeScenario', context).relate(newScenario) ; // the new active scenario

			return newScenario ;
		}) ;
	}
	catch (e) {
		APIServer.api().error(e);
		throw e ;
	}

	return <Scenario>returnValue ;
}

