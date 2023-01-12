import { Ascending } from 'foundation-ts/types'
import { $ok, $count, $length, $unsigned } from 'foundation-ts/commons'

import { 
	$compareDates, 
	$finalDateString, 
	$date2string,
} from '../utils/commons'

import { Model, QueryContext } from 'objection'
import { APIModel } from './APIModels'
import { 
	APIRole, 
	UserRole, 
	SessionStatus, 
	ScenarioStatus,
	DocumentStatus,
	RoleType
} from '../api/APIConstants'
import { apiTables } from './DBConstants'
import { dbcol, dbid } from './DBFunctions'
import Actor from './Actor'
import Download from './Download'
import FileRef from './FileRef'
import Scenario from './Scenario'
import SessionDocument from './SessionDocument'
import { ManifestData, SessionResource, UserData } from '../api/APIInterfaces'
import { EditingContext, RelativeIdentifier, SessionInterface, SessionOtherData, SignedDocument } from './DBInterfaces'
import { LocalID } from '../api/APIIDs'

export default class Session extends APIModel implements SessionInterface {
	static tableName = apiTables.sessions
	
	// identifiers
	declare publicId: number ;

	// common vars
	declare expires_at: string ;
	declare lastPubObject: number ;
	declare status: number ;
	declare ttl:number ;
	declare user: string ;

	// relationships
	declare activeScenario: Scenario | undefined ;
	declare actors: Actor[] | undefined ;
	declare manifestFile: FileRef | undefined ;
	declare scenarios: Scenario[] | undefined ;
	declare documents: SessionDocument[] | undefined ;
	declare downloads: Download[] | undefined ;

	// JSON columns
	declare otherData: SessionOtherData ;

	// standard JSON columns
	declare manifestData: ManifestData ;
	declare userData: UserData ;

	// instance methods
	protected internalUrl(_?:RelativeIdentifier) : string | null { 
		return  `/session/${this.publicId}`; 
	}

	$beforeInsert(context: QueryContext) {
		super.$beforeInsert(context);
		this.lastPubObject = 0,
		this.expires_at = $finalDateString(this.created_at, this.ttl) ;
	}

	// WARNING: This 2 methods are to be used inside a transaction
	// for one or several use of the first method during of the transaction
	// if you don't update the session by other means, you need to use
	// the decond method at the end of your transaction
	public sessionNextPublicID() : number {
		this.lastPubObject = this.lastPubObject + 1 ;
		return this.lastPubObject ;
	}

	public async hasActorWithLogin(login:string, c:EditingContext) : Promise<boolean> {
		const others = await this.$rq('actors', c)
								 .where('login', '=', login)
								 .count()
								 .as('count') ;
		return $count(others) > 0 && $ok(others[0].count) && others[0].count > 0 ; 
	}

	public async acceptsUser(actionRole: APIRole, user:string, userRole:number | string | UserRole, c:EditingContext) : Promise<boolean> {
		if (!$length(user)) return false ;
		const role = $unsigned(userRole) ;
		if (!role || !Object.values(UserRole).includes(role)) { return false ; }
		
		if (role === UserRole.Action && user === this.user) { return true ; } // whatever API action we seek, this is the action creator, so right is granted
		
		if (role === UserRole.Action && 
		    (actionRole == APIRole.Listing || actionRole == APIRole.Reading || actionRole == APIRole.Signature)) {
			// we accept a registered actor for reading, listing and finally signing if he has a signing role 
			const actor:Actor = await this.$rq('actors', c).findOne('login', '=', user) ;
			if ($ok(actor) && (actionRole != APIRole.Signature || actor.canSign())) { return true ; }
		}

		if (role !== UserRole.Action && actionRole == APIRole.Listing) { return true ; } // all non-action users can list

		if ((role === UserRole.Maintenance || role === UserRole.System) && 
		    (actionRole !== APIRole.Signature)) { return true ; } // maintenance/sustem users can do all they want but signing

		return false ;
	}

	public async myActiveScenario(c:EditingContext) : Promise<Scenario|null> {
		if (this.isActive()) {
			if (!$ok(this.activeScenario)) {
				this.activeScenario = await this.$rq('activeScenario', c) ;
				if (!$ok(this.activeScenario)) {
					throw new Error('Database loading session error') ;
				}
			}	
			return $ok(this.activeScenario) ? <Scenario>this.activeScenario : null ;
		}
		return null ;

	}

	// returns a zero or negative time is the session is expired
	public expirationDate(): string { return $date2string(this.expires_at) ; }

	public isActive() : boolean { 
		return this.status == SessionStatus.Active ;
	}

	public isExpired() : boolean {
		return $compareDates(new Date(), new Date(this.expires_at)) !== Ascending ? true : false ;
	}

