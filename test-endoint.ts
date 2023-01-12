import { $count, $length, $ok } from 'foundation-ts/commons'
import { $inspect, $logterm } from "foundation-ts/utils";
import { $hash, HashMethod } from 'foundation-ts/crypto';

import { $exit, $now } from "./utils/commons";

import { SignatureLevel, SignatureType } from "./api/APIConstants";
import { NGT } from "./client/test-ng";
import { fileTokenToXMLString } from "./classes/CertignaEndPoint";

const args = process.argv.slice(2);

const api = new NGT(
	'pps#test',
	'ySsPUR23',
	$count(args) > 0 && (args.includes('remote') || args.includes('-remote')), 
	true
) ;

const start = async (): Promise<void> => {
	const now = $now() ;
	$logterm(`Starting Endpoint Test at ${now}...`) ;

	// make a ping on our api
	$logterm(`Pinging api...`)
	const resp = await api.ping() ;
	api.check($ok(resp) && $length(resp?.requestId) > 0, 'ping api') ;
	$logterm(`Ping did return:\n${$inspect(resp)}`) ;

	// Trying to server-sign a document
	$logterm('Check PAdES signature with server certificate ...') ;
	await api.directPadesSign('pdf1.pdf', SignatureLevel.LT, 'server') ;

	const token = {
		name:'John DOE',
		user:'testlogin',
		size:142857,
		hash:$hash(Buffer.from("Je ne sais pas pouquoi la pluie quitte la haut ses oripaux, que sont ces lourds nuages gris pour se briser sur nos coteaux"), HashMethod.SHA256),
		date:now
	} ;
	let xmlString = fileTokenToXMLString(token) ;

	$logterm('Check XAdES signature with server certificate ...') ;
	await api.directXadesSign(xmlString, SignatureType.Envelopped, 'seal-envelopped.xml') ;
	await api.directXadesSign(xmlString, SignatureType.Envelopping, 'seal-envelopping.xml') ;

	$logterm('Check PAdES signature with generated certificate ...') ;
	await api.directPadesSign('pdf2.pdf', SignatureLevel.LTA, 'generate') ;

	$exit('Endpoint Test concluded with no errors', 0)

} ;

start() ;
