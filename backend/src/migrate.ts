import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const sql=await readFile(fileURLToPath(new URL('../migrations/001_initial.sql',import.meta.url)),'utf8');
const connection=await mysql.createConnection({host:process.env.DB_HOST??'localhost',port:Number(process.env.DB_PORT??3306),database:process.env.DB_NAME??'vocabup',user:process.env.DB_USER??'vocabup',password:process.env.DB_PASSWORD??'vocabup',multipleStatements:true});
try { await connection.query(sql); console.log('Database migration applied.'); } finally { await connection.end(); }
