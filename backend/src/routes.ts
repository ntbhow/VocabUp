import { raw, Router } from 'express';
import bcrypt from 'bcryptjs';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { pool } from './db.js';
import { authenticate, signToken } from './auth.js';
import type { AuthRequest } from './types.js';
import { scheduleReview } from './srs.js';
import { ApkgImportError, parseApkg } from './apkg.js';
import { DEFAULT_DAILY_NEW_LIMIT } from './config.js';
import { buildStudyQueue, remainingNewQuota } from './study-queue.js';

export const router = Router();
const sessionCookie = (token: string) => {
  const expiresAt = (jwt.decode(token) as jwt.JwtPayload | null)?.exp ?? Math.floor(Date.now() / 1000);
  const maxAge = Math.max(0, expiresAt - Math.floor(Date.now() / 1000));
  return `vocabup_session=${encodeURIComponent(token)}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
};
const positiveId = (value: string) => /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value));
router.param('deckId', (req, res, next, value) => { if (!positiveId(String(value))) { res.status(400).json({ error: 'ID bộ từ không hợp lệ.' }); return; } next(); });
router.param('cardId', (req, res, next, value) => { if (!positiveId(String(value))) { res.status(400).json({ error: 'ID từ vựng không hợp lệ.' }); return; } next(); });
const asyncRoute = (fn: (req: AuthRequest, res: import('express').Response) => Promise<unknown>) => (req: AuthRequest, res: import('express').Response, next: import('express').NextFunction) => { void fn(req, res).catch(next); };
const auth = authenticate;
const userId = (req: AuthRequest) => req.user!.id;
const routeParam = (value: string | string[] | undefined): string => Array.isArray(value) ? value[0] ?? '' : value ?? '';
const deckSchema = z.object({ name: z.string().trim().min(1).max(120), description: z.string().max(500).optional().default(''), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().default('#6c63ff'), dailyNewLimit: z.number().int().min(0).max(500).optional().default(DEFAULT_DAILY_NEW_LIMIT) });
const cardSchema = z.object({ front: z.string().trim().min(1).max(500), back: z.string().trim().min(1).max(5000), pronunciation: z.string().max(500).optional().default(''), translation: z.string().max(5000).optional().default(''), example: z.string().max(5000).optional().nullable() });

router.post('/auth/register', asyncRoute(async (req, res) => {
  const data = z.object({ name: z.string().trim().min(1).max(100), email: z.email(), password: z.string().min(8).max(72) }).parse(req.body);
  const [existing] = await pool.execute('SELECT id FROM users WHERE email = ?', [data.email.toLowerCase()]);
  if ((existing as unknown[]).length) { res.status(409).json({ error: 'Email đã được sử dụng.' }); return; }
  const hash = await bcrypt.hash(data.password, 12);
  const [result] = await pool.execute('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)', [data.name, data.email.toLowerCase(), hash]);
  const user = { id: Number((result as { insertId: number }).insertId), name: data.name, email: data.email.toLowerCase() };
  res.setHeader('Set-Cookie', sessionCookie(signToken(user)));
  res.status(201).json({ user });
}));

router.post('/auth/login', asyncRoute(async (req, res) => {
  const data = z.object({ email: z.email(), password: z.string().min(1).max(72) }).parse(req.body);
  const [rows] = await pool.execute('SELECT id, name, email, password_hash AS passwordHash FROM users WHERE email = ?', [data.email.toLowerCase()]);
  const row = (rows as Array<{id:number;name:string;email:string;passwordHash:string}>)[0];
  if (!row || !(await bcrypt.compare(data.password, row.passwordHash))) { res.status(401).json({ error: 'Email hoặc mật khẩu không đúng.' }); return; }
  const user = { id: row.id, name: row.name, email: row.email };
  res.setHeader('Set-Cookie', sessionCookie(signToken(user)));
  res.json({ user });
}));

router.post('/auth/logout', (_req, res) => {
  res.setHeader('Set-Cookie', `vocabup_session=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
  res.status(204).end();
});

