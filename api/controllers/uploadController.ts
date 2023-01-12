
import { $length, $ok } from 'foundation-ts/commons'

import { NotFoundError, ForbiddenError} from '../../utils/errors'

import Upload from '../../model/Upload'
import { UserRole } from '../APIConstants'
import { $url2gid, GlobalID } from '../APIIDs'
import { APIAuth } from '../APIInterfaces'
import { EditingContext } from '../../model/DBInterfaces'
import { APIServer } from '../../server'


export const uploadWithPublicID = async (uid:GlobalID|null|undefined, c:EditingContext) : Promise<Upload> =>
{
	let upload = await Upload.objectWithPublicID<Upload>(uid, c) ;
	if (!$ok(upload)) {
		throw new NotFoundError(`Impossible to find upload with id ${uid}.`);
	}
	if (upload?.isExpired()) {
		throw new ForbiddenError(`Upload with id ${uid} is expired.`);
	}
	return <Upload>upload ;
}

export const uploadWithURL = async (url:string|null|undefined, c:EditingContext) : Promise<Upload> =>
{
	if (!$length(url)) {
		throw new NotFoundError(`Impossible to find upload with undefined url.`);
	}
	return uploadWithPublicID($url2gid(url), c) ;
}

export const deleteUpload = async (auth:APIAuth, uid:GlobalID) : Promise<string> =>
{
	let returnValue = undefined ;
	try {
		returnValue = await Upload.transaction(async trx => {
			const context = {trx:trx} ;
			let upload = await Upload.objectWithPublicID<Upload>(uid, context) ;
			if (!$ok(upload)) {
				throw new NotFoundError(`Impossible to find upload with id ${uid}.`);
			}
			if (auth.user !== upload?.user && auth.role !== UserRole.Maintenance && auth.role !== UserRole.System) {
				throw new ForbiddenError(`Upload ${uid} cannot be deleted by user ${auth.user}.`);
			}
			let url = (<Upload>upload).url() ;
			await (<Upload>upload).cleanAndDelete(context) ;

			return url ;
		}) ;
	}
	catch (e) {
		// here we have a rollback
		APIServer.api().error(e);
		throw e ;
	}

	return returnValue ;
}
