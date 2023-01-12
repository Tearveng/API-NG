import { Resp, Verb } from 'foundation-ts/tsrequest'

import { APIServer } from '../../server'
import { APIRole } from '../APIConstants';
import { $gid } from '../APIIDs';
import { APIHeaders, CreateDocumentBody, DocumentsQuery, URLResource } from '../APIInterfaces'
import { apiHeadersSchema, createDocumentBodySchema, documentsQuerySchema } from '../APISchemas';
import { getSessionDocumentList, addDocumentToSession } from '../controllers/documentsController'
import { SessionParams } from './session';


export function documentsRoutes() {
	const api = APIServer.api() ;
	const tags={tags:['documents']};

	// getSessionDocumentList
	api.server.route<{
		Params: SessionParams
		Querystring: DocumentsQuery,
		Headers: APIHeaders
	}
	>(
		{
			url: `${api.prefix}${api.version}/session/:id/documents`,
			method: Verb.Get,
			schema:{
				...tags,
				headers:apiHeadersSchema,
				params:{id:{type:'number'}},
				querystring:documentsQuerySchema
			},
			handler: async (request, reply) => {
				try {
					const auth = api.prepareRequest(request, reply, 'id') ;
					let list = await getSessionDocumentList(auth, $gid(request.params.id), request.query) ;
					api.jsonReply(reply, Resp.OK, {...list}) ;
				}
				catch (e) { await api.requestError(reply, e) ; }
			}
		},
	
	) ;

	// addDocumentToSession
	api.server.route<{
		Params: SessionParams
		Body: CreateDocumentBody,
		Headers: APIHeaders
	}
	>(
		{
			url: `${api.prefix}${api.version}/session/:id/documents`,
			method: Verb.Post,
			schema:{
				...tags,
				headers:apiHeadersSchema,
				params:{id:{type:'number'}},
				body:createDocumentBodySchema
			},
			handler: async (request, reply) => {
				console.log("oooooooooo");
				try {
					const auth = api.prepareRequest(request, reply, 'id', APIRole.Update) ;
					let doc = await addDocumentToSession(auth, $gid(request.params.id), request.body) ; 
					const url = doc.url(request.params.id) ;
					const date = doc.creationDate() ;
					reply.header('Location', url) ;
					reply.header('Date', date) ;
					api.jsonReply<URLResource>(reply, Resp.Created, { url:url, date:date }) ;
				}
				catch (e) { await api.requestError(reply, e) ; }
			}
		},
	
	) ;

	
}
