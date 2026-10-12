import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { z } from 'zod';
import { pool } from './db.js';
import { authenticate, signToken } from './auth.js';
import type { AuthRequest } from './types.js';
import { scheduleReview } from './srs.js';

export const router = Router();
const asyncRoute = (fn: (req: AuthRequest, res: import('express').Response) => Promise<unknown>) => (req: AuthRequest, res: import('express').Response, next: import('express').NextFunction) => { void fn(req, res).catch(next); };
const auth = authenticate;
const userId = (req: AuthRequest) => req.user!.id;
const routeParam = (value: string | string[] | undefined): string => Array.isArray(value) ? value[0] ?? '' : value ?? '';
const deckSchema = z.object({ name: z.string().trim().min(1).max(120), description: z.string().max(500).optional().default(''), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().default('#6c63ff') });
const cardSchema = z.object({ front: z.string().trim().min(1).max(500), back: z.string().trim().min(1).max(5000), example: z.string().max(5000).optional().nullable() });

router.post('/auth/register', asyncRoute(async (req, res) => {
  const data = z.object({ name: z.string().trim().min(1).max(100), email: z.email(), password: z.string().min(8).max(72) }).parse(req.body);
  const [existing] = await pool.execute('SELECT id FROM users WHERE email = ?', [data.email.toLowerCase()]);
  if ((existing as unknown[]).length) { res.status(409).json({ error: 'Email đã được sử dụng.' }); return; }
  const hash = await bcrypt.hash(data.password, 12);
  const [result] = await pool.execute('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)', [data.name, data.email.toLowerCase(), hash]);
  const user = { id: Number((result as { insertId: number }).insertId), name: data.name, email: data.email.toLowerCase() };
  res.status(201).json({ token: signToken(user), user });
}));

router.post('/auth/login', asyncRoute(async (req, res) => {
  const data = z.object({ email: z.email(), password: z.string().min(1).max(72) }).parse(req.body);
  const [rows] = await pool.execute('SELECT id, name, email, password_hash AS passwordHash FROM users WHERE email = ?', [data.email.toLowerCase()]);
  const row = (rows as Array<{id:number;name:string;email:string;passwordHash:string}>)[0];
  if (!row || !(await bcrypt.compare(data.password, row.passwordHash))) { res.status(401).json({ error: 'Email hoặc mật khẩu không đúng.' }); return; }
  const user = { id: row.id, name: row.name, email: row.email };
  res.json({ token: signToken(user), user });
}));

router.get('/me', auth, asyncRoute(async (req, res) => {
  const [rows] = await pool.execute('SELECT id, name, email, created_at AS createdAt FROM users WHERE id = ?', [userId(req)]);
  res.json((rows as unknown[])[0] ?? null);
}));

router.get('/decks', auth, asyncRoute(async (req, res) => {
  const [rows] = await pool.execute(`SELECT d.id, d.name, d.description, d.color, d.created_at AS createdAt,
    COUNT(c.id) AS cardCount, SUM(c.due_at <= UTC_TIMESTAMP()) AS dueCount
    FROM decks d LEFT JOIN cards c ON c.deck_id = d.id WHERE d.user_id = ? GROUP BY d.id ORDER BY d.created_at DESC`, [userId(req)]);
  res.json(rows);
}));
router.post('/decks', auth, asyncRoute(async (req, res) => {
  const d = deckSchema.parse(req.body);
  const [result] = await pool.execute('INSERT INTO decks (user_id, name, description, color) VALUES (?, ?, ?, ?)', [userId(req), d.name, d.description, d.color]);
  res.status(201).json({ id: Number((result as {insertId:number}).insertId), ...d, cardCount: 0, dueCount: 0 });
}));
router.patch('/decks/:deckId', auth, asyncRoute(async (req, res) => {
  const d = deckSchema.partial().parse(req.body);
  const [result] = await pool.execute('UPDATE decks SET name = COALESCE(?, name), description = COALESCE(?, description), color = COALESCE(?, color) WHERE id = ? AND user_id = ?', [d.name ?? null, d.description ?? null, d.color ?? null, routeParam(req.params.deckId), userId(req)]);
  if (!(result as {affectedRows:number}).affectedRows) { res.status(404).json({error:'Không tìm thấy bộ từ.'}); return; }
  res.json({ok:true});
}));
router.delete('/decks/:deckId', auth, asyncRoute(async (req, res) => {
  const [result] = await pool.execute('DELETE FROM decks WHERE id = ? AND user_id = ?', [routeParam(req.params.deckId), userId(req)]);
  if (!(result as {affectedRows:number}).affectedRows) { res.status(404).json({error:'Không tìm thấy bộ từ.'}); return; }
  res.status(204).end();
}));

