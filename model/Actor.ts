import { $count, $length, $ok } from 'foundation-ts/commons'
import { $inspect } from 'foundation-ts/utils'

import { Model } from 'objection'
import { APIModel } from './APIModels'
import { AuthType, SessionStatus, SigningProcess } from '../api/APIConstants'
import { apiTables } from './DBConstants'
import { dbcol, dbid } from './DBFunctions'
import { ActorResource, ManifestData, UserData } from '../api/APIInterfaces'
import { ActorInterface, EditingContext, RelativeIdentifier } from './DBInterfaces'

import Session from './Session'
import Scenario from './Scenario'
import Token from './Token'
import CAToken from './CAToken'
import { APICountry } from '../api/APICountries'
import { APIServer } from '../server'


export default class Actor extends APIModel implements ActorInterface {
	static tableName = apiTables.actors ;
	
	// identifiers
	declare sessionId: number ;
	declare publicId: number ;
	
	// common vars
	administrativeCode: string | undefined ;
	declare country: APICountry ;
	declare email: string ;
	declare mobile: string | undefined ;
	declare firstName: string | undefined  ;
	declare login: string ;
	declare name: string ;
	declare type: number ;
	declare authType:AuthType;

	// relationships
	declare session: Session ;
	declare tokens: Token[] | undefined ; 	  // these are the OTP tokens
	declare caTokens: CAToken[] | undefined ; // those are the Certification Authorities tokens

	// JSON columns
	declare rolesArray: string[] ;
	
	// standard JSON columns
	declare manifestData: ManifestData ;
	declare userData: UserData ;

	// instance methods
	completeName() : string {
		// we don't check the type here since firstName is not set for the legal type
		return $length(this.firstName) ? `${this.firstName} ${this.name}` : this.name ;
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
	
	public async canBeDeleted(c:EditingContext) : Promise<boolean>
	{
		const session = await this.mySession(c) ;
		if (session.status !== SessionStatus.Genuine) return false ;

		const scenarios = await session.scenariosUnderConstruction(c) ;
		if ($ok(scenarios)) {
			for (let s of <Scenario[]>scenarios) {
				if (s.otherData.aids.includes(this.publicId)) return false ;
			}
		}
		const api = APIServer.api() ;
		const res1 = await Token.query(c.trx)
								  .where('actorId', '=', this.id)
								  .where('actor.sessionId', '=', this.sessionId)
								  .count()
								  .as('tokensCount') ;
		api.log(`TOKEN QUERY RESULTS = ${$inspect(res1)}`)
		if ($count(res1) && (<any>res1[0]).tokensCount > 0) { return false ; }
		const res2 = await CAToken.query(c.trx)
								  .where('actorId', '=', this.id)
								  .where('sessionId', '=', this.sessionId)
								  .count()
								  .as('tokensCount') ;
		api.log(`CA-TOKEN QUERY RESULTS = ${$inspect(res2)}`)
		return $count(res2) && (<any>res2[0]).tokensCount > 0 ? false : true ;
	}
	
	public canSign() : boolean {
		if ($count(this.rolesArray)) {
			for (let role of this.rolesArray) {
				role = role.toLowerCase() ;
				if (role === SigningProcess.Sign ||
					role === SigningProcess.Cosign ||
					role === SigningProcess.Countersign ||
					role === SigningProcess.OrderedCosign ||
					role === SigningProcess.IndividualSign) {
					return true ;
				}
			}
		}
		return false ;
	}

	protected internalUrl(relativeIdentifier?:RelativeIdentifier) : string | null
	{ 
		return  `/session/${!!relativeIdentifier ? relativeIdentifier : this.session.publicId}/actor/${this.publicId}`; 
	}

	public async toAPI(c:EditingContext) : Promise<ActorResource> { 
		let returnValue:ActorResource = {
			aid:this.publicId,
			date:this.creationDate(),
			id: (await this.mySession(c)).publicId,
			country:this.country,
			email:this.email,
			name:this.name,
			roles:this.rolesArray,
			type:this.type
		} ;
		if ($length(this.firstName)) { 
			returnValue['first-name'] = this.firstName ;
		}
		if ($length(this.mobile)) { 
			returnValue.mobile = this.mobile ;
		}
		if ($ok(this.manifestData)) {
			returnValue['manifest-data'] = this.manifestData ;
		}
		if ($ok(this.userData)) {
			returnValue['user-data'] = this.userData ;
		}
		return returnValue ;
	} ;

	static jsonAttributes = ['manifestData', 'rolesArray', 'userData'] ;

	static relationMappings = () => ({
		caTokens: {
			relation: Model.HasManyRelation,
			modelClass: CAToken,
			join: {
			  from: dbid(apiTables.actors),
			  to: dbcol(apiTables.caTokens, 'actorId')
			},
		},
		session: {
			relation: Model.BelongsToOneRelation,
			modelClass: Session,
			join: {
			  from: dbcol(apiTables.actors, 'sessionId'),
			  to: dbid(apiTables.sessions)
			},
		},
		tokens: {
			relation: Model.HasManyRelation,
			modelClass: Token,
			join: {
			  from: dbid(apiTables.actors),
			  to: dbcol(apiTables.tokens, 'actorId')
			},
		},
	}) ;

}
