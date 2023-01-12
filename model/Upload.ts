import { Ascending } from 'foundation-ts/types'
import { $length, $ok } from 'foundation-ts/commons'
import { $filename, $isfile, $readString, $removeFile } from 'foundation-ts/fs'
import { $hashfile } from 'foundation-ts/crypto'

import { $finalDateString, $compareDates, $date2string} from '../utils/commons'
import { InternalError } from '../utils/errors'

import { QueryContext } from 'objection'
import { APIStaticModel } from './APIModels'
import { apiTables } from './DBConstants'
import { EditingContext, RelativeIdentifier, UploadInterface } from './DBInterfaces'
import { verifySeal } from '../classes/CertignaEndPoint'
import { $logterm } from 'foundation-ts/utils'


export default class Upload extends APIStaticModel implements UploadInterface {
	static tableName = apiTables.uploads ;
	
	// identifiers
	declare publicId: number ; // TODO: public id is a sequence for now, upgrade it to a stored procedure

	// common vars
	declare uploaded_at: string ; // no so different from the creation date but should be identical to one found in the XML signature
	declare expires_at: string ;
	declare fileType: number ;
	declare hash: string | undefined ;
	declare path: string ;
	declare sealPath: string | undefined ;
	declare size: number ;
	declare ttl:number ;
	declare user: string ;

	protected internalUrl(_?:RelativeIdentifier) : string | null { 
		return  `/upload/${this.publicId}`; 
	}

	$beforeInsert(context: QueryContext) {
		super.$beforeInsert(context);
		this.expires_at = $finalDateString(this.created_at, this.ttl) ;
	}
	public expirationDate(): string { return $date2string(this.expires_at) ; }

	public async cleanAndDelete(c:EditingContext) {
		if (!$ok(c.trx)) {
			throw new InternalError('<anUpload>.cleanAndDelete() should be called inside a transaction') ;
		}
		if ($isfile(this.path)) {
			if (!$removeFile(this.path)) {
				$logterm(`&O&b Warning &0 &w: cannot remove file '&c${this.path}&w'&0`)
			}
		}
		if ($isfile(this.sealPath)) {
			if (!$removeFile(this.sealPath)) {
				$logterm(`&O&b Warning &0 &w: cannot remove file '&c${this.sealPath}&w'&0`)
			}
		}	
		await this.$delete(c) ;
	}

	public async verifyFileSeal() : Promise<boolean> {
		if (!$length(this.hash)) { return false ; }
		let v = await verifySeal($readString(this.sealPath), {
			name:$filename(this.path),
			user:this.user,
			hash:<string>this.hash,
			date:$date2string(this.uploaded_at), // for uploads the upload timestamp act as a file timestamped_at
			size:this.size
		}) ;
		if (v) {
			// if our token file is verified, we will verify the hash of our upload file
			const calculatedHash = await $hashfile(this.path) ;
			v = calculatedHash === this.hash ;
		}
		return v ;
	}

	public fillPathsIn(paths:string[]) {
		if ($isfile(this.path)) paths.push(this.path) ;
		if ($isfile(this.sealPath)) paths.push(<string>(this.sealPath)) ;
	}

	public isExpired() : boolean {
		return $compareDates(new Date(), new Date(this.expires_at)) !== Ascending ? true : false ;
	}

	static jsonAttributes = ['fileMetaData'] ;
}
