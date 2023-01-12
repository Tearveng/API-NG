import { Resp, Verb } from 'foundation-ts/tsrequest'

import { APIServer } from '../../server'
import { APIHeaders, CreateActorBody, ActorsQuery, URLResource } from '../APIInterfaces'
import { getSessionActorList, addActorToSession } from '../controllers/actorsController'
import { SessionParams } from './session'
import { $gid } from '../APIIDs'
import { APIRole } from '../APIConstants'
import { apiHeadersSchema,actorsQuerySchema,createActorBodySchema } from '../APISchemas';

export function actorsRoutes() {
	const api = APIServer.api() ;
	const tags={tags:["actors"]};
	api.server.route<{
		Params: SessionParams
		Querystring: ActorsQuery,
		Headers: APIHeaders
	}
	>(
		{
			url: `${api.prefix}${api.version}/session/:id/actors`,
			method: Verb.Get,
			schema:{
				...tags,
				params: {
					id: {
						type: 'number',
						description: 'user id'
					}
				},
				querystring:actorsQuerySchema,
				headers:apiHeadersSchema
			},
			handler: async (request, reply) => {
				try {
					const auth = api.prepareRequest(request, reply, 'id') ;
					let list = await getSessionActorList(auth, $gid(request.params.id), request.query) ;
					api.jsonReply(reply, Resp.OK, {...list}) ;
				}
				catch (e) { await api.requestError(reply, e) ; }
			}
		}
	) ;
		
	// addActorToSession
	api.server.route<{
		Params: SessionParams
		Body: CreateActorBody,
		Headers: APIHeaders
	}
	>(
		{
			url: `${api.prefix}${api.version}/session/:id/actors`,
			method: Verb.Post,
			schema:{
				...tags,
				params:{
					id:{type:"number"}
				},
				querystring:actorsQuerySchema,
				headers:apiHeadersSchema,
				body:createActorBodySchema
			},
			handler: async (request, reply) => {
				try {
					const auth = api.prepareRequest(request, reply, 'id', APIRole.Update) ;
					let actor = await addActorToSession(auth, $gid(request.params.id), request.body) ;
					// console.log("XXXXXXX",actor);
					const url = actor.url(request.params.id) ;
					const date = actor.creationDate() ;
					reply.header('Location', url) ;
					reply.header('Date', date) ;
					api.jsonReply<URLResource>(reply, Resp.Created, { url:url, date:date }) ;
				}
				catch (e) { await api.requestError(reply, e) ; }
			}
		}	
	) ;
}
