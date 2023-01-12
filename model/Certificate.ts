import { Model, QueryContext } from 'objection'
import { apiTables } from './DBConstants'
import { dbcol, dbid } from './DBFunctions'
import { APIStaticModel } from './APIModels'
import { $date2string, $finalDateString } from '../utils/commons'
import CAToken from './CAToken'
import FileRef from './FileRef'
import { RelativeIdentifier } from './DBInterfaces'

/**
 * For now we only have the serialNumber and not the aki nor the ski of the certificate
 */
export interface CertificateData {
	 aki?: string ;
	countryName:string ;
	data:string, // base64 certificate conten ;
	givenName:string ;
	id:string ;
	lifespan:number ;
	notAfter:string ;
	notBefore:string ;
	organizationName?:string ;
	organizationUnitName?:string ;
	password:string ;
	serialnumber:string ;
	surname:string ;
	ski?:string ;
}

export default class Certificate extends APIStaticModel {
	static tableName = apiTables.certificates ;

	// identifiers
	declare publicId: number ;
	declare caTokenId: number ;
	declare sessionId: number ;

	// common vars
	declare expires_at: string | undefined ; 
	declare status: number ;
	declare ttl:number ;
	declare user:string | undefined ;

	// relationships
	declare caToken: CAToken ;
	declare files: FileRef[] | undefined ;

	// JSON columns
	declare certificateData: CertificateData ;

	// instance methods
	protected internalUrl(relativeIdentifier?:RelativeIdentifier) : string | null
	{ 
		return  `/session/${!!relativeIdentifier ? relativeIdentifier : this.caToken.actor.session.publicId}/certificate/${this.publicId}`;
	}

	$beforeInsert(context: QueryContext) {
		super.$beforeInsert(context);
		this.expires_at = $finalDateString(this.created_at, this.ttl) ;
	}
	public expirationDate(): string { return $date2string(this.expires_at) ; }

	static jsonAttributes = ['certificateData'] ;

	static relationMappings = () => ({
		caToken: {
			relation: Model.BelongsToOneRelation,
			modelClass: CAToken,
			join: {
			  from: dbcol(apiTables.certificates, 'caTokenId'),
			  to: dbid(apiTables.caTokens)
			},
		},
		files: {
			relation: Model.ManyToManyRelation,
	  		modelClass: FileRef,
			join: {
				from: dbid(apiTables.certificates),
			  	// Description of the join table which is not present as a Class in Objection
			  	through: {
					from: dbcol(apiTables.certificateFiles, 'certificateId'),
					to: dbcol(apiTables.certificateFiles, 'fileId'),
					// with extra, new instance vars will be available in the files array
					extra: ['rank', 'status', 'type', 'usage', 'usageTitle']
				},
			  	to: dbid(apiTables.files),
			},
		},
	}) ;
}
