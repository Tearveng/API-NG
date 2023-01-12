import { validityState } from '../api/APIConstants'

export const NO_CONTEXT = {}
export const MODEL_VERSION = '1.2.4' ;

export const apiTables = {
	actors:				'actor',
	certificates:		'certificate',
	certificateFiles:   'cert_files',
	cas:				'ca',
	caTokens:			'caToken',
	config:				'ngConf',
	documents:			'document',
	documentFiles:		'doc_files',
	downloads:			'downloads',
	files:				'files',
	requests:           'requests',
	scenarios:			'scenario',
	scenarioDocuments:	'scenario_docs',
	sessions:			'session',
	tokens:				'otp',
	tokenDocuments:	    'otp_docs',
	uploads:			'uploads',
	userJWT:			'user_jwt'
} ;

export const deleteRules = {
	cascade:			'CASCADE',
	deny:				'RESTRICT',
	nullify:			'SET NULL',
	noAction:			'NO ACTION'
} ;

export enum QueryOperator {
	GT 	= ">",
	GTE = '>=',
	LT	= '<',
	LTE = '<=',
	EQ  = '=',
	NEQ = '<>',
	IN  = 'in'
}

export const apiGlobals = {
	// strings
	databaseSystemUser: '$_api_ng_dbuser_',

	// flags
	usesTimeZone: true,

	// lengths
	codeLength: 50,
	countryLength: 2,
	emailLength: 320, 	 // 64 charcters for adress + @ + 255 charcter of domain name
	filenameLength: 260, // to match windows length
	hashLength: 128,
	keyIdLength: 40, // that means 20 octets in hexadecimal form
	loginLength: 64,
	messageLength:128,
	nameLength: 200,
	otpLength: 256,
	pathLength: 4096, // to match linux size
	phoneLength: 30,
	titleLength: 200,
	uuidLength: 36,
	valueLength: 128,
	versionLength: 16,
	ipLength:40
}

export enum CAStatus {
	Valid = validityState.valid,
	Invalid = validityState.invalid
}

export enum FileStatus {
	Valid = validityState.valid,
	Invalid = validityState.invalid
}

export enum TokenStatus {
	Active = validityState.valid,
	Archived = validityState.invalid
}

export enum ConfigType {
	String = 0,
	Integer = 1,
	Unsigned = 2,
	Real = 3
}
