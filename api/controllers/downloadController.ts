import { $length, $ok } from 'foundation-ts/commons'
import { $filename } from 'foundation-ts/fs'

import { ForbiddenError, NotFoundError } from '../../utils/errors'

import { APIRoleNames } from '../APIConstants'
import Download from '../../model/Download'
import FileRef from '../../model/FileRef'
import { APIAuth } from '../APIInterfaces'


export const downloadFile = async (auth:APIAuth, downloadID:number) : Promise<[string, string]> => {
	let download = await Download.objectWithPublicID<Download>(downloadID, { prefetchings:'session' }) ; // we load the session with the download
	if (!$ok(download)) {
		throw new NotFoundError(`Download with ID ${downloadID} was not found.`);
	}
	console.log("DownloadXXX",download);

	if (!(await download?.session.acceptsUser(auth.apiRole, auth.user, auth.role, {}))) {
		throw new ForbiddenError(`Session with ID ${download?.session.publicId} does not accept user ${auth.user} for action ${APIRoleNames[auth.apiRole]}.`);
	}

	if (auth.user !== download?.user) {
		// FIXME: we may be authorized to get a file even if we're not the creator
		throw new ForbiddenError(`Download ${downloadID} cannot be read by user ${auth.user}.`);
	}
	if ($length(download?.path)) { return [<string>download?.path, $filename(<string>download?.path)] ; }

	const file = await download?.$relatedQuery('file') ;
	console.log("DownloadXXX",file);
	if (!$ok(file)) { throw new NotFoundError() ; }
	return [(<FileRef>file).path, (<FileRef>file).fileName] ;
} ;
