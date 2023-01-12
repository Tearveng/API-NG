// Update with your config settings.
require('ts-node/register');
const env = require('./env-config');

module.exports = {

  development: {
	client: env.DB_CLIENT,
	connection: {
		host : env.DB_HOST,
        port: env.DB_PORT,
		user : env.DB_USER,
		password : env.DB_PASS,
		database : env.DB_NAME,
		charset: 'utf8'
	},
	migrations: {
		directory: __dirname + '/migrations',
	},
	seeds: {
		directory: __dirname + '/seeds'
	}
  },

  staging: {
    client: 'postgresql',
    connection: {
        host: env.DB_HOST,
        port: env.DB_PORT,
        user: env.DB_USER,
        password: env.DB_PASS
    },
    pool: {
      min: 2,
      max: 10
    },
    migrations: {
      tableName: 'knex_migrations'
    }
  },

  production: {
    client: env.DB_CLIENT,
    connection: {
      database : env.DB_NAME,
      user : env.DB_USER,
      password : env.DB_PASS,
    },
    pool: {
      min: 2,
      max: 10
    },
    migrations: {
      tableName: 'knex_migrations'
    }
  }

};
