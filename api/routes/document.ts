import { Resp, Verb } from 'foundation-ts/tsrequest'

import { APIServer } from '../../server'
import { APIHeaders, DeletedURLResource, DocumentResource, ExpiringURLResource } from '../APIInterfaces'
import { APIRole } from '../APIConstants'
import {
	getSessionDocumentByID,
	removeSessionDocument,
	getSessionDocumentCurrentVersionDownload,
	getSessionDocumentGenuineVersionDownload
} from '../controllers/documentController'
import { $gid, $lid } from '../APIIDs';
import { NO_CONTEXT } from '../../model/DBConstants';
import { apiHeadersSchema } from '../APISchemas';


export interface DocumentParams	{ id:number ; did:number ; }

export interface DocumentDownloadQuery	
{
	actor?:string|number ; 
}

export function documentRoutes() {
	const api = APIServer.api() ;

	const tags={tags:['document']};
	// getSessionDocumentByID
	api.server.route<{
		Params: DocumentParams,
		Headers: APIHeaders
	}
	>(
		{
			url: `${api.prefix}${api.version}/session/:id/document/:did`,
			method: Verb.Get,
			schema:{
				...tags,
				headers:apiHeadersSchema,
				params:{
					id:{type:'number'},
					did:{type:'number'}
				}
			},
			handler: async (request, reply) => {
				try {
					const auth = api.prepareRequest(request, reply, ['id', 'did']) ;
					let doc = await getSessionDocumentByID(auth, $gid(request.params.id), $lid(request.params.did), NO_CONTEXT) ;
					reply.header('Date', doc.creationDate()) ;
					reply.header('Last-Modified', doc.modificationDate()) ;
					api.jsonReply<DocumentResource>(reply, Resp.OK, await doc.toAPI(NO_CONTEXT)) ;
				}
				catch (e) { await api.requestError(reply, e) ; }
			}
		},
	) ;

	// removeSessionDocument
	api.server.route<{
		Params: DocumentParams,
		Headers: APIHeaders
	}
	>(
		{
			url: `${api.prefix}${api.version}/session/:id/document/:did`,
			method: Verb.Delete,
			schema:{
				...tags,
				headers:apiHeadersSchema,
				params:{
					id:{type:'number'},
					did:{type:'number'}
				}
			},
			handler: async (request, reply) => {
				try {
					const auth = api.prepareRequest(request, reply, ['id', 'did'], APIRole.Update) ;
					let url = await removeSessionDocument(auth, $gid(request.params.id), $lid(request.params.did)) ;
					api.jsonReply<DeletedURLResource>(reply, Resp.OK, {deleted:url}) ;
				}
				catch (e) { await api.requestError(reply, e) ; }
			}
		},
	) ;


	// getSessionDocumentCurrentVersionDownload
	api.server.route<{
		Params: DocumentParams,
		Querystring:DocumentDownloadQuery,
		Headers: APIHeaders
	}
	>(
		{
			url: `${api.prefix}${api.version}/session/:id/document/:did/current`,
			method: Verb.Get,
			schema:{
				...tags,
				headers:apiHeadersSchema,
				params:{
					id:{type:'number'},
					did:{type:'number'}
				},
				querystring:{
					actor:{type:'string'}
				}
			},
			handler: async (request, reply) => {
				try {
					const auth = api.prepareRequest(request, reply, ['id', 'did']) ; // TODO: do we need a specific APIRole here ? or verify the actor roles ?
					let download = await getSessionDocumentCurrentVersionDownload(auth, $gid(request.params.id), $lid(request.params.did), $lid(request.query.actor)) ;
					const url = download.url() ;
					const date = download.creationDate() ;
					const expires = download.expirationDate() ;
					reply.header('Location', url) ;
					reply.header('Date', date) ;
					reply.header('Expires', expires)
					api.jsonReply<ExpiringURLResource>(reply, Resp.Created, { url:url, date:date, expires:expires}) ;
				}
				catch (e) { await api.requestError(reply, e) ; }
			}
		},
	) ;

	// getSessionDocumentGenuineVersionDownload
	api.server.route<{
		Params: DocumentParams,
		Headers: APIHeaders
	}
	>(
		{
			url: `${api.prefix}${api.version}/session/:id/document/:did/genuine`,
			method: Verb.Get,
			schema:{
				...tags,
				headers:apiHeadersSchema,
				params:{
					id:{type:'number'},
					did:{type:'number'}
				}
			},
			handler: async (request, reply) => {
				try {
					const auth = api.prepareRequest(request, reply, ['id', 'did']) ; // TODO: do we need a specific APIRole here
					let download = await getSessionDocumentGenuineVersionDownload(auth, $gid(request.params.id), $lid(request.params.did)) ;
					const url = download.url() ;
					const date = download.creationDate() ;
					const expires = download.expirationDate() ;
					reply.header('Location', url) ;
					reply.header('Date', date) ;
					reply.header('Expires', expires)
					api.jsonReply<ExpiringURLResource>(reply, Resp.Created, { url:url, date:date, expires:expires}) ;
				}
				catch (e) { await api.requestError(reply, e) ; }
			}
		},
	) ;
}