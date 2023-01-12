import { $count, $length, $ok } from "foundation-ts/commons" ;
import { $isfile, $path, $removeFile, $writeBuffer } from "foundation-ts/fs" ;
import { $uuid } from "foundation-ts/crypto";
import { $inspect } from "foundation-ts/utils" ;

import { NotFoundError, FileError, ForbiddenError } from "../../utils/errors";

import { Certigna } from "../../classes/CertignaEndPoint";
import CAToken  from "../../model/CAToken";
import CertificationAuthority, { CAData } from "../../model/CertificationAuthority";
import Download  from "../../model/Download";
import { APIServer } from "../../server";
import { getSessionActorByID } from "./actorController";
import { sessionWithPublicID } from "./sessionController";
import { TokenStatus } from "../../model/DBConstants";
import { GlobalID, LocalID } from "../APIIDs";
import { APIAuth, CGUResource } from "../APIInterfaces";
import { EditingContext } from "../../model/DBInterfaces";
import { UserRole } from "../APIConstants";

export const authorityWithPublicID = async (auth:APIAuth, caid:GlobalID, c:EditingContext) : Promise<CertificationAuthority> => {
	// since auth is not used here everybody reads a CA content
	if (auth.role === UserRole.Maintenance || auth.role === UserRole.System) {
		throw new ForbiddenError('System or maintenance users cannot access certification authorities') ;
	}
	let authority = await CertificationAuthority.objectWithPublicID<CertificationAuthority>(caid, c) ;
	if (!$ok(authority) || !authority?.isValid()) {
		throw new NotFoundError(`Certification Authority with ID ${caid} was not found.`);
	}
	return <CertificationAuthority>authority ;
};
export const getCAByID = authorityWithPublicID ;

export const getCACGU = async (auth:APIAuth, caid:GlobalID, sessionPublicID:GlobalID, aid:LocalID) : Promise<CGUResource> =>
{		
	let returnValue = undefined ;
	let updateRemoteCGU = false ;
	let CA_cguPath:any = undefined ;
	let api = APIServer.api() ;

	api.log(`Want to get CGUs for authority with ID ${caid}`) ;
	
	try {
		returnValue = await CAToken.transaction(async trx => {
			const context = {trx:trx} ;
			let authority = await authorityWithPublicID(auth, caid, context) ;
			let session = await sessionWithPublicID(auth, sessionPublicID, context) ;
			let actor = await getSessionActorByID(auth, session, aid, context) ;
			let remoteCGUContent:Buffer|null = null ;
			let CA_cguVersion = authority.CGUVersion() ;
			let CA_cguSize = authority.caData.cguSize ;
			api.log('Authority = '+$inspect(authority)) ;
			CA_cguPath = authority.caData.cguLocalPath ;

			let isLocalCGU = $isfile(CA_cguPath) ;
	
			// TODO: do we check session mutablity ?
			// await checkSessionMutability(session) ;
			
			if (!isLocalCGU) {
				// we will get the cgu version
				let endPoint = Certigna.endPoint() ;
				let remoteCGUVersion = await endPoint.getTOUVersion(authority.caData.aki) ;
				if (!$length(remoteCGUVersion)) {
					throw new NotFoundError('Impossible find CGU version') ;
				}
				if (CA_cguVersion != remoteCGUVersion) {
					remoteCGUContent = await endPoint.getTOU(authority.caData.aki) ; 
					CA_cguSize = $length(remoteCGUContent) ;
					if (!CA_cguSize) {
						throw new FileError('Impossible to reach new CGU file') ;
					}
					CA_cguPath = $path(api.downloadsPathFiles, $uuid()) ;
					updateRemoteCGU = true ;
					CA_cguVersion = <string>remoteCGUVersion ;
				}
			}
					
		
			if (updateRemoteCGU) {
				// first, if we have a new CGU for our certification authority,
				// we need to update it
				if (!$writeBuffer(CA_cguPath, <Buffer>remoteCGUContent)) {
					throw new FileError('Impossible to write CGU file') ;
				}
				const newCaData:CAData = {
					aki:authority.caData.aki,
					longName:authority.caData.longName,
					cguVersion:CA_cguVersion,
					cguPath:CA_cguPath,
					cguSize:CA_cguSize,
					cguLocalPath:undefined, // keep it here because cguLocalPath determines the whole token management
				} ;
				await authority.$q(context).patch({
					caData:newCaData
				}) ;
			}

			// Have we an active token for this ac and actor ?
			let tokens = await CAToken.query(trx)
								.where('caId', '=', authority.id)
								.where('actorId', '=', actor.id)
								.where('status', '=', TokenStatus.Active) ;
			let token:CAToken|null = $count(tokens) ? tokens[0] : null ;

			// if the AC as a  CGU diffent than the last token, we need a new active token here
			// and to archive the previous one
			if (!$ok(token) || token?.cguVersion != CA_cguVersion) {
				if ($ok(token))	{
					// the previous token is no more active
					await token?.$q(context).patch({ status:TokenStatus.Archived}) ;
				}

				token = await CAToken.query(trx).insert({
					actorId:actor.id,
					sessionId:session.id,
					caId:authority.id,
					token:$uuid(),
					status:TokenStatus.Active,
					cguVersion:CA_cguVersion
				}) ;
				token.actor = actor ;  			// we want
				token.authority = authority ; 	// our graph strait	
			}

			
			// TODO: (maybe)
			// each call to this method will produce a new download
			// there's an optimmization to be done here in order to
			// reuse a previous valid download.
			// this is not really space consuming because downloads are purged
			// and the file is not put in a FileRef so, it's really the same file
			// if CGUs don't change
			let pid = await Download.nextGlobalPublicID(context) ; // this method updates NGConfig table

			let download = await Download.query(trx).insert({
				user:auth.user,
				sessionId:session.id,
				publicId:pid,
				size:CA_cguSize,
				path:CA_cguPath,
				ttl:api.conf.downloadTtl
			}) ;
			download.session = session ; // we want our graph straight

			return {
				actor:actor.url(sessionPublicID),
				authority:authority.url(),
				'download-url':download.url(sessionPublicID),
				session:session.url(),
				token:(<CAToken>token).token,
				version:(<CAToken>token).cguVersion
			} ;
		}) ;
	}
	catch (e) {
		// here we may have a rollback
		// and so we need to destroy non-used created CGU File
		if (updateRemoteCGU && $isfile(CA_cguPath)) {
			$removeFile(CA_cguPath) ;
		}
		APIServer.api().error(e);
		throw e ;
	}
	return <CGUResource>returnValue ;		
};
