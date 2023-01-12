
import { $length, $ok } from 'foundation-ts/commons';
import { $decrypt, $encrypt, $hash, HashMethod } from 'foundation-ts/crypto';

import { InternalError } from '../utils/errors';

import { APIModel } from './APIModels'
import { apiTables } from './DBConstants';
import { JWTAuthData, UserJWTInterface } from './DBInterfaces';

export default class UserJWT extends APIModel implements UserJWTInterface {
	static tableName = apiTables.userJWT ;
	private static __ck = '81ABD59747024B62AADE1615973630A9' ;
	declare user: string ;

	// JSON columns
	declare authData: JWTAuthData ;
	
	public static authDataWithJWT(jwt:string) : JWTAuthData {
		if (!$length(jwt)) {
			throw new InternalError('cannot handle and empty JWT') ;
		}
		const encrypted = $encrypt(jwt, UserJWT.__ck) ;
		if (!$ok(encrypted)) {
			throw new InternalError('cannot prepare JWT data') ;
		}
		const hash = $hash(Buffer.from(<string>encrypted), HashMethod.SHA256) ;
		return {
			jwtA:<string>encrypted,
			jwtB:hash
		}
	}

	public jwt() : string|null {
		return $decrypt(this.authData.jwtA, UserJWT.__ck) ;
	}

	static jsonAttributes = ['authData'] ;
}