router.get('/me', auth, asyncRoute(async (req, res) => {
  const [rows] = await pool.execute('SELECT id, name, email, created_at AS createdAt FROM users WHERE id = ?', [userId(req)]);
  res.json((rows as unknown[])[0] ?? null);
}));

router.get('/decks', auth, asyncRoute(async (req, res) => {
  const [rows] = await pool.execute(`SELECT d.id, d.name, d.description, d.color, d.daily_new_limit AS dailyNewLimit, d.created_at AS createdAt,
    COUNT(c.id) AS cardCount, SUM(CASE WHEN c.id IS NOT NULL AND c.due_at <= UTC_TIMESTAMP() AND (c.repetitions>0 OR EXISTS (SELECT 1 FROM reviews r WHERE r.card_id=c.id)) THEN 1 ELSE 0 END) AS dueCount
    FROM decks d LEFT JOIN cards c ON c.deck_id = d.id WHERE d.user_id = ? GROUP BY d.id ORDER BY d.created_at DESC`, [userId(req)]);
  res.json(rows);
}));
router.post('/decks', auth, asyncRoute(async (req, res) => {
  const d = deckSchema.parse(req.body);
  const [result] = await pool.execute('INSERT INTO decks (user_id, name, description, color, daily_new_limit) VALUES (?, ?, ?, ?, ?)', [userId(req), d.name, d.description, d.color, d.dailyNewLimit]);
  res.status(201).json({ id: Number((result as {insertId:number}).insertId), ...d, cardCount: 0, dueCount: 0 });
}));
router.patch('/decks/:deckId', auth, asyncRoute(async (req, res) => {
  const d = deckSchema.partial().parse(req.body);
  const [result] = await pool.execute('UPDATE decks SET name = COALESCE(?, name), description = COALESCE(?, description), color = COALESCE(?, color), daily_new_limit = COALESCE(?, daily_new_limit) WHERE id = ? AND user_id = ?', [d.name ?? null, d.description ?? null, d.color ?? null, d.dailyNewLimit ?? null, routeParam(req.params.deckId), userId(req)]);
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
  const [rows] = await pool.execute(`SELECT id, deck_id AS deckId, front, back, pronunciation, translation, example, interval_days AS intervalDays, repetitions, ease_factor AS easeFactor, due_at AS dueAt FROM cards WHERE deck_id = ? ORDER BY front`, [routeParam(req.params.deckId)]);
  res.json(rows);
}));
router.post('/decks/:deckId/cards', auth, asyncRoute(async (req, res) => {
  if (!await ownedDeck(routeParam(req.params.deckId), userId(req))) { res.status(404).json({error:'Không tìm thấy bộ từ.'}); return; }
  const d = cardSchema.parse(req.body);
  const [result] = await pool.execute('INSERT INTO cards (deck_id, front, back, pronunciation, translation, example) VALUES (?, ?, ?, ?, ?, ?)', [routeParam(req.params.deckId), d.front, d.back, d.pronunciation, d.translation, d.example ?? null]);
  res.status(201).json({id:Number((result as {insertId:number}).insertId), deckId:Number(routeParam(req.params.deckId)), ...d, intervalDays:0, repetitions:0, easeFactor:2.5});
}));
router.patch('/cards/:cardId', auth, asyncRoute(async (req, res) => {
  const d = cardSchema.partial().parse(req.body);
  const [result] = await pool.execute(`UPDATE cards c JOIN decks d ON d.id=c.deck_id SET c.front=COALESCE(?,c.front), c.back=COALESCE(?,c.back), c.pronunciation=COALESCE(?,c.pronunciation), c.translation=COALESCE(?,c.translation), c.example=COALESCE(?,c.example) WHERE c.id=? AND d.user_id=?`, [d.front ?? null,d.back ?? null,d.pronunciation ?? null,d.translation ?? null,d.example ?? null,routeParam(req.params.cardId),userId(req)]);
  if (!(result as {affectedRows:number}).affectedRows) { res.status(404).json({error:'Không tìm thấy từ.'}); return; }
  res.json({ok:true});
}));
router.delete('/cards/:cardId', auth, asyncRoute(async (req, res) => {
  const [result] = await pool.execute('DELETE c FROM cards c JOIN decks d ON d.id=c.deck_id WHERE c.id=? AND d.user_id=?', [routeParam(req.params.cardId),userId(req)]);
  if (!(result as {affectedRows:number}).affectedRows) { res.status(404).json({error:'Không tìm thấy từ.'}); return; }
  res.status(204).end();
}));

