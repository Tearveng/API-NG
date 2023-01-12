import { Nullable, StringDictionary } from 'foundation-ts/types';
import { $count, $length, $ok } from 'foundation-ts/commons'
import { $readBuffer } from 'foundation-ts/fs'
import { $uuid, HashMethod } from 'foundation-ts/crypto'
import { TSFusionTemplate, TSHTMLTemplate } from 'foundation-ts/tsfusion';
import { $inspect, $logterm } from 'foundation-ts/utils';

import { $now } from '../utils/commons';
import { JSONObject } from 'ts-json-object'
import { APIAuth, ManifestData } from '../api/APIInterfaces';

import { CertignaRequestError, InternalError, NotFoundError } from '../utils/errors';
import Actor from '../model/Actor';
import SessionDocument from '../model/SessionDocument';
import { DocumentList, LocalID } from '../api/APIIDs';
import Session from '../model/Session';
import { AcceptedLanguages, SignatureFormat, SignatureLevel } from '../api/APIConstants';

import { Certigna } from './CertignaEndPoint';
import { APIServer } from '../server';
import { EditingContext, SessionContextEventType } from '../model/DBInterfaces';
import { GenericLogger, GenericLoggerInterface } from './GenericLogger';
import puppeteer, { PaperFormat, PDFMargin, PDFOptions } from 'puppeteer'
export class ManifestOptions extends JSONObject {
	@JSONObject.union(['letter' , 'legal', 'tabloid', 'ledger', 'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6'])
	@JSONObject.optional("a4")
	format!: PaperFormat

	@JSONObject.union(['portrait' , 'paysage', 'landscape'])
	@JSONObject.optional("portrait")
	orientation!:'portrait' | 'paysage' | 'landscape'
	
	@JSONObject.map('left-margin')
	@JSONObject.optional("10mm")
	leftMargin!: string | number

	@JSONObject.map('right-margin')
	@JSONObject.optional("10mm")
	rightMargin!: string | number

	@JSONObject.map('top-margin')
	@JSONObject.optional("15mm")
	topMargin!: string | number

	@JSONObject.map('bottom-margin')
	@JSONObject.optional("15mm")
	bottomMargin!: string | number

	@JSONObject.optional
	header?: string
	
	@JSONObject.optional
	footer?: string
}

type TemplateDictionary = { [key:string]: TSHTMLTemplate }

const ManifestTrans:{ [key:string]:StringDictionary } = {
	'no-token': { 
		'fr': "Pas d'OTP associé", 		
		'en': "No OTP"
	},
	'signedDocuments': { 'fr': "Documents signés: ", 		'en': "Signed Documents:"}
} ;
const EventTypeTitles:StringDictionary[] = [
	{ 'fr': "Événement inconnu", 		'en': "Unknown event"},
	{ 'fr': "Fermeture de la session", 	'en': "Closing session"},
	{ 'fr': "Création d'un scénario", 	'en': "Scenario creation"},
	{ 'fr': "Activation d'un scénario", 'en': "Scenario activation"},
	{ 'fr': "Split d'un scénario", 		'en': "Scenario split"},
	{ 'fr': "Génération d'un OTP", 		'en': "OTP generation"},
	{ 'fr': "Vérification d'un OTP", 	'en': "OTP check"},
	{ 'fr': "Approbation de documents", 'en': "Documents' approval"},
	{ 'fr': "Signature de documents", 	'en': "Documents' signature"},
	{ 'fr': "Annulation de scénario", 	'en': "Scenario cancelling"}
] ;


export interface ManifestEvent {
	user:string ;
	event:string ;
	date:string ;
	scenarioId:string ;
	reason:string ;
	actorName:string ;
	actorIdentifier:string ;
	hasActor:boolean ;
	documents:ManifestDocumentData[] ;
	operationId:string ;
	manifestData?:ManifestData ;
	token:string ;
	actor?:Actor ;
}

export interface ManifestDocumentData {
	fileName:string,
	document:SessionDocument,
	identifier:string
}
export interface ManifestSourceData {
	date:string,						// manifest creation date
	fileName:string, 					// manifest file name
	reference:string,					// manifest reference
	documents:SessionDocument[],		// all approved and signed documents' infos
	actors:Actor[],						// all approbators and signers
	events:ManifestEvent[]				// all the events
}

