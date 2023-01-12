import { APIServer } from "./server";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from '@fastify/swagger-ui'
import { declare_server_routes } from "./server-start";
export default async function swaggerConfig  (api:APIServer){
 
  await api.server.register(fastifySwagger,{
    mode:'dynamic',
    swagger:{
      info:{
        title:"API-NG",
        version:api.version
      },
      externalDocs: {
        url: 'https://swagger.io',
        description: 'Find more info here'
      },
      schemes: ['http','https'],
      consumes: ['application/json'],
      produces: ['application/json'],
      tags:[]
    },
    hideUntagged:false,
    hiddenTag:"true"
    
  });

 
  //  Defined all routes here
  declare_server_routes(api) ;
  await api.server.register(fastifySwaggerUi, {
    
    routePrefix: '/docs',
    uiConfig: {
     
      deepLinking: false
    },
   
    staticCSP: false,
   
    transformSpecification: (swaggerObject: any, _request: any) => { return swaggerObject },
    transformSpecificationClone: true,
    logLevel:'info'
  });
  
} 