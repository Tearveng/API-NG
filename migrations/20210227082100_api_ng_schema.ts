import { apiTables, deleteRules, apiGlobals, CAStatus, ConfigType, FileStatus, TokenStatus, MODEL_VERSION } from '../model/DBConstants'
import { ActorType, CertificateStatus, ScenarioStatus, SessionStatus, SignatureFormat, SignatureLevel } from '../api/APIConstants'
import { APICountries } from '../api/APICountries';
import { Knex } from 'knex';

/*

	QUICK READ-ME:

	Objection and Knex versions compatibility
	==================================================================================
	Objection.js versions 2.2.14 and 2.2.15 (which are essentialy the same) rely
	on Knex version < 0.95.0. Do not try to upgrade Knex to later versions for now

	Schema choices :
	==================================================================================
	1) No enum column is used since it's buggy
	2) Postgres' string array is not used (JSON used instead) since it's buggy
	3) We use camel case naming for all columns but timestamps : a good way to identify them

	Warnings :
	==================================================================================
	1) First tests seems not working with enums, so all enums are plain unsigned integers
	   and the default values are constants defined in the head of the export() function
	2) Table names are set in constants in the head of the export function()  
	3) String length is always specified using constant defined in the head of export() 
	   function
	4) Since Integers and Strings are nullable by default, modifiers are applied
	   only if needed
	5) Since timestamps are NOT nullable by default, modifiers are applied only if needed

*/


