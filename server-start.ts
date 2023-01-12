import { APIServer } from './server'
import { actorRoutes } from './api/routes/actor';
import { uploadRoutes } from './api/routes/upload'
import { uploadsRoutes } from './api/routes/uploads'
import { actorsRoutes } from './api/routes/actors';
import { caRoutes } from './api/routes/ca';
import { casRoutes } from './api/routes/cas';
import { certificateRoutes } from './api/routes/certificate';
import { certificatesRoutes } from './api/routes/certificates';
import { documentRoutes } from './api/routes/document';
import { documentsRoutes } from './api/routes/documents';
import { downloadRoutes } from './api/routes/download';
import { downloadsRoutes } from './api/routes/downloads';
import { scenarioRoutes } from './api/routes/scenario';
import { scenariosRoutes } from './api/routes/scenarios';
import { sessionRoutes } from './api/routes/session';
import { sessionsRoutes } from './api/routes/sessions';
import { devRoutes } from './api/routes/dev'
import * as env from './env-config'
import { $exit } from './utils/commons';
import { Certigna } from './classes/CertignaEndPoint';
import { EXTERNAL_SERVICES_ERROR, DATABASE_ERROR } from './utils/errors';
import NGConfig from './model/NGConfig';
import { MODEL_VERSION } from './model/DBConstants';


export function declare_server_routes(theAPI:APIServer) : void {
	actorRoutes() ;
	actorsRoutes() ;
	caRoutes() ;
	casRoutes() ;
	certificateRoutes() ;
	certificatesRoutes() ;
	documentRoutes() ;
	documentsRoutes() ;
	downloadRoutes()
	downloadsRoutes() ;
	scenarioRoutes() ;
	scenariosRoutes() ;
	sessionRoutes() ;
	sessionsRoutes() ;
	uploadRoutes() ;
	uploadsRoutes() ;

	if (!theAPI.conf.isProduction) {
		devRoutes()
	}
}

export async function server_start(theAPI:APIServer) : Promise<void> 

{
	const PORT:any = env.APP_PORT;
	
	const endPoint = Certigna.endPoint() ;
	const valid = await endPoint.checkGenerationStatus() ;
	if  (!valid) {
		$exit('Impossible to reach Certigna certificate generation service', EXTERNAL_SERVICES_ERROR) ;
	}
	let dbVersion = '' ;
	try {
		dbVersion = await NGConfig.getModelVersion() ;
	}
	catch (e) {
		dbVersion = '' ;
	}
	
	if (dbVersion === MODEL_VERSION) {
		theAPI.log(`Connected to database version ${MODEL_VERSION}`)
	}
	else if (dbVersion === '') {
		$exit(`Connected database is not correctly set (verify that your tables have been created)`, DATABASE_ERROR) ;
	}
	else {
		$exit(`Wrong database version (connected:'${dbVersion}', should be '${MODEL_VERSION}')`, DATABASE_ERROR) ;
	}


	theAPI.server.listen({port:PORT,host:env.APP_ADDRESS},(err:Error,address:String)=>{
		if(err){
			$exit(err.message,500,"server start");
			return;
		}
		console.log(`SERVER ADDRESS START : ${address}`);
	});
	// (PORT,env.APP_ADDRESS)
}

/**
 
process.on('uncaughtException', (error) => {
	console.error(error);
	process.exit(333);
});
process.on('unhandledRejection', (error) => {
	console.error(error);
	process.exit(999);
});

 */