async function ownedDeck(deckId: string, uid: number): Promise<boolean> {
  const [rows] = await pool.execute('SELECT id FROM decks WHERE id = ? AND user_id = ?', [deckId, uid]);
  return (rows as unknown[]).length > 0;
}
router.get('/decks/:deckId/cards', auth, asyncRoute(async (req, res) => {
  if (!await ownedDeck(routeParam(req.params.deckId), userId(req))) { res.status(404).json({error:'Không tìm thấy bộ từ.'}); return; }
  const [rows] = await pool.execute(`SELECT id, deck_id AS deckId, front, back, example, interval_days AS intervalDays, repetitions, ease_factor AS easeFactor, due_at AS dueAt FROM cards WHERE deck_id = ? ORDER BY front`, [routeParam(req.params.deckId)]);
  res.json(rows);
}));
router.post('/decks/:deckId/cards', auth, asyncRoute(async (req, res) => {
  if (!await ownedDeck(routeParam(req.params.deckId), userId(req))) { res.status(404).json({error:'Không tìm thấy bộ từ.'}); return; }
  const d = cardSchema.parse(req.body);
  const [result] = await pool.execute('INSERT INTO cards (deck_id, front, back, example) VALUES (?, ?, ?, ?)', [routeParam(req.params.deckId), d.front, d.back, d.example ?? null]);
  res.status(201).json({id:Number((result as {insertId:number}).insertId), deckId:Number(routeParam(req.params.deckId)), ...d, intervalDays:0, repetitions:0, easeFactor:2.5});
}));
router.patch('/cards/:cardId', auth, asyncRoute(async (req, res) => {
  const d = cardSchema.partial().parse(req.body);
  const [result] = await pool.execute(`UPDATE cards c JOIN decks d ON d.id=c.deck_id SET c.front=COALESCE(?,c.front), c.back=COALESCE(?,c.back), c.example=COALESCE(?,c.example) WHERE c.id=? AND d.user_id=?`, [d.front ?? null,d.back ?? null,d.example ?? null,routeParam(req.params.cardId),userId(req)]);
  if (!(result as {affectedRows:number}).affectedRows) { res.status(404).json({error:'Không tìm thấy từ.'}); return; }
  res.json({ok:true});
}));
router.delete('/cards/:cardId', auth, asyncRoute(async (req, res) => {
  const [result] = await pool.execute('DELETE c FROM cards c JOIN decks d ON d.id=c.deck_id WHERE c.id=? AND d.user_id=?', [routeParam(req.params.cardId),userId(req)]);
  if (!(result as {affectedRows:number}).affectedRows) { res.status(404).json({error:'Không tìm thấy từ.'}); return; }
  res.status(204).end();
}));

router.get('/study/due', auth, asyncRoute(async (req, res) => {
  const deck = req.query.deckId ? ' AND d.id = ?' : '';
  const values: Array<string | number> = req.query.deckId ? [userId(req), Number(req.query.deckId)] : [userId(req)];
  const [rows] = await pool.execute(`SELECT c.id,c.deck_id AS deckId,c.front,c.back,c.example,c.interval_days AS intervalDays,c.repetitions,c.ease_factor AS easeFactor,c.due_at AS dueAt FROM cards c JOIN decks d ON d.id=c.deck_id WHERE d.user_id=? AND c.due_at<=UTC_TIMESTAMP()${deck} ORDER BY c.due_at LIMIT 100`, values);
  res.json(rows);
}));
router.post('/study/:cardId/review', auth, asyncRoute(async (req, res) => {
  const { rating } = z.object({rating:z.number().int().min(0).max(3)}).parse(req.body);
  const [rows] = await pool.execute(`SELECT c.id,c.interval_days AS intervalDays,c.repetitions,c.ease_factor AS easeFactor FROM cards c JOIN decks d ON d.id=c.deck_id WHERE c.id=? AND d.user_id=?`, [routeParam(req.params.cardId),userId(req)]);
  const card = (rows as Array<{id:number;intervalDays:number;repetitions:number;easeFactor:number}>)[0];
  if (!card) { res.status(404).json({error:'Không tìm thấy từ.'}); return; }
  const schedule = scheduleReview(rating, card.repetitions, card.intervalDays, card.easeFactor);
  const conn = await pool.getConnection();
  try { await conn.beginTransaction();
    await conn.execute('UPDATE cards SET interval_days=?, repetitions=?, ease_factor=?, due_at=DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? DAY) WHERE id=?', [schedule.intervalDays,schedule.repetitions,schedule.easeFactor,schedule.intervalDays,card.id]);
    await conn.execute('INSERT INTO reviews (card_id,user_id,rating) VALUES (?,?,?)', [card.id,userId(req),rating]);
    await conn.commit();
  } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
  res.json(schedule);
}));

