import { Resp, Verb } from 'foundation-ts/tsrequest'

import { APIServer } from '../../server'
import { $gid } from '../APIIDs';
import { APIHeaders, DeletedURLResource } from '../APIInterfaces'
import { apiHeadersSchema } from '../APISchemas';
import { deleteUpload } from '../controllers/uploadController'

export interface UploadsParams	{ uid:number ; }

export function uploadRoutes() {
	const api = APIServer.api() ;

	const tags={tags:['upload']};
	// deleteUpload
	api.server.route<{
		Params: UploadsParams,
		Headers: APIHeaders
	}
	>(
		{
			url: `${api.prefix}${api.version}/upload/:uid`,
			method: Verb.Delete,
			schema:{
				...tags,
				headers:apiHeadersSchema,
				params:{
					uid:{type:'number'}
				}
			},
			handler: async (request, reply) => {
				try {
					const auth = api.prepareRequest(request, reply, 'uid') ;
					let url = await deleteUpload(auth, $gid(request.params.uid)) ;
					api.jsonReply<DeletedURLResource>(reply, Resp.OK, {deleted:url}) ;
				}
				catch (e) { await api.requestError(reply, e) ; }
			}
		},
	) ;
} ;
