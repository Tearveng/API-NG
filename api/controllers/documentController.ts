import { $count, $isnumber, $length, $ok } from 'foundation-ts/commons';
import { $hashfile, $uuid } from 'foundation-ts/crypto';
import { $filesize, $path, $removeFile, $writeString } from 'foundation-ts/fs';
import { $inspect } from 'foundation-ts/utils';

import AdmZip from 'adm-zip' ;

import { $now } from '../../utils/commons';
import { NotFoundError, ForbiddenError, FileError, InternalError } from '../../utils/errors'

import SessionDocument from '../../model/SessionDocument';
import { sessionWithPublicID } from './sessionController'
import { APIFileType } from '../APIConstants'
import { APIServer } from '../../server';
import Download from '../../model/Download';
import FileRef from '../../model/FileRef';
import Session from '../../model/Session';
import { FileStatus } from '../../model/DBConstants';
import { APIAuth } from '../APIInterfaces';
import { $lid, GlobalID } from '../APIIDs';
import { EditingContext, FileRefInterface, LastFile } from '../../model/DBInterfaces';
import { Certigna } from '../../classes/CertignaEndPoint';

export const getSessionDocumentByID = async (
	auth:APIAuth, 
	sessionOrID:GlobalID|Session, 
	did:number, 
	c:EditingContext) : Promise<SessionDocument> => 
{
	let session = $isnumber(sessionOrID) ? await sessionWithPublicID(auth, <GlobalID>sessionOrID, {trx:c.trx}) : <Session>sessionOrID  ;
	let doc = null ;
	if ($ok(session)) {
		doc = await SessionDocument.sessionObjectWithPublicID<SessionDocument>(session, did, c) ; 
	}
	if (!$ok(doc)) {
		throw new NotFoundError(`Document with IDs (${session.publicId},${did}) was not found.`);
	}
	return <SessionDocument>doc ; 
}

export const removeSessionDocument = async (auth:APIAuth, sessionPublicID:number, did:number) : Promise<string> => {

	let returnValue = undefined ;
	try {
		let paths:string[] = [] ;
		// since we will cascade destruction, we need to be in a transaction
		returnValue = await SessionDocument.transaction(async trx => {
			const context = {trx:trx} ;
			let doc = await getSessionDocumentByID(auth, sessionPublicID, did, {trx:trx, prefetchings:'files'}) ; // we load the files we want to clean
			if (!(await doc.canBeDeleted(context))) {
				throw new ForbiddenError(`Document with IDs (${sessionPublicID},${did}) cannot be deleted.`);
			}
			let url = (<SessionDocument>doc).url(sessionPublicID) ;
			doc?.files?.forEach(file => { file.fillPathsIn(paths) ; });
					
			await doc.$delete(context) ;
			return url ;
		})
		// here we are commited, we can destroy files on disk
		paths.forEach(p => $removeFile(p)) ;
	}
	catch (e) {
		// here we may have a rollback
		APIServer.api().error(e);
		throw e ;
	}
	return returnValue ;
}

