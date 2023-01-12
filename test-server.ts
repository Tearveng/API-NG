import { $path } from 'foundation-ts/fs';
import { $logterm } from 'foundation-ts/utils';

import { APIServer } from './server'
import { declare_server_routes, server_start } from './server-start';
import { DEFAULT_PATH} from './utils/commons' 

$logterm('*************** LOCAL TEST SERVER LAUNCHING ******') ;
$logterm(`Launching test directory is '${DEFAULT_PATH}'`) ;
$logterm('**************************************************') ;

const downloadsFolder = $path(DEFAULT_PATH, 'tests', 'server-downloads') ;
const uploadsFolder = $path(DEFAULT_PATH, 'tests', 'server-uploads') ;
const storageFolder = $path(DEFAULT_PATH, 'tests', 'server-storage') ;

const api = APIServer.api({
	"accept-forced-closure": true,
	"certificate-ttl": 900,
	"client-upload-number-max": 100000,
	"client-upload-size-max":   1073741824,
	"default-language": "fr",
	"downloads-path":downloadsFolder,
	"storage-path":storageFolder,
	"uploads-path":uploadsFolder,
	"document-approval-categories": {
		"legal": {
			"fr": "Approbation par le service juridique",
			"en": "Legal approval"
		  },
		  "comm": {
			"fr": "Approbation par le service commercial",
			"en": "Commercial approval"
		  },
		  "tech": {
			"fr": "Approbation technique",
			"en": "Technical approval"
		  },
		  "head": {
			"fr": "Approbation par la direction",
			"en": "Direction approval"
		  }
	},
	"manifest-on-closure": false,
	"sign-server-login": {
		"login":"pps#test",
		"password":"ySsPUR23"
	},
	"otp-ttl": 600,
	"port": 8008,
	"activate-manifest-data":{
		"activation-reference":{
			"fr": "Ref. d'activation",
			"en": "Activation ID #"
		}
	},
	"session-manifest-data":{
		"title":{
			"fr": "Titre",
			"en": "Title"
		},
		"folder-reference":{
			"fr": "No de dossier",
			"en": "Directory #"
		}
	},
	"session-documents-number-max": 50,
	"session-documents-size-max": 4194304,
	"ttl-max": 864000,
	"ttl-min": 60,
	"upload-bandwidth-max": 1048576,
	"upload-size-max": 1048576,
	"upload-ttl": 900,
	"production-environment":false	
}) ;


declare_server_routes(api) ;
server_start(api) ;