export interface ManifestGenerationOptions {
	templateName?:string,
	options?:ManifestOptions
}

export interface ManifestTarget {
	session:Session,
	templateName:string,
	language:AcceptedLanguages,
	dataSource:ManifestSourceData,
	pdfPath:string
	options?:ManifestOptions
}

export class Manifest extends GenericLogger {
	templates:TemplateDictionary = {} ;

	private static instance: Manifest; // the private singleton var

	private async _generateSourceData(auth:APIAuth, session:Session, c:EditingContext) : Promise<ManifestSourceData> {
		let actorSet = new Set<LocalID>() ;
		let actors:Actor[] = [] ;
		let actorsByIds:{ [key:string]:Actor} = {};
		let documentSet = new Set<LocalID>() ;
		let documents:SessionDocument[] = [] ;
		let documentsByIds:{ [key:string]:SessionDocument} = {};
		const sessionEvents = session.otherData.sessionContextEvents ;
		const lang = auth.language ;

		// constructing documents and actors for our source
		for (let e of sessionEvents) {
			if (e['event-type'] === SessionContextEventType.ApproveDocuments || e['event-type'] === SessionContextEventType.SignDocuments) {
				const aid = e['actor-id'] ;
				if ($ok(aid) && aid && !actorSet.has(aid)) {
					let actor = await Actor.sessionObjectWithPublicID<Actor>(session, aid, {trx:c.trx}) ;
					if (!$ok(actor)) {
						throw new NotFoundError(`Actor with ID (${session.publicId}, ${aid}) not found`) ;
					}
					actors.push(<Actor>actor) ;
					actorsByIds[aid] = <Actor>actor ;
					actorSet.add(aid) ; // may be faster than the simple object ??
				}
				if ($count(e['document-ids'])) {
					for (let did of <DocumentList>(e['document-ids'])) {
						if (!documentSet.has(did)) {
							let doc = await SessionDocument.sessionObjectWithPublicID<SessionDocument>(session, did, c) ;
							if (!$ok(doc)) {
								throw new NotFoundError(`Document with ID (${session.publicId}, ${did}) not found`) ;
							}
							documents.push(<SessionDocument>doc) ;
							documentsByIds[did] = <SessionDocument>doc ;
							documentSet.add(did) ; // may be faster than the simple object ??
						}
					}
				}
			}
		}

		// we now construct the event list
		const sessionPublicID = session.publicId ;
		const noToken = ManifestTrans['no-token'][lang] ;

		let events:ManifestEvent[] = sessionEvents.map(e => {
			const actor = e['actor-id'] ? actorsByIds[e['actor-id']] : null ;
			let event:ManifestEvent = {
				user:e.user,
				date:e.date,
				event:EventTypeTitles[e['event-type']][lang],
				scenarioId:e['scenario-id'] ? `${e['scenario-id']}`: '',
				reason:$ok(e.reason) ? <string>e.reason : '',
				hasActor:false,
				actorName:'',
				actorIdentifier:'',
				documents:[],
				operationId:$ok(e['operation-id']) ? <string>e['operation-id'] : '',
				manifestData:$ok(e['manifest-data']) ? ['manifest-data'] : {},
				token:$ok(e.token) ? <string>e.token : noToken
			}
			if ($ok(actor)) {
				const a = <Actor>actor ;
				event.hasActor = true ;
				event.actorName = a.completeName() ;
				event.actorIdentifier = `${sessionPublicID}-${a.publicId}` ;
				event.actor = a ;
			}
			if ($count(e['document-ids'])) {
				event.documents = (<DocumentList>e['document-ids']).map(did => { 
					const doc = documentsByIds[did] ; 
					return <ManifestDocumentData>{
						fileName:doc.fileName,
						document:doc,
						identifier:`${sessionPublicID}-${did}`
					}
				}) ;
			}
			return event ;
		})
		return {
			date:$now(),				// manifest creation date
			fileName:`${$uuid()}.pdf`, 		// manifest file name
			reference:$uuid(),					// manifest reference
			documents:documents,				// all approved and signed documents' infos
			actors:actors,						// all approbators and signers
			events:events						// all the events
		
		}
	}



