import { $unsigned } from 'foundation-ts/commons';
import { Resp, Verb } from 'foundation-ts/tsrequest'


import { FastifyReply } from 'fastify';
import { NO_CONTEXT } from '../../model/DBConstants';
import Scenario from '../../model/Scenario';
import { APIServer } from '../../server'
import { APIRole } from '../APIConstants';
import { $gid, $lid } from '../APIIDs';
import { 
	APIHeaders, 
	DeletedURLResource, 
	
	ManifestDataBody, 
	ScenarioBody, 
	
	ScenarioCancelBody, 
	
	ScenarioResource, 
	ScenarioSplitBody,
	
	URLResource
} from '../APIInterfaces'
import { apiHeadersSchema, mainfestDataBodySchema, scenarioBodySchema, scenarioCancelBodySchema, scenarioSplitBodySchema } from '../APISchemas';


import { 
	getSessionScenarioByID,
	updateSessionScenario, 
	removeSessionScenario,
	activateScenario,
	cancelScenario,
	splitScenario
} from '../controllers/scenarioController'

export interface ScenarioParams	{ id:number ; sid:number ; }

function _replyModifiedScenario(api:APIServer, reply:FastifyReply, sessionPublicID:number|string, scenario:Scenario) {
	const date = scenario.creationDate() ;
	reply.header('Date', date) ;
	reply.header('Last-Modified', scenario.modificationDate()) ;
	api.jsonReply<URLResource>(reply, Resp.OK, { url:scenario.url($unsigned(sessionPublicID)), date:date }) ;

}

export function scenarioRoutes() {
	const api = APIServer.api() ;
	
	const tags={tags:['scenario']};
	api.server.route<{
		Params: ScenarioParams,
		Headers: APIHeaders
	}
	>(
		{
			url: `${api.prefix}${api.version}/session/:id/scenario/:sid`,
			method: Verb.Get,
			schema:{
				...tags,
				params:{
					id:{type:'number'},
					sid:{type:'number'}
				},
				headers:apiHeadersSchema
				
			},
			handler: async (request, reply) => {
				try {
					const auth = api.prepareRequest(request, reply, ['id', 'sid']) ;
					let scenario = await getSessionScenarioByID(auth, $gid(request.params.id), $lid(request.params.sid), NO_CONTEXT) ;
					reply.header('Date', scenario.creationDate()) ;
					reply.header('Last-Modified', scenario.modificationDate()) ;
					api.jsonReply<ScenarioResource>(reply, Resp.OK, await scenario.toAPI(NO_CONTEXT)) ;
				}
				catch (e) { await api.requestError(reply, e) ; }
			}
		},
	) ;

	api.server.route<{
		Params: ScenarioParams,
		Body:ScenarioBody
		Headers: APIHeaders
	}
	>(
		{
			url: `${api.prefix}${api.version}/session/:id/scenario/:sid`,
			method: Verb.Patch,
			schema:{
				...tags,
				params:{
					id:{type:'number'},
					sid:{type:'number'}
				},
				headers:apiHeadersSchema,
				body:scenarioBodySchema
			},
			handler: async (request, reply) => {
				try {
					const auth = api.prepareRequest(request, reply, ['id', 'sid'], APIRole.Update) ;
					const scenario = await updateSessionScenario(auth, $gid(request.params.id), $lid(request.params.sid), request.body) ;
					_replyModifiedScenario(api, reply, request.params.id, scenario) ;
				}
				catch (e) { await api.requestError(reply, e) ; }
			}
		},
	) ;

	// removeSessionScenario
	api.server.route<{
		Params: ScenarioParams,
		Headers: APIHeaders
	}
	>(
		{
			url: `${api.prefix}${api.version}/session/:id/scenario/:sid`,
			method: Verb.Delete,
			schema:{
				...tags,
				params:{
					id:{type:'number'},
					sid:{type:'number'}
				},
				headers:apiHeadersSchema
			},
			handler: async (request, reply) => {
				try {
					const auth = api.prepareRequest(request, reply, ['id', 'sid'], APIRole.Update) ;
					let url = await removeSessionScenario(auth, $gid(request.params.id), $lid(request.params.sid)) ;
					api.jsonReply<DeletedURLResource>(reply, Resp.OK, {deleted:url}) ;
				}
				catch (e) { await api.requestError(reply, e) ; }
			}
		},
	) ;

	// activateScenario
	api.server.route<{
		Params: ScenarioParams,
		Body: ManifestDataBody,
		Headers: APIHeaders
	}
	>(
		{
			url: `${api.prefix}${api.version}/session/:id/scenario/:sid/activate`,
			method: Verb.Put,
			schema:{
				...tags,
				params:{
					id:{type:'number'},
					sid:{type:'number'}
				},
				headers:apiHeadersSchema,
				body:mainfestDataBodySchema
			},
			handler: async (request, reply) => {
				try {
					const auth = api.prepareRequest(request, reply, ['id', 'sid'], APIRole.Update) ;
					const scenario = await activateScenario(auth, $gid(request.params.id), $lid(request.params.sid), request.body) ;
					_replyModifiedScenario(api, reply, request.params.id, scenario) ;
				}
				catch (e) { await api.requestError(reply, e) ; }
			}
		},
	) ;

	// cancelScenario
	api.server.route<{
		Params: ScenarioParams,
		Body: ScenarioCancelBody,
		Headers: APIHeaders
	}
	>(
		{
			url: `${api.prefix}${api.version}/session/:id/scenario/:sid/cancel`,
			method: Verb.Put,
			schema:{
				...tags,
				params:{
					id:{type:'number'},
					sid:{type:'number'}
				},
				headers:apiHeadersSchema,
				body:scenarioCancelBodySchema
			},
			handler: async (request, reply) => {
				try {
					const auth = api.prepareRequest(request, reply, ['id', 'sid'], APIRole.Update) ;
					let scenario = await cancelScenario(auth, $gid(request.params.id), $lid(request.params.sid), request.body) ;
					_replyModifiedScenario(api, reply, request.params.id, scenario) ;
				}
				catch (e) { await api.requestError(reply, e) ; }
			}
		},
	) ;

	// splitScenario
	api.server.route<{
		Params: ScenarioParams,
		Body: ScenarioSplitBody,
		Headers: APIHeaders
	}
	>(
		{
			url: `${api.prefix}${api.version}/session/:id/scenario/:sid/split`,
			method: Verb.Put,
			schema:{
				...tags,
				params:{
					id:{type:'number'},
					sid:{type:'number'}
				},
				headers:apiHeadersSchema,
				body:scenarioSplitBodySchema
			},
			handler: async (request, reply) => {
				try {
					const auth = api.prepareRequest(request, reply, ['id', 'sid'], APIRole.Update) ;
					// the function returns the new scenario (the one under construction after the split)
					let scenario = await splitScenario(auth, $gid(request.params.id), $lid(request.params.sid), request.body) ;
					const url = scenario.url(request.params.id) ;
					const date = scenario.creationDate() ;
					reply.header('Location', url) ;
					reply.header('Date', date) ;
					api.jsonReply<URLResource>(reply, Resp.Created, { url:url, date:date }) ;
				}
				catch (e) { await api.requestError(reply, e) ; }
			}
		},
	) ;
}

