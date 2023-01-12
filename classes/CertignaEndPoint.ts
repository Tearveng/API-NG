import { $isstring, $length, $ok } from "foundation-ts/commons" ;
import { $ext, $isfile, $readBuffer, $uniquefile, $withoutext } from "foundation-ts/fs";
import { HashMethod } from 'foundation-ts/crypto'
import { TSRequest, Verb, RespType, Resp, $barerauth, $basicauth } from "foundation-ts/tsrequest";
import { TSError } from "foundation-ts/tserrors";
import { $inspect } from "foundation-ts/utils";

import { $left } from "../utils/commons";
import { BadRequestError, CertignaRequestError, ConflictError } from "../utils/errors";

import { APIExtensions, APIFileInfos, APIFileType, SignatureFormat, SignatureLevel, SignatureLevelTag, SignatureType } from "../api/APIConstants";
import { GenericLogger, GenericLoggerInterface } from "./GenericLogger";
import { APIFileToken } from "../api/APIInterfaces";
import { Crypto } from "@peculiar/webcrypto";
import * as xmldsig from "xmldsigjs" ;
import * as env from './../env-config';

const SealingCrypto = new Crypto();

xmldsig.Application.setEngine("NodeJS", SealingCrypto);

/*
 * 	A signleton for all calls to Certigna remote services
 */

export enum CertignaAlignTag {
	Left = 'LEFT',
	Center = 'CENTER',
	Right = 'RIGHT'
}

export const CertignaTextAligns = [
	CertignaAlignTag.Left,
	CertignaAlignTag.Center,
	CertignaAlignTag.Right
] ;


export interface GenericCertificateEntity {
	givenName:string ;
	surname:string ;
	organizationName?:string ;
	organizationUnitName?:string ;
	countryName:string ;
}

export interface CertificateRequestEntity extends GenericCertificateEntity {
	password:string ;
	// lifespan:number ; // we made the lifespan mandatory
	emailAddress:string ;
	role?:'PERSO'|'PRO' ;
}

export interface CertificateEntity extends GenericCertificateEntity {
	id:string ;
	serialnumber:string ;
	notAfter:string ;
	notBefore:string ;
}

export interface KeyStoreEntity {
	password:string ;
	// pkcs12Content:string ;
	certificateId:string ;
	type:'PKCS12KeyStore' ;
}

export interface VisibleSignatureImageParameters {
	imageContent:string ; // base64 encoded image
}

export interface VisibleSignatureTextParameters {
	fontSize:number ;
	horizontalAlignment:CertignaAlignTag ;
	text:string ;
}

export interface VisibleSignatureParameters {
	height:number ;
	width:number ;
	x:number ;
	y:number ;
	page:number ;
	imageParameters?:VisibleSignatureImageParameters ;
	textParameters?:VisibleSignatureTextParameters ;
}

export interface SignatureRequest {
	format:SignatureFormat ;
	login:string ;
	password:string ;
	fileName:string ;
	hashMethod:HashMethod ;
	level:SignatureLevel ;
	certificateId?:string|null|undefined ;
	certificatePwd?:string|null|undefined ;
	type?:SignatureType ;
	visualParameters?:VisibleSignatureParameters ;
}

export interface SignatureEntity {
	digestAlgorithm:HashMethod ;
	fileContent:string ; // base64 file content
	fileName:string ;
	signatureLevel:SignatureLevelTag ;

	keyStore?:KeyStoreEntity ;
}
export interface PAdESEntity extends SignatureEntity {
	visibleSignatureParameters?:VisibleSignatureParameters ;
}

export interface XAdESEntity extends SignatureEntity {
	signaturePackaging:'ENVELOPED' | 'ENVELOPING' ;
}

export interface CAdESEntity extends SignatureEntity {
	signaturePackaging:'ENVELOPING' ;
}

const CERTIFICATE_BASE:any = env.CERTIFICATE_BASE;
const SIGNATURE_BASE:any = env.SIGNATURE_BASE;
// TODO: add timestamp end point here
// const TIMESTAMP_BASE = env.TIMESTAMP_BASE ;

// seconds
export const MIN_CERTIFICATE_TTL = 60 ;
export const MAX_CERTIFICATE_TTL = 1800 ;

// milliseconds
export const DEFAULT_REQUEST_TIMEOUT = 8000 ;
export const DEFAULT_CERTIFICATE_GENERATION_TIMEOUT = 15000 ;
export const DEFAULT_SIGNATURE_TIMEOUT = 60000 ;
// TODO: add timestamp end point here
// export const DEFAULT_TIMESTAMP_TIMEOUT = 20000 ;
export class Certigna extends GenericLogger {
	private static instance: Certigna; // the private singleton var