router.get('/study/due', auth, asyncRoute(async (req, res) => {
  if (req.query.deckId !== undefined && (typeof req.query.deckId !== 'string' || !positiveId(req.query.deckId))) { res.status(400).json({ error: 'ID bộ từ không hợp lệ.' }); return; }
  const uid = userId(req);
  const deckFilter = req.query.deckId ? ' AND id=?' : '';
  const deckValues: Array<string | number> = req.query.deckId ? [uid, Number(req.query.deckId)] : [uid];
  const [deckRows] = await pool.execute(`SELECT id, daily_new_limit AS dailyNewLimit FROM decks WHERE user_id=?${deckFilter}`, deckValues);
  const targetDecks = deckRows as Array<{ id: number; dailyNewLimit: number }>;
  if (req.query.deckId && !targetDecks.length) { res.status(404).json({ error: 'Không tìm thấy bộ từ.' }); return; }
  const reviewCards: Array<{ dueAt: unknown; [key: string]: unknown }> = [];
  const newCards: Array<{ dueAt: unknown; [key: string]: unknown }> = [];
  for (const deck of targetDecks) {
    const [countRows] = await pool.execute(`SELECT COUNT(DISTINCT r.card_id) AS studiedToday FROM reviews r JOIN cards c ON c.id=r.card_id WHERE c.deck_id=? AND r.user_id=? AND DATE(r.reviewed_at)=UTC_DATE() AND r.reviewed_at=(SELECT MIN(r2.reviewed_at) FROM reviews r2 WHERE r2.card_id=r.card_id)`, [deck.id, uid]);
    const studiedToday = Number((countRows as Array<{ studiedToday: number }>)[0]?.studiedToday ?? 0);
    const remainingNew = remainingNewQuota(Number(deck.dailyNewLimit), studiedToday);
    const select = `SELECT c.id,c.deck_id AS deckId,c.front,c.back,c.pronunciation,c.translation,c.example,c.interval_days AS intervalDays,c.repetitions,c.ease_factor AS easeFactor,c.due_at AS dueAt FROM cards c JOIN decks d ON d.id=c.deck_id WHERE d.user_id=? AND c.deck_id=? AND c.due_at<=UTC_TIMESTAMP()`;
    const [reviewRows] = await pool.execute(`${select} AND (c.repetitions>0 OR EXISTS (SELECT 1 FROM reviews r WHERE r.card_id=c.id)) ORDER BY c.due_at`, [uid, deck.id]);
    reviewCards.push(...reviewRows as Array<{ dueAt: unknown; [key: string]: unknown }>);
    if (remainingNew > 0) {
      const [newRows] = await pool.execute(`${select} AND c.repetitions=0 AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.card_id=c.id) ORDER BY c.due_at LIMIT ?`, [uid, deck.id, remainingNew]);
      newCards.push(...newRows as Array<{ dueAt: unknown; [key: string]: unknown }>);
    }
  }
  res.json(buildStudyQueue(reviewCards,newCards));
}));
router.post('/study/:cardId/review', auth, asyncRoute(async (req, res) => {
  const { rating } = z.object({rating:z.number().int().min(0).max(3)}).parse(req.body);
  const [rows] = await pool.execute(`SELECT c.id,c.interval_days AS intervalDays,c.repetitions,c.ease_factor AS easeFactor FROM cards c JOIN decks d ON d.id=c.deck_id WHERE c.id=? AND d.user_id=?`, [routeParam(req.params.cardId),userId(req)]);
  const card = (rows as Array<{id:number;intervalDays:number;repetitions:number;easeFactor:number}>)[0];
  if (!card) { res.status(404).json({error:'Không tìm thấy từ.'}); return; }
  const schedule = scheduleReview(rating, card.repetitions, card.intervalDays, card.easeFactor);
  const conn = await pool.getConnection();
  try { await conn.beginTransaction();
    await conn.execute('UPDATE cards SET interval_days=?, repetitions=?, ease_factor=?, due_at=DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? MINUTE) WHERE id=?', [Math.ceil(schedule.intervalDays),schedule.repetitions,schedule.easeFactor,schedule.intervalMinutes,card.id]);
    await conn.execute('INSERT INTO reviews (card_id,user_id,rating) VALUES (?,?,?)', [card.id,userId(req),rating]);
    await conn.commit();
  } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
  res.json(schedule);
}));

