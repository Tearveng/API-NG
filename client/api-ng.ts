import { Nullable, StringArrayDictionary, StringDictionary, StringEncoding, TSDataLike } from "foundation-ts/types";
import { $count, $defined, $isarray, $isnumber, $isstring, $isunsigned, $isurl, $length, $ok, $strings, $unsigned } from "foundation-ts/commons";
import { TSError } from "foundation-ts/tserrors";
import { TSCharset } from "foundation-ts/tscharset";
import {
    $ext, 
	$isdirectory, 
	$isfile, 
	$path, 
	$readBuffer, 
	$readString, 
	$writeBuffer, 
	$writeString, 
} from "foundation-ts/fs"
import { $logterm } from "foundation-ts/utils";
import { Verb, RespType, Resp, TSRequest, $query, RequestHeaders } from "foundation-ts/tsrequest";
 

import { $exit } from "../utils/commons";

import { $url2gid, $url2lid, LocalID } from "../api/APIIDs";
import { 
	ManifestDataBody,
	CreateSessionBody, 
	CreateDocumentBody, 
	CreateActorBody, 
	ScenarioBody,
	CreateCertificateBody,
	SessionsQuery,
	APIGetListQuery,
	CertificatesQuery,
	SessionOTPBody,
	SessionCheckOTPBody,
	SessionApproveDocumentsBody,
	SessionSignDocumentsBody,
	SessionClosureBody,
	SessionExtendBody,
	ScenarioCancelBody, 
	ScenarioSplitBody,
	ClosingSessionResource,
	APIHeaders,
	SessionResource,
	ActorResource,
	DocumentResource,
	ScenarioResource,
	AuthorityResource,
	DeletedURLResource,
	SigningResource,
	OTPResource,
	CGUResource,
    SessionSignDocumentNode
} from "../api/APIInterfaces";
import { DirectSignatureOptions, DevUploadCheck } from "../api/APIDeveloper";
import { AcceptedLanguages, SignatureFormat, SignatureLevel, SignatureType } from "../api/APIConstants";

export interface NGOptions {
	resourcesFolder?:string ;
	outputFolder?:string ;
	timeOut?:number ;
	downloadTimeOut?:number ;
    uploadTimeOut?:number ;
	certificateTimeOut?:number ;
	signatureTimeOut?:number ;
	debug?:boolean ;
}


export interface ActorDocumentsQuery {
	'status_mask'?: string|number ;
	actor:string|LocalID ; 
	tags?:string[] | string ;
}

export interface TagDocumentsQuery {
	'status_mask'?: string|number ;
	actor?:string|LocalID ; 
	tags:string[] | string ;
}


export class NG extends TSRequest {
    static DEFAULT_TIMEOUT = 8000 ;
    static DEFAULT_CERTIFICATE_TIMEOUT = 15000 ;
    static DEFAULT_SIGNATURE_TIMEOUT = 60000 ;
    static DEFAULT_DOWNLOAD_TIMEOUT = 20000 ;
    static DEFAULT_UPLOAD_TIMEOUT = 40000 ;

	public debug:boolean = false ;

    public readonly timeOut:number ;
    public readonly authentication:APIHeaders ;

	public readonly certificateTimeOut:number ;
	public readonly signatureTimeOut:number ;
	public readonly downloadTimeOut:number ;
	public readonly uploadTimeOut:number ;

	private readonly resourcesPath:string ;
	private readonly outputPath:string ;

	private _acceptedExtensions:{ [key:string]: StringDictionary} = {} ;

    public constructor(baseURL:string, authentication:APIHeaders, opts:NGOptions = {}) {
        super(
            baseURL, 
            {
                timeout:($unsigned(opts.timeOut) > 0 ? $unsigned(opts.timeOut) : NG.DEFAULT_TIMEOUT),

            }
        ) ;

        if (!$isdirectory(opts.resourcesFolder) || !$isdirectory(opts.outputFolder)) {
            throw new TSError('Inexistent resources folder or output folder', { 
                baseURL:baseURL,
                authentication:authentication,
                options:opts
            }) ;
        }

        this.authentication = authentication ;
		this.resourcesPath = opts.resourcesFolder as string ;
		this.outputPath = opts.outputFolder as string ;
        this.debug = !!opts.debug ;
        
        let t = $unsigned(opts.certificateTimeOut) ;
		this.certificateTimeOut = t > 0 ? t : NG.DEFAULT_CERTIFICATE_TIMEOUT ;

		t = $unsigned(opts.signatureTimeOut) ;
		this.signatureTimeOut = t > 0 ? t : NG.DEFAULT_SIGNATURE_TIMEOUT ;

		t = $unsigned(opts.downloadTimeOut) ;
		this.downloadTimeOut = t > 0 ? t : NG.DEFAULT_DOWNLOAD_TIMEOUT ;

        t = $unsigned(opts.uploadTimeOut) ;
		this.uploadTimeOut = t > 0 ? t : NG.DEFAULT_UPLOAD_TIMEOUT ;

		if (!$ok(this.authentication.defaultlanguage)) { 
            this.authentication.defaultlanguage = AcceptedLanguages.FR ;
        }

    }


