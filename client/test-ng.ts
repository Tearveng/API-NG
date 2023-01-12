import { StringArrayDictionary } from "foundation-ts/types";
import { $count, $length, $ok } from "foundation-ts/commons";
import { $path, $uniquefile } from "foundation-ts/fs";
import { $inspect, $logterm } from "foundation-ts/utils";

import { DEFAULT_PATH } from "../utils/commons";

import { DevUploadCheck } from "../api/APIDeveloper";

import { NG } from "./api-ng";

import { AcceptedLanguages, SignatureFormat, SignatureLevel, SignatureType, UserRole } from "../api/APIConstants";
import { $url2gid, $url2lid } from "../api/APIIDs";
import { SignatureResource } from "../api/APIInterfaces";
import { inspect } from "util";

const COMMON_BASE = '/api/v1' ;
const LOCAL_URL = 'http://localhost:8080' ;
const REMOTE_URL = 'http://192.168.191.53' ;
const resourcesFolder = $path(DEFAULT_PATH,  'resources') ;
const outputFolder = $path(DEFAULT_PATH,  'output') ;

export class NGT extends NG {
	ca?:string ;

	public constructor(user:string, password:string, remote:boolean, debug:boolean=true, role:UserRole=UserRole.Action) {
		super(
            (remote ? REMOTE_URL : LOCAL_URL)+ COMMON_BASE,
            {
			    certignauser:user,
			    certignarole:role,
			    certignahash:password,
			    defaultlanguage:AcceptedLanguages.FR
		    },
            {
			    outputFolder:outputFolder,
			    resourcesFolder:resourcesFolder,
			    debug:debug
		    }
        ) ;

	}

	public async currentAuthority() : Promise<string> {
		if (!$ok(this.ca)) {
			const authorities = await this.certificationAuthoritiesList() ;
			const an = $count(authorities) ;
			this.check(an === 1, `verifying certification authorities number (found ${an})`) ;
			this.ca = authorities[0] ;
			this.check($length(this.ca) > 0, `verifyinf certification authorities url '${this.ca}'`) ;
		}
		return <string>(this.ca) ;
	}

	public async uploadFile(file:string) : Promise<string> {
		$logterm(`\n>>>> Uploading file ${file}...`)
		const buf = this.resourceBuffer(file) ;

		this.check($length(buf)>0, `${file} loading from disk`) ;

		let url = await this.upload(buf) ;
		console.log("UPLOAD URL: ",url);
		this.check($length(url) > 0, `Checking file '${file}' upload URL:'${url}'`) ;

		$logterm(`\n>>>> Remote checking Upload's seal for URL '${url}'...`)
		let resp = await this.checkUpload(<string>url) ;
		this.check($ok(resp) && (<DevUploadCheck>resp).verified, `Checking file '${file}' seal`) ;

		return <string>url ;
	}

	private async _sign(
		buf:Buffer,
		fileName:string,
		format:SignatureFormat,
		type:SignatureType,
		level:SignatureLevel=SignatureLevel.B,
		generateCertif:'generate'|'server'
	) : Promise<string>
	{
		const signedFile = await this.directSignDocument(buf, {
			'file-name':fileName,
			format:format,
			level:level,
			type:type,
			certificate:generateCertif
		}) ;
		console.log("BUff: after signed",signedFile);
		this.check($length(signedFile) > 0, `checking '${fileName}' signed return version`) ;
		const signedFileBuffer = signedFile as Buffer ;
		return this.saveUniqueFile(fileName, signedFileBuffer) ;
	}

	public async directPadesSign(
		file:string,
		level:SignatureLevel=SignatureLevel.B,
		generateCertif:'generate'|'server'
	) : Promise<string>
	{
		const buf = this.resourceBuffer(file) ;
		this.check($length(buf)>0, `'${file}' loading from disk`) ;
		return await this._sign(buf, file, SignatureFormat.PAdES, SignatureType.Envelopped, level, generateCertif) ;
	}

	public async directXadesSign(
		xmlString:string,
		type:SignatureType.Envelopped | SignatureType.Envelopping,
		fileName:string,
		level:SignatureLevel=SignatureLevel.B,
		generateCertif:'generate'|'server'='server'
	) : Promise<string>
	{
		const buf = Buffer.from(xmlString) ;

		this.check($length(buf)>0, `'${fileName}' transformation to buffer`) ;
		return await this._sign(buf, fileName, SignatureFormat.XAdES, type, level, generateCertif) ;
	}

