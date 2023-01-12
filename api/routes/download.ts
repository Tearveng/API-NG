import { readFileSync } from 'fs'

import { Resp, Verb } from 'foundation-ts/tsrequest'

import { APIServer } from '../../server'
import { APIHeaders } from '../APIInterfaces'
import { downloadFile } from '../controllers/downloadController'
import { $gid } from '../APIIDs';
import { apiHeadersSchema } from '../APISchemas';

export interface DownloadParams	{ dwid:number ; }

export function downloadRoutes() {
	const api = APIServer.api() ;

	const tags={tags:['downloads']};
	// downloadFile
	api.server.route<{
		Params: DownloadParams,
		Headers: APIHeaders
	}
	>(
		{
			url: `${api.prefix}${api.version}/download/:dwid`,
			method: Verb.Get,
			schema:{
				...tags,
				headers:apiHeadersSchema,
				params:{
					dwid:{type:'number'},
					
				}
			},
			handler: async (request, reply) => {
				try {
					const auth = api.prepareRequest(request, reply, 'dwid') ; // APIRole.Reading is used here. Should we use SignatureRole or create a specific one
					let [path, fileName] = await downloadFile(auth, $gid(request.params.dwid)) ;
					
					reply.header('Content-Disposition', `attachment;filename=${fileName}`) ;
					const stream =readFileSync(path) ;
					
					console.log("Download File ",[path,fileName],stream);
					reply.code(Resp.OK).send(stream) ;
				}
				catch (e) { 
					 
					await api.requestError(reply, e) ;
				 }
			}
		},
	) ;
} ;