	public resourcePath(name:string) : string {
		if (!$length(name)) { throw new TSError('Cannot find Resource with unspecified file name', { fileName:name }) ; } ;
		const file = $path(this.resourcesPath, name) ;
		if (!$isfile(file)) { throw new TSError(`File '${file}' is not found`, { file:name }) ; }
		return file ;
	}

	public resourceBuffer(name:string) : Buffer { 
		const file = this.resourcePath(name) ;
		const buf = $readBuffer(file) ;
		if (!$ok(buf)) { throw new TSError(`Cannot load data file '${file}'.`, { file:file }) ; }
		return <Buffer>buf ;
	}

	public resourceString(name:string) : string { 
		const file = this.resourcePath(name) ;
		const str = $readString(file) ;
		if (!$ok(str)) { throw new TSError(`Cannot load text file '${file}'.`, { file:file }) ; }
		return <string>str ;
	}

	public save(fileName:string, data:string|Buffer, encoding?:Nullable<StringEncoding|TSCharset>) : boolean {
		if (!$length(fileName)) { return false ; }
		$logterm('outputpath='+this.outputPath) ;
		if ($isstring(data)) {
			return $writeString($path(this.outputPath, fileName), data as string, { encoding:encoding }) ;
		}
		return $writeBuffer($path(this.outputPath, fileName), data as Buffer) ;
	}	

	public async ngrequest<T=any>(
		relativeURL:string, 
		method?:Verb, 
		responseType?:RespType,
        statuses?:number[],
		body?:Nullable<object|TSDataLike>, 
		suplHeaders?:RequestHeaders,
		timeout?:number
	) : Promise<T|null> {
        suplHeaders = $ok(suplHeaders) ? {...this.authentication, ...suplHeaders} : { ... this.authentication } ;
        statuses = $count(statuses) ? statuses! : [Resp.OK] ;
        const resp = await this.req(relativeURL, method, responseType, body, suplHeaders, timeout) ;
        return statuses.includes(resp.status) && $ok(resp.response) ? resp.response as T : null ;
    }


    public check(check:boolean, test:string) {
		if (!check) {
			$exit(`&R&w NG() did fail check ${test}`, -666, 'api-ng client &0')
		}
		else {
			$logterm(`&G&w NG() did pass check ${test} &0`)
		}
	}
	public error(message:string) : null {
		if (this.debug) { $logterm(`&oNG() error : &w${message}&0`) ; }
		return null ;
	}

	public log(message:string) {
		if (this.debug) { $logterm(`&wNG() infos : ${message}&0`) ; }
	}

	public async acceptedExtensions(type:'all'|'signing'='all') : Promise<StringDictionary|null> {
		if (!$ok(this._acceptedExtensions[type])) {
            let acl:Nullable<StringDictionary> = undefined
            const ac = await this.ngrequest($query('/uploads/accepted-extensions', { type:type })) ;
            if ($ok(ac) && $ok(acl = (ac as any)['accepted-extensions'])) { 
				this._acceptedExtensions[type] = acl as StringDictionary  ;
            }
			else { return this.error(`Impossible to get ${type} accepted exensions from API Server`) ;}
		}
		return this._acceptedExtensions[type] ;
	}

	// ============= upload and download document =================================
	private async _upload(buf:Buffer, extensionsType:'all'|'signing',extension:string='pdf') : Promise<string|null> {
		const extensions = await this.acceptedExtensions(extensionsType) ;
		if (!$ok(extensions)) { return null ; }
		
		if (!$length(buf)) { return this.error(`Trying to upload empty data`) ; }

        const mimeType = (<StringDictionary>extensions)[extension.toLowerCase()] ;
		if (!$length(mimeType)) { return this.error(`Passed data is from the wrong type (${extension})`) ; }
		
        this.log(`Will upload ${buf.length} octets as ${mimeType}...`) ;

        return _ngurl(await this.ngrequest('/uploads', Verb.Post, RespType.Json, [Resp.Created], buf, { 'Content-Type': mimeType }, this.uploadTimeOut )) ;
	}