	public isArchived() : boolean {
		return this.status === SessionStatus.WellTerminatedArchived ||
		       this.status === SessionStatus.WrongTerminatedArchived ;
	}
	
	public async findDocumentStatus(did:LocalID, c:EditingContext) : Promise<DocumentStatus> {
		if (this.status !== SessionStatus.Genuine && this.status !== SessionStatus.UnderConstruction) {
			const signatures = this.otherData.signatures ;
			let n = $count(signatures) ;
			while (n-- > 0) {
				const signature = (<SignedDocument[]>signatures)[n] ;
				if (signature.did === did) {
					if (signature.roleType === RoleType.Signature) return DocumentStatus.Signed ;
					if (signature.roleType === RoleType.Approval) return DocumentStatus.Approved ;
				}
			}
			const scenario = await this.myActiveScenario(c) ;
			if ($ok(scenario)) { 
				const ret = (<Scenario>scenario).findDocumentStatus(did) ;
				if ($ok(ret)) return <DocumentStatus>ret ;
			}
		}
		return DocumentStatus.Genuine ;
	}

	public async scenariosUnderConstruction(c:EditingContext): Promise<Scenario[]|null> {
		const scenarios = await this.$rq('scenarios', c)
					    			.where('status', '=', ScenarioStatus.UnderConstruction)
									.orWhere('status', '=', ScenarioStatus.UnderConstructionAfterSplit) ;
		return $count(scenarios) ? scenarios : null ;
	}

	public async maxScenarioRank(c:EditingContext):Promise<number> {
		const results = await this.$rq('scenarios', c)
							 	   .max('rank') ;
		if ($count(results)) {
			const m = (<any>results[0]).max ;
			if ($ok(m)) return m ;
		}
		return 0 ;
	}

	public wasCertificateUsed(cid:number) : boolean {
		if (!$count(this.otherData?.signatures)) return false ;
		let node = this.otherData?.signatures?.find(s => s.cid === cid) ;
		return $ok(node) ? true : false ;
	}

	public isClosed() : boolean { 
		return this.status == SessionStatus.WellTerminated ||
			   this.status == SessionStatus.Deleted ||
			   this.status == SessionStatus.Canceled ? true : false ;
	}
	public isOpened() : boolean { return !this.isClosed() ; }

	static jsonAttributes = ['manifestData', 'otherData', 'userData'] ;
	
	public async toAPI(c:EditingContext) : Promise<SessionResource> { 
		let returnValue:SessionResource = {
			id: this.publicId,
			status:this.status,
			ttl:this.ttl,
			date:this.creationDate(),
			expires:this.expirationDate()
		} ;

		if (!$ok(this.actors)) {
			this.actors = await this.$rq('actors', c) ;
		}
		returnValue.actors = Session.toManyURLs<Actor>(this.actors, this.publicId) ;


		if (!$ok(this.documents)) {
			this.documents = await this.$rq('documents', c) ;
		}
		returnValue.documents = Session.toManyURLs<SessionDocument>(this.documents, this.publicId) ;


		if (!$ok(this.scenarios)) {
			this.scenarios = await this.$rq('scenarios', c) ;
		}
		returnValue.scenarios = Session.toManyURLs<Scenario>(this.scenarios, this.publicId) ;

		if ($ok(this.manifestData)) {
			returnValue['manifest-data'] = this.manifestData ;
		}
		if ($ok(this.userData)) {
			returnValue['user-data'] = this.userData ;
		}

		return returnValue ;
	}

	static relationMappings = () => ({
		activeScenario: {
			relation: Model.BelongsToOneRelation,
			modelClass: Scenario,
			join: {
			  from: dbcol(apiTables.sessions, 'activeScenarioId'),
			  to: dbid(apiTables.scenarios)
			},
		},
		actors: {
			relation: Model.HasManyRelation,
			modelClass: Actor,
			join: {
			  from: dbid(apiTables.sessions),
			  to: dbcol(apiTables.actors, 'sessionId')
			},
		},
		documents: {
			relation: Model.HasManyRelation,
			modelClass: SessionDocument,
			join: {
			  from: dbid(apiTables.sessions),
			  to: dbcol(apiTables.documents, 'sessionId')
			},
		},
		downloads: {
			relation: Model.HasManyRelation,
			modelClass: Download,
			join: {
			  from: dbid(apiTables.sessions),
			  to: dbcol(apiTables.downloads, 'sessionId')
			},
		},
		manifestFile: {
			relation: Model.BelongsToOneRelation,
			modelClass: FileRef,
			join: {
			  from: dbcol(apiTables.sessions, 'manifestFileId'),
			  to: dbid(apiTables.files)
			},
		},
		scenarios: {
			relation: Model.HasManyRelation,
			modelClass: Scenario,
			join: {
			  from: dbid(apiTables.sessions),
			  to: dbcol(apiTables.scenarios, 'sessionId')
			},
		},
	})
}
