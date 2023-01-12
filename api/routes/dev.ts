import { $length, $ok, $unsigned } from 'foundation-ts/commons';
import { $trim } from 'foundation-ts/strings';
import { $ext, $readString } from 'foundation-ts/fs';
import { $uuid, HashMethod } from 'foundation-ts/crypto';
import { Resp, Verb } from 'foundation-ts/tsrequest'
import { $inspect } from 'foundation-ts/utils';

import { $now } from '../../utils/commons';
import { BadRequestError, CertignaRequestError, NotFoundError } from '../../utils/errors';


import { Certigna, SignatureRequest } from '../../classes/CertignaEndPoint';
import { CertificateData } from '../../model/Certificate';
import { NO_CONTEXT } from '../../model/DBConstants';
import Upload from '../../model/Upload';
import UserJWT from '../../model/UserJWT';
import { APIServer } from '../../server'
import { ActorType, APIRole, SignatureFormat, SignatureLevel, SignatureType } from '../APIConstants';
import { DirectSignatureOptions, devSignatureOptionsSchema } from '../APIDeveloper';
import { $gid } from '../APIIDs';
import { APIHeaders } from '../APIInterfaces';
import { apiHeadersSchema } from '../APISchemas';

import { generateCertignaCertificate } from '../controllers/certificatesCommons';
import { UploadsParams } from './upload';


export function devRoutes() {
	const api = APIServer.api() ;

	const tags={tags:["dev"]}

	api.server.route<{
		Headers: APIHeaders
	}
	>(
		{
			url: `${api.prefix}${api.version}/dev/ping`,
			method: Verb.Get,
			schema:{
				...tags,
				headers:apiHeadersSchema
 			},
			handler: async (request, reply) => {
				try {
					const auth = api.prepareRequest(request, reply, [], APIRole.Signature) ;
					api.jsonReply(reply, Resp.OK, {
						requestId:request.id,
						apiRole:auth.apiRole,
						user:auth.user,
						role:auth.role,
						requestMethod:request.method,
						requestUrl:request.url,
						date:$now(),
						ip:request.ip,
						params:request.params,
						headers:request.headers,
						query:request.query,
						body:request.body
					}) ;
				}
				catch (e) { await api.requestError(reply, e) ; }
			}
		}
	) ;

	api.server.route<{
		Headers: APIHeaders
	}
	>(
		{
			url: `${api.prefix}${api.version}/dev/check-certificate-generation-status`,
			method: Verb.Get,
			schema:{
				...tags,
				headers:apiHeadersSchema
 			},
			handler: async (request, reply) => {
				try {
					api.prepareRequest(request, reply, [], APIRole.Signature) ;
					const endPoint = Certigna.endPoint() ;

					const cgs = await endPoint.checkGenerationStatus() ;
					api.jsonReply(reply, Resp.OK, { status:cgs }) ;
				}
				catch (e) { await api.requestError(reply, e) ; }
			}
		}
	) ;


	api.server.route<{
		Headers: APIHeaders,
		Querystring: DirectSignatureOptions
	}
	>(
		{
			url: `${api.prefix}${api.version}/dev/sign-document`,
			method: Verb.Post,
			schema:{
				...tags,
				headers:apiHeadersSchema,
				querystring:devSignatureOptionsSchema
 			},

			handler: async (request, reply) => {
				try {
					const auth = api.prepareRequest(request, reply, [], APIRole.Signature) ;

					const fileToBeSigned = <Buffer>request.body ;
					const endPoint = Certigna.endPoint() ;
					const fileName = request.query['file-name'] ;
					const signatureFormat = $unsigned(request.query.format) ;
					const signatureType = $unsigned(request.query.type) ;
					const signatureLevel = $unsigned(request.query.level) ;
					const certificateGen = $trim(request.query.certificate).toLowerCase() ;

					if (!signatureFormat || !Object.values(SignatureFormat).includes(signatureFormat)) {
						throw new BadRequestError('Bad signature format') ;
					}
					if (!signatureType || !Object.values(SignatureType).includes(signatureType)) {
						throw new BadRequestError('Bad signature type') ;
					}
					if (!signatureLevel || !Object.values(SignatureLevel).includes(signatureLevel)) {
						throw new BadRequestError('Bad signature level') ;
					}
					if (certificateGen !== 'generate' && certificateGen !== 'server') {
						throw new BadRequestError('Bad certificate generation mode') ;
					}

					api.log(`FileName='${fileName}'`) ;
					api.log(request.query) ;
					const certigna = Certigna.endPoint() ;

					let signatureRequest:SignatureRequest = {
						format:signatureFormat,
						login:auth.user,
						password:auth.password,
						fileName:fileName,
						hashMethod:HashMethod.SHA256,
						level:signatureLevel,
						type:signatureType
					} ;

					certigna.verifySignatureRequest(signatureRequest) ;



					let certificateData:CertificateData|null = null ;

					if (certificateGen === 'generate') {
						certificateData = await UserJWT.transaction(async trx => {
							const context = {trx:trx} ;
							api.log("Will generate certificate with data:") ;
							const generationData = {
								givenName:'John' ,
								surname:'Doe',
								organizationName:'Unknown',
								countryName:'FR',
								emailAddress:"john.doe@orange.fr",
								lifespan: 720
							} ;
							api.log(generationData) ;
							return await generateCertignaCertificate(auth, generationData, ActorType.Person, context) ;
						}) ;
					}

					api.log(`Will sign document '${fileName}' :`) ;
					if ($ok(certificateData)) {
						api.log(`with certificateData:\n${$inspect(certificateData)}`) ;
					}

					const result = await endPoint.signDocument(fileToBeSigned, {
						...signatureRequest,
						certificateId:$ok(certificateData) ? certificateData?.serialnumber : undefined,
						certificatePwd:$ok(certificateData) ? certificateData?.password : undefined
					}) ;


					if (!$ok(result)) { throw new CertignaRequestError('Impossible sign PDF file') ; }
					const signedFileName = `${$uuid()}.${$ext(fileName)}`;
					api.log(`Did generate signed document '${signedFileName}' :`) ;
					reply.header('Content-Disposition', `attachment;filename=${signedFileName}`) ;
					reply.header('Content-Length', $length(result)) ;
					reply.code(Resp.OK).send(<Buffer>result) ;
				}
				catch (e) { await api.requestError(reply, e) ; }
			}
		}
	) ;

	api.server.route<{
		Headers: APIHeaders
		Params: UploadsParams,
	}
	>(
		{
			url: `${api.prefix}${api.version}/dev/upload-verif/:uid`,
			method: 'GET',
			schema:{
				...tags,
				headers:apiHeadersSchema,
				params:{
					uid:{type:'number'}
				}
			},
			handler: async (request, reply) => {
				try {
					const auth = api.prepareRequest(request, reply, ['uid'], APIRole.Signature) ;
					const uid = $gid(request.params.uid) ;
					let upload = await Upload.objectWithPublicID<Upload>(uid, NO_CONTEXT) ;

					if (!$ok(upload)) {
						throw new NotFoundError(`Upload with ID ${uid} was not found.`);
					}
					const seal = $readString(upload?.sealPath) ;
					if (!$length(seal)) {
						throw new NotFoundError(`Seal of upload with ID ${uid} was not found.`);
					}

					if (await upload?.verifyFileSeal()) {
						api.jsonReply(reply, Resp.OK, { verified: true, seal:seal, auth:auth }) ;
					}
					else {
						api.jsonReply(reply, Resp.OK, { verified: false, auth:auth }) ;
					}
				}
				catch (e) { await api.requestError(reply, e) ; }
			}
		}
	) ;

}
