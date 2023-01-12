import { $count, $ok } from 'foundation-ts/commons'
import { $removeFile } from 'foundation-ts/fs'

import { Model, Modifiers } from 'objection'
import { DocumentStatus, RoleType, ScenarioStatus } from '../api/APIConstants'
import { LocalID } from '../api/APIIDs'
import { ManifestData, ScenarioResource, StepNode, UserData } from '../api/APIInterfaces'
import { APIModel } from './APIModels'
import { apiTables } from './DBConstants'
import { dbcol, dbid } from './DBFunctions'
import {
	EditingContext,
	LastFile,
	LastFilesDictionary,
	RelativeIdentifier,
	ScenarioInterface,
	ScenarioOtherData
} from './DBInterfaces'
import FileRef from './FileRef'
import Session from './Session'
import SessionDocument from './SessionDocument'
import { automatCurrentNode } from '../api/automat/automat'


async function _destroyFiles(referenceSet:Set<number>, allFiles:LastFilesDictionary|undefined|null, c:EditingContext) {
	if ($ok(allFiles)) {
		for (let key in <LastFilesDictionary>allFiles) {
			let documentFiles = (<LastFilesDictionary>allFiles)[key] ;
			for (let f of documentFiles) {
				if (!referenceSet.has(f.fileId)) {
					let file = await FileRef.query(c.trx).findById(f.fileId) ;
					if ($ok(file)) {
						$removeFile(file.path) ;
						if ($ok(file.sealPath)) { $removeFile(file.sealPath) ;}
					}
					await file.$delete(c) ;
					referenceSet.add(f.fileId) ; // don't destroy twice
				}
			}
		}
	}
}

export default class Scenario extends APIModel implements ScenarioInterface {
	static tableName = apiTables.scenarios

	// identifiers
	declare publicId: number ;
	declare sessionId:number ;

	// common vars
	declare rank: number ;
	declare signatureFormat: number ;
	declare signatureLevel: number ;
	declare status: number ;

	// relationships
	declare session: Session ;
	// documents: SessionDocument[] | undefined ;

	// JSON columns
	declare otherData: ScenarioOtherData ;
	declare stepsDefinition: StepNode[] ;

	// standard JSON columns
	declare manifestData: ManifestData ;
	declare userData: UserData ;

	// instance methods
	protected internalUrl(relativeIdentifier?:RelativeIdentifier) : string | null
	{
		return  `/session/${!!relativeIdentifier ? relativeIdentifier : this.session.publicId}/scenario/${this.publicId}`;
	}

	public isUnderConstruction() : boolean {
		return this.status == ScenarioStatus.UnderConstruction ||
			   this.status == ScenarioStatus.UnderConstructionAfterSplit ? true : false ;

	}

	public isActive() : boolean {
		return this.status == ScenarioStatus.ActiveScenario ? true : false ;
	}

	public findDocumentStatus(did:LocalID) : DocumentStatus|null {
		if (this.isActive()) {
			const node = automatCurrentNode(this.otherData.automat) ;
			if ($ok(node)) {
				if (node?.dids.includes(did)) {
					if (node.roleType === RoleType.Approval) return DocumentStatus.Approbation ;
					if (node.roleType === RoleType.Signature) return DocumentStatus.Signing ;
				}
			}
		}
		return null ;
	}


	public async mySession(c:EditingContext) : Promise<Session> {
		if (!$ok(this.session)) {
			this.session = await this.$rq('session', c) ;
			if (!$ok(this.session)) {
				throw new Error('Database loading session error') ;
			}
		}
		return this.session ;
	}

	public async fetchLastFilesFromDocuments(c:EditingContext) : Promise<LastFilesDictionary> {
		let ret:LastFilesDictionary = {} ;
		if ($count(this.otherData.dids)) {
			const session = await this.mySession(c) ;
			for (let did of this.otherData.dids) {
				let realDoc = await SessionDocument.sessionObjectWithPublicID<SessionDocument>(session, did, c) ;
				if (!$ok(realDoc)) {
					throw new Error('Database loading document error') ;
				}
				ret[did] = (<SessionDocument>realDoc).getLastFiles() ;
			}
		}
		return ret ;
	}
	public sourceFileReferences(did:LocalID, aid:LocalID) : LastFile[] {
		const sourceFiles = this.otherData?.sourceFiles ;
		if (!$ok(sourceFiles)) return [] ;
		let lastFiles = (<LastFilesDictionary>sourceFiles)[did] ;
		if (!$count(lastFiles)) return [] ;

		return lastFiles.filter(f => !$ok(f.aid) || f.aid === aid)
	}

	// use only this method when cancelling a scenario
	// WARNING : after that, you need to patch the other data
	//         : need to be used in a transaction
	public async destroyScenarioFiles(destroyGeneratedFiles:boolean, c:EditingContext) {
		if ($ok(this.otherData.sourceFiles)) {
			const originalFiles = <LastFilesDictionary>(this.otherData.originalLastFiles) ;
			const referenceSet = new Set<number>() ;
			for (let key in originalFiles) {
				for (let f of originalFiles[key]) { referenceSet.add(f.fileId) ; }
			}
			// destroy all source files except original files
			// source files contain the original files => not destroyed
			await _destroyFiles(referenceSet, this.otherData.sourceFiles, c) ;
			if (destroyGeneratedFiles) {
				// generated files are different from original files
				await _destroyFiles(referenceSet, this.otherData.generatedFiles, c) ;
			}
		}
	}

	public async toAPI(c:EditingContext) : Promise<ScenarioResource> {
		let returnValue:ScenarioResource = {
			date:this.creationDate(),
			id: (await this.mySession(c)).publicId,
			sid:this.publicId,
			status:this.status,
			documents:this.otherData.documentURLs,
			format:this.signatureFormat,
			level:this.signatureLevel,
			steps:this.stepsDefinition,
		} ;
		if ($ok(this.manifestData)) {
			returnValue['manifest-data'] = this.manifestData ;
		}
		if ($ok(this.userData)) {
			returnValue['user-data'] = this.userData ;
		}
		return returnValue ;
	} ;

	static jsonAttributes = ['otherData', 'manifestData', 'stepsDefinition', 'userData'] ;

	static modifiers: Modifiers = {
		orderByRank(builder) {
			builder.orderBy('rank');
		}
	} ;

	static relationMappings = () => ({
		session: {
			relation: Model.BelongsToOneRelation,
			modelClass: Session,
			join: {
			  from: dbcol(apiTables.scenarios, 'sessionId'),
			  to: dbid(apiTables.sessions)
			},
		},
	}) ;

}
