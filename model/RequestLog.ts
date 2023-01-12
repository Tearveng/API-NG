import { APIRole, UserRole } from '../api/APIConstants'
import { APIStaticModel } from './APIModels'
import { apiTables } from './DBConstants'
import { RequestInterface } from './DBInterfaces';


export default class RequestLog extends APIStaticModel implements RequestInterface {
	static tableName = apiTables.requests

	requestId!:string ;
	apiRole!:APIRole ;
	
	user!:string ;
	role!:UserRole ;

	requestMethod!:string ;
	requestUrl!:string ;
	date!:string ; 
	status!: number ;
	
	duration?:number ; 
	ip?:string ; 

	error?: string ; 
	
	request?: object ;
	reply?: object ;

	static jsonAttributes = ['request', 'reply'] ;
}

