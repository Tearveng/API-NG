import { Model } from 'objection'
import { APIModel } from './APIModels'
import { apiTables } from './DBConstants'
import { dbcol, dbid } from './DBFunctions'
import Actor from './Actor'
import Certificate from './Certificate'
import CertificationAuthority from './CertificationAuthority'

export default class CAToken extends APIModel {
	static tableName = apiTables.caTokens ;

	// common vars
	declare cguVersion: string ;
	declare token: string ;
	declare caId: number ;
	declare actorId: number ;
	declare sessionId: number ;
	declare status: number ;

	// relationships
	declare actor: Actor ;
	declare authority:CertificationAuthority
	declare certificates: Certificate[] | undefined ;

	static relationMappings = () => ({
		actor: {
			relation: Model.BelongsToOneRelation,
			modelClass: Actor,
			join: {
			  from: dbcol(apiTables.caTokens, 'actorId'),
			  to: dbid(apiTables.actors)
			},
		},
		authority: {
			relation: Model.BelongsToOneRelation,
			modelClass: CertificationAuthority,
			join: {
			  from: dbcol(apiTables.caTokens, 'caId'),
			  to: dbid(apiTables.cas)
			},
		},
		certificates: {
			relation: Model.HasManyRelation,
			modelClass: Certificate,
			join: {
			  from: dbid(apiTables.caTokens),
			  to: dbcol(apiTables.certificates, 'caTokenId')
			},
		},
	}) ;
}
