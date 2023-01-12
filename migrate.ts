import Knex from 'knex'
import { $exit } from './utils/commons';
import * as env from './env-config'
console.log("Initializing migration...")

const knex = Knex({
	client: env.DB_CLIENT,
	connection: {
		host: env.DB_HOST,
		port: env.DB_PORT,
		user: env.DB_USER,
		password: env.DB_PASS,
		database: env.DB_NAME
	}
});

console.log("Starting migration...") ;

async function migrate() : Promise<void> 
{
	await knex.migrate.latest() ;
	$exit('Tables creation is done.',0) ;
}

migrate() ;