export async function up(knex: Knex): Promise<void> {
			  
	
	// Actors' constants
	const DEFAULT_ACTOR_TYPE = ActorType.Person,
		  DEFAULT_ACTOR__AUTH_TYPE = 0,
		  DEFAULT_COUNTRY = APICountries.FR.code ;

	// CertificationAuthorities' constants
	const DEFAULT_CA_STATUS = CAStatus.Valid ;

	// Certificates' constants 
	const DEFAULT_CERTIFICATE_STATUS = CertificateStatus.Valid,	// valid certificate by default
		  DEFAULT_CERTIFICATE_TTL = 60 ; /* 60 seconds by default from CERTIGNA API */

	// CertificationAuthorities Tokens' constants
	const DEFAULT_CA_TOKEN_STATUS = TokenStatus.Active ;

	// Downloads' constants
	const DEFAULT_DOWNLOAD_TTL = 7200 ;		// 2 hours
	
	// File's constant
	const DEFAULT_FILE_STATUS = FileStatus.Valid ; // means 

	// Scenarios' constants
	const DEFAULT_SCENARIO_STATUS = ScenarioStatus.UnderConstruction,
		  DEFAULT_SIGNATURE_FORMAT = SignatureFormat.PAdES,
		  DEFAULT_SIGNATURE_LEVEL = SignatureLevel.B ; 

	// Sessions' constants
	const DEFAULT_SESSION_STATUS = SessionStatus.Genuine,
		  DEFAULT_SESSION_TTL = 86400 ;

	// OTP Tokens' constant
	const DEFAULT_OTP_TTL = 600 ; // 10mn 

	// Uploads' constant
	const DEFAULT_UPLOAD_TTL = 300 ; // 5mn 

	console.log(`=============== START OF SCHEMA CREATION =================`) ;
	/********************************************
	 * 		STANDARD TABLES CREATION			*
	 ********************************************/
	 console.log(`Creating ${apiTables.actors} table`) ;
	 await knex.schema.createTable(apiTables.actors, table => {

		// identifiers and timestamps
		table.increments(	'id').primary() ;
		table.integer(	 	'publicId').unsigned().notNullable().index() ;
		table.timestamp( 	'created_at', { useTz: apiGlobals.usesTimeZone }).defaultTo(knex.fn.now()) ;
		table.timestamp( 	'updated_at', { useTz: apiGlobals.usesTimeZone }).defaultTo(knex.fn.now()) ;

		// common columns
		table.string(		'administrativeCode', apiGlobals.codeLength).index() ;
		table.string(		'country', apiGlobals.countryLength).defaultTo(DEFAULT_COUNTRY).notNullable() ;
		table.string(		'email', apiGlobals.emailLength).notNullable() ;
		table.string(		'firstName', apiGlobals.nameLength) ;
		table.string(		'login', apiGlobals.loginLength).index() ;
		table.string(		'name', apiGlobals.nameLength).notNullable() ;
		table.string(		'mobile', apiGlobals.phoneLength) ;
		table.integer(		'authType').unsigned().defaultTo(DEFAULT_ACTOR__AUTH_TYPE).notNullable() ;
		table.integer(		'type').unsigned().defaultTo(DEFAULT_ACTOR_TYPE).notNullable() ;

		// JSON columns
		table.json(			'rolesArray') ;	// not Postgres specific that way...

		// standard JSON columns
		table.json(			'userData') ;
		table.json(			'manifestData') ;	
	}) ;

	console.log(`Creating ${apiTables.cas} table`) ;
	await knex.schema.createTable(apiTables.cas, table => {
		// identifiers and timestamps
		table.increments(	'id').primary() ;
		table.integer(	 	'publicId').unsigned().notNullable().index() ;
		table.timestamp( 	'created_at', { useTz: apiGlobals.usesTimeZone }).defaultTo(knex.fn.now()) ;
		table.timestamp( 	'updated_at', { useTz: apiGlobals.usesTimeZone }).defaultTo(knex.fn.now()) ;
		table.string(		'importId', apiGlobals.uuidLength).notNullable().unique() ; 

		// common columns
		table.integer(		'status').unsigned().defaultTo(DEFAULT_CA_STATUS).notNullable().index() ;
		table.string(		'name', apiGlobals.nameLength).notNullable() ;

		// JSON columns
		table.json(			'caData') ;
	}) ;

	console.log(`Creating ${apiTables.caTokens} table`) ;
	await knex.schema.createTable(apiTables.caTokens, table => {
		// identifiers and timestamps
		table.increments(	'id').primary() ;
		table.integer(		'sessionId').unsigned().notNullable().index() ;
		table.string(		'token', apiGlobals.uuidLength).notNullable().unique() ; // even if the token could be unique only for 
																					 // a given session, we want it globally unique
		table.timestamp( 	'created_at', { useTz: apiGlobals.usesTimeZone }).defaultTo(knex.fn.now()) ;
		table.timestamp( 	'updated_at', { useTz: apiGlobals.usesTimeZone }).defaultTo(knex.fn.now()) ;

		// common columns
		table.integer(		'status').unsigned().defaultTo(DEFAULT_CA_TOKEN_STATUS).notNullable().index() ;
		table.string(		'cguVersion', apiGlobals.versionLength).notNullable() ;
	}) ;
	
	console.log(`Creating ${apiTables.certificates} table`) ;
	await knex.schema.createTable(apiTables.certificates, table => {
		// identifiers and timestamps
		table.increments(	'id').primary() ;
		table.integer(	 	'publicId').unsigned().notNullable().index() ;
		table.integer(		'sessionId').unsigned().notNullable().index() ;
		table.timestamp( 	'created_at', { useTz: apiGlobals.usesTimeZone }).defaultTo(knex.fn.now()) ;

		// common columns
		table.timestamp(	'expires_at', { useTz: apiGlobals.usesTimeZone }).index() ;
		table.integer(		'status').unsigned().defaultTo(DEFAULT_CERTIFICATE_STATUS).notNullable().index() ;
		table.integer(		'ttl').unsigned().defaultTo(DEFAULT_CERTIFICATE_TTL).notNullable() ;
		table.string(		'user', apiGlobals.loginLength).index() ;

		// JSON columns
		table.json(			'certificateData') ;	// other certificate's data

	}) ;
	
	console.log(`Creating ${apiTables.config} table`) ;
	await knex.schema.createTable(apiTables.config, table => {
		// identifiers and timestamps
		table.increments(	'id').primary() ;
		table.timestamp( 	'created_at', { useTz: apiGlobals.usesTimeZone }).defaultTo(knex.fn.now()) ;
		table.timestamp( 	'updated_at', { useTz: apiGlobals.usesTimeZone }).defaultTo(knex.fn.now()) ;

		// common columns
		table.string(		'key', apiGlobals.keyIdLength).notNullable().index() ;
		table.string(		'value', apiGlobals.valueLength) ;
		table.integer(		'rank').unsigned().defaultTo(0).notNullable() ;
		table.integer(		'type').unsigned().defaultTo(ConfigType.String).notNullable() ;
		table.string(		'user', apiGlobals.loginLength).defaultTo(apiGlobals.databaseSystemUser).notNullable().index() ;

	}) ;

	console.log(`Inserting version ${MODEL_VERSION} in ${apiTables.config} table`) ;
	await knex(apiTables.config).insert({
		key:'MODEL_VERSION', 
		value:MODEL_VERSION, 
	}) ;

	console.log(`Creating ${apiTables.documents} table`) ;
	await knex.schema.createTable(apiTables.documents, table => {
		// identifiers and timestamps
		table.increments(	'id').primary() ;
		table.integer(	 	'publicId').unsigned().notNullable().index() ;
		table.timestamp( 	'created_at', { useTz: apiGlobals.usesTimeZone }).defaultTo(knex.fn.now()) ;
		table.timestamp( 	'updated_at', { useTz: apiGlobals.usesTimeZone }).defaultTo(knex.fn.now()) ;

		// common columns
		table.text(			'abstract') ;
		table.string(		'fileName', apiGlobals.filenameLength).notNullable() ;
		table.string(		'title', apiGlobals.titleLength).notNullable() ;

		// JSON columns
		table.json(			'otherData') ;	// documents meta data

		// standard JSON columns
		table.json(			'userData') ;
		table.json(			'manifestData') ;	
	}) ;

	console.log(`Creating ${apiTables.downloads} table`) ;
	await knex.schema.createTable(apiTables.downloads, table => {
		// identifiers and timestamps
		table.increments(	'id').primary() ;
		table.integer(	 	'publicId').unsigned().notNullable().index() ;
		table.timestamp( 	'created_at', { useTz: apiGlobals.usesTimeZone }).defaultTo(knex.fn.now()) ;
		table.timestamp( 	'updated_at', { useTz: apiGlobals.usesTimeZone }).defaultTo(knex.fn.now()) ;
		table.string(		'user', apiGlobals.loginLength).notNullable().index() ;

		// common columns
		table.integer(		'downloadsCount').unsigned().defaultTo(0).notNullable() ;
		table.timestamp(	'expires_at', { useTz: apiGlobals.usesTimeZone }).index() ;
		table.string(		'path', apiGlobals.pathLength) ;
		table.integer(		'size').unsigned().defaultTo(0).notNullable() ;
		table.integer(		'ttl').unsigned().defaultTo(DEFAULT_DOWNLOAD_TTL).notNullable() ;
	}) ;

	console.log(`Creating ${apiTables.files} table`) ;
	await knex.schema.createTable(apiTables.files, table => {
		table.increments(	'id').primary() ;
		table.timestamp( 	'created_at', { useTz: apiGlobals.usesTimeZone }).defaultTo(knex.fn.now()) ;

		// common columns
		table.string(		'fileName', apiGlobals.filenameLength).notNullable() ;
		table.integer(		'fileType').unsigned().notNullable() ; // no default. should be set programatically
		table.string(		'hash', apiGlobals.hashLength).notNullable() ;
		table.string(		'path', apiGlobals.pathLength).notNullable() ;
		table.string(		'sealPath', apiGlobals.pathLength) ;
		table.integer(		'size').unsigned().defaultTo(0).notNullable() ;
		table.integer(		'status').unsigned().defaultTo(DEFAULT_FILE_STATUS).notNullable().index() ;
		table.integer(		'ttl').unsigned().defaultTo(DEFAULT_UPLOAD_TTL).notNullable() ;
		table.timestamp( 	'timestamped_at', { useTz: apiGlobals.usesTimeZone }).notNullable() ;
		table.timestamp( 	'uploaded_at', { useTz: apiGlobals.usesTimeZone }).nullable() ; // null means it's not an upploaded file
		table.string(		'user', apiGlobals.loginLength).notNullable().index() ;
				
		// JSON columns
		table.json(			'fileMetaData') ;	// file meta data
		table.json(			'otherData') ;		// file other non-limited data

	}) ;

	console.log(`Creating ${apiTables.requests} table`) ;
	await knex.schema.createTable(apiTables.requests, table => {
		// identifiers and timestamps
		table.increments(	'id').primary() ;
		table.string(		'requestId', apiGlobals.uuidLength) ;
		table.timestamp( 	'created_at', { useTz: apiGlobals.usesTimeZone }).defaultTo(knex.fn.now()) ;

		// common columns
		table.string(		'user', apiGlobals.loginLength).notNullable() ;
		table.integer(		'role').unsigned().notNullable() ;
		table.integer(		'apiRole').unsigned().notNullable() ;
		table.integer(		'duration').unsigned().notNullable() ;
		table.string(		'requestMethod', apiGlobals.keyIdLength).notNullable() ;
		table.string(		'requestUrl', apiGlobals.pathLength).notNullable() ;
		table.timestamp( 	'date', { useTz: apiGlobals.usesTimeZone }).defaultTo(knex.fn.now()).notNullable() ;
		table.integer(		'status').unsigned().notNullable() ;

		table.string(		'ip', apiGlobals.ipLength) ;
		table.string(		'error', apiGlobals.messageLength) ;

		// JSON columns
		table.json(			'request').nullable() ;
		table.json(			'reply').nullable() ; ;
	}) ;

	console.log(`Creating ${apiTables.scenarios} table`) ;
	await knex.schema.createTable(apiTables.scenarios, table => {
		// identifiers and timestamps
		table.increments(	'id').primary() ;
		table.integer(	 	'publicId').unsigned().notNullable().index() ;
		table.timestamp( 	'created_at', { useTz: apiGlobals.usesTimeZone }).defaultTo(knex.fn.now()) ;
		table.timestamp( 	'updated_at', { useTz: apiGlobals.usesTimeZone }).defaultTo(knex.fn.now()) ;

		// common columns
		table.integer(		'rank').unsigned().defaultTo(0).notNullable().index() ;
		table.integer(		'signatureFormat').unsigned().defaultTo(DEFAULT_SIGNATURE_FORMAT).notNullable() ;
		table.integer(		'signatureLevel').unsigned().defaultTo(DEFAULT_SIGNATURE_LEVEL).notNullable() ;
		table.integer(		'status').unsigned().defaultTo(DEFAULT_SCENARIO_STATUS).notNullable().index() ;

		// JSON columns
		table.json(			'otherData') ;	// documents meta data
		table.json(			'stepsDefinition') ;	// documents meta data

		// standard JSON columns
		table.json(			'userData') ;
		table.json(			'manifestData') ;
	}) ;

	console.log(`Creating ${apiTables.sessions} table`) ;
	await knex.schema.createTable(apiTables.sessions, table => {
		// identifiers and timestamps
		table.increments(	'id').primary() ;
// =============== WARNING =========================================
// since the session publicId could slow the process
// new security mesure should be enforced tater (may be with stored procedure)
// for now we want a global public id which may at least be different from
// the primary key
// =================================================================
		table.integer(		'publicId').unsigned().notNullable().unique() ;
		table.timestamp( 	'created_at', { useTz: apiGlobals.usesTimeZone }).defaultTo(knex.fn.now()) ;
		table.timestamp( 	'updated_at', { useTz: apiGlobals.usesTimeZone }).defaultTo(knex.fn.now()) ;

		// common columns 
		table.timestamp(	'expires_at', { useTz: apiGlobals.usesTimeZone }).index() ;
		table.integer(		'lastPubObject').unsigned().defaultTo(0).notNullable() ;
		table.integer(		'status').unsigned().defaultTo(DEFAULT_SESSION_STATUS).index() ;
		table.integer(		'ttl').unsigned().defaultTo(DEFAULT_SESSION_TTL).notNullable() ;
		table.string(		'user', apiGlobals.loginLength).notNullable().index() ;

		// JSON columns
		table.json(			'otherData') ;

		// standard JSON columns
		table.json(			'userData') ;
		table.json(			'manifestData') ;
	}) ;

	console.log(`Creating ${apiTables.tokens} table`) ;
	await knex.schema.createTable(apiTables.tokens, table => {
		// identifiers and timestamps
		table.increments(	'id').primary() ;
		table.string(		'otp', apiGlobals.otpLength).notNullable().unique() ; // even if the otp could be unique only for 
																				   // a given session, we want it globally unique
		table.timestamp( 	'created_at', { useTz: apiGlobals.usesTimeZone }).defaultTo(knex.fn.now()) ;

		// JSON columns
		table.json(			'otherData') ;

		// common columns
		table.timestamp(	'expires_at', { useTz: apiGlobals.usesTimeZone }).index() ;
		table.integer(		'ttl').unsigned().defaultTo(DEFAULT_OTP_TTL).notNullable() ;
	}) ;

	console.log(`Creating ${apiTables.uploads} table`) ;
	await knex.schema.createTable(apiTables.uploads, table => {
		// identifiers and timestamps
		table.increments(	'id').primary() ;
// =============== WARNING =========================================
// since the uploads publicId could slow the process
// new security mesure should be enforced tater (may be with stored procedure)
// for now we want a global public id which may at least be different from
// the primary key
// =================================================================
		table.integer(		'publicId').unsigned().notNullable().unique() ;
		table.timestamp( 	'created_at', { useTz: apiGlobals.usesTimeZone }).defaultTo(knex.fn.now()) ;

		// common columns
		table.timestamp(	'expires_at', { useTz: apiGlobals.usesTimeZone }).index() ;
		table.integer(		'fileType').unsigned().notNullable() ; // no default. should be set programatically
		table.string(		'hash', apiGlobals.hashLength).notNullable() ;
		table.string(		'path', apiGlobals.pathLength).notNullable() ;
		table.string(		'sealPath', apiGlobals.pathLength) ;
		table.integer(		'size').unsigned().defaultTo(0).notNullable() ;
		table.integer(		'ttl').unsigned().defaultTo(DEFAULT_UPLOAD_TTL).notNullable() ;
		table.timestamp( 	'uploaded_at', { useTz: apiGlobals.usesTimeZone }).defaultTo(knex.fn.now()) ;
		table.string(		'user', apiGlobals.loginLength).notNullable().index() ;

	}) ;

	console.log(`Creating ${apiTables.userJWT} table`) ;
	await knex.schema.createTable(apiTables.userJWT, table => {
		// identifiers and timestamps
		table.increments(	'id').primary() ;
		table.timestamp( 	'created_at', { useTz: apiGlobals.usesTimeZone }).defaultTo(knex.fn.now()) ;
		table.timestamp( 	'updated_at', { useTz: apiGlobals.usesTimeZone }).defaultTo(knex.fn.now()) ;

		// common columns
		table.string(		'user', apiGlobals.loginLength).notNullable().unique() ;

		// JSON columns
		table.json(			'authData').notNullable() ;
	}) ;

	/**

	// JSON columns
	authData!: JWTAuthData ;

	 */
	/********************************************
	 * 		NxN TABLES CREATION					*
	 ********************************************/
	 console.log(`Creating NxN ${apiTables.certificateFiles} table`) ;
	 await knex.schema.createTable(apiTables.certificateFiles, table => {
// =============== WARNING =========================================
// this is a N x N table !
// It seems that Objection.js works only if there's an id (or an equivalent column) in each table
// From a SQL normalization point of view, that's not right but it does no harm, so we comply
		table.increments(	'id').primary() ;
// =================================================================
		table.integer(	 	'rank').unsigned().defaultTo(0).notNullable().index() ;
		table.integer(	 	'status').unsigned().defaultTo(FileStatus.Valid).notNullable() ;
		table.integer(	 	'usage').unsigned().defaultTo(0).notNullable() ;
		table.integer(	 	'type').unsigned().defaultTo(0).notNullable() ;
		table.string(		'usageTitle', apiGlobals.titleLength) ;
		table
			.integer(		'certificateId')
			.unsigned()
			.references('id')
			.inTable(apiTables.certificates)
			.onDelete(deleteRules.cascade) // if the certificate is deleted, so is this object
			.notNullable()
			.index() ;

		table
			.integer(		'fileId')
			.unsigned()
			.references('id')
			.inTable(apiTables.documents)
			.onDelete(deleteRules.deny) // the file cannot be deleted if the certificate uses it
			.notNullable()
			.index() ;
	}) ;

	console.log(`Creating NxN ${apiTables.documentFiles} table`) ;
	await knex.schema.createTable(apiTables.documentFiles, table => {
// =============== WARNING =========================================
// this is a N x N table !
// It seems that Objection.js works only if there's an id (or an equivalent column) in each table
// From a SQL normalization point of view, that's not right but it does no harm, so we comply
		table.increments(	'id').primary() ;
// =================================================================
		table.integer(	 	'rank').unsigned().defaultTo(0).notNullable().index() ;
		table.integer(	 	'status').unsigned().defaultTo(FileStatus.Valid).notNullable() ;
		table.integer(	 	'usage').unsigned().defaultTo(0).notNullable() ;
		table.integer(	 	'type').unsigned().defaultTo(0).notNullable() ;
		table.string(		'usageTitle', apiGlobals.titleLength) ;
		table
		  .integer(			'documentId')
		  .unsigned()
		  .references('id')
		  .inTable(apiTables.documents)
		  .onDelete(deleteRules.cascade) // if the document is deleted, so is this object
		  .notNullable()
		  .index() ;

		table
		  .integer(			'fileId')
		  .unsigned()
		  .references('id')
		  .inTable(apiTables.files)
		  .onDelete(deleteRules.deny) // the file cannot be deleted if the document uses it
		  .notNullable()
		  .index() ;
	}) ;

	/********************************************
	 * 		TO-ONE RELATIONSHIPS DECLARATIONS	*
	 ********************************************/
	 console.log(`Adding ${apiTables.actors} table to-one relationships`) ;
	 await knex.schema.alterTable(apiTables.actors, table => {
		table
		  .integer(			'sessionId')
		  .unsigned()
		  .references('id')
		  .inTable(apiTables.sessions)
		  .onDelete(deleteRules.cascade) // if session is deleted, so is this object
		  .notNullable()
		  .index() ;
	}) ;

	console.log(`Adding ${apiTables.caTokens} table to-one relationships`) ;
	await knex.schema.alterTable(apiTables.caTokens, table => {
		table
		  .integer(			'actorId')
		  .unsigned()
		  .references('id')
		  .inTable(apiTables.actors)
		  .onDelete(deleteRules.cascade) // if actor is deleted, so is this object
		  .notNullable()
		  .index() ;

		table
		  .integer(			'caId')
		  .unsigned()
		  .references('id')
		  .inTable(apiTables.cas)
		  .onDelete(deleteRules.deny) // cannot delete certification authority if used here
		  .notNullable()
		  .index() ;
	}) ;

	console.log(`Adding ${apiTables.certificates} table to-one relationships`) ;
	await knex.schema.alterTable(apiTables.certificates, table => {
		table
		  .integer(			'caTokenId')
		  .unsigned()
		  .references('id')
		  .inTable(apiTables.caTokens)
		  .onDelete(deleteRules.cascade) // if token is deleted, delete the certificate
		  .notNullable()
		  .index() ;

	}) ;

	console.log(`Adding ${apiTables.documents} table to-one relationships`) ;
	await knex.schema.alterTable(apiTables.documents, table => {
		table
		  .integer(			'genuineFileId')
		  .unsigned()
		  .references('id')
		  .inTable(apiTables.files)
		  .onDelete(deleteRules.deny) // cannot delete the file if we are referencing it
		  .index() ;

		table
		  .integer(			'sessionId')
		  .unsigned()
		  .references('id')
		  .inTable(apiTables.sessions)
		  .onDelete(deleteRules.cascade) // if session is deleted, so is this object
		  .notNullable()
		  .index() ;
	}) ;

	console.log(`Adding ${apiTables.downloads} table to-one relationships`) ;
	await knex.schema.alterTable(apiTables.downloads, table => {
		table
		  .integer(			'fileId')
		  .unsigned()
		  .references('id')
		  .inTable(apiTables.files)
		  .onDelete(deleteRules.deny) // cannot delete the file if we are referencing it
		  .index() ;

		table
		  .integer(			'sessionId')
		  .unsigned()
		  .references('id')
		  .inTable(apiTables.sessions)
		  .onDelete(deleteRules.cascade) // if session is deleted, so is this object
		  .notNullable()
		  .index() ;
	}) ;

	console.log(`Adding ${apiTables.scenarios} table to-one relationships`) ;
	await knex.schema.alterTable(apiTables.scenarios, table => {
		// relationships' columns
		table
		  .integer(			'sessionId')
		  .unsigned()
		  .references('id')
		  .inTable(apiTables.sessions)
		  .onDelete(deleteRules.cascade) // if session is deleted, so is this object
		  .notNullable()
		  .index() ;
	}) ;


	console.log(`Adding ${apiTables.sessions} table to-one relationships`) ;
	await knex.schema.alterTable(apiTables.sessions, table => {
		table
		  .integer(			'manifestFileId')
		  .unsigned()
		  .references('id')
		  .inTable(apiTables.files)
		  .onDelete(deleteRules.deny) // cannot delete the file if we are referencing it
		  .index() ;

		table
		  .integer(			'activeScenarioId')
		  .unsigned()
		  .references('id')
		  .inTable(apiTables.scenarios)
		  .onDelete(deleteRules.noAction) // does nothing on delete because it's a suplemental relationship
		  						 		  // WARNING : this meas coherence is checked by code elsewhere
		  .index() ;	  
	}) ;

	console.log(`Adding ${apiTables.tokens} table to-one relationships`) ;
	await knex.schema.alterTable(apiTables.tokens, table => {
		table
		  .integer(			'actorId')
		  .unsigned()
		  .references('id')
		  .inTable(apiTables.actors)
		  .onDelete(deleteRules.cascade) // if actor is deleted, so is this object
		  .notNullable()
		  .index() ;

	}) ;
	console.log(`================ END OF SCHEMA CREATION ==================`) ;

}