    private _signatureEndPoint:TSRequest ;
    private _certificateEndPoint:TSRequest ;

	public timeOut:number ;
	public certificateGenerationTimeOut:number = DEFAULT_CERTIFICATE_GENERATION_TIMEOUT ;
	public signatureGenerationTimeOut:number=DEFAULT_SIGNATURE_TIMEOUT ;
	public jwtTtl = 3600 ;
	public emailSizeMax = 255 ;
	public surnameMax = 40 ;
	public givenNameMax = 16 ;
	public organizationNameMax = 64 ;
	public organizationUnitNameMax = 128 ;

	// WARNING : for now we accept as extensions the same extensions as those authorized for all uploads
	public signingExtensions = APIExtensions ;

	private constructor(logger?:GenericLoggerInterface) {
		super(logger) ;
        this.timeOut = DEFAULT_REQUEST_TIMEOUT ;
        const opts = { timeout: this.timeOut } ;
        this._certificateEndPoint = new TSRequest(CERTIFICATE_BASE, opts) ;
        this._signatureEndPoint = new TSRequest(SIGNATURE_BASE, opts) ;
        // TODO: add timestamp end point here
        // this._timestampEndPoint = new TSRequest(TIMESTAMP_BASE)
	}

	public async certificatesAPILogin(login:string, pwd:string) : Promise<string|null> {
		if (!$length(login) || !$length(pwd)) {
			throw new Error("'login' and 'password' should be specified for login body on certificate system") ;
		}
		const r = await this._certificateEndPoint.req('/login', Verb.Post, RespType.Buffer,
			{ 'username': login, 'password': pwd},
			{ 'Accept': 'application/jwt'}
		) ;
		return r?.status === Resp.OK ? r?.response?.toString('ascii') /* we don't want any transformation here */ : null ;
	}

	public async getTOUVersion(aki:string):Promise<string|null> {
		const r = await this._certificateEndPoint.req(`/cgu/version?aki=${aki}`) ;
        return r?.status === Resp.OK && $length((<any>r?.response)['version']) > 0 ? (<any>r.response)['version'] as string : null ;
	}

	public async getTOU(aki:string):Promise<Buffer | null> {
		const r = await this._certificateEndPoint.req(`/cgu?aki=${aki}`, Verb.Get, RespType.Buffer) ;
        return r?.status === Resp.OK ? r.response as Buffer : null ;
	}

	public async checkGenerationStatus():Promise<boolean> {
        const response = await this._certificateEndPoint.req('/status') ;
		return response?.status === Resp.OK ;
	}

	public async generateCertificate(jwt:string, entity:CertificateRequestEntity):Promise<CertificateEntity | null> {
        if (!$length(jwt)) {
            throw new TSError("'token' should be specified for JWT authentification on Certigna systems for certificate generation") ;
        }

		if ($ok(entity.givenName)) entity.givenName = $left(entity.givenName, this.givenNameMax) ;
		if ($ok(entity.surname)) entity.surname = $left(entity.surname, this.surnameMax) ;
		if ($ok(entity.emailAddress)) entity.emailAddress = $left(entity.emailAddress, this.emailSizeMax) ;
		if ($ok(entity.organizationName)) entity.organizationName = $left(entity.organizationName, this.organizationNameMax) ;
		if ($ok(entity.organizationUnitName)) entity.organizationUnitName = $left(entity.organizationUnitName, this.organizationUnitNameMax) ;
		this.log(`generateCertificate() body:\n${$inspect(entity)}`) ;
        const r = await this._certificateEndPoint.req('/certificates', Verb.Post, RespType.Json, entity, {'Authorization':$barerauth(jwt)}, this.certificateGenerationTimeOut) ;
        return r?.status === Resp.OK ? r.response as CertificateEntity : null ;
	}

	// the return is a base64 encoded buffer
	public async downloadCertificate(jwt:string, SN:string):Promise<Buffer|null> {
		const r = await this._certificateEndPoint.req(`/certificates/${SN}/download`, Verb.Get, RespType.Buffer, undefined, {'Authorization':$barerauth(jwt)}, this.certificateGenerationTimeOut) ;
        return r.status === Resp.OK ? r.response as Buffer : null ;
	}

	public async revoqueCertificate(jwt:string, SN:string, reason:string='API-NG end of usage revocation'):Promise<boolean> {
        const r = await this._certificateEndPoint.req(`/certificates/${SN}/revok`, Verb.Post, RespType.String, { reason:reason }, {'Authorization':$barerauth(jwt)}, this.certificateGenerationTimeOut) ;
		return r?.status === Resp.NoContent ;
	}


