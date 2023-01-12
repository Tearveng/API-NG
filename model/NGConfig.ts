
import { $length, $ok } from 'foundation-ts/commons';
import { $trim } from 'foundation-ts/strings';

import { $now, $date2string } from '../utils/commons';
import { InternalError } from '../utils/errors';

import { Model } from 'objection';
import { apiTables, ConfigType, apiGlobals } from './DBConstants';
import { EditingContext } from './DBInterfaces';


export default class NGConfig extends Model {
	static tableName = apiTables.config ;

	
	id!: number ;
    created_at: string | undefined ;
    updated_at: string | undefined ;

	// common vars
	key!: string ;
	rank!: number ;
	type!: number ;
	user!: string ;
	value?: string ;

	public static async getModelVersion(c?:EditingContext) : Promise<string> {
		const query = $ok(c?.trx) ? this.query(c?.trx) : this.query() ;
		let version = await query.findOne('key', '=', 'MODEL_VERSION') ;
		return $ok(version) ? (<NGConfig>version).stringValue() : '' ;
	}

	// WARNING: This function is to be used inside a transaction
	public static async nextGlobalPublicIDWithTableName(identifier:string, c:EditingContext) : Promise<number> {

		if (!$ok(c.trx)) {
			throw new InternalError('nextGlobalPublicIDWithTableName(): should be used within a transaction') ;
		}

		let returnedValue:number = 0 ;
		if ($length(identifier) > 0) {
			identifier = `$_${identifier}_NID`;
			let v = await this.query(c.trx).findOne('key', '=', identifier) ;
			if ($ok(v)) {
				returnedValue = v.numberValue() + 1 ;
				await v.$query(c.trx).patch({
					value:`${returnedValue}`
				}) ;
			}
			else {
				returnedValue = 1 ;
				// we need to inser a NGConfig 
				await this.query(c.trx).insert({
					key:identifier,
					rank:0,
					type:ConfigType.Unsigned,
					user:apiGlobals.databaseSystemUser,
					value:`${returnedValue}`
				}) ;
			}		
		}
		return returnedValue ;
	}

	$beforeInsert() {
		this.created_at = $now();
		this.updated_at = this.created_at ; // we want that a just created object has a modification date identical to its creation date
	}

	$beforeUpdate() {
		this.updated_at = $now();
	}

	public creationDate(): string { return $date2string(this.created_at) ; }
	public modificationDate(): string { return $date2string(this.updated_at) ; }

	public numberValue() : number {
		return $ok(this.value) ? parseInt(<string>this.value, 10) : 0 ;
	}

	public stringValue() : string { 
		return $ok(this.value) ? <string>this.value : '' ; 
	}

	public valueType() : ConfigType {
		return <ConfigType>this.type ;
	}

	public valueUser() : string {
		return this.user === apiGlobals.databaseSystemUser ? '' : this.user ;
	}

	public setValue(value:any, type:ConfigType, user:string) {
		this.type = type ;
		user = $trim(user) ;
		this.user = $length(user) ? user : apiGlobals.databaseSystemUser ;
		if ($ok(value)) this.value = value.toString() ; 
	}
}