	public async upload(buf:Buffer, extension?:string) : Promise<string|null> {
		return await this._upload(buf, 'signing', extension) ;
	}

	public async accessoryUpload(buf:Buffer, extension?:string) : Promise<string|null> {
		return await this._upload(buf, 'all', extension) ;
	}

	public async download(downloadURL:string) : Promise<Buffer|null|undefined> {
        return await this.ngrequest<Buffer>(returnId(downloadURL), Verb.Get, RespType.Buffer, undefined, undefined, undefined, this.downloadTimeOut) ;
	}

    private async _purge(type:string): Promise<number> {
		const r = await this.ngrequest(`${type}/purge`, Verb.Post) ;
		return $ok(r) ? $unsigned(r['deleted-count']) : 0 ;

    }
	public async purgeDownloads() : Promise<number> { return await this._purge('/downloads') ; }
	public async purgeUploads() : Promise<number> { return await this._purge('/uploads') ; }

	// ============= creation requests =================================
	public async createSession(body:CreateSessionBody) : Promise<string|null> {
		if (!$isunsigned(body.ttl) || body.ttl === 0) { return null ; }
        return _ngurl(await this.ngrequest('/sessions', Verb.Post, RespType.Json, [Resp.Created], body )) ;
	}






	
	public async addDocument(sessionURL:string, body:CreateDocumentBody) : Promise<string|null> {
		if (!isValidCreateDocumentBody(body)) { return null ; }
				console.log("SESSION URL : ",sessionURL);
        return _ngurl(await this.ngrequest(`/${returnId(sessionURL)}/documents`, Verb.Post, RespType.Json, [Resp.Created], body )) ;
	}




	public async addActor(sessionURL:string, body:CreateActorBody) : Promise<string|null> {
        body = { ...body, roles:$strings(body.roles) } ;
				console.log("BODY",body,sessionURL);
		if ( !isValidCreateActorBody(body)) { return null ; }
        return _ngurl(await this.ngrequest(`/${returnId(sessionURL)}/actors`, Verb.Post, RespType.Json, [Resp.Created], body )) ;
	}

	public async addScenario(sessionURL:string, body:ScenarioBody) : Promise<string|null> {

		if ( !isValidScenarioBody(body)) { return null ; }
		
        return _ngurl(await this.ngrequest(`/${returnId(sessionURL)}/scenarios`, Verb.Post, RespType.Json, [Resp.Created], body )) ;
	}

	public async createCertificate(sessionURL:string, body:CreateCertificateBody) : Promise<string|null> {
		if ( !isValidCreateCertificateBody(body)) { return null ; }
		
        return _ngurl(await this.ngrequest(`/${returnId(sessionURL)}/certificates`, Verb.Post, RespType.Json, [Resp.Created], body )) ;
	}

	// ============= listing requests =================================
	public async sessionsList(query:SessionsQuery={}) : Promise<string[]> {
        const r = await this.ngrequest($query('/sessions', query)) ;
        return $isarray(r?.sessions) ? r!.sessions as string[] : [] ;
	}

	public async documentsList(sessionURL:string, mask:number = 0) : Promise<string[]> {
		if ( !$isunsigned(mask)) { return null ; }
        const r = await this.ngrequest($query(`/${returnId(sessionURL)}/documents`, mask === 0 ? {} : { 'status_mask':mask })) ;
        return $isarray(r?.documents) ? r!.documents as string[] : [] ;
	}

	public async taggedDocuments(sessionURL:string, query:ActorDocumentsQuery|TagDocumentsQuery) : Promise<StringArrayDictionary|null> {
		if ( (!isValidID(query.actor) && !$count(query.tags))) { return null ; } // WARNING: previous behavior was buggy. it did return an array of documents if no tags and no actor
        return await this.ngrequest<StringArrayDictionary>($query(`/${returnId(sessionURL)}/documents`, query)) ;
	}

	public async actorsList(sessionURL:string) : Promise<string[]> {
		const r = await this.ngrequest(`/${returnId(sessionURL)}/actors`);
        return $isarray(r?.actors) ? r!.actors as string[] : [] ;
	}

