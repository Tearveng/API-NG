import { $count, $length, $ok, $unsigned } from 'foundation-ts/commons';
import { $removeFile } from 'foundation-ts/fs';
import { $uuid } from 'foundation-ts/crypto';

import { NotFoundError, ConflictError, BadRequestError } from '../../utils/errors'

import Certificate, {CertificateData} from '../../model/Certificate';
import Upload from '../../model/Upload'
import { uploadWithURL } from './uploadController'
import { CertificateStatus, ActorType, UserRole } from '../APIConstants'
import { APIServer } from '../../server'
import {
	APIAuth,
	CertificatesQuery,
	CertificateFileNode,
	CreateCertificateBody
} from '../APIInterfaces';
import { authorityWithPublicID } from './caController';
import { getSessionActorByID } from './actorController';
import CAToken from '../../model/CAToken';
import { apiGlobals, FileStatus, NO_CONTEXT, TokenStatus } from '../../model/DBConstants';
import FileRef from '../../model/FileRef';
import { $url2gid, $url2lid, GlobalID } from '../APIIDs';
import { sessionWithPublicID } from './sessionController';
import { SessionContextEventType } from '../../model/DBInterfaces';
import { generateCertignaCertificate } from './certificatesCommons';



export interface CertificateListNode {
	publicId:GlobalID ;
}

export const getSessionCertificateList = async (auth:APIAuth, sessionPublicID:number, q:CertificatesQuery) : Promise<string[]> =>
{
	await sessionWithPublicID(auth, sessionPublicID, NO_CONTEXT) ; // here in order to verify the rights to do what we want to do...
	const query = Certificate.expirationAwareListQuery<CertificatesQuery, Certificate>(auth, q, NO_CONTEXT) ;
	if (auth.role === UserRole.Action) {
		// as action role, we get only our certificates
		query.where('user', '=', auth.user) ;
	}

	query.where('status', '=', CertificateStatus.Valid) ; // we get only valid certificates

	if ($ok(q.caid) && !Certificate.addGlobalIDsToQuery<Certificate>(query, 'caToken.authority.publicId', q.caid)) {
		throw new ConflictError('Bad certification authority id in request') ;
	}
	if ($ok(q.actorIds) && !Certificate.addLocalIDsToQuery<Certificate>(query, 'caToken.actor.publicId', q.actorIds)) {
		throw new ConflictError('Bad actor id or actor ids list in request') ;
	}

	query.select('publicId').orderBy('publicId') ;

	let list = <CertificateListNode[]>await query ;

	if ($count(list)) {
		let api = APIServer.api() ;
		return list.map(n => api.url('session', sessionPublicID, 'actor', n.publicId)) ;
	}
	return [] ;
}

export interface UploadNode extends CertificateFileNode
{
	upload:Upload ;
}

export const generateCertificateForSession = async (auth:APIAuth, sessionPublicID:number, q:CreateCertificateBody) : Promise<Certificate> =>
{
	let returnValue = undefined ;
	let paths:string[] = [] ;

	try {

		returnValue = await Certificate.transaction(async trx => {
			let uploads:UploadNode[] = [] ;
			const context = {trx:trx} ;
			let session = await sessionWithPublicID(auth, sessionPublicID, context) ;
			const uploadNodes = q['supporting-documents'] ;

			if ($count(uploadNodes)) {
				for (let node of <CertificateFileNode[]>uploadNodes) {
					if (!$length(node.filename)) {
						throw new BadRequestError('bad filename definition') ;
					}
					const upload = await uploadWithURL(node.url, context) ;

					uploads.push({ upload:upload, ...node}) ;
					upload.fillPathsIn(paths) ;
				}
			}

			const caid = $url2gid(q.authority) ;
			if (!caid) { throw new NotFoundError("AC not found") ; }
			const aid = $url2lid(q.actor) ;
			if (!aid) { throw new NotFoundError("Actor not found") ; }
			if ($length(q.token) !== apiGlobals.uuidLength) { throw new NotFoundError("Token not found or malformed") ; }

			const authority = await authorityWithPublicID(auth, caid, context) ;
			let actor = await getSessionActorByID(auth, session, aid, context) ;
			let tokens = await CAToken.query(trx)
							   		  .where('caId', '=', authority.id)
							   		  .where('sessionId', '=', session.id)
							   		  .where('actorId', '=', actor.id)
							   		  .where('token', '=', q.token)
							   		  .where('status', '=', TokenStatus.Active) ;

			if ($count(tokens) !== 1) { throw new NotFoundError("Token not found") ; }
			let token = tokens[0] ;

			token.authority = authority ; // make our graph strait
			token.actor = actor ; // idem

			// TODO: should be check session mutability here ?
			// await checkSessionMutability(actor.session) ;
			if (actor.url() !== q.actor) {
				throw new NotFoundError("Actor not found : wrong session identifier") ; // we did put a bad session ID in the actor URL !
			}
			token.actor = actor ;
			let api = APIServer.api() ;
			let ttl:number = $unsigned(q.ttl) ;
			if (!ttl) { ttl = api.conf.certificateTtl ; }

			let certificateData = await generateCertignaCertificate(auth, {
				givenName:$length(actor.firstName) ? <string>(actor.firstName) : 'John' ,
				surname:actor.type === ActorType.Person ? actor.name : 'Doe',
				organizationName:(actor.type === ActorType.Entity ? actor.name : 'Unknown'),
				emailAddress:actor.email,
				countryName:actor.country,
				lifespan: ttl
			},
			actor.type,
			context) ;

			// we need to create all the filerefs for the certificate
			let files:FileRef[] = [] ;

			for (let node of uploads) {
				const upload = node.upload ;
				let file = await FileRef.query(trx).insert({
					fileName:node.filename,
					fileType:upload.fileType,
					hash:upload.hash,
					path:upload.path,
					sealPath:upload.sealPath,
					size:upload.size,
					status:FileStatus.Valid,
					timestamped_at:upload.uploaded_at,
					uploaded_at:upload.uploaded_at,
					user:upload.user
				}) ;

				files.push(file) ;
				await upload.cleanAndDelete(context) ;
			}

			let pid = actor.session.sessionNextPublicID() ;
			let certificate = await Certificate.query(trx).insert({
				publicId:pid,
				sessionId:session.id,
				caTokenId:token.id,
				status:CertificateStatus.Valid,
				ttl:ttl,
				user:auth.user,
				certificateData:(<CertificateData>certificateData)
			}) ;
			console.log("certificateData:XX===",files);
			if($count(files)){
				await certificate.$rq('files', context).relate(files) ;
			}

			console.log("XXXXXXXXX===");
			let sessionOtherData = { ...actor.session.otherData } ;
			sessionOtherData.sessionContextEvents.push({
				user:auth.user,
				date:certificate.creationDate(),
				'event-type':SessionContextEventType.GenerateCertificate,
				'actor-id':aid,
				'operation-id':$uuid(),
				token:token.token,
				'certificate-id':pid
			}) ;

			await actor.session.$q(context).patch({
				lastPubObject:actor.session.lastPubObject,
				otherData:sessionOtherData,
			}) ;

			return certificate ;
		}) ;
	}
	catch (e) {
		// we did rollback here
		// we at least will remove all uploaded files...
		console.log("API CALLEDX:Error");
		paths.forEach(p => $removeFile(p)) ;
		APIServer.api().error(e);
		throw e ;
	}
	console.log("API CALLEDX:");

	return <Certificate>returnValue ;
}
