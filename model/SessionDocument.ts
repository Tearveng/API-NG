import { $count, $length, $ok } from 'foundation-ts/commons'

import { Model } from 'objection'
import { APIModel } from './APIModels'
import { DocumentStatus, SessionStatus } from '../api/APIConstants'
import { apiTables } from './DBConstants'
import { dbcol, dbid } from './DBFunctions'
import Session from './Session'
import FileRef from './FileRef'
import { DocumentResource, ManifestData, UserData } from '../api/APIInterfaces'
import Token from './Token'
import Scenario from './Scenario'
import { LocalID } from '../api/APIIDs'
import { DocumentInterface, DocumentOtherData, EditingContext, LastFile, RelativeIdentifier } from './DBInterfaces'


export default class SessionDocument extends APIModel implements DocumentInterface {
	static tableName = apiTables.documents ;

	// identifiers
	declare sessionId: number ;
	declare publicId: number ;

	// common vars
	declare abstract: string | undefined ;
	declare genuineFileId: number ;
	declare fileName: string ;
	declare title: string  ;

	// relationships
	declare session: Session ;
	declare genuineFile: FileRef ;
	declare files: FileRef[] | undefined ;

	// JSON columns
	declare otherData?: DocumentOtherData | undefined ;
	
	// standard JSON columns
	declare manifestData: ManifestData ;
	declare userData: UserData ;

	// instance methods
	protected internalUrl(relativeIdentifier?:RelativeIdentifier) : string | null
	{ return  `/session/${!!relativeIdentifier ? relativeIdentifier : this.session.publicId}/document/${this.publicId}`; }

	public async mySession(c:EditingContext) : Promise<Session> {
		if (!$ok(this.session)) {
			this.session = await this.$rq('session', c) ;
			if (!$ok(this.session)) {
				throw new Error('Database loading session error') ;
			}
		}
		return this.session ;
	}

	public async canBeDeleted(c:EditingContext) : Promise<boolean> {
		const session = await this.mySession(c) ;

		if (session.status !== SessionStatus.Genuine) return false ;

		const scenarios = await session.scenariosUnderConstruction(c) ;
		if ($ok(scenarios)) {
			for (let s of <Scenario[]>scenarios) {
				if (s.otherData.dids.includes(this.publicId)) return false ;
			}
		}

		let tokens = await Token.query(c.trx)
								.where('actor.sessionId', '=', this.sessionId)
								.select('otherData') ;
		if ($count(tokens)) {
			for (let t of <Token[]>tokens) { // this is a bad cast since we only ave otherData in this object
				if (t.otherData?.dids?.includes(this.publicId)) return false ;
			}
		}
		return true ;
	}

	/*
		Document status is now calculated from session
		and current automat from active scenario
	 */
	public async documentStatus(c:EditingContext) : Promise<DocumentStatus> {
		const session = await this.mySession(c) ;
		return await session.findDocumentStatus(this.publicId, c) ;
	}
	public async toAPI(c:EditingContext) : Promise<DocumentResource> { 
		const session = await this.mySession(c) ;
		let returnValue:DocumentResource = {
			id: session.publicId,
			date: this.creationDate(),
			did:this.publicId,
			'file-name':this.fileName,
			title:this.title,
			status:(await this.documentStatus(c)),
		} ;
		if ($length(this.abstract)) { 
			returnValue.abstract = this.abstract ; 
		}
		if ($ok(this.manifestData)) {
			returnValue['manifest-data'] = this.manifestData ;
		}
		if ($ok(this.userData)) {
			returnValue['user-data'] = this.userData ;
		}
		return returnValue ;
	} ;

	static jsonAttributes = ['otherData', 'manifestData', 'userData'] ;

	public async fetchGenuineFile(c:EditingContext):Promise<FileRef> {
		if (!$ok(this.genuineFile)) {
			this.genuineFile = await this.$rq('genuineFile', c) ;
		}
		return this.genuineFile ;
	}
	
	public getGenuineFiles():LastFile[] {
		return [ {fileId:this.genuineFileId} ] ;
	}
	
	public getLastFiles(aid?:LocalID):LastFile[] {
		if (!$ok(this.otherData?.lastFiles)) { return this.getGenuineFiles() ; }
		if ($ok(aid) && <number>aid > 0) {
			(<DocumentOtherData>this.otherData).lastFiles.filter(e => e.aid === aid) ;
		}
		return (<DocumentOtherData>this.otherData).lastFiles ;
	}

	static relationMappings = () => ({
		session: {
			relation: Model.BelongsToOneRelation,
			modelClass: Session,
			join: {
			  from: dbcol(apiTables.documents, 'sessionId'),
			  to: dbid(apiTables.sessions)
			},
		},
		files: {
			relation: Model.ManyToManyRelation,
	  		modelClass: FileRef,
			join: {
				from: dbid(apiTables.documents),
			  	// Description of the join table which is not present as a Class in Objection
			  	through: {
					from: dbcol(apiTables.documentFiles, 'documentId'),
					to: dbcol(apiTables.documentFiles, 'fileId'),
					extra: ['rank', 'status', 'type', 'usage', 'usageTitle']
				},
			  	to: dbid(apiTables.files),
			},
		},
		genuineFile: {
			relation: Model.BelongsToOneRelation,
			modelClass: FileRef,
			join: {
			  from: dbcol(apiTables.documents, 'genuineFileId'),
			  to: dbid(apiTables.files)
			},
		},
	}) ;

}

