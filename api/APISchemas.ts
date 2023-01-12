// These Schema, their model base on APIInterfaces.ts
export const apiHeadersSchema={
	defaultlanguage: {type:'string',default:'fr'} ,
	certignarole: {type:'number',default:1},
	certignahash: {type:'string',default:"7Bqk9k3RxE5D"} ,
	certignauser: {type:'string',default:"dhimyotis#apiworkflow"} 
}
export const apiAuthSchema={
	user:{type:"string"},
	role:{type:"number",enum:[1,2,3,4]}, 
	password:{type:"string"},
	apiRole: {type:"number"}
}
export const apiFileTokenSchema={
	name:{type:"string"},
	size:{type:"number"},
	date:{type:"string"},
	hash:{type:"string"},
	user:{type:"string"}
}

export const apiGetListQuerySchema={
	ttlmin:{type:"number"},
	ttlmax:{type:"number"},
	dynttlmin:{type:"number"},
	dynttlmax:{type:"number"},
	userids:{type:"array"},
	expirationstatus:{type:'string',enum:['all','expired','valid']}
}

export const mainfestDataBodySchema={
	'manifest-data':{type:'object'}
}
const userDataBodySchema={
	'user-data':{
		type:"object"
	}
}

export const createSessionBodySchema ={
	...userDataBodySchema,
	ttl:{type:'number'}
}

export const createDocumentBodySchema ={
	...userDataBodySchema,
	abstract:{type:'string'},
	'file-name':{type:'string'},
	title:{type:'string'},
	upload:{type:'string'}
}

export const createActorBodySchema= {
	type:'object',
	properties:{
		...userDataBodySchema,
	'adm-id':{type:"string"},
	country:{type:"string"},
	email:{type:"string"},
	'first-name':{type:"string"},
	login:{type:"string"},
	mobile:{type:'string'},
	name:{type:"string"},
	role:{type:"array"},
	type:{type:"number", enum:[0,1],default:0}
	}
}

export const scenarioBodySchema = {
	...userDataBodySchema,
	documents:{type:'array'},
	format:{type:"number"},
	level:{type:"number"},
	steps:{type:'object',
	default:{
		process:"string" ,
		steps: [] as any[],  
		signatureType:1,// useless for approval steps
		cardinality:'one'
	}}
}

export const createCertificateBodySchema={
	actor:{type:'string'},
	authority:{type:'string'},
	token:{type:'string'},
	ttl:{type:'number'},
	"supporting-documents":{
		type:"object",
		default:{
			filename:"string",
			url:"string"
		}
	}
}

export const sessionQuerySchema ={
	...apiGetListQuerySchema,
	'status_mask':{type:"string"}
}

export const documentsQuerySchema={
	actor:{type:'string'},
	tages:{type:'array'},
	'status_mask':{type:'string'}
}

export const actorsQuerySchema ={
	tags:{type:"array"}
}

export const certificatesQuerySchema={
	caid:{type:"string"},
	actorIds:{type:"array"}
}
export const sessionOTPBodySchema={
	actor:{type:'string'},
	documents:{type:'array'},
	length:{type:'number'},
	numeric:{type:'boolean'},
	ttl:{type:"number"},
	tag:{type:'string'}
}

export const sessionCheckOTPBodySchema={
	actor:{type:"string"},
	documents:{type:"array"},
	otp:{type:"string"},
	tag:{type:"string"},
	delete:{type:"boolean"}
}

export const sessionApproveDocumentsBodySchema={
	...mainfestDataBodySchema,
	actor:{type:"string"},
	documents:{type:"array"},
	otp:{type:"string"},
	tag:{type:"string"},
	
}
export const sessionSignDocumentsBodySchema ={
	...mainfestDataBodySchema,
	certificate:{type:'string'},
	actor:{type:"string"},
	documents:{type:"array"},
	otp:{type:"string"},
	tag:{type:"string"},
}

export const sessionClosureBodySchema={
	...mainfestDataBodySchema,
	reason:{type:'string'},
	force:{type:'boolean'},
}
export const sessionExtendBodySchema={
	ttl:{type:'number'}
}

export const  scenarioSplitBodySchema = {
	reason:{type:'string'},
	...userDataBodySchema
}

export const scenarioCancelBodySchema = {
	reason:{type:'string'},
	...mainfestDataBodySchema
}
export const acceptedUploadsQuerySchema={
	type:'object',
	properties:{
		type:{type:'string', enum:['all','signing'],default:'all'}
	}

}

export const devSignatureOptionsSchema={
	type:'object',
	properties:{
		'file-name':{type:"string"},
		format:{type:'number',enum:[1,2,3]},
		level:{type:'number',enum:[1,2,3,4]},
		type:{type:'number',enum:[1,2,3]},
		certificate:{type:'string',enum:['generate','server','test-parameters']}
	}

}