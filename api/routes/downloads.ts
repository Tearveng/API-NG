import { Resp, Verb } from 'foundation-ts/tsrequest'

import { APIServer } from '../../server'
import { APIRole } from '../APIConstants';
import { APIHeaders } from '../APIInterfaces'
import { apiHeadersSchema } from '../APISchemas';

import {
	purgeDownloads
} from '../controllers/downloadsController'

export function downloadsRoutes() {
	const api = APIServer.api() ;
	const tags={tags:['downloads']};
	// purgeDownloads
	api.server.route<{
		Headers: APIHeaders
	}
	>(
		{
			url: `${api.prefix}${api.version}/downloads/purge`,
			method: Verb.Post,
			schema:{
				...tags,
				headers:apiHeadersSchema
			},
			handler: async (request, reply) => {
				try {
					const auth = api.prepareRequest(request, reply, [], APIRole.Maintenance) ;
					let n = await purgeDownloads(auth) ;
					api.jsonReply(reply, Resp.OK, {'deleted-count': n}) ;
				}
				catch (e) { await api.requestError(reply, e) ; }
			}
		},
	
	) ;

} ;