	public verifySignatureRequest(r:SignatureRequest) {
		if (!$length(r.login)) { throw new BadRequestError('No login specified for signature') ;} ;
		if (!$length(r.password)) { throw new BadRequestError('No password specified for signature') ;} ;
		if (!$length(r.fileName)) { throw new BadRequestError('No specified file name') ;} ;
		if (!r.level || !Object.values(SignatureLevel).includes(r.level)) {
			throw new BadRequestError('Bad signature level') ;
		}
		if (!$length(r.hashMethod) || !Object.values(HashMethod).includes(r.hashMethod)) {
			throw new BadRequestError('Bad digest algorithm') ;
		}

		let fileType:APIFileType | undefined = undefined ;
		switch (r.format) {
			case SignatureFormat.PAdES:
				fileType = APIFileType.PDF ;
				if ($ok(r.type) && r.type !== SignatureType.Envelopped) {
					throw new ConflictError('Incompatible signature type for PAdES signature') ;
				}
				break ;
			case SignatureFormat.XAdES:
				fileType = APIFileType.XML ;
				if (r.type !== SignatureType.Envelopped && r.type !== SignatureType.Envelopping) {
					throw new ConflictError('Incompatible signature type for XAdES signature') ;
				}
				if ($ok(r.visualParameters)) {
					throw new ConflictError('No Visual parameters should be set for XAdES signature') ;
				}
				break ;
			case SignatureFormat.CAdES:
				if (r.type !== SignatureType.Envelopping) {
					throw new ConflictError('Incompatible signature type for CAdES signature') ;
				}
				if ($ok(r.visualParameters)) {
					throw new ConflictError('No Visual parameters should be set for CAdES signature') ;
				}
				break ;
			default:
				throw new BadRequestError('Bad signature format') ;
		}
		const extension = $ext(r.fileName).toLowerCase() ;
		if ($ok(fileType)) {
			if (!APIFileInfos[<APIFileType>fileType].extensions.includes(extension)) {
				throw new ConflictError(`Signature should concern exclusively ${$inspect(APIFileInfos[<APIFileType>fileType].extensions)} files`) ;
			}
		}
		else {
			if (!$length(this.signingExtensions[extension])) {
				throw new BadRequestError(`Bad file extension ${extension} for document to be signed`) ;
			}
		}
	}

	public async signDocument(doc:string|Buffer, request:SignatureRequest) : Promise<Buffer|null> {

		this.verifySignatureRequest(request) ;
		let fileContent = _prepareDocumentForSigning(doc) ;

		let entity ;
		let relativeURL ;
		// let outputType ;

		switch (request.format) {
			case SignatureFormat.PAdES:
				entity = _signatureEntity<PAdESEntity>(fileContent, request) ;
				if ($ok(request.visualParameters)) entity.visibleSignatureParameters = request.visualParameters ;
				relativeURL = '/signature/pades'
				// outputType = 'PAdESResponse' ;
				break ;
			case SignatureFormat.XAdES:
				entity = _signatureEntity<XAdESEntity>(fileContent, request) ;
				entity.signaturePackaging = request.type === SignatureType.Envelopped ? 'ENVELOPED' :'ENVELOPING' ;
				relativeURL = '/signature/xades'
				// outputType = 'XAdESResponse' ;
				break ;
			case SignatureFormat.CAdES:
				entity = _signatureEntity<CAdESEntity>(fileContent, request) ;
				entity.signaturePackaging = 'ENVELOPING' ;
				relativeURL = '/signature/cades'
				// outputType = 'CAdESResponse' ;
				break ;
			default:
				throw new Error('Bad signature format') ;
		}
			console.log("Authentication signatures : ",request.login,request.password);


        const r = await this._signatureEndPoint.req(
            relativeURL,
            Verb.Post,
            RespType.Json,
            entity,
            {'Authorization': $basicauth("pps#test", request.password)},
            this.signatureGenerationTimeOut
        ) ;
				console.log("RES:X",r?.status);
		// TODO: should we throw an error if outoutType is wrong ?
		if (r?.status === Resp.OK) {
			let fc = (<any>r.response)['signedFileContent'] ;
			if ($length(fc)) return Buffer.from(fc, 'base64') ;
		}
		return null ;
	}

	public async seal(login:string, password:string, token:APIFileToken, sealName?:string) : Promise<string> {
		const xmlString = fileTokenToXMLString(token) ;
		if (!$length(sealName)) {
			if ($ext(token.name).toLowerCase() === 'xml') {
				sealName = $uniquefile(token.name) ;
			}
			else {
				sealName = `${$withoutext(token.name)}.xml`;
			}
		}


		const bufferOrNull = await this.signDocument(Buffer.from(xmlString), {
				format:SignatureFormat.XAdES,
				login:login,
				password:password,
				fileName:<string>sealName,
				hashMethod:HashMethod.SHA256,
				level:SignatureLevel.LTA,
				type:SignatureType.Envelopped
		}) ;

		if (!$length(bufferOrNull)) {
			throw new CertignaRequestError("Impossible seal.") ;
		}
		const returnedString = (<Buffer>bufferOrNull).toString('utf-8') ;
		if (!(await verifySignature(returnedString))) {
			throw new CertignaRequestError("Impossible to verify seal's signature.")
		}
		return returnedString ;
	}


