import { Resp, Verb } from 'foundation-ts/tsrequest'

import { APIServer } from '../../server'
import { ActorResource, APIHeaders, DeletedURLResource } from '../APIInterfaces'
import { APIRole } from '../APIConstants'
import { getSessionActorByID, removeSessionActor} from '../controllers/actorController'
import { $gid, $lid } from '../APIIDs'
import { NO_CONTEXT } from '../../model/DBConstants'
import { apiHeadersSchema } from '../APISchemas'

export interface ActorParams	{ 
	id:number ; 
	aid:number ;
}

const tags={tags:["actor"]};
const _schema={
	...tags,
	params:{
		id:{type:'number'},
		aid:{type:'number'}
	},
	headers:apiHeadersSchema
}

export function actorRoutes() {
	const api = APIServer.api() ;
	
	// getActorByID
	api.server.route<{
		Params: ActorParams,
		Headers: APIHeaders
	}
	>(
		{
			url: `${api.prefix}${api.version}/session/:id/actor/:aid`,
			method: Verb.Get,
			schema:_schema,
			handler: async (request, reply) => {
				try {
					const auth = api.prepareRequest(request, reply, ['id', 'aid']) ;
					let actor = await getSessionActorByID(auth, $gid(request.params.id), $lid(request.params.aid), NO_CONTEXT) ;
					reply.header('Date', actor.creationDate()) ;
					reply.header('Last-Modified', actor.modificationDate()) ;
					api.jsonReply<ActorResource>(reply, Resp.OK, await actor.toAPI(NO_CONTEXT)) ;
				}
				catch (e) { await api.requestError(reply, e) ; }
			}
		},
	) ;

	// removeSessionActor
	api.server.route<{
		Params: ActorParams,
		Headers: APIHeaders
	}
	>(
		{
			url: `${api.prefix}${api.version}/session/:id/actor/:aid`,
			method: Verb.Delete,
			schema:_schema,
			handler: async (request, reply) => {
				try {
					const auth = api.prepareRequest(request, reply, ['id', 'aid'], APIRole.Update) ;
					let url = await removeSessionActor(auth, $gid(request.params.id), $lid(request.params.aid)) ;
					api.jsonReply<DeletedURLResource>(reply, Resp.OK, {deleted:url}) ;
				}
				catch (e) { await api.requestError(reply, e) ; }
			}
		},
	) ;
	

}