	public saveUniqueFile(fileName:string, data:string|Buffer) : string {
		const uniqueFile = $uniquefile(fileName) ;
		const saved = this.save(uniqueFile, data) ;
		this.check(saved, `Checking saving file '${uniqueFile}'`) ;
		return uniqueFile ;
	}

	public async signAvailableDocumentsForActor(
		session:string,
		actor:string,
		signatureTag:string,
		attendedDocumentsCount?:number,
		proof?:object,
	) : Promise<SignatureResource[]> {

		await this.currentAuthority() ;

		$logterm(`Get documents available for signature for actor: '${actor}'`) ;
		const tobesignedRet = await this.taggedDocuments(session, {actor:$url2lid(actor)}) ;
		this.check($ok(tobesignedRet), `checking documents return for '${actor}' signature`) ;
		const tobesigned = (<StringArrayDictionary>tobesignedRet)[signatureTag] ;
		const n = $count(tobesigned) ;
		if ($ok(attendedDocumentsCount)) {
			this.check(n === attendedDocumentsCount, `checking documents '${actor}' signature count:${n} (should be ${attendedDocumentsCount})`) ;
		}
		else {
			this.check(n > 0, `checking documents for '${actor}' availibility`) ;
		}
		const cgu = await this.getCGU(<string>this.ca, session, actor) ;
		console.log("CGUX",cgu);
		this.check($ok(cgu) && $length(cgu?.token) === 36, `checking authority '${<string>this.ca}' CGUs for '${session}' and '${actor}'`) ;
		$logterm("Get CGU:", $inspect(cgu)) ;
		console.log("CGUX",cgu);
		const token = cgu?.token as string ;
		$logterm(`Generate certificate for actor '${actor}'`) ;
	// TOCHECK :::
		const certret = await this.createCertificate(session, {
			actor: actor,
			authority: <string>this.ca,
			token: token,
			ttl: 1200,
			proof: proof,
		}) ;

		$logterm("DATA for creating certificate :",certret);
		this.check($length(certret) > 0, `creation of new certificate for actor '${actor}'`) ;
		const certificate = certret as string ;
		$logterm(`New cerificate URL = '${certificate}'`)
		$logterm(`Will now sign ${n} documents by actor '${actor}'`) ;

		let signret = await this.signDocuments(session, {
			certificate:certificate,
			actor:actor,
			documents:tobesigned,
			tag:signatureTag
		}) ;
		this.check($ok(signret) && $count(signret?.signatures) === n, `checking documents '${signatureTag}' by actor '${actor}'`) ;
		const signatures = signret?.signatures as SignatureResource[] ;
		$logterm('-------------------------------------------------') ;
		$logterm(`Done signatures by: ${actor}:\n${$inspect(signatures)}`) ;
		$logterm('-------------------------------------------------') ;
		return signatures ;
	}

	public async getAndSaveDocument(d:string, fileName:string) : Promise<string> {
		console.log("GET DOCUMENTX:",d);
		const docret = await this.getDocument(d) ;
		this.check($ok(docret), `checking document '${d}' content`) ;
		$logterm('-------------------------------------------------') ;
		$logterm(`Document '${d}' content:\n${$inspect(docret)}`) ;
		$logterm('-------------------------------------------------') ;

		const downloadURL = await this.getCurrentDocument(d) ;
		this.check($length(downloadURL) > 0, `Checking download url for '${d}' = '${downloadURL}'`) ;

		const bufd = await this.download(<string>downloadURL) ;
		console.log("Download url : ",bufd,bufd.length, inspect(bufd));
		this.check($length(bufd) > 0, `Checking downloaded buffer at url '${downloadURL}'`) ;

		return this.saveUniqueFile(fileName, <Buffer>bufd) ;
	}

	public async recoverManifest(session:string) : Promise<string> {
		const manifest = await this.getSessionManifest(session) ;
		console.log("ManifestX",manifest);
		this.check($length(manifest) > 0, `checking session '${session}' manifest url '${manifest}'`) ;

		const manifestDownload = await this.download(<string>manifest) ;
		console.log("manifestDownlaod",manifestDownload)
		this.check($length(manifestDownload) > 0, `Checking downloaded buffer at url '${manifest}'`) ;

		return this.saveUniqueFile(`manifest-${$url2gid(session)}.pdf`, <Buffer>manifestDownload) ;
	}
}
