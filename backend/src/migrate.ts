import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { DEFAULT_DAILY_NEW_LIMIT } from './config.js';

const sql=await readFile(fileURLToPath(new URL('../migrations/001_initial.sql',import.meta.url)),'utf8');
const connection=await mysql.createConnection({host:process.env.DB_HOST??'localhost',port:Number(process.env.DB_PORT??3306),database:process.env.DB_NAME??'vocabup',user:process.env.DB_USER??'vocabup',password:process.env.DB_PASSWORD??'vocabup',multipleStatements:true});
try {
  await connection.query(sql);
  for (const [table, column, definition] of [['cards', 'pronunciation', "VARCHAR(500) NOT NULL DEFAULT ''"], ['cards', 'translation', 'TEXT NULL'], ['decks', 'daily_new_limit', `INT UNSIGNED NOT NULL DEFAULT ${DEFAULT_DAILY_NEW_LIMIT}`]] as const) {
    const [rows] = await connection.query(
      'SELECT COUNT(*) AS count FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?', [table, column],
    ) as unknown as [Array<{ count: number }>, unknown];
    if (Number(rows[0]?.count ?? 0) === 0) await connection.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
  console.log('Database migration applied.');
} finally { await connection.end(); }
