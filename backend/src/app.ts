import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { router } from './routes.js';
import { usersRouter } from './users.js';
import { pool } from './db.js';
import { UPLOAD_DIR } from './uploads.js';
import { UploadLimitError } from './upload-stream.js';

const app = express();
const allowedOrigins = (process.env.FRONTEND_URL ?? 'http://localhost:5173').split(',').map(value => value.trim()).filter(Boolean);
const isAllowedOrigin = (origin: string) => {
  if (allowedOrigins.includes(origin)) return true;
  if (process.env.NODE_ENV === 'production') return false;
  try {
    const url = new URL(origin);
    if (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return true;
    // ngrok free assigns a new HTTPS subdomain each time a tunnel is restarted.
    return url.protocol === 'https:' && (
      url.hostname.endsWith('.ngrok-free.app') ||
      url.hostname.endsWith('.ngrok-free.dev')
    );
  } catch {
    return false;
  }
};
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: { directives: {
  defaultSrc: ["'self'"], baseUri: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"],
  scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:', 'https:'], fontSrc: ["'self'", 'data:'], connectSrc: ["'self'"],
  upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
} }, hsts: false }));
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  next();
});
app.use(cors({ origin(origin, callback) { callback(null, !origin || isAllowedOrigin(origin) ? (origin || false) : false); }, credentials: true, methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'], allowedHeaders: ['Content-Type'], maxAge: 600 }));
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!['GET','HEAD','OPTIONS'].includes(req.method)) {
    const origin = req.get('origin');
    if (origin && !isAllowedOrigin(origin)) { res.status(403).json({ error: 'Origin không được phép.' }); return; }
  }
  next();
});
app.use(express.json({limit:'1mb'}));
app.use('/api/auth',rateLimit({windowMs:15*60*1000,limit:30,standardHeaders:true,legacyHeaders:false}));
app.get('/api/health',async(_req,res)=>{
  try { await pool.query('SELECT 1'); res.json({status:'ok',database:'ok'}); }
  catch { res.status(503).json({status:'error',database:'unavailable'}); }
});
app.use('/api/users', usersRouter);
app.use('/api',router);
app.use('/api', (_req, res) => { res.status(404).json({ error: 'Không tìm thấy API endpoint.' }); });
// Uploaded illustrations are stored on disk (never in MySQL) and served with a
// random, immutable filename. Only same-origin pages may embed them.
app.use('/uploads', express.static(UPLOAD_DIR, {
  index: false,
  maxAge: '30d',
  immutable: true,
  setHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  },
}));
const frontendDist = resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/dist');
if (process.env.NODE_ENV === 'production' && existsSync(frontendDist)) {
  app.use(express.static(frontendDist, {
    index: false,
    setHeaders(res, filePath) {
      const normalizedPath = filePath.replaceAll('\\', '/');
      const isFingerprintedAsset = /\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[^/]+$/.test(normalizedPath);
      res.setHeader('Cache-Control', isFingerprintedAsset ? 'public, max-age=31536000, immutable' : 'public, max-age=3600');
    },
  }));
  app.get('/sitemap.xml', (_req, res) => {
    res.status(404).type('text/plain').setHeader('Cache-Control', 'no-store');
    res.end('Not found');
  });
  app.get(/.*/, (_req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(resolve(frontendDist, 'index.html')); });
}
app.use((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
  if(error instanceof UploadLimitError){res.status(413).json({error:error.message,code:error.code,kind:error.kind,limitMB:error.limitMB});return;}
  if(error instanceof ZodError){res.status(400).json({error:'Dữ liệu không hợp lệ.',details:error.issues.map(i=>({path:i.path,message:i.message}))});return;}
  if(error && typeof error==='object' && 'status' in error && Number(error.status) >= 400 && Number(error.status) < 500){const status=Number(error.status);res.status(status).json({error:status===413?'File vượt quá giới hạn cho phép.':'Request không hợp lệ.'});return;}
  if(error && typeof error==='object' && 'code' in error && error.code==='ER_DUP_ENTRY'){res.status(409).json({error:'Dữ liệu đã tồn tại.'});return;}
  if(error && typeof error==='object' && 'code' in error && ['ER_ACCESS_DENIED_ERROR','ER_DBACCESS_DENIED_ERROR','ER_BAD_DB_ERROR','ECONNREFUSED','ETIMEDOUT','PROTOCOL_CONNECTION_LOST'].includes(String(error.code))){res.status(503).json({error:'Dịch vụ dữ liệu tạm thời không khả dụng.'});return;}
  const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : 'UNEXPECTED_ERROR';
  console.error('[vocabup] Request failed.', { method: _req.method, path: _req.path, code });
  res.status(500).json({error:'Đã có lỗi máy chủ.'});
});
export default app;
