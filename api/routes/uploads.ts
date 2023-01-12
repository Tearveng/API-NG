import { StringDictionary } from 'foundation-ts/types';
import { $trim } from 'foundation-ts/strings';
import { Resp, Verb } from 'foundation-ts/tsrequest'

import { BadRequestError } from '../../utils/errors';

import { Certigna } from '../../classes/CertignaEndPoint';
import { APIServer } from '../../server'
import { APIRole, APIExtensions } from '../APIConstants';
import { APIHeaders, APIGetListQuery, ExpiringURLResource, AcceptedUploads, AcceptedUploadsQuery, } from '../APIInterfaces'
import { acceptedUploadsQuerySchema, apiGetListQuerySchema, apiHeadersSchema } from '../APISchemas';

import {
	UploadHeaders,
	uploadFile,
	getUploadList,
	purgeUploads,
	UploadHeadersSchema,

} from '../controllers/uploadsController'

export function uploadsRoutes() {
	const api = APIServer.api() ;
	const tags={tags:['uploads']};
	// getUploadList
	api.server.route<{
		Querystring: APIGetListQuery,
		Headers: APIHeaders
	}
	>(
		{
			url: `${api.prefix}${api.version}/uploads`,
			method: Verb.Get,
			schema:{
				...tags,
				headers:apiHeadersSchema,
				querystring:apiGetListQuerySchema
			},
			handler: async (request, reply) => {
				try {
					const auth = api.prepareRequest(request, reply, [], APIRole.Listing) ;
					let list = await getUploadList(auth, request.query) ;
					api.jsonReply(reply, Resp.OK, { uploads:list }) ;
				}
				catch (e) { await api.requestError(reply, e) ; }
			}
		},
	) ;
	
	// uploadFile
	api.server.route<{
		Headers: UploadHeaders
	}
	>(
		{
			url: `${api.prefix}${api.version}/uploads`,
			method: Verb.Post,
			schema:{
				...tags,
				headers:UploadHeadersSchema
			},
			handler: async (request, reply) => {
				console.log("Uploaded Docuement : ");
				try {
					const auth = api.prepareRequest(request, reply, [], APIRole.Creation) ;
				
					let upload = await uploadFile(auth, request.headers['content-type'], <Buffer>request.body) ;
					
					const url = upload.url() ;
					const date = upload.creationDate() ;
					const expires = upload.expirationDate() ;
					reply.header('Location', url) ;
					reply.header('Date', date) ;
					reply.header('Expires',expires) ;
					api.jsonReply<ExpiringURLResource>(reply, Resp.Created, { url:url, date:date, expires:expires}) ;
				}
				catch (e) { 
				
					await api.requestError(reply, e) ; 
				}
			}
		},
	
	) ;

	// purgeUploads
	api.server.route<{
		Headers: APIHeaders
	}
	>(
		{
			url: `${api.prefix}${api.version}/uploads/purge`,
			method: Verb.Post,
			schema:{
				...tags,
				headers:apiHeadersSchema
			},
			handler: async (request, reply) => {
				try {
					const auth = api.prepareRequest(request, reply, [], APIRole.Maintenance) ;
					let n = await purgeUploads(auth) ;
					api.jsonReply(reply, Resp.OK, {'deleted-count': n}) ;
				}
				catch (e) { await api.requestError(reply, e) ; }
			}
		}
	) ;

	// accepted mime-extensions
	api.server.route<{
		Headers: APIHeaders
		Querystring:AcceptedUploadsQuery
	}
	>(
		{
			url: `${api.prefix}${api.version}/uploads/accepted-extensions`,
			method: Verb.Get,
			schema:{
				...tags,
				headers:apiHeadersSchema,
				querystring:acceptedUploadsQuerySchema,
			},
			handler: async (request, reply) => {
				try {
					api.prepareRequest(request, reply, [], APIRole.Listing) ;
					const type = $trim(request.query.type).toLowerCase() ;

					if (type !== 'signing' && type !== 'all') {
						throw new BadRequestError('Bad accepted-extensions type') ;
					}

					const content:StringDictionary = type === 'signing' ? Certigna.endPoint().signingExtensions : APIExtensions ;
					api.jsonReply<AcceptedUploads>(reply, Resp.OK, { 'accepted-extensions':content }) ;
				}
				catch (e) { await api.requestError(reply, e) ; }
			}
		}
	) ;
} ;

