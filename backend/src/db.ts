import mysql from 'mysql2/promise';
import 'dotenv/config';

if (process.env.NODE_ENV === 'production' && !process.env.DB_PASSWORD) {
  throw new Error('DB_PASSWORD must be configured in production');
}

export const pool = mysql.createPool({
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 3306),
  database: process.env.DB_NAME ?? 'vocabup',
  user: process.env.DB_USER ?? 'vocabup',
  password: process.env.DB_PASSWORD ?? 'vocabup',
  waitForConnections: true,
  connectionLimit: 10,
  decimalNumbers: true,
  timezone: 'Z'
});