router.get('/stats', auth, asyncRoute(async (req, res) => {
  const uid = userId(req);
  const [summaryRows] = await pool.execute(`SELECT COUNT(DISTINCT d.id) AS deckCount, COUNT(c.id) AS cardCount, SUM(CASE WHEN c.id IS NOT NULL AND c.due_at<=UTC_TIMESTAMP() AND (c.repetitions>0 OR EXISTS (SELECT 1 FROM reviews r WHERE r.card_id=c.id)) THEN 1 ELSE 0 END) AS dueCount FROM decks d LEFT JOIN cards c ON c.deck_id=d.id WHERE d.user_id=?`,[uid]);
  const [todayRows] = await pool.execute(`SELECT COUNT(*) AS reviewedToday FROM reviews WHERE user_id=? AND reviewed_at>=UTC_DATE()`,[uid]);
  const [days] = await pool.execute(`SELECT DATE(reviewed_at) AS day, COUNT(*) AS count FROM reviews WHERE user_id=? AND reviewed_at>=DATE_SUB(UTC_DATE(), INTERVAL 6 DAY) GROUP BY DATE(reviewed_at) ORDER BY day`,[uid]);
  const summary = (summaryRows as Array<{deckCount:number;cardCount:number;dueCount:number|null}>)[0]!;
  const today = (todayRows as Array<{reviewedToday:number}>)[0]!;
  res.json({...summary, dueCount:summary.dueCount ?? 0, ...today, last7Days:days});
}));

router.get('/decks/:deckId/export.csv', auth, asyncRoute(async (req, res) => {
  const deckId = routeParam(req.params.deckId);
  if (!await ownedDeck(deckId,userId(req))) { res.status(404).json({error:'Không tìm thấy bộ từ.'}); return; }
  const [rows] = await pool.execute('SELECT front,back,pronunciation,translation,example FROM cards WHERE deck_id=? ORDER BY front',[deckId]);
  const csv = stringify(rows as Array<Record<string,string|null>>, {header:true,columns:['front','back','pronunciation','translation','example']});
  res.type('text/csv; charset=utf-8').attachment(`vocabup-deck-${deckId}.csv`).send('\uFEFF'+csv);
}));
router.post('/decks/:deckId/import.csv', auth, asyncRoute(async (req, res) => {
  const deckId = routeParam(req.params.deckId);
  if (!await ownedDeck(deckId,userId(req))) { res.status(404).json({error:'Không tìm thấy bộ từ.'}); return; }
  const csv = typeof req.body?.csv === 'string' ? req.body.csv : '';
  if (!csv || csv.length > 1_000_000) { res.status(400).json({error:'CSV trống hoặc vượt quá 1 MB.'}); return; }
  const records = parse(csv.replace(/^\uFEFF/,''), {columns:true,skip_empty_lines:true,trim:true,bom:true}) as Array<Record<string,string>>;
  if (!records.length) { res.status(400).json({error:'CSV cần có tiêu đề front, back và các dòng dữ liệu.'}); return; }
  const normalized = records.map((row:Record<string,string>)=>({front:row.front ?? row.term ?? '',back:row.back ?? row.translation ?? '',pronunciation:row.pronunciation ?? row.phonetic ?? '',translation:row.back ? (row.translation ?? row.vietnamese ?? '') : (row.vietnamese ?? ''),example:row.example ?? ''}));
  if (normalized.some((r:{front:string;back:string})=>!r.front||!r.back)) { res.status(400).json({error:'Mỗi dòng cần có front/back (hoặc term/translation).'}); return; }
  if (normalized.length > 5000 || normalized.some((r:{front:string;back:string;pronunciation:string;translation:string;example:string})=>r.front.length>500||r.back.length>5000||r.pronunciation.length>500||r.translation.length>5000||r.example.length>5000)) { res.status(400).json({error:'Dữ liệu CSV vượt giới hạn cho phép.'}); return; }
  const conn = await pool.getConnection();
  try { await conn.beginTransaction(); for (const row of normalized) await conn.execute('INSERT INTO cards (deck_id,front,back,pronunciation,translation,example) VALUES (?,?,?,?,?,?)',[deckId,row.front,row.back,row.pronunciation,row.translation,row.example||null]); await conn.commit(); }
  catch(error){await conn.rollback();throw error;} finally {conn.release();}
  res.status(201).json({imported:normalized.length});
}));

