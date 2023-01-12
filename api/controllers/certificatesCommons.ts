import { $length, $ok } from 'foundation-ts/commons'
import { $password } from 'foundation-ts/crypto'

import { $now, $timeBetweenDates } from "../../utils/commons";
import { CertignaRequestError, DatabaseError, ForbiddenError, InternalError } from "../../utils/errors";

import { Certigna, GenericCertificateEntity, CertificateEntity } from "../../classes/CertignaEndPoint";
import { CertificateData } from "../../model/Certificate";
import { EditingContext } from "../../model/DBInterfaces";
import UserJWT from "../../model/UserJWT";
import { ActorType } from "../APIConstants";
import { APIAuth } from "../APIInterfaces";

const CERTIFICATE_PASSWORD_LENGTH = 16 ;

export const certignaJWT = async (user:string, password:string, forceLogin:boolean, c:EditingContext) : Promise<[string, boolean]> =>
{
	if (!$ok(c.trx)) {
		throw new InternalError('certignaJWT() should be called inside a transaction') ;
	}
	if (!$length(user) || !$length(password)) {
		throw new InternalError('certignaJWT() should be called with a valid user and password')
	}
	const certigna = Certigna.endPoint() ;
	let userJWT = await UserJWT.query(c.trx).findOne('user', user) ;

	let jwt:string|null = null ;
	let isNew = false ;

	if (!forceLogin && $ok(userJWT) && $timeBetweenDates(userJWT.modificationDate(), $now()) < certigna.jwtTtl) {
		jwt = userJWT.jwt() ;
	}

	if (!$length(jwt)) {

		const newJwt = await certigna.certificatesAPILogin(user, password) ;
		console.log("JWTX:",newJwt);
		if (!$length(newJwt)) {
			throw new ForbiddenError('Impossible to login for certificate generation') ;
		}
		if (newJwt !== jwt) {
			// we must save our new token
			isNew = true ;
			if ($ok(userJWT)) {
				userJWT = await userJWT.$q(c).patchAndFetch({
					authData:UserJWT.authDataWithJWT(<string>newJwt)
				})
			}
			else {
				userJWT = await UserJWT.query(c.trx).insert({
					user:user,
					authData:UserJWT.authDataWithJWT(<string>newJwt)
				})
			}
			if (!$ok(userJWT)) {
				throw new DatabaseError('Impossible to save new JWT') ;
			}
		}
		jwt = newJwt ;
	}
	console.log("JWTX:",jwt);
	return [<string>jwt, isNew] ;
}

export interface CertificateGeneration extends GenericCertificateEntity
{
	lifespan:number ; // we made the lifespan mandatory
	emailAddress:string ;
	// proof: object | null ;
}

export const generateCertignaCertificate = async (auth:APIAuth, input:CertificateGeneration, role:ActorType, c:EditingContext) : Promise<CertificateData> =>
{
	if (!$ok(c.trx)) {
		throw new InternalError('generateCertignaCertificate() should be called inside a transaction') ;
	}
	let [jwt, isNewJWT] = await certignaJWT(auth.user, auth.password, false, c) ;
	const certigna = Certigna.endPoint() ;
	console.log("Authorization:X",auth,[jwt, isNewJWT]);
	const certificatePasword = $password(16, {
		hasLowercase:true,
		hasUppercase:true,
		hasNumeric:true,
		hasSpecials:true
	}) ;

	if ($length(certificatePasword) !== CERTIFICATE_PASSWORD_LENGTH) {
		throw new CertignaRequestError()
	}
	let certificateEntity = await certigna.generateCertificate(jwt, {
		password:<string>certificatePasword,
		role:role === ActorType.Entity ? 'PRO' : 'PERSO',
		...input
	}) ;


	if (!$ok(certificateEntity)) {
		if (!isNewJWT) {
			[jwt, isNewJWT] = await certignaJWT(auth.user, auth.password, true, c) ;
			certificateEntity = await certigna.generateCertificate(jwt, {
				password:<string>certificatePasword,
				role:role === ActorType.Entity ? 'PRO' : 'PERSO',
				...input
			}) ;
		}
		if (!$ok(certificateEntity)) {
			throw new CertignaRequestError('Impossible to generate certificate') ;
		}
	}

	const SN = certificateEntity?.serialnumber ;
	if (!$length(SN)) {
		throw new CertignaRequestError('BAD certificate serial number') ;
	}

	let certificate = await certigna.downloadCertificate(jwt, <string>SN) ;
	if (!$length(certificate)) {
		if (!isNewJWT) {
			[jwt, isNewJWT] = await certignaJWT(auth.user, auth.password, true, c) ;
			certificate = await Certigna.endPoint().downloadCertificate(jwt, <string>SN) ;
		}
		if (!$length(certificate)) {
			throw new CertignaRequestError('Impossible to generate certificate') ;
		}
	}

	return <CertificateData>{
		data:(<Buffer>certificate).toString('base64'), // we keep the base64 content here
		password:<string>certificatePasword,
		// lifespan:input.lifespan,
		...<CertificateEntity>certificateEntity
	} ;

}

export const revoqueCertignaCertificate = async (auth:APIAuth, SN:string, c:EditingContext) : Promise<void> =>
{
	if (!$ok(c.trx)) {
		throw new InternalError('revoqueCertignaCertificate() should be called inside a transaction') ;
	}
	let [jwt, isNewJWT] = await certignaJWT(auth.user, auth.password, false, c) ;
	let flag = await Certigna.endPoint().revoqueCertificate(jwt, SN) ; // TODO: later we could add a reason here
	if (!flag) {
		if (!isNewJWT) {
			[jwt, isNewJWT] = await certignaJWT(auth.user, auth.password, true, c) ;
			flag = await Certigna.endPoint().revoqueCertificate(jwt, SN) ;
		}
		// if we fail, we ignore it, and the certificate will stay in Certigna's repository until it auto-revokes
	}
}