	public async taggedActors(sessionURL:string, tags:string|string[]) : Promise<StringArrayDictionary|null> {
        tags = $strings(tags) ; 
        if ( !$count(tags)) { return null ; } // WARNING: precedent behaviour was buggy, it did return an array of actors when tags was not set or empty
		
        return await this.ngrequest<StringArrayDictionary>($query(`/${returnId(sessionURL)}/actors`, {tags:tags})) ;
	}

	public async scenarioList(sessionURL:string) : Promise<string[]> {
		const r = $isurl(sessionURL) ? await this.ngrequest(`${sessionURL}/scenarios`) : null ; 
        return $isarray(r?.scenarios) ? r!.scenarios as string[] : [] ;
	}

	public async certificatesList(sessionURL:string, query:CertificatesQuery={}) : Promise<string[]> {
		const r = $isurl(sessionURL) ? await this.ngrequest($query(`${sessionURL}/certificates`, query)) : null ; 
        return $isarray(r?.certificates) ? r!.certificates as string[] : [] ;
	}

	public async certificationAuthoritiesList() : Promise<string[]> {
		const r = await this.ngrequest('/cas') ; 
        return $ok(r) && $isarray(r['certification-authorities']) ? r['certification-authorities'] as string[] : [] ;
	}

	public async uploadsList(query:APIGetListQuery={}) : Promise<string[]> {
		const r = await this.ngrequest($query('/uploads', query)) ; 
        return $isarray(r?.uploads) ? r!.uploads as string[] : [] ;
	}

	// ============= get/delete resource requests =================================
	
	private async _getResource<T>(resourceURL:string) : Promise<T|null> {
		// return $isurl(resourceURL) ? await this.ngrequest<T>(resourceURL) : null ;
		try {
			return await this.ngrequest<T>(returnId(resourceURL));
		} catch (error) {
			return null;
		}
	}
	
	public async getSession 	(url:string) : Promise<SessionResource|null>  { return await this._getResource<SessionResource>(url) ; }
	public async getActor   	(url:string) : Promise<ActorResource|null>    { return await this._getResource<ActorResource>(url) ; }
	public async getDocument	(url:string) : Promise<DocumentResource|null> { return await this._getResource<DocumentResource>(url) ; }
	public async getScenario	(url:string) : Promise<ScenarioResource|null> { return await this._getResource<ScenarioResource>(url) ; }
	public async getCertificate (url:string) : Promise<ScenarioResource|null> { return await this._getResource<ScenarioResource>(url) ; }
	public async getAuthority   (url:string) : Promise<AuthorityResource|null>{ return await this._getResource<AuthorityResource>(url) ; }
	
	public async deleteResource(resourceURL:string) : Promise<boolean> {
        if (!$isurl(resourceURL)) { return false ; }
        const r = await this.ngrequest<DeletedURLResource>(resourceURL, Verb.Delete) ;
		return $length(r?.deleted) > 0 ; 
	}

	// ============= session specific management =================================
	public async closeSession(sessionURL:string, body:SessionClosureBody) : Promise<ClosingSessionResource|null> {
	
        if ( !$length(body.reason) || !$ok(body.force)) { return null ; }
				console.log("Close session: ",body);
        return await this.ngrequest<ClosingSessionResource>(`/${returnId(sessionURL)}/close`, Verb.Put, RespType.Json, [Resp.OK, Resp.Created], body, undefined, this.signatureTimeOut) ;
	}

	public async extendSession(sessionURL:string, body:SessionExtendBody) : Promise<boolean> {
        if ( !$isunsigned(body.ttl) || body.ttl === 0) { return false ; }
		return _ngbool(await this.ngrequest(`/${returnId(sessionURL)}/extend`, Verb.Put, RespType.Json, undefined, body), "url") ;
	}

	public async getSessionManifest(sessionURL:string) : Promise<string|null> {
        // if (!$isurl(sessionURL)) { return null ; }
				console.log("URL:::",await this.ngrequest(`/${returnId(sessionURL)}/manifest`, Verb.Get,RespType.Json, undefined, undefined, undefined, this.signatureTimeOut))
		return _ngurl(await this.ngrequest(`/${returnId(sessionURL)}/manifest`, Verb.Get,RespType.Json, undefined, undefined, undefined, this.signatureTimeOut)) ;
	}

	// ============= documents specific management =================================
	public async getGenuineDocument(documentURL:string) : Promise<string|null> {
        // if (!$isurl(documentURL)) { return null ; }
		return _ngurl(await this.ngrequest(`${documentURL}/genuine`, Verb.Get, RespType.Json, [Resp.Created])) ;
	}

