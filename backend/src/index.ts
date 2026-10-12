import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { ZodError } from 'zod';
import { router } from './routes.js';
import { pool } from './db.js';

const app = express();
app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL ?? 'http://localhost:5173' }));
app.use(express.json({limit:'1mb'}));
app.use('/api/auth',rateLimit({windowMs:15*60*1000,limit:30,standardHeaders:true,legacyHeaders:false}));
app.get('/api/health',async(_req,res)=>{
  try { await pool.query('SELECT 1'); res.json({status:'ok',database:'ok'}); }
  catch { res.status(503).json({status:'error',database:'unavailable'}); }
});
app.use('/api',router);
app.use((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
  if(error instanceof ZodError){res.status(400).json({error:'Dữ liệu không hợp lệ.',details:error.issues.map(i=>({path:i.path,message:i.message}))});return;}
  if(error && typeof error==='object' && 'code' in error && error.code==='ER_DUP_ENTRY'){res.status(409).json({error:'Dữ liệu đã tồn tại.'});return;}
  if(error && typeof error==='object' && 'code' in error && ['ER_ACCESS_DENIED_ERROR','ER_BAD_DB_ERROR','ECONNREFUSED','ETIMEDOUT'].includes(String(error.code))){res.status(503).json({error:'Không kết nối được MySQL. Hãy kiểm tra backend/.env và trạng thái database.'});return;}
  console.error(error); res.status(500).json({error:'Đã có lỗi máy chủ.'});
});
const port=Number(process.env.PORT??4000);
app.listen(port,()=>console.log(`VocabUp API listening on http://localhost:${port}`));
