import { 
	SignatureFormat, 
	SignatureLevel, 
	 SignatureType 
} from './APIConstants';
import { APIAuth } from './APIInterfaces';
 
export interface DirectSignatureOptions {
	'file-name':string,
	format:SignatureFormat,
	level:SignatureLevel,
	type:SignatureType,
	certificate?:'generate'|'server'|'test-parameters'
}

export const devSignatureOptionsSchema={
	'file-name':{type:"string"},
	format:{type:'number',enum:[1,2,3]},
	level:{type:'number',enum:[1,2,3,4]},
	type1:{type:'number',enum:[1,2,3]},
	certificate:{type:'string',enum:['generate','server','test-parameters']}
}

export interface DevUploadCheck {
	auth:APIAuth
	verified:boolean,
	seal?:string|null,
}
