
import { $count, $isnumber, $ok } from 'foundation-ts/commons';

import { ForbiddenError, NotFoundError } from '../../utils/errors'

import Certificate from '../../model/Certificate';
import { sessionWithPublicID } from './sessionController';
import { APIServer } from '../../server';
import { GlobalID, LocalID } from '../APIIDs';
import { APIAuth } from '../APIInterfaces';
import { EditingContext } from '../../model/DBInterfaces';
import Session from '../../model/Session';
import { revoqueCertignaCertificate } from './certificatesCommons';

export const getSessionCertificate = async (auth:APIAuth, sessionOrID:GlobalID|Session, cid:LocalID, c:EditingContext) : Promise<Certificate> => {
	let session = $isnumber(sessionOrID) ? await sessionWithPublicID(auth, <GlobalID>sessionOrID, c) : <Session>sessionOrID  ;
	let query = $ok(c.trx) ? Certificate.query(c.trx) : Certificate.query() ;

	query.where('publicId', '=', cid)
		 .where('sessionId', '=', session.id) ;

	let certificates = $ok(c.prefetchings) ? 
					   await query.withGraphFetched(<any>c.prefetchings) : // we fetch the token with the certificate
					   await query ;

	if (!$count(certificates)) {
		throw new NotFoundError(`Certificate with IDs (${session.publicId},${cid}) was not found.`);
	}

	return (<Certificate[]>certificates)[0] 
}

export const removeSessionCertificate = async (auth:APIAuth, sessionPublicID:GlobalID, cid:LocalID) : Promise<string> =>
{
	let returnValue = undefined ;
	try {
		// since we will cascade destruction, we need to be in a transaction
		returnValue = await Certificate.transaction(async trx => {
			const context = {trx:trx} ;
			const certificate = await getSessionCertificate(auth, 
															sessionPublicID, 
															cid, 
															{trx:trx, prefetchings:'[files, caToken.actor.session]'}) ;
			const SN = certificate.certificateData.serialnumber ;
			const url = certificate.url(sessionPublicID) ;
		
			if (certificate.caToken.actor.session.wasCertificateUsed(cid)) {
				throw new ForbiddenError(`Certificate with IDs (${sessionPublicID},${cid}) cannot be deleted.`);
			}
					// since we will cascade destruction, we need to be in a transaction
			await certificate.$rq('files', context).unrelate() ;
			await certificate.$delete(context) ;
			await revoqueCertignaCertificate(auth, SN, context) ; // if we fail to revoke we ignore it

			return url ;
		})
	}
	catch (e) {
		// here we may have a rollback
		APIServer.api().error(e);
		throw e ;
	}

	return returnValue ;
}

