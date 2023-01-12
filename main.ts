import { APIServer } from './server'
import {  server_start } from './server-start';
import swaggerConfig from './swagger-config';
const api = APIServer.api() ;
swaggerConfig(api);

server_start(api) ;




