import { Resp, Verb } from 'foundation-ts/tsrequest'

import { APIServer } from '../../server'
import { APIRole } from '../APIConstants';
import { $gid } from '../APIIDs';
import { APIHeaders, ScenarioBody, URLResource } from '../APIInterfaces'
import { apiHeadersSchema, scenarioCancelBodySchema } from '../APISchemas';
import { getSessionScenariosList, addScenarioToSession } from '../controllers/scenariosController'
import { SessionParams } from './session';

export function scenariosRoutes() {
	const api = APIServer.api() ;

	const tags={tags:['scenarios']};
	// getSessionDocumentList
	api.server.route<{
		Params: SessionParams
		Headers: APIHeaders
	}
	>(
		{
			url: `${api.prefix}${api.version}/session/:id/scenarios`,
			method: Verb.Get,
			schema:{
				...tags,
				params:{
					id:{type:"number"}
				},
				headers:apiHeadersSchema
			},
			handler: async (request, reply) => {
				try {
					const auth = api.prepareRequest(request, reply, 'id') ;
					let list = await getSessionScenariosList(auth, $gid(request.params.id)) ;
					api.jsonReply(reply, Resp.OK, {...list}) ;
				}
				catch (e) { await api.requestError(reply, e) ; }
			}
		},
	
	) ;

	// addScenarioToSession
	api.server.route<{
		Params: SessionParams
		Body: ScenarioBody,
		Headers: APIHeaders
	}
	>(
		{
			url: `${api.prefix}${api.version}/session/:id/scenarios`,
			method: Verb.Post,
			schema:{
				...tags,
				params:{
					id:{type:"number"}
				},
				headers:apiHeadersSchema,
				body:scenarioCancelBodySchema
			},
			handler: async (request, reply) => {
				try {
					const auth = api.prepareRequest(request, reply, 'id', APIRole.Update) ;
					let scenario = await addScenarioToSession(auth, $gid(request.params.id), request.body) ; 
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
} ;