	public async getCurrentDocument(documentURL:string) : Promise<string|null> {
        // if (!$isurl(documentURL)) { return null ; }
		return _ngurl(await this.ngrequest(`${returnId(documentURL)}/current`, Verb.Get, RespType.Json, [Resp.Created])) ;
	}

	// ============= scenario specific management =================================
	public async patchScenario(scenarioURL:string, body:ScenarioBody) : Promise<boolean> {
        // if (!$length(scenarioURL) || !isValidScenarioBody(body)) { return false ; }
		return _ngbool(await this.ngrequest(scenarioURL, Verb.Patch, RespType.Json, undefined, body), "url") ;
	}

	public async activateScenario(scenarioURL:string, body:ManifestDataBody) : Promise<boolean> {
        // if (!$isurl(scenarioURL)) { return false ; }
		return _ngbool(await this.ngrequest(`/${returnId(scenarioURL)}/activate`, Verb.Put, RespType.Json, undefined, body), "url") ;
	}

	public async cancelScenario(scenarioURL:string, body:ScenarioCancelBody) : Promise<boolean> {
        // if (!$isurl(scenarioURL) || !$length(body.reason)) { return false ; }
		return _ngbool(await this.ngrequest(`${scenarioURL}/cancel`, Verb.Put, RespType.Json, undefined, body), "url") ;
	}

	public async splitScenario(scenarioURL:string, body:ScenarioSplitBody) : Promise<string|null> {
        // if (!$isurl(scenarioURL) || !$length(body.reason)) { return null ; }
		return _ngurl(await this.ngrequest(`${scenarioURL}/split`, Verb.Put, RespType.Json, [Resp.Created], body)) ;
	}


	// ============= certificate / otp / token / signature methods =================================
	public async getCGU(caURL:string, sessionURL:string, actorURL:string) : Promise<CGUResource|null> {
        // if ( !$length(sessionURL) || !$length(actorURL)) { return null ; }
        return await this.ngrequest<CGUResource>($query(`/${returnId(caURL)}/cgu`, { session:$url2gid(sessionURL), actor:$url2lid(actorURL)})) ;
	}

	public async generateOTP(sessionURL:string, body:SessionOTPBody) : Promise<OTPResource|null> {
        if ( !isValidOTPBody(body)) { return null ; }
        // WARNING: why havent we a Resp.Created here ?
        return await this.ngrequest<OTPResource>(`/${returnId(sessionURL)}/generate-otp`, Verb.Put, RespType.Json, undefined, body) ;
	}

	public async checkOTP(sessionURL:string, body:SessionCheckOTPBody) : Promise<boolean> {
        if ( $length(body.otp) === 0) { return false ; }
		return _ngbool(await this.ngrequest(`/${returnId(sessionURL)}/check-otp`, Verb.Put, RespType.Json, undefined, body), "otp") ;
	}

	public async approveDocuments(sessionURL:string, body:SessionApproveDocumentsBody) : Promise<SigningResource|null> {
        if ( !isValidApproveDocumentsBody(body)) { return null ; }
        return await this.ngrequest<SigningResource>(`/${returnId(sessionURL)}/approve-documents`, Verb.Put, RespType.Json, undefined, body) ;
	}

	public async signDocuments(sessionURL:string, body:SessionSignDocumentsBody) : Promise<SigningResource|null> {
        if ( !isValidSignDocumentsBody(body)) { return null ; }
        return await this.ngrequest<SigningResource>(`/${returnId(sessionURL)}/sign-documents`, Verb.Put, RespType.Json, undefined, body, undefined, this.signatureTimeOut) ;
	}

	// ============= developer requests =================================
	public async ping() : Promise<any> { return await this.ngrequest('/dev/ping') ; }

	public async checkUpload(uploadURL:string) : Promise<DevUploadCheck|null> {
        if (!$length(uploadURL)) { return null ; }
        return await this.ngrequest<DevUploadCheck>(`/dev/upload-verif/${$url2gid(uploadURL)}`) ;
	}

	public async checkCertificateGenerationStatus() : Promise<boolean> {
		const r = await this.ngrequest('/dev/check-certificate-generation-status') ;
		return !!(r?.status)  ;
	}

