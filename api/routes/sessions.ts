import { Resp, Verb } from 'foundation-ts/tsrequest'

import { APIServer } from '../../server'
import { APIRole } from '../APIConstants';
import { APIHeaders, CreateSessionBody, ExpiringURLResource, SessionsQuery } from '../APIInterfaces'
import { apiHeadersSchema, createSessionBodySchema, sessionQuerySchema } from '../APISchemas';
import { getSessionList, createSession } from '../controllers/sessionsController'


export function sessionsRoutes() {
	const api = APIServer.api() ;
	const tags={tags:['sessions']};
	// getSessionList
	api.server.route<{
		Querystring: SessionsQuery,
		Headers: APIHeaders
	}
	>(
		{
			url: `${api.prefix}${api.version}/sessions`,
			method: Verb.Get,
			schema:{
				...tags,
				querystring:sessionQuerySchema,
				headers:apiHeadersSchema
			},
			handler: async (request, reply) => {
				try {
					
					const auth = api.prepareRequest(request, reply, [], APIRole.Listing) ;
				
					let list = await getSessionList(auth, request.query) ;
					api.jsonReply(reply, Resp.OK, { sessions:list }) ;
				}
				catch (e) { await api.requestError(reply, e) ; }
			}
		},
	
	) ;

	// createSession
	api.server.route<{
		Body: CreateSessionBody,
		Headers: APIHeaders
	}
	>(
		{
			url: `${api.prefix}${api.version}/sessions`,
			method: Verb.Post,
			schema:{
				...tags,
				headers:apiHeadersSchema,
				body:createSessionBodySchema
			},
			handler: async (request, reply) => {
				try {
					console.log("REQUEST BODY",request.body);
					const auth = api.prepareRequest(request, reply, [], APIRole.Creation) ;
					let session = await createSession(auth, request.body) ;
					
					const url = session.url() ;
					console.log(url);
					const date = session.creationDate() ;
					const expires = session.expirationDate() ;
					reply.header('Location', url) ;
					reply.header('Date', date) ;
					reply.header('Expires',expires) ;
					api.jsonReply<ExpiringURLResource>(reply, Resp.Created, { url:url, date:date, expires:expires}) ;
				}
				catch (e) { await api.requestError(reply, e) ; }
			}
		},
	
	) ;


	
}

