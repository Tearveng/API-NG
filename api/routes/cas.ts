import { Resp, Verb } from 'foundation-ts/tsrequest'

import { APIServer } from '../../server'
import { APIRole } from '../APIConstants';
import { APIHeaders } from '../APIInterfaces'
import { apiHeadersSchema } from '../APISchemas';
import { getCAList } from '../controllers/casController'

export function casRoutes() {
	const api = APIServer.api() ;
	const tags={tags:['cas']}
	// getSessionList
	api.server.route<{
		Headers: APIHeaders
	}
	>(
		{
			url: `${api.prefix}${api.version}/cas`,
			method: Verb.Get,
			schema:{
				...tags,
				headers:apiHeadersSchema
			},
			handler: async (request, reply) => {
				try {
					const auth = api.prepareRequest(request, reply, [], APIRole.Listing) ;
					let list = await getCAList(auth) ;
					api.jsonReply(reply, Resp.OK, { 'certification-authorities':list }) ;
				}
				catch (e) { await api.requestError(reply, e) ; }
			}
		},
	
	) ;
	
}