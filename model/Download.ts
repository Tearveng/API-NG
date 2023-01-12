import { Model, QueryContext } from 'objection'
import { APIModel } from './APIModels'
import { apiTables } from './DBConstants'
import { dbcol, dbid } from './DBFunctions'
import { $date2string, $finalDateString } from '../utils/commons'
import FileRef from './FileRef'
import Session from './Session'
import { RelativeIdentifier } from './DBInterfaces'


export default class Download extends APIModel {
	static tableName = apiTables.downloads ;
	
	// identifiers
	declare publicId: number ; // this is a global publicId, not relative to session
	declare sessionId:number ;

	// common vars
	declare downloadsCount: number ;
	declare expires_at: string | undefined ;
	declare size: number ;
	declare ttl:number ;
	declare user:string ;
	declare fileId?:number ;

	// relationships
	declare file?: FileRef ;
	declare path?: string ;		// path for direct download without any fileRef
	declare session: Session ;

	// instance methods
	// URL is not relative to session because we may move download mechanism elsewhere
	protected internalUrl(_?:RelativeIdentifier) : string | null { 
		return  `/download/${this.publicId}`;
	}
	public expirationDate(): string { return $date2string(this.expires_at) ; }

	$beforeInsert(context: QueryContext) {
		super.$beforeInsert(context);
		this.downloadsCount = 0;
		this.expires_at = $finalDateString(this.created_at, this.ttl) ;
	}


	static relationMappings = () => ({
		file: {
			relation: Model.BelongsToOneRelation,
			modelClass: FileRef,
			join: {
			  from: dbcol(apiTables.downloads, 'fileId'),
			  to: dbid(apiTables.files)
			},
		},
		session: {
			relation: Model.BelongsToOneRelation,
			modelClass: Session,
			join: {
			  from: dbcol(apiTables.downloads, 'sessionId'),
			  to: dbid(apiTables.sessions)
			},
		},
	}) ;

}