	public static endPoint(logger?:GenericLoggerInterface): Certigna
	{
		if (!this.instance) {
			this.instance = new Certigna(logger) ;
		}
		return this.instance ;
	}
}

export function fileTokenToXMLString(token:APIFileToken):string {
    return '<FileToken>\n' +
    `\t<name>${token.name}</name>\n` +
    `\t<user>${token.user}</user>\n` +
    `\t<size>${token.size}</size>\n` +
    `\t<hash>${token.hash}</hash>\n` +
    `\t<date>${token.date}</date>\n` +
    '</FileToken>\n' ;
}

export async function verifySignature(xmlString:string|null|undefined) : Promise<boolean> {
    const xmlDoc = _parseXML(<string>xmlString) ;
    if (!$ok(xmlDoc)) { return false ; }
    return await _verifyXMLSignature(<Document>xmlDoc) ;
}

export async function verifySeal(xmlString:string|null|undefined, token:APIFileToken) {
    const xmlDocOrNull = _parseXML(xmlString) ;
    if (!$ok(xmlDocOrNull)) { return false ; }
    const xmlDoc = xmlDocOrNull as Document ;
    if (!(await _verifyXMLSignature(xmlDoc))) { return false ; } ;
    if (!_verifySealTag(xmlDoc, 'name', token?.name)) { return false ; }
    if (!_verifySealTag(xmlDoc, 'hash', token?.hash)) { return false ; }
    if (!_verifySealTag(xmlDoc, 'user', token?.user)) { return false ; }
    if (!_verifySealTag(xmlDoc, 'date', token?.date)) { return false ; }
    if (!_verifySealTag(xmlDoc, 'size', `${token?.size}`)) { return false ; }
    return true ;
}

function _prepareDocumentForSigning(file:string|Buffer) : string {
    if (!$length(file)) { throw new Error('No specified file to sign') ;} ;
    let fileContent:string ;
    if ($isstring(file)) {
        if (!$isfile(<string>file)) { throw new Error('No specified path for file to sign') ; }
        const content = $readBuffer(<string>file) ;
        if (!$length(content)) { throw new Error('Impossible to read file') ;} ;
        fileContent = (<Buffer>content).toString('base64') ;
    }
    else {
        fileContent = (<Buffer>file).toString('base64') ;
    }
    if (!$length(fileContent)) { throw new Error('Impossible to convert file to Base 64') ;} ;
    return fileContent ;
}

function _signatureEntity<R extends SignatureEntity>(fileContent:string, r:SignatureRequest) : R {

    let entity:SignatureEntity = {
        digestAlgorithm:r.hashMethod,
        fileContent:fileContent,
        fileName:r.fileName,
        signatureLevel:<SignatureLevelTag>SignatureLevel[r.level],
    }
    if ($length(r.certificateId) || $length(r.certificatePwd)) {
        if (!$length(r.certificateId)) { throw new Error('No specified certificate content') ;} ;
        if (!$length(r.certificatePwd)) { throw new Error('No password for the certificate') ;} ;
        entity.keyStore = {
            password:<string>r.certificatePwd,
			certificateId:<string>r.certificateId,
            type:'PKCS12KeyStore'
        } ;
    }
    return entity as R ;
}

function _parseXML(data: string|null|undefined) : Document|null {
	if (!$length(data)) { return null ; }
	let doc ;
	try {
		doc = xmldsig.Parse(<string>data) ;
	}
	catch(e) {
		doc = null ;
	}
	return $ok(doc) ? doc : null ;
}

async function _verifyXMLSignature(xmlDoc:Document) : Promise<boolean> {
	const xmlSignature = xmlDoc.getElementsByTagNameNS("http://www.w3.org/2000/09/xmldsig#", "Signature");
	const signedXml = new xmldsig.SignedXml(xmlDoc);
	signedXml.LoadXml(xmlSignature[0]);
	return await signedXml.Verify();
}

function _verifySealTag(d:Document, tag:string, value:string|undefined|null) : boolean
{
	if (!$length(value)) { return false ; }
	const elts = d.getElementsByTagName(tag) ;
	if (!$ok(elts) || elts.length !== 1 || elts[0]?.childNodes[0]?.nodeValue !== value) {
		return false ;
	}
	return true ;
}