router.get('/stats', auth, asyncRoute(async (req, res) => {
  const uid = userId(req);
  const [summaryRows] = await pool.execute(`SELECT COUNT(DISTINCT d.id) AS deckCount, COUNT(c.id) AS cardCount, SUM(c.due_at<=UTC_TIMESTAMP()) AS dueCount FROM decks d LEFT JOIN cards c ON c.deck_id=d.id WHERE d.user_id=?`,[uid]);
  const [todayRows] = await pool.execute(`SELECT COUNT(*) AS reviewedToday FROM reviews WHERE user_id=? AND reviewed_at>=UTC_DATE()`,[uid]);
  const [days] = await pool.execute(`SELECT DATE(reviewed_at) AS day, COUNT(*) AS count FROM reviews WHERE user_id=? AND reviewed_at>=DATE_SUB(UTC_DATE(), INTERVAL 6 DAY) GROUP BY DATE(reviewed_at) ORDER BY day`,[uid]);
  const summary = (summaryRows as Array<{deckCount:number;cardCount:number;dueCount:number|null}>)[0]!;
  const today = (todayRows as Array<{reviewedToday:number}>)[0]!;
  res.json({...summary, dueCount:summary.dueCount ?? 0, ...today, last7Days:days});
}));

router.get('/decks/:deckId/export.csv', auth, asyncRoute(async (req, res) => {
  const deckId = routeParam(req.params.deckId);
  if (!await ownedDeck(deckId,userId(req))) { res.status(404).json({error:'Không tìm thấy bộ từ.'}); return; }
  const [rows] = await pool.execute('SELECT front,back,example FROM cards WHERE deck_id=? ORDER BY front',[deckId]);
  const csv = stringify(rows as Array<Record<string,string|null>>, {header:true,columns:['front','back','example']});
  res.type('text/csv; charset=utf-8').attachment(`vocabup-deck-${deckId}.csv`).send('\uFEFF'+csv);
}));
router.post('/decks/:deckId/import.csv', auth, asyncRoute(async (req, res) => {
  const deckId = routeParam(req.params.deckId);
  if (!await ownedDeck(deckId,userId(req))) { res.status(404).json({error:'Không tìm thấy bộ từ.'}); return; }
  const csv = typeof req.body?.csv === 'string' ? req.body.csv : '';
  if (!csv || csv.length > 1_000_000) { res.status(400).json({error:'CSV trống hoặc vượt quá 1 MB.'}); return; }
  const records = parse(csv.replace(/^\uFEFF/,''), {columns:true,skip_empty_lines:true,trim:true,bom:true}) as Array<Record<string,string>>;
  if (!records.length) { res.status(400).json({error:'CSV cần có tiêu đề front, back và các dòng dữ liệu.'}); return; }
  const normalized = records.map((row:Record<string,string>)=>({front:row.front ?? row.term ?? '',back:row.back ?? row.translation ?? '',example:row.example ?? ''}));
  if (normalized.some((r:{front:string;back:string})=>!r.front||!r.back)) { res.status(400).json({error:'Mỗi dòng cần có front/back (hoặc term/translation).'}); return; }
  const conn = await pool.getConnection();
  try { await conn.beginTransaction(); for (const row of normalized) await conn.execute('INSERT INTO cards (deck_id,front,back,example) VALUES (?,?,?,?)',[deckId,row.front,row.back,row.example||null]); await conn.commit(); }
  catch(error){await conn.rollback();throw error;} finally {conn.release();}
  res.status(201).json({imported:normalized.length});
}));
