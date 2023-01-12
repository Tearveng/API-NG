
import { $count, $length, $unsigned } from "foundation-ts/commons";
import { $removeFile } from "foundation-ts/fs";

import { $now } from "../../utils/commons";
import { ForbiddenError } from "../../utils/errors";

import Download from "../../model/Download";
import FileRef from "../../model/FileRef";
import { APIServer } from "../../server";
import { UserRole } from "../APIConstants";
import { APIAuth } from "../APIInterfaces";

export const purgeDownloads = async (auth:APIAuth) : Promise<number> => {
	let n = 0 ;
	if (auth.role !== UserRole.Maintenance && auth.role !== UserRole.System) {
		throw new ForbiddenError(`Uploads cannot be purged by user ${auth.user}.`);
	}
	try {
		n = await Download.transaction(async trx => {
			let total = 0 ;
			const now = $now() ;
			let downloads = await Download.query(trx).where('expires_at', '<=', now) ;

			let files:string[] = [] ;
			if ($count(downloads)) {
				let fileIDs:number[] = []
				downloads.forEach(d => {
					if ($length(d.path)) { files.push(<string>(d.path)) ; }
					else { 
						const fid = $unsigned(d.fileId) ; 
						if (fid) fileIDs.push(fid) ;
					}
				}) ;
				
				let fileRefs = await FileRef.query(trx).where('id', 'in', fileIDs) ;

				fileRefs?.forEach(f => f.fillPathsIn(files)) ;

				await Download.query(trx).delete().where('expires_at', '<=', now) ;

				if ($count(fileRefs)) {
					await FileRef.query(trx).delete().where('id', 'in', fileIDs) ;
				}
				
				files.forEach(p => $removeFile(p)) ;
			}
			return total ;
		}) ;
	}
	catch (e) {
		// here we have a rollback
		APIServer.api().error(e);
		throw e ;
	}
	return n ;	
};