	public async directSignDocument(buf:Buffer, options:DirectSignatureOptions) : Promise<Buffer|null> {
		if (!$length(buf)) { return this.error(`Trying to upload empty data`) ; }
        if (!isValidDirectSignatureOptions(options)) { return this.error('Invalid direct sign options') ; }

        const extensions = await this.acceptedExtensions('signing') ;
		if (!$ok(extensions)) { return null ; }
		const extension = $ext(options["file-name"]) ;
		const mimeType = (<StringDictionary>extensions)[extension.toLowerCase()] ;
		if (!$length(mimeType)) { 
			return this.error(`Passed data is from the wrong type (${extension})`) ;
		}
		this.log(`Will upload ${buf.length} octets as ${mimeType} for signature...`)
        return await this.ngrequest<Buffer>($query('/dev/sign-document', options), 
                                            Verb.Post, 
                                            RespType.Buffer, 
                                            undefined, 
                                            buf, 
                                            { 'Content-Type': mimeType }, 
                                            this.signatureTimeOut) ;
	}

}

function _ngret(ret:any, field:string) : string|null { return $ok(ret) && $length(ret[field]) ? <string>ret[field] : null ; }
function _ngbool(ret:any, field:string) : boolean { const v = _ngret(ret, field) ; return $ok(v) ; }
function _ngurl(ret:any) : string|null { return _ngret(ret, 'url') ; }

function isValidID(id:Nullable<number|string>):boolean {
    return $isnumber(id) ? $isunsigned(id) && id > 0 : $isstring(id) && $length(id as string) > 0 ;
}

function isValidCreateDocumentBody(body:CreateDocumentBody):boolean {
    return $length(body['file-name']) > 0 && $length(body.title) > 0 && $length(body.upload) > 0 ;
}

function isValidCreateActorBody(body:CreateActorBody):boolean {
    if (!$length(body.name) || !$length(body.email) || !$count(body.roles)) { return false ; }
    for (let r of body.roles) { if (!r.length) return false ; }
    return true ;
}

function isValidCreateCertificateBody(body:CreateCertificateBody):boolean {
    return $length(body.actor) > 0 && $length(body.authority) > 0 && $length(body.token) > 0 ;
}

function isValidScenarioBody(body:ScenarioBody):boolean {
    if (!$count(body.documents) || !$count(body.steps)) { return false ; } ;
    for (let d of body.documents) { if (!d.length) return false ; }
    for (let s of body.steps) {
        if (!$length(s.process) ||
            !$count(s.steps) || 
            ($defined(s.signatureType) && !Object.values(SignatureType).includes(s.signatureType)) ||
            ($isnumber(s.cardinality) && !$isunsigned(s.cardinality)) ||
            ($isstring(s.cardinality) && !['all', 'one'].includes(s.cardinality as string))) { 
                return false ; 
        }
        for (let step of s.steps) { if (!step.length) return false ; }
    }
    return true ;
}

function isValidOTPBody(body:SessionOTPBody):boolean {
    if (!$ok(body.numeric) || !$length(body.actor) || !body.length || !$count(body.documents)) { return false ; }
    for (let d of body.documents) { if (!d.length) return false ; }
    return true ;
}

function isValidApproveDocumentsBody(body:SessionApproveDocumentsBody):boolean {
    if (!$length(body.actor) || !$length(body.otp) || !$count(body.documents)) { return false ; }
    for (let d of body.documents) { if (!d.length) return false ; }
    return true ;
}

function isValidSignDocumentsBody(body:SessionSignDocumentsBody):boolean {
    
    if ($length(body.actor) > 0 && 
           $count(body.documents as Array<string|SessionSignDocumentNode>) > 0 && 
           $length(body.certificate) > 0 && 
           $length(body.tag) > 0 && 
           (!$defined(body.otp) || $length(body.otp) > 0)) {
        for (let d of body.documents) {
            const s = $isstring(d) ? d as string : (d as SessionSignDocumentNode)['document-url'] ;
            if (!$length(s)) { return false ; }
        }
        return true ;
    }
    return false ;
}

function isValidDirectSignatureOptions(opts:DirectSignatureOptions) {
    return $length(opts['file-name']) > 0 && 
           Object.values(SignatureFormat).includes(opts.format) && 
           Object.values(SignatureLevel).includes(opts.level) && 
           Object.values(SignatureType).includes(opts.type) && 
           (!$defined(opts.certificate) || ['generate','server','test-parameters'.includes(opts.certificate)]);

}
function returnId( path:string):string{
	let paths= path.split("/");
	paths.splice(0,3);
	let url = paths.join('/');

	return url;
}

