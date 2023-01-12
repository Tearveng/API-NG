import { $ok, $count, $length, $isstring, $isobject, $isarray, $isnumber } from 'foundation-ts/commons'
import { $trim } from 'foundation-ts/strings'

import { BadRequestError, ForbiddenError, InternalError } from '../utils/errors'
import { Model, QueryContext, QueryBuilder, SingleQueryBuilder, TransactionOrKnex } from 'objection'
import { UserRole } from '../api/APIConstants'
import { APIAuth, APIGetListQuery } from '../api/APIInterfaces'
import { APIServer } from '../server'
import { $now, $date2string, $finalDateString } from '../utils/commons'
import Session from './Session'
import NGConfig from './NGConfig'
import { LocalID, $lid, GlobalID, $gid } from '../api/APIIDs'
import { QueryOperator } from './DBConstants'
import { EditingContext, RelativeIdentifier } from './DBInterfaces'


/*
interface ModelClass<T extends APIStaticModel> {
	new (): T;
	query():QueryBuilderType<T>;
	query(t:TransactionOrKnex): QueryBuilderType<T>;
	relatedQuery(): QueryBuilderType<T>;
	relatedQuery(t:TransactionOrKnex): QueryBuilderType<T>;
}
*/
export class APIStaticModel extends Model {
	declare id: number ;
  declare created_at: string | undefined ;


	// WARNING : $beforeInsert() is not async here because we don't use any
	// async functions in the class hierarchy.
	// If we need to execute queries in any of the subclasses, this function
	// SHOULD BECOME async
	$beforeInsert(_: QueryContext) {
		this.created_at = $now();
	}
	
	// ====== Tool methods put here in order to be available for all instance of all objects ====
	// not a so good modelisation schema but very, easy to use in subclasses, so an easy wins...
	public static async nextGlobalPublicID(context:EditingContext) : Promise <number> {
		return NGConfig.nextGlobalPublicIDWithTableName(this.tableName, context) ;
	}

	private static _addIDsToQuery<M extends APIStaticModel>(query:QueryBuilder<M, M[]>,
															property:string, 
														    values:string[] | string | number[] | number | undefined | null,
															global:boolean,
	   													   ) : boolean {

		if (!$ok(values) || !$length(property)) { return false ; }
		if ($isarray(values)) {
			if (!$count(values as Array<number|string>)) { return true ; /* there's nothing to insert */ }
			const ids:LocalID[] = [] ;
			for (let p of <string[]|number[]>values) {
				const n = global ? $gid(p) : $lid(p) ;
				if (!n) { return false ; }
				ids.push(n) ;
			}
			query.where(property, 'in', ids) ;
		}
		else if ($isstring(values) && !$length(<string>values)) { 
			return true ; // there's nothing to insert
		}
		else {
			const n = global ? $gid(<string|number>values) : $lid(<string|number>values) ;
			if (!n) { return false ; }
			query.where(property, '=', n) ;
		}
		return true ;
	}

	public static addLocalIDsToQuery<M extends APIStaticModel>(query:QueryBuilder<M, M[]>,
															   property:string, 
															   values:string[] | string | LocalID[] | LocalID | undefined | null,
															   ) : boolean {
		return this._addIDsToQuery<M>(query, property, values, false) ;
	}

	public static addGlobalIDsToQuery<M extends APIStaticModel>(query:QueryBuilder<M, M[]>,
														 property:string, 
														 values:string[] | string | GlobalID[] | GlobalID | undefined | null, 
														 ) : boolean {
		return this._addIDsToQuery<M>(query, property, values, true) ;
	}
	
	public static addNumberToQuery<M extends APIStaticModel>(query:QueryBuilder<M, M[]>,
															 property:string,
															 value:string|number|undefined|null,
															 operator:QueryOperator = QueryOperator.EQ,
															 min?:number,
                                                             max?:number 
															) : boolean {
		if (!$ok(value) || !$length(property)) { return false ; }
		if ($isstring(value)) {
			if (!$length($trim(<string>value))) { return false ; }
			value = parseInt(<string>value, 10) ;
			if (isNaN(value)) return false ;
		}
		if (($isnumber(min) && (value as number) < (min as number)) ||
            ($isnumber(max) && (value as number) > (max as number))) { return false ; }

		const op:string = $ok(operator) ? <string>operator : '=' ; 
		query.where(property, op, <number>value) ;
		return true ;
	}

	public static expirationAwareListQuery<Q extends APIGetListQuery, M extends APIStaticModel>(auth:APIAuth, 
																								q:Q, 
																								c:EditingContext) : QueryBuilder<M, M[]> {
		const query = $ok(c.trx) ? this.query(c.trx) : this.query() ;

		if ($ok(q)) {
			if ($ok(q.ttlmin) && this.addNumberToQuery(query, 'ttl', q.ttlmin,QueryOperator.GTE, 0)) {
				throw new BadRequestError('bad ttlmin parameter in query') ;
			}
			if ($ok(q.ttlmax) && this.addNumberToQuery(query, 'ttl', q.ttlmax,QueryOperator.LTE, 0)) {
				throw new BadRequestError('bad ttlmax parameter in query') ;
			}

			if ($ok(q.userids)) {
				if (auth.role === UserRole.Action) {
					throw new ForbiddenError('Action user cannot specify user identifiers in their request')
				}
				if ($isstring(q.userids) && $length(<string>(q.userids))) { 
					query.where('user', '=', <string>q.userids) ;
				}
				else if ($isarray(q.userids)) {
					// paranoid, I know but typing does not mean we receive strings...
					query.where('user', 'in', (<[any]>(q?.userids)).map((e: any) => `${e}`)) ; 
				}
			}	
		
			const now = $now() ;
			let ttlsearch = false ;
			if ($ok(q.dynttlmin)) {
				query.where('expires_at', '>=', $finalDateString(now, <number>q.dynttlmin)) ;
				ttlsearch = true ;
			}
			if ($ok(q.dynttlmax)) {
				query.where('expires_at', '<=', $finalDateString(now, <number>q.dynttlmax)) ;
				ttlsearch = true ;
			}
			if (!ttlsearch) {
				// by default we get only the non-expired objects but
				// this can be changed with the expirationstatus param
				if (!$length(q.expirationstatus) || q.expirationstatus === 'valid') {
					query.where('expires_at', '>', now) ;
				}
				else if (q.expirationstatus === 'expired') {
					query.where('expires_at', '<=', now) ;
				}
			}
		}
		/* this predicated was removed from here
		   because it's now in the code which use this method
		if (auth.role === UserRole.Action) {
			// as action role, we get only our items
			query.where('user', '=', auth.user) ;
		}
		*/
		return <QueryBuilder<M, M[]>><unknown>query ;
	}

