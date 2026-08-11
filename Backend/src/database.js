const mysql = require('mysql2/promise');

let pool;

const getDatabasePool = () => {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      charset: 'utf8mb4',
    });
  }

  return pool;
};

const hasDatabaseConfiguration = () => Boolean(
  process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME
);

module.exports = { getDatabasePool, hasDatabaseConfiguration };