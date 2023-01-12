import { $length, $ok } from 'foundation-ts/commons';
import { 
	$copyFile, 
	$ext, 
	$filename, 
	$isfile, 
	$path, 
	$readString, 
	$removeFile, 
	$withoutext, 
	$writeBuffer, 
	$writeString 
} from 'foundation-ts/fs';
import { $hash, $hashfile, $uuid } from 'foundation-ts/crypto';
import { $inspect, $logterm } from 'foundation-ts/utils';

import { $date2string } from '../utils/commons';

import { APIStaticModel } from './APIModels';
import { apiTables, FileStatus } from './DBConstants';
import { FileRefInterface } from './DBInterfaces';
import { APIAuth } from '../api/APIInterfaces';
import { FileError, InternalError } from '../utils/errors';
import { Certigna, verifySeal } from '../classes/CertignaEndPoint';
import { APIServer } from '../server';


type CopyFileOptions = {
	fileName?:string ;
	fileType?:number ;
	status?:FileStatus ;
} ;

export default class FileRef extends APIStaticModel implements FileRefInterface {
	static tableName = apiTables.files ;

	// common vars
	declare fileName: string ;
	declare fileType: number ;
	declare hash: string | undefined ;
	declare path: string ;
	declare sealPath?: string | undefined ;
	declare size: number ;
	declare status: number ;
	declare timestamped_at: string ;				// this should never be null, could be equal to uploaded_at
	declare uploaded_at: string | undefined ; 		// if uploaded_at is null, it indicates that this file has not been uploaded
	declare user:string ;

	// JSON columns
	declare fileMetaData: object | undefined ;
	declare otherData: object | undefined ;
	
	public fillPathsIn(paths:string[]) {
		if ($isfile(this.path)) paths.push(this.path) ;
		if ($isfile(this.sealPath)) paths.push(<string>(this.sealPath)) ;
	}

	public static async fileWithExistingPath(auth:APIAuth, filePath:string, sealPath:string, timestamp:string, fileType:number, hash:string, size:number) : Promise<FileRefInterface|null>
	{
		if (!$isfile(filePath) || !$length(hash) || !size || !$length(sealPath) || !$length(timestamp)) return null ;
		const api = APIServer.api() ;
		const credentials = api.conf.signServerLogin ;
		const fileName = $filename(filePath) ;
		let seal = await Certigna.endPoint().seal(credentials.login, credentials.password, {
			name:$filename(filePath),
			user:auth.user,
			size:size,
			hash:hash,
			date:timestamp
		}) ;
		if (!$length(seal)) return null ;
		if (!$writeString(sealPath, <string>seal)) return null ;
		return {
			fileName:fileName, 
			fileType:fileType,
			hash:<string>hash, 
			path:filePath,
			sealPath:sealPath,
			size:size,
			status:FileStatus.Valid,
			timestamped_at:timestamp,
			user:auth.user
		} ;

	}

	// saved buffers are always sealed
	// WARNING: this function runs an object you may use to create your own FileRef in a transaction. 
	public static async fileWithBuffer(auth:APIAuth, buf:Buffer, folder:string, timestamp:string, fileName:string, fileType:number) : Promise<FileRefInterface|null>
	{
		if (!$length(buf)) return null ; // cannot create an empty file
		let filePath = $path(folder, 'files', fileName) ;
		let sealPath = $path(folder, 'seals', `${$withoutext(fileName)}.xml`) ;

		if (!$writeBuffer(filePath, buf)) return null ;
		const ret = await this.fileWithExistingPath(auth, filePath, sealPath, timestamp, fileType, $hash(buf), buf.length)

		if (!$ok(ret)) {
			$removeFile(filePath) ;
			return null ;
		}
		return <FileRefInterface>ret ;
	}

	// copied files are always sealed
	// WARNING: this function runs an object you may use to create your own FileRef in a transaction. 
	public async fileInterfaceOfCopyToDirectory(auth:APIAuth, folder:string, timestamp:string, opts?:CopyFileOptions) : Promise<FileRefInterface> {

		if (!$length(auth.user)) {
			throw new InternalError('fileInterfaceOfCopyToDirectory(): user should be set') ;
		}
		if (!$length(folder)) {
			throw new InternalError('fileInterfaceOfCopyToDirectory(): folder should be set') ;
		}
		if (!$length(timestamp)) {
			throw new InternalError('fileInterfaceOfCopyToDirectory(): timestamp should be set') ;
		}
		if (!$isfile(this.path)) {
			throw new FileError('FileRef.path not found') ;
		}

		let extension = $ext(this.path) ;
		let newLocalFileName = $uuid() ;
		let fileName = `${newLocalFileName}.${extension}` ;
		// first, we need to generate a new token
		const hash = $length(this.hash) ? <string>this.hash : (await $hashfile(this.path)) ;
		if (!$length(hash)) {
			throw new InternalError('fileInterfaceOfCopyToDirectory(): error on seal hash code') ;
		}
		const api = APIServer.api() ;
		const credentials = api.conf.signServerLogin ;

		let seal = await Certigna.endPoint().seal(credentials.login, credentials.password, {
			name:fileName,
			user:auth.user,
			size:this.size,
			hash:<string>hash,
			date:timestamp
		}) ;

		if (!$length(seal)) {
			throw new InternalError('fileInterfaceOfCopyToDirectory(): error on seal generation') ;
		}
		let filePath = $path(folder, 'files', fileName) ;
		let sealPath = $path(folder, 'seals', `${newLocalFileName}.xml`) ;
		
		if (!$writeString(sealPath, <string>seal)) {
			throw new FileError('Impossible to save seal file to new directory') ;
		}
		if (!$copyFile(this.path, filePath)) {
			$removeFile(sealPath) ;
			throw new FileError('Impossible to save file to new directory') ;
		}

		return {
			// if we provide a new fileName, we use it. 
			// if it's not the case : if the previous file name was the real file name, we use the new uuid(), 
			//						  if not we use the previous logical file name 
			fileName:$length(opts?.fileName) ? <string>(opts?.fileName) : (this.fileName === $filename(this.path) ? fileName : this.fileName), 
			fileType:$ok(opts?.fileType) ? <FileStatus>opts?.fileType : this.fileType,
			hash:<string>hash, 
			path:filePath,
			sealPath:sealPath,
			size:this.size,
			status:$ok(opts?.status) ? <number>(opts?.status) : this.status,
			timestamped_at:timestamp,
			user:auth.user
		} ;
	}

	public async verifyFileSeal() : Promise<boolean> {
		$logterm($inspect(this.toJSON())) ;
		if (!$length(this.hash)) return false ;
		let v = await verifySeal($readString(this.sealPath), {
			name:$filename(this.path), // we keep here the disk file name, not the logical one
				user:this.user,
				hash:<string>this.hash,
				date:$date2string(this.timestamped_at),
				size:this.size
		}) ;
		if (v) {
			// if our token file is verified, we will verify the hash of our upload file
			const calculatedHash = await $hashfile(this.path) ;
			v = calculatedHash === this.hash ;
		}
		return v ;
	}

	static jsonAttributes = ['fileMetaData', 'otherData'] ;

}
