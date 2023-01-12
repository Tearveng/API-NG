import { Model, QueryContext } from 'objection'
import { $date2string, $finalDateString } from '../utils/commons'
import { APIStaticModel } from './APIModels'
import { apiTables } from './DBConstants'
import Actor from './Actor'
// import SessionDocument from './SessionDocument'
import { dbcol, dbid } from './DBFunctions'
import { TokenOtherData } from './DBInterfaces'


export default class Token extends APIStaticModel {
	static tableName = apiTables.tokens ;

	// common vars
	declare expires_at: string | undefined ;
	declare actorId:number ;
	declare otp: string ;
	declare ttl:number ;

	// relationships
	declare actor: Actor ;
	
	//documents: SessionDocument[] | undefined ;
	declare otherData?: TokenOtherData | undefined ;

	$beforeInsert(context: QueryContext) {
		super.$beforeInsert(context);
		this.expires_at = $finalDateString(this.created_at, this.ttl) ;
	}
	public expirationDate(): string { return $date2string(this.expires_at) ; }

	static jsonAttributes = ['otherData'] ;

	static relationMappings = () => ({
		actor: {
			relation: Model.BelongsToOneRelation,
			modelClass: Actor,
			join: {
			  from: dbcol(apiTables.tokens, 'actorId'),
			  to: dbid(apiTables.actors)
			},
		},
		/*documents: {
			relation: Model.ManyToManyRelation,
			modelClass: SessionDocument,
			join: {
				from: dbid(apiTables.tokens),
				through: {
					from: dbcol(apiTables.tokenDocuments, 'tokenId'),
					to: dbcol(apiTables.tokenDocuments, 'documentId'),
				},
				to: dbid(apiTables.documents),
			},
		},*/
	}) ;
}
