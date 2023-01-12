import { $count, $length/*, $ok*/ } from "foundation-ts/commons";
import { $inspect, $logterm } from "foundation-ts/utils";
import { ActorType, SignatureFormat, SignatureLevel, SignatureType, SigningProcess } from "./api/APIConstants";
import { $uuid } from "foundation-ts/crypto";

import { $now } from "./utils/commons";

import { NGT } from "./client/test-ng";
import { CreateActorBody, ScenarioBody } from "./api/APIInterfaces";


const args = process.argv.slice(2);

const api = new NGT(
	'pps#test',
	'ySsPUR23',
	$count(args) > 0 && (args.includes('remote') || args.includes('-remote')),
	true
) ;

const start = async (): Promise<void> => {
	const now = $now() ;
	$logterm(`Starting Manifest Generation Test at ${now}...`) ;

	$logterm(">>>>>>>>> UPLOADS AND SESSION CREATION >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>") ;
	const pdf1 = await api.uploadFile('pdf1.pdf') ;

	$logterm("\n>>>> Creating Session 1") ;
	let ret:string|null = await api.createSession({ttl:900}) ;
	api.check($length(ret) > 0, `creating session1 :'${ret}'`) ;
	const session1 = <string>ret ;
	$logterm("<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<") ;

	$logterm(">>>>>>>>> ADDING DOCUMENT TO SESSION >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>") ;
	ret = await api.addDocument(session1, {
		'file-name':'pdf1.pdf',
		title:'My unique PDF',
		upload:pdf1,
	}) ;
	api.check($length(ret) > 0, `adding pdf1 ${ret} to session1`) ;
	const document1 = ret as string ;

	$logterm("<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<") ;

	$logterm(">>>>>>>>> ADDING ACTOR TO SESSION >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>") ;
	const actor1body:CreateActorBody = {
		name:'DURAND',
		email:'paul.durand@free.fr',
		'first-name':'Paul',
		country:'FR',
		roles:['approval', 'sign'],
		type:ActorType.Person
	}
	$logterm(`\nWill add actor : ${$inspect(actor1body)}`) ;
	ret = await api.addActor(session1, actor1body) ;
	api.check($length(ret) > 0, `adding actor1: ${ret} to session1`) ;
	const actor1 = ret as string ;
	$logterm("<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<") ;

	$logterm(">>>>>>>>> CREATE AND ACTIVATE A SIMPLE SCENARIO FOR CURRENT SESSION >>>>>>>>>>>>>>>>>>") ;
	const signatureTag = SigningProcess.Cosign ;
	const scenario1Body:ScenarioBody = {
		documents: [<string>document1],
		format:SignatureFormat.PAdES,
		level:SignatureLevel.LTA,
		steps:[
			{
				process:signatureTag,
				steps:[actor1],
				signatureType:SignatureType.Envelopped,
				cardinality:'all'
			}
		]
	}
	$logterm(`\n>>>> Will add scenario : ${$inspect(scenario1Body)}`) ;
	const rets = await api.addScenario(session1, scenario1Body) ;
	api.check($length(rets) > 0, 'adding scenario1 to session1') ;
	const scenario1 = rets as string ;

	$logterm(`\n>>>> Will activate scenario : ${scenario1}`) ;
	const activated = await api.activateScenario(scenario1, {
		'manifest-data':{
			'activation-reference': $uuid()
		}
	}) ;
	api.check(activated, 'checking activating scenario1') ;
	$logterm("<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<") ;

	$logterm(">>>>>>>>> DOCUMENT SIGNATURE AND SAVING >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>") ;
	await api.signAvailableDocumentsForActor(session1, actor1, signatureTag, 1) ;
	$logterm(">>>>>>>>> DOCUMENT SAVING >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>") ;
	// await api.getAndSaveDocument(document1, `unique-doc1.pdf`) ;
	// $logterm("<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<") ;
	//
	// $logterm(">>>>>>>>> SESSION CLOSING >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>") ;
	// let closed = await api.closeSession(session1, {reason:'end of our work', force:false})
	// api.check($ok(closed), 'closing of session1') ;
	// $logterm("<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<") ;
	//
	// $logterm(">>>>>>>>> GENERATE AND DOWNLOAD MANIFEST >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>") ;
	// await api.recoverManifest(session1) ;
	// $logterm("<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<") ;

} ;

start() ;