	public async generateManifest(
		auth:APIAuth, 
		session:Session,
		c:EditingContext, 
		templateName:string = 'standard', 
		opts?:ManifestOptions
	) : Promise<Buffer> {
		const template = this.getTemplate(templateName) ;
		if (!$ok(template)) {
			throw new InternalError(`No template found with name '${templateName}'`) ;
		}
		this.log(`Using template '${templateName}' to generate manifest:\n${$inspect(template)}`) ;

		const dataSource = await this._generateSourceData(auth, session, c) ;
        const glob = {} ;
        const errors:string[] = [] ;
        const html = template!.fusionWithDataContext(dataSource, glob, errors) ;
		if (!$length(html)) {
			throw new InternalError(`Impossible to generate HTML file from template '${templateName}'`) ;
		}

		this.log(`${$length(html)} bytes HTML generated from template '${templateName}'`) ;
		this.log(`typeof puppeterr.launch = ${puppeteer.launch}`) ;

		const browser = await puppeteer.launch() ;
		const page = await browser.newPage() ;
		await page.setContent(html.toString('utf-8')) ;

		const api = APIServer.api() ;
		let margin:PDFMargin = {} ;
		if ($ok(opts?.leftMargin)) { margin.left = opts?.leftMargin ; }
		if ($ok(opts?.rightMargin)) { margin.left = opts?.rightMargin ; }
		if ($ok(opts?.topMargin)) { margin.left = opts?.topMargin ; }
		if ($ok(opts?.bottomMargin)) { margin.left = opts?.bottomMargin ; }

		let pdfOptions:PDFOptions = {
			format:$ok(opts?.format)?<PaperFormat>(opts?.format.toLowerCase()):'a4',
			printBackground:true,
			landscape:opts?.orientation === 'paysage' || opts?.orientation === 'landscape' ? true : false,
			margin:margin
		}
		if ($length(opts?.header)) {
			pdfOptions.headerTemplate = opts?.header ;
			pdfOptions.displayHeaderFooter = true ;
		}
		if ($length(opts?.footer)) {
			pdfOptions.footerTemplate = opts?.footer ;
			pdfOptions.displayHeaderFooter = true ;
		}

		const pdf = await page.pdf(pdfOptions) ;

		if (!$length(pdf)) {
			throw new InternalError(`Impossible to produce PDF file from HTML generated from template '${templateName}'`) ;
		}
		// now we want to PAdES sign this PDF File
		const endPoint = Certigna.endPoint() ;
		const credentials = api.conf.signServerLogin ;

		// we make a PAdES signature with a server hosted certificate whose credential
		// are stored in our configuration file
		let signedPDF = await endPoint.signDocument(<Buffer>pdf, {
			format:SignatureFormat.PAdES,
			login:credentials.login,
			password:credentials.password,
			fileName:`${$uuid()}.pdf`,
			hashMethod:HashMethod.SHA256,
			level:SignatureLevel.LTA
		})
		await browser.close();

		if (!$length(signedPDF)) {
			throw new CertignaRequestError(`Impossible to generated PDF file from template '${templateName}'`) ;
		}


		return <Buffer>signedPDF ;
	}

	public addTemplateFile(path:Nullable<string>, name:string = 'standard'):TSHTMLTemplate | null {
		if (!$length(path) || !$length(name)) { return null ; }
        const templateData = $readBuffer(path) ;
        if (!$length(templateData)) { return null } ;
        try {
            const template = TSFusionTemplate.fromHTMLData(templateData) ;
			this.templates[name] = template ;
            return template ;
        }
        catch (e) {
			$logterm(`&oDid encouter error &r${e?.name} &oduring template interpretation: "&w${e?.message}&o"&0`) ;
            return null ;
        }
	}
	
	public getTemplate(name:string = 'standard') : TSHTMLTemplate | null {
		const t =  this.templates[name] ;
		return $ok(t) ? t : null ;
	}

	public static producer(logger?:GenericLoggerInterface): Manifest {
		if (!this.instance) {
			this.instance = new Manifest(logger) ;
		}
		return this.instance ;

	}
}
