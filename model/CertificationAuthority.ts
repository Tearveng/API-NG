import { $length, $ok } from 'foundation-ts/commons' ;
import { $filesize } from 'foundation-ts/fs';

import { APIModel } from './APIModels'
import { apiTables, CAStatus } from './DBConstants'
import { APIServer } from '../server'
import { AuthorityResource } from '../api/APIInterfaces';
import { EditingContext, RelativeIdentifier } from './DBInterfaces';

export interface ImportedCA {
	aki:string ;
	uuid:string ;
	name:string ;
	longName?:string ;
	cguVersion?:string ;
	cguLocalPath?:string ;
}

export interface CAData {
	aki:string ;
	longName?:string ;
	cguVersion?:string ;
	cguLocalPath?:string ;
	cguPath?:string ;
	cguSize:number ;
}

type CADictionary = { [key: string]: CertificationAuthority } ;

export default class CertificationAuthority extends APIModel {
	static tableName = apiTables.cas ;
	
	// identifiers
	declare publicId: number ;

	// common vars
	declare importId: string ;
	declare name: string ;
	declare status: CAStatus ;

	// JSON columns
	declare caData: CAData ;

	// instance methods
	protected internalUrl(_?:RelativeIdentifier) : string | null { 
		return  `/ca/${this.publicId}`; 
	}

	public isValid() : boolean { return this.status == CAStatus.Valid ? true : false ; }

	public static async synchronizeCertificationAuthorities(imports:ImportedCA[]) {
		// we load all known autorities in the database
		// all known but different are patched
		// all unknown are added
		// all missing in the definition are marked as invalid
		// we do all that in the same transaction
		// we never delete a certification authority

		try {
			await this.transaction(async trx => {
				const context = {trx:trx} ;
				let authorities = await CertificationAuthority.query(trx) ;
				let dbset:CADictionary = {} ;
				let uuidSet = new Set() ;
				authorities?.forEach(authority => { dbset[authority.importId] = authority ; })

				for (const i of imports) {
					if (!uuidSet.has(i.uuid)) {
						let authority = dbset[i.uuid] ;
						if ($ok(authority)) {
							// we have to update the previous CA
							await authority.$q(context).patch({
								name:i.name,
								status:CAStatus.Valid,
								caData:{
									aki:i.aki,
									longName:i.longName,
									cguVersion:i.cguVersion,
									cguLocalPath:i.cguLocalPath,
									cguSize:$filesize(i.cguLocalPath)
								}
							}) ;
							delete dbset[i.uuid] ; // removed from initial set
						}
						else {
							// we have to create a new certification authority
							let n = await this.nextGlobalPublicID({trx:trx}) ; // this method updates NGConfig table
							await CertificationAuthority.query(trx).insert({
								publicId:n,
								importId:i.uuid,
								name:i.name,
								status:CAStatus.Valid,
								caData:{
									aki:i.aki,
									longName:i.longName,
									cguVersion:i.cguVersion,
									cguLocalPath:i.cguLocalPath,
									cguSize:$filesize(i.cguLocalPath)
								}
							}) ;
						}
						uuidSet.add(i.uuid) ; // never add an authority twice !	
					}
				} ;
				// here, CA remaining in dbset should be invalidated
				// because they are not in the new imported CAs
				for (let uuid in dbset) {
					await dbset[uuid].$q(context).patch({ status:CAStatus.Invalid }) ;
				}
			}) ;
			// here we are commited
		}
		catch (e) {
			// here we may have a rollback
			// we will halt the server with an error
			APIServer.api().error(e);
			throw e ;
		}	
	}
	
	public CGUVersion() : string {
		return $length(this.caData?.cguVersion) ? <string>this.caData?.cguVersion : '<unknown>' ;
	}


	public async toAPI(_:EditingContext) : Promise<AuthorityResource> { 
		return {
			caid: this.publicId,
			'cgu-version':this.CGUVersion(),
			'long-name':$length(this.caData?.longName) ? <string>this.caData?.longName : this.name ,
			name:this.name
		} ;
	}



	static jsonAttributes = ['caData'] ;

	// WARNING : relationships caTokens is not implemented here
}