router.post('/decks/:deckId/import.apkg', auth, raw({ type: 'application/octet-stream', limit: '50mb' }), asyncRoute(async (req, res) => {
  const deckId = routeParam(req.params.deckId);
  if (!await ownedDeck(deckId, userId(req))) { res.status(404).json({ error: 'Không tìm thấy bộ từ.' }); return; }
  if (!Buffer.isBuffer(req.body) || !req.body.length) { res.status(400).json({ error: 'File APKG bị trống hoặc không hợp lệ.' }); return; }
  let parsed;
  try { parsed = await parseApkg(req.body); }
  catch (error) { if (error instanceof ApkgImportError) { res.status(400).json({ error: error.message }); return; } throw error; }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [deckRows] = await conn.execute('SELECT daily_new_limit AS dailyNewLimit FROM decks WHERE id=? AND user_id=? FOR UPDATE', [deckId, userId(req)]);
    const storedLimit = (deckRows as Array<{ dailyNewLimit: number | string | null }>)[0]?.dailyNewLimit;
    const numericLimit = storedLimit === null || storedLimit === undefined || storedLimit === '' ? Number.NaN : Number(storedLimit);
    // Anki deck limits are not imported; initialize only a missing/invalid VocabUp
    // value and preserve every valid user setting, including 0 (disabled).
    if (!Number.isInteger(numericLimit) || numericLimit < 0 || numericLimit > 500) {
      await conn.execute('UPDATE decks SET daily_new_limit=? WHERE id=? AND user_id=?', [DEFAULT_DAILY_NEW_LIMIT, deckId, userId(req)]);
    }
    for (const card of parsed.cards) {
      const [existing] = await conn.execute('SELECT id FROM cards WHERE deck_id=? AND front=? LIMIT 1', [deckId, card.front]);
      const id = (existing as Array<{ id: number }>)[0]?.id;
      if (id) await conn.execute('UPDATE cards SET back=?, pronunciation=?, translation=?, example=? WHERE id=?', [card.back, card.pronunciation, card.translation, card.example, id]);
      else await conn.execute('INSERT INTO cards (deck_id, front, back, pronunciation, translation, example, interval_days, repetitions, ease_factor, due_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, UTC_TIMESTAMP()))', [deckId, card.front, card.back, card.pronunciation, card.translation, card.example, card.intervalDays, card.repetitions, card.easeFactor, card.dueAt]);
    }
    await conn.commit();
  } catch (error) { await conn.rollback(); throw error; }
  finally { conn.release(); }
  res.status(201).json({ imported: parsed.cards.length, skipped: parsed.skipped, media: 'audio and images are not imported' });
}));