	public static async objectWithPublicID<M extends APIStaticModel>(identifier:number|null|undefined, c:EditingContext) : Promise <M | null> {
		if ($ok(identifier) && <number>identifier > 0) {
			let q = $ok(c.trx) ? this.query(<TransactionOrKnex>(c.trx)) : this.query() ;
			let r = null ;
			if (($isstring(c.prefetchings) && $length(<string>(c.prefetchings)) > 0) || ($ok(c.prefetchings) && $isobject(c.prefetchings))) {
				q.where('publicId', '=', <number>identifier) ;
				let fetched = await q.withGraphFetched(<any>c.prefetchings) ;
				if ($count(fetched) == 1) r = fetched[0] ;
			}
			else {
				r = await q.findOne('publicId', '=', <number>identifier) ;
			}
			if ($ok(r)) {
				return <M>r ;
			}
		}
		return null ;
	}

	public static toManyURLs<C extends APIStaticModel>(elements:C[] | undefined | null, r?:RelativeIdentifier) : string[]
	{
		return $count(elements) ? (<C[]>elements)?.map((e:C) => (e.url(r))) : [] ;
	}

	// WARNING: never use with object without a session
	public static async sessionObjectWithPublicID<M extends APIStaticModel>(
		session:Session|null|undefined, 
		identifier:number|null|undefined, 
		c:EditingContext) : Promise <M | null> {
		if ($ok(identifier) && $ok(session) && (<number>identifier) > 0) {
			let q = $ok(c.trx) ? this.query(c.trx) : this.query() ;
			q.where({
				sessionId: (<Session>session).id, /*session instanceof Session ? (<Session>session).id : <number>session, */
				publicId: <number>identifier
			}) ;
			let fetched = null ;

			if (($isstring(c.prefetchings) && $length(<string>(c.prefetchings)) > 0) || ($ok(c.prefetchings) && $isobject(c.prefetchings))) {
				fetched = await q.withGraphFetched(<any>c.prefetchings) ;
			}
			else {
				fetched = await q ;
			}
			if ($count(fetched) == 1) {
				let fetchedObject = (<M[]><unknown>fetched)[0] ; // BAD casting but typescript is a hell of type checking
				if ($ok(fetchedObject)) {
					// WARNING: never use with object without a session
					// the bad casting continues but we need it to assign the session to the fetched object if needed here
					if (!$ok((<any><unknown>fetchedObject)?.session)) {
						(<any><unknown>fetchedObject).session = session ;
					}
					return fetchedObject ;
				}  
			}
		}
		return null ;
	}

	// global URL management methods for the API
	protected internalUrl(_?:RelativeIdentifier) : string | null { return null ; }

	public $q(c:EditingContext) : SingleQueryBuilder<any> { 
		return $ok(c.trx) ? this.$query(c.trx) : this.$query() ;
	}

	public $rq(relation:string, c:EditingContext) : SingleQueryBuilder<any> { 
		return $ok(c.trx) ? this.$relatedQuery(relation, c.trx) : this.$relatedQuery(relation) ;
	}

	public async $delete(c:EditingContext) {
		if (!$ok(c.trx)) {
			throw new InternalError('$delete() should be called inside a transaction') ;
		}
		await this.$query(c.trx).delete() ;
	}

	public creationDate():string { return $date2string(this.created_at) ; }
	public longUrl(relativeIdentifier?:RelativeIdentifier) : string {
		let internalUrl = this.internalUrl(relativeIdentifier) ;
		const api = APIServer.api() ;
		return internalUrl ? `${api.prefix}${api.version}${internalUrl}` : "" ;
	}
	public shortUrl(relativeIdentifier?:RelativeIdentifier) : string {
		let internalUrl = this.internalUrl(relativeIdentifier) ;
		return internalUrl ? internalUrl : "" ;
	}
	public url(relativeIdentifier?:RelativeIdentifier) : string {
		return APIServer.api().conf.longIdentifiers ? this.longUrl(relativeIdentifier) : this.shortUrl(relativeIdentifier) ;
	}
}


export class APIModel extends APIStaticModel {
    updated_at: string | undefined

	$beforeInsert(context: QueryContext) {
		super.$beforeInsert(context);
		this.updated_at = this.created_at ; // we want that a just created object has a modification date identical to its creation date
	}

	public modificationDate(): string { return $date2string(this.updated_at) ; }

	// WARNING : $beforeUpdate() is not async here because we don't use any
	// async functions in the class hierarchy.
	// If we need to execute queries in any of the subclasses, this function
	// SHOULD BECOME async
	$beforeUpdate() {
		this.updated_at = $now();
	}
	
}