export async function down(knex: Knex): Promise<void> {
	console.log(`=============== START OF SCHEMA DELETION =================`) ;
	await knex.schema.dropTableIfExists(apiTables.actors) ;
	await knex.schema.dropTableIfExists(apiTables.cas) ;
	await knex.schema.dropTableIfExists(apiTables.caTokens) ;
	await knex.schema.dropTableIfExists(apiTables.certificates) ;
	await knex.schema.dropTableIfExists(apiTables.certificateFiles) ;
	await knex.schema.dropTableIfExists(apiTables.config) ;
	await knex.schema.dropTableIfExists(apiTables.documents) ;
	await knex.schema.dropTableIfExists(apiTables.documentFiles) ;
	await knex.schema.dropTableIfExists(apiTables.downloads) ;
	await knex.schema.dropTableIfExists(apiTables.files) ;
	await knex.schema.dropTableIfExists(apiTables.requests) ;
	await knex.schema.dropTableIfExists(apiTables.scenarios) ;
	await knex.schema.dropTableIfExists(apiTables.sessions) ;
	await knex.schema.dropTableIfExists(apiTables.tokens) ;
	await knex.schema.dropTableIfExists(apiTables.uploads) ;
	console.log(`================ END OF SCHEMA DELETION ==================`) ; 
}
