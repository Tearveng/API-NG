import { Resp, Verb } from 'foundation-ts/tsrequest'

import { NO_CONTEXT } from '../../model/DBConstants';
import { APIServer } from '../../server'
import { $gid, $lid } from '../APIIDs';
import {  APIHeaders, AuthorityResource, CGUResource } from '../APIInterfaces'
import { apiAuthSchema } from '../APISchemas';
import { getCAByID, getCACGU } from '../controllers/caController'

export interface CAParams	{ caid:number ; }
export interface CGUQuery {
	session:number ;
	actor:number ;
}


export function caRoutes() {
	const api = APIServer.api() ;
	
	const tags={tags:["ca"]};
	// getCAByID
	api.server.route<{
		Params: CAParams,
		Headers: APIHeaders
	}
	>(
		{
			url: `${api.prefix}${api.version}/ca/:caid`,
			method: Verb.Get,
			schema:{
				...tags,
				params:{
					session:{type:'number'},
					actor:{type:'number'}
				},
				headers:apiAuthSchema
			},
			handler: async (request, reply) => {
				try {
					const auth = api.prepareRequest(request, reply, 'caid') ;
					let ca = await getCAByID(auth, $gid(request.params.caid), NO_CONTEXT) ;
					reply.header('Date', ca.creationDate()) ;
					reply.header('Last-Modified', ca.modificationDate()) ;
					api.jsonReply<AuthorityResource>(reply, Resp.OK, await ca.toAPI(NO_CONTEXT)) ;
				}
				catch (e) { await api.requestError(reply, e) ; }
			}
		},
	) ;

	// getCACGU
	api.server.route<{
		Params: CAParams,
		Querystring: CGUQuery,
		Headers: APIHeaders
	}
	>(
		{
			url: `${api.prefix}${api.version}/ca/:caid/cgu`,
			method: Verb.Get,
			schema:{
				...tags,
				headers:apiAuthSchema,
				params:{
					caid:{type:"number"}
				}
			},
			handler: async (request, reply) => {
				try {
					const auth = api.prepareRequest(request, reply, 'caid') ;
					let response = await getCACGU(auth, $gid(request.params.caid), $gid(request.query.session), $lid(request.query.actor)) ;
					api.jsonReply<CGUResource>(reply, Resp.OK, response) ;
				}
				catch (e) { await api.requestError(reply, e) ; }
			}
		},
	) ;
} ;