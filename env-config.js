const dotenv = require('dotenv');

switch(process.env.NODE_ENV){
  case 'production':
    dotenv.config({path:'prod.env',debug:true});
    console.log("Production Mode: >>", process.env.NODE_ENV);
    break;
  default :
    dotenv.config({path:'dev.env',debug:true});
    console.log("Development Mode: >>", process.env.NODE_ENV);
}


module.exports = {
  APP_ADDRESS:process.env.APP_ADDRESS,
  APP_PORT:Number(process.env.APP_PORT)||3000,
  DB_CLIENT:process.env.DB_CLIENT,
  NODE_ENV: process.env.NODE_ENV || 'development',
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  DB_NAME: process.env.DB_NAME || 'api_c',
  DB_HOST: process.env.DB_HOST || 'localhost',
  DB_PORT: Number(process.env.DB_PORT) || 5432,
  DB_USER: process.env.DB_USER || 'postgres',
  DB_PASS: process.env.DB_PASS || 'postgres',
  REMOTE_URL: process.env.REMOTE_URL,
  SIGN_SERVER_LOGIN:process.env.SIGN_SERVER_LOGIN,
  SIGN_SERVER_PASS:process.env.SIGN_SERVER_PASS,
  CERTIFICATE_BASE:process.env.CERTIFICATE_BASE,
  SIGNATURE_BASE:process.env.SIGNATURE_BASE
};