export const _documentsDownload = async(
	auth:APIAuth, 
	session:Session, 
	sourceFiles:LastFile[], 
	tobeRemoved:string[], 
	c:EditingContext
) : Promise<Download> => {

	if (!$ok(c.trx)) {
		throw new InternalError('_documentsDownload() method should be called inside a transaction') ;
	}
	const n = $count(sourceFiles) ;
	if (!n) {
		throw new NotFoundError(`No files to be downloaded.`);				
	}
	let dbFiles:FileRef[] = [] ;

	for (let source of sourceFiles) {
		let file = await FileRef.query(c.trx).findById(source.fileId) ;
		if (!$ok(file)) { throw new NotFoundError('Download file not found') ; }
		dbFiles.push(file) ;
	}

	const api = APIServer.api() ;
	let now = $now() ;
	let downloadFileInterface:FileRefInterface|undefined|null = undefined ;

	api.log(`Files to be downloaded:\n${$inspect(dbFiles)}`)
	if (n == 1) {
		// one file, we take it as it, copy it to the directory and all is good
		downloadFileInterface = await dbFiles[0].fileInterfaceOfCopyToDirectory(auth, api.conf.downloadsPath, now) ; // no options for now
	}
	else {
		// we have several files, we create a zip file
		const zip = new AdmZip();
		dbFiles.forEach(file => { zip.addLocalFile(file.path); }) ;
		const fileBase = $uuid(), fileName = `${fileBase}.zip`;
		let filePath = $path(api.conf.downloadsPath, 'files', fileName) ;
		zip.writeZip(filePath) ;

		// then seal it
		const hash = await $hashfile(filePath) ;
		if (!$length(hash)) {
			throw new FileError(`Cannot activate calculate hash of zip file to download.`);				
		}
		const fileSize = $filesize(filePath) ; // FIXME: get errors here !!!
		const credentials = api.conf.signServerLogin ;

		let seal = await Certigna.endPoint().seal(credentials.login, credentials.password, {
			name:fileName,
			user:auth.user,
			size:fileSize,
			hash:<string>hash,
			date:now
		}) ;

		if (!$ok(seal)) {
			throw new FileError(`Cannot seal zip file to download.`);				
		}
		
		let sealPath = $path(api.conf.downloadsPath, 'seals', `${fileBase}.xml`) ;
		if (!$writeString(sealPath, <string>seal)) {
			throw new FileError(`Cannot save seal file of zip file to download.`);				
		}
		downloadFileInterface = {
			fileName:fileName, 
			fileType:APIFileType.ZIP,
			hash:<string>hash, 
			path:filePath,
			sealPath:sealPath,
			size:fileSize,
			status:FileStatus.Valid,
			timestamped_at:now,
			user:auth.user
		} ;

	}

	const sp = downloadFileInterface.sealPath ; 
	if ($length(sp)) { tobeRemoved.push(<string>sp) ; }
	tobeRemoved.push(downloadFileInterface.path) ;

	let pid = await Download.nextGlobalPublicID(c) ; // this method updates NGConfig table
	let newFile = await FileRef.query(c.trx).insert(downloadFileInterface) ;
	let download = await Download.query(c.trx).insert({
		publicId:pid,
		sessionId:session.id,
		size:downloadFileInterface.size,
		ttl:api.conf.downloadTtl,
		user:downloadFileInterface.user
	}) ;
	await download.$rq('file', c).relate(newFile) ;			
	download.session = session ; // we want our graph straight

	return download ;
}


export const getSessionDocumentCurrentVersionDownload = async (auth:APIAuth, sessionPublicID:number, did:number, optionalActorID?:number) : Promise<Download> => {
	let paths:string[] = [] ;
	let returnValue = undefined ;
	try {
		returnValue = await Download.transaction(async trx => {
			let doc = await getSessionDocumentByID(auth, sessionPublicID, did, {trx:trx}) ;
			let lastFiles = doc.getLastFiles($lid(optionalActorID)) ;
			return _documentsDownload(auth, doc.session, lastFiles, paths, {trx:trx}) ;
		}) ;
	}
	catch (e) {
		paths.forEach(f => $removeFile(f)) ;
		APIServer.api().error(e);
		throw e ;
	}
	return returnValue ;
}

export const getSessionDocumentGenuineVersionDownload = async (auth:APIAuth, sessionPublicID:number, did:number) : Promise<Download> => {

	let paths:string[] = [] ;
	let returnValue = undefined ;
	try {
		returnValue = await Download.transaction(async trx => {
			let doc = await getSessionDocumentByID(auth, sessionPublicID, did, {trx:trx, prefetchings:'genuineFile'}) ; // we load the genuineFile
			let lastFiles = doc.getGenuineFiles() ;
			return _documentsDownload(auth, doc.session, lastFiles, paths, {trx:trx}) ;
		}) ;
	}
	catch (e) {
		paths.forEach(f => $removeFile(f)) ;
		APIServer.api().error(e);
		throw e ;
	}
	return returnValue ;
}

