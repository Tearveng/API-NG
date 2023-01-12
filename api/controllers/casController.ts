import { $count } from "foundation-ts/commons";

import { ForbiddenError } from "../../utils/errors";

import CertificationAuthority from "../../model/CertificationAuthority";
import { CAStatus } from "../../model/DBConstants";
import { APIServer } from "../../server";
import { UserRole } from "../APIConstants";
import { APIAuth } from "../APIInterfaces";

export interface CAListNode {
	publicId:number ;
}

export const getCAList = async (auth:APIAuth) : Promise<string[]> => {
	// everybody can list the certification authority list : auth is not used here !
	if (auth.role === UserRole.Maintenance || auth.role === UserRole.System) {
		throw new ForbiddenError('System or maintenance users cannot list certification authorities') ;
	}
	const list = <CAListNode[]>await CertificationAuthority.query()
										     .where('status', '=', CAStatus.Valid)
									         .select('publicId')
										     .orderBy('publicId') ;
	const api = APIServer.api() ;
	return $count(list) ? list.map((n:CAListNode) => api.url('ca', n.publicId)) : [] ;
}
