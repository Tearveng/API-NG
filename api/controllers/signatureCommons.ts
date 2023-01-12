import { ObjectDictionary } from 'foundation-ts/types';
import { $count, $length, $ok } from "foundation-ts/commons";

import { 
	ForbiddenError, 
	NotFoundError, 
	ManifestDataError, 
	BadRequestError
} from "../../utils/errors";

import Scenario from "../../model/Scenario";
import Session from "../../model/Session";
import Token from "../../model/Token";
import { APIServer } from "../../server";
import { $url2lid, $urls2lids, DocumentList } from "../APIIDs";
import { 
	APIAuth, 
	ManifestData, 
	SessionCheckOTPBody,
	SessionApproveDocumentsBody, 
	SigningVisualParameters,
	SigningTextAlignment
} from "../APIInterfaces";
import { Automat, automatCopyWithActorAction } from "../automat/automat";
import { sessionWithPublicID } from "./sessionController";
import { EditingContext } from "../../model/DBInterfaces";
import Objection from "objection";
import { CertignaTextAligns, VisibleSignatureParameters } from "../../classes/CertignaEndPoint";
import Actor from "../../model/Actor";

export interface SigningContext extends EditingContext {
	tag:string ;
	aid:number ;
	dids:number[] ;
	manifestData:ManifestData ;
	session:Session ;
	scenario:Scenario ;
	nextAutomat:Automat ;
}

export const checkOTPConformity = async (auth:APIAuth, sessionPublicID:number, body:SessionCheckOTPBody, c:EditingContext) : Promise<[Token, Session]> => {
	let session = await sessionWithPublicID(auth, sessionPublicID, {trx:c.trx}) ;

	if (session.isClosed() || session.isExpired()) {
		throw new ForbiddenError(`Session ${sessionPublicID} is closed or already expired.`);
	}
	if (!$length(body.otp)) { throw new NotFoundError('OTP field not specified'); }

	let actorSubquery = Actor.query(c.trx).where('sessionId', '=', session.id) ;
	if ($length(body.actor)) {
		const aid = $url2lid(body.actor) ;
		if (!aid) { throw new BadRequestError('Bad actor identifier') ; }
		actorSubquery.where('publicId', '=', aid)
	}

	let tokens = await Actor.relatedQuery('tokens')
	                        .for(actorSubquery)
							.where('otp', '=', body.otp) ;

	if ($count(tokens) !== 1) { throw new NotFoundError(); }
	const token = (<Token[]>tokens)[0] ;
	if ($length(body.tag) && token.otherData?.tag !== body.tag) { throw new NotFoundError(); }

	let docs:DocumentList = $urls2lids(body.documents) ;
	if (docs.length !== $count(body.documents)) { throw new NotFoundError() ; }

	docs.forEach(did => { if (!token.otherData?.dids?.includes(did)) { throw new NotFoundError(); }} ) ;

	return [token, session] ;
}

export function certignaVisualParameters(params:SigningVisualParameters) : VisibleSignatureParameters
{
	let ret:VisibleSignatureParameters = {
		height:params.height,
		width:params.width,
		x:params.x,
		y:params.y,
		page:params['page-number'],
	} ;
	let textOrImage = false ;

	if ($length(params.text)) {
		textOrImage = true ;
		const fontSize = params['font-size'] ;
		if (!$ok(fontSize)) {
			throw new BadRequestError('Bad PAdES font size option') ;
		}
		const align = params['text-align'] ;
		if (!$ok(align) || !Object.values(SigningTextAlignment).includes(align)) { 
			throw new BadRequestError('Bad PAdES text alignment option') ;
		}

		ret.textParameters = {
			text:<string>(params.text),
			fontSize:<number>fontSize,
			horizontalAlignment:CertignaTextAligns[<SigningTextAlignment>align]
		}
	}
	if ($length(params['image-content'])) {
		textOrImage = true ;
		ret.imageParameters = {
			imageContent:<string>params['image-content']
		}
	}
	if (!textOrImage) {
		throw new BadRequestError('No Image or Text in PAdES visual-parameters') ;
	}			

	return ret ;
}

/**
 * This function takes transaction as parameter and not an editing context
 * because the returned objet IS an interface extension of EditingContext
 * (i.e. the EditingContext is created by this function)
*/
export async function checkSigningAndApprobation(
	api:APIServer,
	auth:APIAuth, 
	trx:Objection.TransactionOrKnex,
	sessionPublicID:number, 
	body:SessionApproveDocumentsBody,
	type:'approve'|'sign', 
	manifestDefault:ObjectDictionary, 
	defaultTag?:string
) : Promise<SigningContext>
{
	let aid = $url2lid(body.actor) ;
	if (!aid) {
		throw new BadRequestError(`No actor defined for signing or approval.`);
	}
	let tag = body.tag ;
	if (!$length(tag)) {
		if (!$length(defaultTag)) {
			throw new BadRequestError(`No tag indicated for documents to be signed or approved.`);
		}
		tag = defaultTag ;
	}
	if (!$count(body.documents)) {
		throw new BadRequestError(`No documents listed for signing or approval.`);
	}

	let dids = $urls2lids(body.documents) ;
	if (dids.length !== $count(body.documents)) {
		throw new BadRequestError(`One of the document listed for approval had a wrong url.`);
	}

	let manifestData =  body['manifest-data'] ;

	if (!api.verifyManifestData(manifestData, manifestDefault)) {
		throw new ManifestDataError(`manifest-data did not match allowed keys for approval or signing operations.`);
	}

	let session ;
	if (type === 'approve') {
		[, session] = await checkOTPConformity(auth, sessionPublicID, body, {trx:trx}) ;
	}
	else {
		session = await sessionWithPublicID(auth, sessionPublicID, {trx:trx}) ;
	}

	let scenario = await session.$relatedQuery('activeScenario', trx) ;
	let newAutomat = automatCopyWithActorAction(scenario.otherData.automat, aid, <string>tag, dids) ;

	return {
		trx:trx,	// because this is a sub-interface of EditingContext
		tag:<string>tag,
		aid:aid,
		dids:dids,
		manifestData:manifestData,
		session:session,
		scenario:scenario,
		nextAutomat:<Automat>newAutomat
	}
}
