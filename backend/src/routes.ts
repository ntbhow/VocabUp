import { raw, Router } from 'express';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { stringify } from 'csv-stringify/sync';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { pool } from './db.js';
import { authenticate, signToken, requireAdmin } from './auth.js';
import { adminRouter } from './admin.js';
import { clientIp, recordActivity, touchUserActivity } from './activity.js';
import type { AuthRequest } from './types.js';
import { scheduleReview } from './srs.js';
import { ApkgImportError, parseApkgFile } from './apkg.js';
import { ImageProviderError, findImageForCard, imageProviderStatus, searchImages, suggestImageForCard } from './image-provider.js';
import { resolveImageSense } from './image-semantics.js';
import { startImageJob, getImageJob } from './image-jobs.js';
import { cardImageFields, clearCardImage, imageColumns, setCardImage } from './image-store.js';
import { removeStoredImage } from './image-download.js';
import { storePreview, takePreview, type PreviewCard } from './import-preview.js';
import { analyze, deckLearning, getPreferences, learningActivity, learningDecks, learningOverview, resolveRange, savePreferences } from './stats.js';
import { ImageUploadError, saveUploadedImage } from './uploads.js';
import { CsvImportError, parseCsvCards, parseCsvFile } from './csv-import.js';
import { contentLengthExceeds, receiveToTempFile, UploadLimitError, UploadTimeoutError, withTimeoutReject } from './upload-stream.js';
import {
  APKG_MAX_BYTES, APKG_MAX_DATABASE_BYTES, APKG_MAX_ENTRIES, APKG_MAX_NOTES, APKG_PARSE_TIMEOUT_MS,
  CSV_MAX_BYTES, CSV_PARSE_TIMEOUT_MS, DEFAULT_DAILY_NEW_LIMIT, UPLOAD_LIMITS, UPLOAD_TMP_DIR,
} from './config.js';
import { buildStudyQueue, remainingNewQuota } from './study-queue.js';
import { SQL_TODAY, STUDY_TIME_ZONE, shiftDateKey, sqlStudyDay, studyDateKey, studyDayStart, toDateKey } from './timezone.js';

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
// Provider-backed endpoints are rate limited separately: one batch job already
// throttles its own upstream calls, but manual searches must not be spammed.
const imageLimit = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false });
/** Image uploads are buffered in memory with a dedicated, configurable cap. */
const imageUploadParser = raw({ type: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/octet-stream'], limit: `${UPLOAD_LIMITS.imageMaxMB}mb` });
const routeParam = (value: string | string[] | undefined): string => Array.isArray(value) ? value[0] ?? '' : value ?? '';
const positiveIntParam = (value: unknown, fallback: number, max: number): number => {
  const n = Number(Array.isArray(value) ? value[0] : value);
  if (!Number.isInteger(n) || n < 0) return fallback;
  return Math.min(max, n);
};
const deckSchema = z.object({ name: z.string().trim().min(1).max(120), description: z.string().max(500).optional().default(''), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().default('#6c63ff'), dailyNewLimit: z.number().int().min(0).max(500).optional().default(DEFAULT_DAILY_NEW_LIMIT), isPublic: z.boolean().optional() });
const cardSchema = z.object({ front: z.string().trim().min(1).max(500), back: z.string().trim().min(1).max(5000), pronunciation: z.string().max(500).optional().default(''), translation: z.string().max(5000).optional().default(''), example: z.string().max(5000).optional().nullable() });

router.post('/auth/register', asyncRoute(async (req, res) => {
  const data = z.object({ name: z.string().trim().min(1).max(100), email: z.email(), password: z.string().min(8).max(72) }).parse(req.body);
  const [existing] = await pool.execute('SELECT id FROM users WHERE email = ?', [data.email.toLowerCase()]);
  if ((existing as unknown[]).length) { res.status(409).json({ error: 'Email đã được sử dụng.' }); return; }
  const hash = await bcrypt.hash(data.password, 12);
  // `role`/`status` are never taken from the request body: new accounts are always plain users.
  const [result] = await pool.execute("INSERT INTO users (name, email, password_hash, role, status) VALUES (?, ?, ?, 'user', 'active')", [data.name, data.email.toLowerCase(), hash]);
  const user = { id: Number((result as { insertId: number }).insertId), name: data.name, email: data.email.toLowerCase(), role: 'user' as const };
  res.setHeader('Set-Cookie', sessionCookie(signToken(user)));
  await touchUserActivity(user.id);
  await recordActivity({ actorUserId: user.id, actorRole: 'user', action: 'auth.register', targetType: 'user', targetId: user.id, ip: clientIp(req) });
  res.status(201).json({ user });
}));

router.post('/auth/login', asyncRoute(async (req, res) => {
  const data = z.object({ email: z.email(), password: z.string().min(1).max(72) }).parse(req.body);
  const [rows] = await pool.execute('SELECT id, name, email, password_hash AS passwordHash, role, status FROM users WHERE email = ?', [data.email.toLowerCase()]);
  const row = (rows as Array<{ id: number; name: string; email: string; passwordHash: string; role: 'user' | 'admin'; status: 'active' | 'locked' }>)[0];
  if (!row || !(await bcrypt.compare(data.password, row.passwordHash))) { res.status(401).json({ error: 'Email hoặc mật khẩu không đúng.' }); return; }
  if (row.status !== 'active') { res.status(403).json({ error: 'Tài khoản đã bị khóa. Vui lòng liên hệ quản trị viên.' }); return; }
  const user = { id: row.id, name: row.name, email: row.email, role: row.role };
  res.setHeader('Set-Cookie', sessionCookie(signToken(user)));
  await touchUserActivity(row.id);
  await recordActivity({ actorUserId: row.id, actorRole: row.role, action: 'auth.login', targetType: 'user', targetId: row.id, ip: clientIp(req) });
  res.json({ user });
}));

router.post('/auth/logout', asyncRoute(async (req, res) => {
  const cookieHeader = req.headers.cookie ?? '';
  const token = cookieHeader.split(';').map(part => part.trim()).find(part => part.startsWith('vocabup_session='))?.slice('vocabup_session='.length);
  if (token) {
    try {
      const payload = jwt.verify(decodeURIComponent(token), process.env.JWT_SECRET ?? '', { algorithms: ['HS256'], issuer: 'vocabup-api', audience: 'vocabup-web' }) as jwt.JwtPayload;
      const id = Number(payload.sub);
      if (Number.isSafeInteger(id) && id > 0) {
        await recordActivity({ actorUserId: id, actorRole: null, action: 'auth.logout', targetType: 'user', targetId: id, ip: clientIp(req) });
      }
    } catch { /* logout must succeed even with an expired or invalid token */ }
  }
  res.setHeader('Set-Cookie', `vocabup_session=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
  res.status(204).end();
}));

router.get('/me', auth, asyncRoute(async (req, res) => {
  const [rows] = await pool.execute('SELECT id, name, email, role, created_at AS createdAt FROM users WHERE id = ?', [userId(req)]);
  res.json((rows as unknown[])[0] ?? null);
}));

/**
 * Shared projection for the owner's deck list. `is_favorite` is a per-deck flag
 * on the deck row (each deck has exactly one owner), so a separate favourites
 * join table is unnecessary; a user's favourites are their own flagged decks.
 */
async function deckRowsFor(uid: number, favoritesOnly: boolean) {
  const filter = favoritesOnly ? ' AND d.is_favorite = 1' : '';
  const [rows] = await pool.execute(`SELECT d.id, d.name, d.description, d.color, d.daily_new_limit AS dailyNewLimit, d.is_public AS isPublic, d.is_favorite AS isFavorite, d.created_at AS createdAt,
    COUNT(c.id) AS cardCount, SUM(CASE WHEN c.id IS NOT NULL AND c.due_at <= UTC_TIMESTAMP() AND (c.repetitions>0 OR EXISTS (SELECT 1 FROM reviews r WHERE r.card_id=c.id)) THEN 1 ELSE 0 END) AS dueCount
    FROM decks d LEFT JOIN cards c ON c.deck_id = d.id WHERE d.user_id = ?${filter} GROUP BY d.id ORDER BY d.created_at DESC`, [uid]);
  return (rows as Array<Record<string, unknown>>).map(row => ({ ...row, isPublic: Boolean(row.isPublic), isFavorite: Boolean(row.isFavorite) }));
}
router.get('/decks', auth, asyncRoute(async (req, res) => {
  res.json(await deckRowsFor(userId(req), false));
}));
router.get('/decks/favorites', auth, asyncRoute(async (req, res) => {
  res.json(await deckRowsFor(userId(req), true));
}));
router.post('/decks', auth, asyncRoute(async (req, res) => {
  const d = deckSchema.parse(req.body);
  const [result] = await pool.execute('INSERT INTO decks (user_id, name, description, color, daily_new_limit, is_public) VALUES (?, ?, ?, ?, ?, ?)', [userId(req), d.name, d.description, d.color, d.dailyNewLimit, d.isPublic ? 1 : 0]);
  const deckId = Number((result as {insertId:number}).insertId);
  await touchUserActivity(userId(req));
  await recordActivity({ actorUserId: userId(req), actorRole: req.user!.role, action: 'deck.create', targetType: 'deck', targetId: deckId, ip: clientIp(req), metadata: { name: d.name } });
  res.status(201).json({ id: deckId, ...d, isPublic: Boolean(d.isPublic), isFavorite: false, cardCount: 0, dueCount: 0 });
}));
router.patch('/decks/:deckId', auth, asyncRoute(async (req, res) => {
  const d = deckSchema.partial().parse(req.body);
  const [result] = await pool.execute('UPDATE decks SET name = COALESCE(?, name), description = COALESCE(?, description), color = COALESCE(?, color), daily_new_limit = COALESCE(?, daily_new_limit), is_public = COALESCE(?, is_public) WHERE id = ? AND user_id = ?', [d.name ?? null, d.description ?? null, d.color ?? null, d.dailyNewLimit ?? null, d.isPublic === undefined ? null : (d.isPublic ? 1 : 0), routeParam(req.params.deckId), userId(req)]);
  if (!(result as {affectedRows:number}).affectedRows) { res.status(404).json({error:'Không tìm thấy bộ từ.'}); return; }
  await touchUserActivity(userId(req));
  await recordActivity({ actorUserId: userId(req), actorRole: req.user!.role, action: 'deck.update', targetType: 'deck', targetId: Number(routeParam(req.params.deckId)), ip: clientIp(req) });
  res.json({ok:true});
}));
router.delete('/decks/:deckId', auth, asyncRoute(async (req, res) => {
  const [result] = await pool.execute('DELETE FROM decks WHERE id = ? AND user_id = ?', [routeParam(req.params.deckId), userId(req)]);
  if (!(result as {affectedRows:number}).affectedRows) { res.status(404).json({error:'Không tìm thấy bộ từ.'}); return; }
  await touchUserActivity(userId(req));
  await recordActivity({ actorUserId: userId(req), actorRole: req.user!.role, action: 'deck.delete', targetType: 'deck', targetId: Number(routeParam(req.params.deckId)), ip: clientIp(req) });
  res.status(204).end();
}));

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), ms); });
  return Promise.race([promise, timeout]).finally(() => { if (timer) clearTimeout(timer); });
}

async function ownedDeck(deckId: string, uid: number): Promise<boolean> {
  const [rows] = await pool.execute('SELECT id FROM decks WHERE id = ? AND user_id = ?', [deckId, uid]);
  return (rows as unknown[]).length > 0;
}

interface OwnedCard { id: number; deckId: number; front: string; back: string; translation: string; example: string | null; imageUrl: string | null }
async function ownedCard(cardId: number, uid: number): Promise<OwnedCard | null> {
  const [rows] = await pool.execute('SELECT c.id, c.deck_id AS deckId, c.front, c.back, c.translation, c.example, c.image_url AS imageUrl FROM cards c JOIN decks d ON d.id = c.deck_id WHERE c.id = ? AND d.user_id = ?', [cardId, uid]);
  return (rows as OwnedCard[])[0] ?? null;
}

function cardMeaningKey(front: string, translation: string, back: string): string {
  return `${front}\u0000${translation || back}`;
}

async function existingCardsFor(deckId: string, cards: Array<{ front: string; translation: string; back: string }>): Promise<Map<string, { id: number; hasImage: boolean }>> {
  const map = new Map<string, { id: number; hasImage: boolean }>();
  const unique = [...new Set(cards.map(card => card.front))].slice(0, 2000);
  for (let index = 0; index < unique.length; index += 500) {
    const chunk = unique.slice(index, index + 500);
    const placeholders = chunk.map(() => '?').join(',');
    const [rows] = await pool.execute(`SELECT id, front, translation, back, image_url AS imageUrl FROM cards WHERE deck_id = ? AND front IN (${placeholders})`, [deckId, ...chunk]);
    for (const row of rows as Array<{ id: number; front: string; translation: string | null; back: string | null; imageUrl: string | null }>) {
      map.set(cardMeaningKey(row.front, row.translation ?? '', row.back ?? ''), { id: row.id, hasImage: Boolean(row.imageUrl) });
    }
  }
  return map;
}

function summarizePreview(cards: PreviewCard[], existing: Map<string, { id: number; hasImage: boolean }>) {
  const list = cards.map((card, index) => {
    const match = existing.get(cardMeaningKey(card.front, card.translation, card.back));
    return {
      index,
      front: card.front,
      meaning: card.translation || card.back,
      back: card.back,
      translation: card.translation,
      example: card.example,
      hasImage: match?.hasImage ?? false,
      existingCardId: match?.id ?? null,
    };
  });
  const existingWithImage = list.filter(item => item.hasImage).length;
  return { cards: list, existingWithImage, withoutImage: list.length - existingWithImage };
}

// Favourite toggles are idempotent set operations (POST = favourite, DELETE =
// un-favourite) so repeated clicks cannot create duplicates or inconsistent state.
router.post('/decks/:deckId/favorite', auth, asyncRoute(async (req, res) => {
  const deckId = routeParam(req.params.deckId);
  if (!await ownedDeck(deckId, userId(req))) { res.status(404).json({ error: 'Không tìm thấy bộ từ.' }); return; }
  await pool.execute('UPDATE decks SET is_favorite = 1 WHERE id = ? AND user_id = ?', [deckId, userId(req)]);
  await touchUserActivity(userId(req));
  res.json({ id: Number(deckId), isFavorite: true });
}));
router.delete('/decks/:deckId/favorite', auth, asyncRoute(async (req, res) => {
  const deckId = routeParam(req.params.deckId);
  if (!await ownedDeck(deckId, userId(req))) { res.status(404).json({ error: 'Không tìm thấy bộ từ.' }); return; }
  await pool.execute('UPDATE decks SET is_favorite = 0 WHERE id = ? AND user_id = ?', [deckId, userId(req)]);
  await touchUserActivity(userId(req));
  res.json({ id: Number(deckId), isFavorite: false });
}));
router.get('/decks/:deckId/cards', auth, asyncRoute(async (req, res) => {
  const deckId = routeParam(req.params.deckId);
  if (!await ownedDeck(deckId, userId(req))) { res.status(404).json({error:'Không tìm thấy bộ từ.'}); return; }
  const limit = positiveIntParam(req.query.limit, 100, 200);
  const offset = Math.max(0, positiveIntParam(req.query.offset, 0, 1_000_000));
  const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 200) : '';
  const columns = `id, deck_id AS deckId, front, back, pronunciation, translation, example, interval_days AS intervalDays, repetitions, ease_factor AS easeFactor, due_at AS dueAt, ${imageColumns}`;
  if (search) {
    const like = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
    const where = ' AND (front LIKE ? ESCAPE \'\\\\\' OR back LIKE ? ESCAPE \'\\\\\' OR pronunciation LIKE ? ESCAPE \'\\\\\' OR translation LIKE ? ESCAPE \'\\\\\')';
    const [countRows] = await pool.execute(`SELECT COUNT(*) AS total FROM cards WHERE deck_id = ?${where}`, [deckId, like, like, like, like]);
    const total = Number((countRows as Array<{ total: number }>)[0]?.total ?? 0);
    const [rows] = await pool.execute(`SELECT ${columns} FROM cards WHERE deck_id = ?${where} ORDER BY front LIMIT ? OFFSET ?`, [deckId, like, like, like, like, limit, offset]);
    res.json({ cards: rows, total });
    return;
  }
  const [countRows] = await pool.execute('SELECT COUNT(*) AS total FROM cards WHERE deck_id = ?', [deckId]);
  const total = Number((countRows as Array<{ total: number }>)[0]?.total ?? 0);
  const [rows] = await pool.execute(`SELECT ${columns} FROM cards WHERE deck_id = ? ORDER BY front LIMIT ? OFFSET ?`, [deckId, limit, offset]);
  res.json({ cards: rows, total });
}));
router.post('/decks/:deckId/cards', auth, asyncRoute(async (req, res) => {
  if (!await ownedDeck(routeParam(req.params.deckId), userId(req))) { res.status(404).json({error:'Không tìm thấy bộ từ.'}); return; }
  const d = cardSchema.parse(req.body);
  const [result] = await pool.execute('INSERT INTO cards (deck_id, front, back, pronunciation, translation, example) VALUES (?, ?, ?, ?, ?, ?)', [routeParam(req.params.deckId), d.front, d.back, d.pronunciation, d.translation, d.example ?? null]);
  const cardId = Number((result as {insertId:number}).insertId);
  await touchUserActivity(userId(req));
  await recordActivity({ actorUserId: userId(req), actorRole: req.user!.role, action: 'card.create', targetType: 'card', targetId: cardId, ip: clientIp(req), metadata: { deckId: Number(routeParam(req.params.deckId)) } });
  // Automatic image for brand-new cards only (Pixabay + Unsplash). A provider
  // failure must never block card creation or attach a wrong-sense photo.
  if (imageProviderStatus().configured) {
    try {
      const candidate = await withTimeout(findImageForCard({ front: d.front, back: d.back, translation: d.translation, example: d.example ?? null }), 3500);
      if (candidate) await setCardImage(cardId, candidate, false, candidate.query);
    } catch { /* no image: the user can search again or upload one later */ }
  }
  res.status(201).json({ id: cardId, deckId: Number(routeParam(req.params.deckId)), ...d, ...(await cardImageFields(cardId)), intervalDays: 0, repetitions: 0, easeFactor: 2.5 });
}));
router.patch('/cards/:cardId', auth, asyncRoute(async (req, res) => {
  const d = cardSchema.partial().parse(req.body);
  const [result] = await pool.execute(`UPDATE cards c JOIN decks d ON d.id=c.deck_id SET c.front=COALESCE(?,c.front), c.back=COALESCE(?,c.back), c.pronunciation=COALESCE(?,c.pronunciation), c.translation=COALESCE(?,c.translation), c.example=COALESCE(?,c.example) WHERE c.id=? AND d.user_id=?`, [d.front ?? null,d.back ?? null,d.pronunciation ?? null,d.translation ?? null,d.example ?? null,routeParam(req.params.cardId),userId(req)]);
  if (!(result as {affectedRows:number}).affectedRows) { res.status(404).json({error:'Không tìm thấy từ.'}); return; }
  await touchUserActivity(userId(req));
  await recordActivity({ actorUserId: userId(req), actorRole: req.user!.role, action: 'card.update', targetType: 'card', targetId: Number(routeParam(req.params.cardId)), ip: clientIp(req) });
  res.json({ok:true});
}));
router.delete('/cards/:cardId', auth, asyncRoute(async (req, res) => {
  const [result] = await pool.execute('DELETE c FROM cards c JOIN decks d ON d.id=c.deck_id WHERE c.id=? AND d.user_id=?', [routeParam(req.params.cardId),userId(req)]);
  if (!(result as {affectedRows:number}).affectedRows) { res.status(404).json({error:'Không tìm thấy từ.'}); return; }
  await touchUserActivity(userId(req));
  await recordActivity({ actorUserId: userId(req), actorRole: req.user!.role, action: 'card.delete', targetType: 'card', targetId: Number(routeParam(req.params.cardId)), ip: clientIp(req) });
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
    const [countRows] = await pool.execute(`SELECT COUNT(DISTINCT r.card_id) AS studiedToday FROM reviews r JOIN cards c ON c.id=r.card_id WHERE c.deck_id=? AND r.user_id=? AND ${sqlStudyDay('r.reviewed_at')}=${SQL_TODAY} AND r.reviewed_at=(SELECT MIN(r2.reviewed_at) FROM reviews r2 WHERE r2.card_id=r.card_id)`, [deck.id, uid]);
    const studiedToday = Number((countRows as Array<{ studiedToday: number }>)[0]?.studiedToday ?? 0);
    const remainingNew = remainingNewQuota(Number(deck.dailyNewLimit), studiedToday);
    const select = `SELECT c.id,c.deck_id AS deckId,c.front,c.back,c.pronunciation,c.translation,c.example,c.interval_days AS intervalDays,c.repetitions,c.ease_factor AS easeFactor,c.due_at AS dueAt,c.image_url AS imageUrl,c.image_thumbnail_url AS imageThumbnailUrl,c.image_source AS imageSource,c.image_author AS imageAuthor,c.image_source_url AS imageSourceUrl,c.image_status AS imageStatus,c.image_is_manual AS imageIsManual,c.image_updated_at AS imageUpdatedAt FROM cards c JOIN decks d ON d.id=c.deck_id WHERE d.user_id=? AND c.deck_id=? AND c.due_at<=UTC_TIMESTAMP()`;
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
  await Promise.all([
    touchUserActivity(userId(req)),
    recordActivity({ actorUserId: userId(req), actorRole: req.user!.role, action: 'study.review', targetType: 'card', targetId: card.id, ip: clientIp(req), metadata: { rating } }),
  ]);
  res.json(schedule);
}));

function computeStreak(days: Array<{ day: string | Date }>): number {
  const set = new Set(days.map(row => toDateKey(row.day)));
  if (!set.size) return 0;
  // A streak survives until the day is actually missed: if nothing was studied
  // yet today, yesterday still counts.
  let cursor = studyDateKey();
  if (!set.has(cursor)) cursor = shiftDateKey(cursor, -1);
  let streak = 0;
  while (set.has(cursor)) {
    streak += 1;
    cursor = shiftDateKey(cursor, -1);
  }
  return streak;
}

router.get('/stats', auth, asyncRoute(async (req, res) => {
  const uid = userId(req);
  const [[summaryRows], [studyDays], [progressRows], [retentionRows], learning, activity] = await Promise.all([
    pool.execute(`SELECT COUNT(DISTINCT d.id) AS deckCount, COUNT(c.id) AS cardCount, SUM(CASE WHEN c.id IS NOT NULL AND c.due_at<=UTC_TIMESTAMP() AND (c.repetitions>0 OR EXISTS (SELECT 1 FROM reviews r WHERE r.card_id=c.id)) THEN 1 ELSE 0 END) AS dueCount FROM decks d LEFT JOIN cards c ON c.deck_id=d.id WHERE d.user_id=?`, [uid]),
    pool.execute(`SELECT DISTINCT ${sqlStudyDay('reviewed_at')} AS day FROM reviews WHERE user_id=? ORDER BY day DESC`, [uid]),
    pool.execute(`SELECT SUM(CASE WHEN c.interval_days>=21 THEN 1 ELSE 0 END) AS matureCount FROM cards c JOIN decks d ON d.id=c.deck_id WHERE d.user_id=?`, [uid]),
    pool.execute(`SELECT COUNT(*) AS total, SUM(CASE WHEN r.rating>0 THEN 1 ELSE 0 END) AS remembered FROM reviews r WHERE r.user_id=? AND r.reviewed_at>=DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY) AND r.reviewed_at>(SELECT MIN(r2.reviewed_at) FROM reviews r2 WHERE r2.card_id=r.card_id)`, [uid]),
    learningOverview(uid),
    learningActivity(uid, 7, 1),
  ]);
  const summary = (summaryRows as Array<{ deckCount: number; cardCount: number; dueCount: number | null }>)[0]!;
  const streak = computeStreak(studyDays as Array<{ day: string }>);
  const progress = (progressRows as Array<{ matureCount: number | null }>)[0];
  const retention = (retentionRows as Array<{ total: number; remembered: number | null }>)[0];
  const retentionTotal = Number(retention?.total ?? 0);
  res.json({
    deckCount: Number(summary.deckCount ?? 0),
    cardCount: Number(summary.cardCount ?? 0),
    dueCount: Number(summary.dueCount ?? 0),
    reviewedToday: learning.today.reviewCount,
    newToday: learning.today.newCount,
    new7: learning.last7.newCount,
    new30: learning.last30.newCount,
    new365: learning.last365.newCount,
    reviewsToday: learning.today.reviewCount,
    reviews7: learning.last7.reviewCount,
    reviews30: learning.last30.reviewCount,
    reviews365: learning.last365.reviewCount,
    learnedCount: learning.learnedTotal,
    matureCount: Number(progress?.matureCount ?? 0),
    retentionRate: retentionTotal ? Math.round((Number(retention?.remembered ?? 0) / retentionTotal) * 100) : null,
    retentionSample: retentionTotal,
    streak,
    last7Days: (activity.days as Array<{ day: string; reviewCount: number }>).map(row => ({ day: row.day, count: row.reviewCount })),
    studyDate: learning.studyDate,
    timeZone: learning.timeZone,
    decksLearned: learning.decksLearned,
  });
}));

/** Full learning statistics for /statics: overview, activity charts and deck table. */
router.get('/stats/learning', auth, asyncRoute(async (req, res) => {
  const uid = userId(req);
  const days = Number(req.query.days ?? 30);
  const months = Number(req.query.months ?? 12);
  const [overview, decks, activity] = await Promise.all([
    learningOverview(uid),
    learningDecks(uid),
    learningActivity(uid, Number.isFinite(days) ? days : 30, Number.isFinite(months) ? months : 12),
  ]);
  res.json({ ...overview, decks, activity });
}));

/** Advanced /statics: custom ranges, multi-deck filter, buckets, comparison, heatmap, habits. */
router.get('/stats/analysis', auth, asyncRoute(async (req, res) => {
  const range = resolveRange({
    range: typeof req.query.range === 'string' ? req.query.range : undefined,
    from: typeof req.query.from === 'string' ? req.query.from : undefined,
    to: typeof req.query.to === 'string' ? req.query.to : undefined,
  });
  if (!range) { res.status(400).json({ error: 'Khoảng thời gian không hợp lệ.' }); return; }
  const deckIds = typeof req.query.decks === 'string'
    ? req.query.decks.split(',').map(Number).filter(value => Number.isInteger(value) && value > 0).slice(0, 100)
    : [];
  const bucket = req.query.bucket === 'week' || req.query.bucket === 'month' ? req.query.bucket : 'day';
  res.json(await analyze(userId(req), range, deckIds, bucket));
}));

/** Per-user layout/preferences for /statics, isolated by user_id. */
router.get('/stats/preferences', auth, asyncRoute(async (req, res) => {
  res.json(await getPreferences(userId(req)));
}));

router.put('/stats/preferences', auth, asyncRoute(async (req, res) => {
  res.json(await savePreferences(userId(req), req.body));
}));

/** Per-deck learning statistics. Ownership is enforced before any number is read. */
router.get('/decks/:deckId/stats', auth, asyncRoute(async (req, res) => {
  const deckId = routeParam(req.params.deckId);
  if (!await ownedDeck(deckId, userId(req))) { res.status(404).json({ error: 'Không tìm thấy bộ từ.' }); return; }
  const stats = await deckLearning(userId(req), Number(deckId));
  if (!stats) { res.status(404).json({ error: 'Không tìm thấy bộ từ.' }); return; }
  res.json(stats);
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
  let cards: PreviewCard[];
  if (req.is('application/json')) {
    const csv = typeof req.body?.csv === 'string' ? req.body.csv : '';
    try { cards = parseCsvCards(csv); } catch (error) { res.status(400).json({error:(error as Error).message}); return; }
  } else {
    if (contentLengthExceeds(req, CSV_MAX_BYTES)) throw new UploadLimitError('CSV', UPLOAD_LIMITS.csvMaxMB);
    const upload = await receiveToTempFile(req, { maxBytes: CSV_MAX_BYTES, kind: 'CSV', limitMB: UPLOAD_LIMITS.csvMaxMB, extension: 'csv', tempDir: UPLOAD_TMP_DIR });
    try {
      cards = await withTimeoutReject(parseCsvFile(upload.path, { maxBytes: CSV_MAX_BYTES }), CSV_PARSE_TIMEOUT_MS, 'Xử lý CSV quá lâu. Hãy thử file nhỏ hơn.');
    } catch (error) {
      if (error instanceof CsvImportError) { res.status(400).json({ error: error.message }); return; }
      if (error instanceof UploadTimeoutError) { res.status(408).json({ error: error.message }); return; }
      throw error;
    } finally { await upload.cleanup(); }
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const card of cards) {
      await conn.execute(
        'INSERT INTO cards (deck_id, front, back, pronunciation, translation, example) VALUES (?,?,?,?,?,?)',
        [deckId, card.front, card.back, card.pronunciation, card.translation, card.example],
      );
    }
    await conn.commit();
  }
  catch(error){await conn.rollback();throw error;} finally {conn.release();}
  res.status(201).json({imported:cards.length, maxMB: UPLOAD_LIMITS.csvMaxMB});
}));

router.post('/decks/:deckId/import.apkg', auth, asyncRoute(async (req, res) => {
  const deckId = routeParam(req.params.deckId);
  if (!await ownedDeck(deckId, userId(req))) { res.status(404).json({ error: 'Không tìm thấy bộ từ.' }); return; }
  if (contentLengthExceeds(req, APKG_MAX_BYTES)) throw new UploadLimitError('APKG', UPLOAD_LIMITS.apkgMaxMB);
  const upload = await receiveToTempFile(req, { maxBytes: APKG_MAX_BYTES, kind: 'APKG', limitMB: UPLOAD_LIMITS.apkgMaxMB, extension: 'apkg', tempDir: UPLOAD_TMP_DIR });
  try {
    if (!upload.size) { res.status(400).json({ error: 'File APKG bị trống hoặc không hợp lệ.' }); return; }
    let parsed;
    try {
      parsed = await withTimeoutReject(
        parseApkgFile(upload.path, { maxArchiveBytes: APKG_MAX_BYTES, maxDatabaseBytes: APKG_MAX_DATABASE_BYTES, maxEntries: APKG_MAX_ENTRIES, maxNotes: APKG_MAX_NOTES }),
        APKG_PARSE_TIMEOUT_MS,
        'Xử lý APKG quá lâu. Hãy thử file nhỏ hơn.',
      );
    } catch (error) {
      if (error instanceof ApkgImportError) { res.status(400).json({ error: error.message }); return; }
      if (error instanceof UploadTimeoutError) { res.status(408).json({ error: error.message }); return; }
      throw error;
    }
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
    res.status(201).json({ imported: parsed.cards.length, skipped: parsed.skipped, media: 'audio and images are not imported', maxMB: UPLOAD_LIMITS.apkgMaxMB });
  } finally {
    await upload.cleanup();
  }
}));

// ── Illustration images ──────────────────────────────────────────────────────
router.get('/upload/limits', auth, (_req, res) => {
  res.json({ apkgMaxMB: UPLOAD_LIMITS.apkgMaxMB, csvMaxMB: UPLOAD_LIMITS.csvMaxMB, imageMaxMB: UPLOAD_LIMITS.imageMaxMB });
});
router.get('/images/status', auth, (_req, res) => {
  res.json(imageProviderStatus());
});

router.get('/cards/:cardId/image/candidates', auth, imageLimit, asyncRoute(async (req, res) => {
  const card = await ownedCard(Number(routeParam(req.params.cardId)), userId(req));
  if (!card) { res.status(404).json({ error: 'Không tìm thấy từ.' }); return; }
  if (!imageProviderStatus().configured) { res.json({ configured: false, provider: null, query: null, candidates: [] }); return; }
  const sense = resolveImageSense(card);
  const search = typeof req.query.q === 'string' && req.query.q.trim() ? req.query.q.trim().slice(0, 80) : sense.queries[0] ?? card.front;
  try {
    const result = await searchImages(search);
    res.json({
      configured: true,
      provider: result.provider,
      query: search,
      sense: { meaningVi: sense.meaningVi, meaningEn: sense.meaningEn, partOfSpeech: sense.partOfSpeech, confidence: sense.confidence, source: sense.source },
      candidates: result.candidates.slice(0, 12).map(candidate => ({
        url: candidate.url,
        thumbnailUrl: candidate.thumbnailUrl,
        author: candidate.author,
        sourceUrl: candidate.sourceUrl,
        width: candidate.width,
        height: candidate.height,
        score: candidate.score,
        provider: candidate.provider,
        query: candidate.query,
        license: candidate.license ?? null,
        licenseUrl: candidate.licenseUrl ?? null,
      })),
    });
  } catch (error) {
    if (error instanceof ImageProviderError) { res.status(502).json({ error: error.message }); return; }
    throw error;
  }
}));

router.post('/images/candidates', auth, imageLimit, asyncRoute(async (req, res) => {
  if (!imageProviderStatus().configured) { res.status(503).json({ error: 'Chưa cấu hình API key cho dịch vụ ảnh. Thêm PIXABAY_API_KEY, UNSPLASH_ACCESS_KEY hoặc PEXELS_API_KEY vào backend/.env.' }); return; }
  const data = z.object({ query: z.string().trim().min(1).max(120) }).parse(req.body);
  try {
    const result = await searchImages(data.query);
    res.json({
      query: data.query,
      provider: result.provider,
      candidates: result.candidates.slice(0, 12).map(candidate => ({
        url: candidate.url,
        thumbnailUrl: candidate.thumbnailUrl,
        author: candidate.author,
        sourceUrl: candidate.sourceUrl,
        width: candidate.width,
        height: candidate.height,
        score: candidate.score,
        provider: candidate.provider,
        query: candidate.query,
        license: candidate.license ?? null,
        licenseUrl: candidate.licenseUrl ?? null,
      })),
    });
  } catch (error) {
    if (error instanceof ImageProviderError) { res.status(502).json({ error: error.message }); return; }
    throw error;
  }
}));

const suggestCardSchema = z.object({
  front: z.string().trim().min(1).max(500),
  back: z.string().max(5000).optional().default(''),
  translation: z.string().max(5000).optional().default(''),
  example: z.string().max(5000).nullable().optional().default(null),
});
/** Suggestions for the import confirmation UI: semantic query + best image per card. */
router.post('/images/suggest', auth, imageLimit, asyncRoute(async (req, res) => {
  if (!imageProviderStatus().configured) { res.status(503).json({ error: 'Chưa bật dịch vụ ảnh. Thêm PIXABAY_API_KEY, UNSPLASH_ACCESS_KEY, PEXELS_API_KEY hoặc FLICKR_API_KEY vào backend/.env.' }); return; }
  const data = z.object({ cards: z.array(suggestCardSchema).min(1).max(50) }).parse(req.body);
  const suggestions = [];
  for (let index = 0; index < data.cards.length; index += 1) {
    const card = data.cards[index]!;
    try {
      const suggestion = await suggestImageForCard({ front: card.front, back: card.back, translation: card.translation, example: card.example });
      suggestions.push({
        index,
        query: suggestion.query,
        meaningVi: suggestion.sense.meaningVi,
        meaningEn: suggestion.sense.meaningEn,
        partOfSpeech: suggestion.sense.partOfSpeech,
        confidence: suggestion.sense.confidence,
        source: suggestion.sense.source,
        reason: suggestion.reason,
        candidate: suggestion.candidate ? {
          url: suggestion.candidate.url,
          thumbnailUrl: suggestion.candidate.thumbnailUrl,
          author: suggestion.candidate.author,
          sourceUrl: suggestion.candidate.sourceUrl,
          provider: suggestion.candidate.provider,
          width: suggestion.candidate.width,
          height: suggestion.candidate.height,
          score: suggestion.candidate.score,
          query: suggestion.query,
          license: suggestion.candidate.license ?? null,
          licenseUrl: suggestion.candidate.licenseUrl ?? null,
        } : null,
      });
    } catch (error) {
      suggestions.push({
        index,
        query: null,
        meaningVi: card.translation,
        meaningEn: card.back,
        partOfSpeech: 'unknown',
        confidence: 0,
        source: 'error',
        reason: 'provider-error',
        candidate: null,
        error: error instanceof ImageProviderError ? error.message : 'Không thể tìm ảnh cho từ này.',
      });
    }
  }
  res.json({ suggestions });
}));

router.post('/cards/:cardId/image/auto', auth, imageLimit, asyncRoute(async (req, res) => {
  const card = await ownedCard(Number(routeParam(req.params.cardId)), userId(req));
  if (!card) { res.status(404).json({ error: 'Không tìm thấy từ.' }); return; }
  if (!imageProviderStatus().configured) { res.status(503).json({ error: 'Chưa bật dịch vụ ảnh. Thêm PIXABAY_API_KEY, UNSPLASH_ACCESS_KEY, PEXELS_API_KEY hoặc FLICKR_API_KEY vào backend/.env.' }); return; }
  try {
    const suggestion = await suggestImageForCard(card, { expanded: true });
    if (suggestion.reason === 'provider-error') {
      res.status(502).json({ error: suggestion.error ?? 'Không thể kết nối dịch vụ ảnh.' }); return;
    }
    if (!suggestion.candidate) {
      res.json({ ...(await cardImageFields(card.id)), found: false }); return;
    }
    const fields = await setCardImage(card.id, suggestion.candidate, false, suggestion.query);
    await touchUserActivity(userId(req));
    res.json({ ...fields, found: true });
  } catch (error) {
    if (error instanceof ImageProviderError) { res.status(502).json({ error: error.message }); return; }
    throw error;
  }
}));

router.post('/cards/:cardId/image/select', auth, imageLimit, asyncRoute(async (req, res) => {
  const data = z.object({ query: z.string().trim().min(1).max(120), url: z.string().max(2048).regex(/^https?:\/\//i) }).parse(req.body);
  const card = await ownedCard(Number(routeParam(req.params.cardId)), userId(req));
  if (!card) { res.status(404).json({ error: 'Không tìm thấy từ.' }); return; }
  if (!imageProviderStatus().configured) { res.status(503).json({ error: 'Chưa cấu hình API key cho dịch vụ ảnh.' }); return; }
  try {
    // Only URLs that are part of the provider/cache result are accepted: the
    // server never fetches an arbitrary user-supplied URL (no SSRF vector).
    const result = await searchImages(data.query);
    const candidate = result.candidates.find(item => item.url === data.url);
    if (!candidate) { res.status(400).json({ error: 'Ảnh không còn khả dụng. Hãy tìm lại.' }); return; }
    const fields = await setCardImage(card.id, candidate, true, data.query);
    await touchUserActivity(userId(req));
    res.json({ ...fields, found: true });
  } catch (error) {
    if (error instanceof ImageProviderError) { res.status(502).json({ error: error.message }); return; }
    throw error;
  }
}));

router.post('/cards/:cardId/image/upload', auth, (req, res, next) => {
  imageUploadParser(req, res, error => {
    if (error) { res.status(400).json({ error: `Ảnh vượt quá giới hạn ${UPLOAD_LIMITS.imageMaxMB} MB hoặc không đúng định dạng.` }); return; }
    next();
  });
}, asyncRoute(async (req, res) => {
  const cardId = Number(routeParam(req.params.cardId));
  const card = await ownedCard(cardId, userId(req));
  if (!card) { res.status(404).json({ error: 'Không tìm thấy từ.' }); return; }
  if (!Buffer.isBuffer(req.body) || !req.body.length) { res.status(400).json({ error: 'Ảnh tải lên bị trống.' }); return; }
  try {
    const saved = await saveUploadedImage(req.body);
    await pool.execute("UPDATE cards SET image_url = ?, image_thumbnail_url = ?, image_source = 'upload', image_author = NULL, image_source_url = NULL, image_license = NULL, image_license_url = NULL, image_query = NULL, image_status = 'ready', image_is_manual = 1, image_retry_count = 0, image_retry_at = NULL, image_updated_at = UTC_TIMESTAMP() WHERE id = ?", [saved.url, saved.url, cardId]);
    removeStoredImage(card.imageUrl);
    await touchUserActivity(userId(req));
    res.json({ ...(await cardImageFields(cardId)), found: true });
  } catch (error) {
    if (error instanceof ImageUploadError) { res.status(400).json({ error: error.message }); return; }
    throw error;
  }
}));

router.delete('/cards/:cardId/image', auth, asyncRoute(async (req, res) => {
  const card = await ownedCard(Number(routeParam(req.params.cardId)), userId(req));
  if (!card) { res.status(404).json({ error: 'Không tìm thấy từ.' }); return; }
  await touchUserActivity(userId(req));
  res.json(await clearCardImage(card.id));
}));

router.get('/images/jobs/:jobId', auth, (req, res) => {
  const job = getImageJob(String(req.params.jobId), userId(req));
  if (!job) { res.status(404).json({ error: 'Không tìm thấy tiến trình.' }); return; }
  res.json(job);
});

// ── Import preview / commit ─────────────────────────────────────────────────
// Two-phase import so the user can confirm which words should get illustrations
// before any row is written. The parsed payload is cached in memory by token.
router.post('/decks/:deckId/import/preview.csv', auth, asyncRoute(async (req, res) => {
  const deckId = routeParam(req.params.deckId);
  if (!await ownedDeck(deckId, userId(req))) { res.status(404).json({ error: 'Không tìm thấy bộ từ.' }); return; }
  let cards: PreviewCard[];
  if (req.is('application/json')) {
    const csv = typeof req.body?.csv === 'string' ? req.body.csv : '';
    try { cards = parseCsvCards(csv); } catch (error) { res.status(400).json({ error: (error as Error).message }); return; }
  } else {
    if (contentLengthExceeds(req, CSV_MAX_BYTES)) throw new UploadLimitError('CSV', UPLOAD_LIMITS.csvMaxMB);
    const upload = await receiveToTempFile(req, { maxBytes: CSV_MAX_BYTES, kind: 'CSV', limitMB: UPLOAD_LIMITS.csvMaxMB, extension: 'csv', tempDir: UPLOAD_TMP_DIR });
    try {
      cards = await withTimeoutReject(parseCsvFile(upload.path, { maxBytes: CSV_MAX_BYTES }), CSV_PARSE_TIMEOUT_MS, 'Xử lý CSV quá lâu. Hãy thử file nhỏ hơn.');
    } catch (error) {
      if (error instanceof CsvImportError) { res.status(400).json({ error: error.message }); return; }
      if (error instanceof UploadTimeoutError) { res.status(408).json({ error: error.message }); return; }
      throw error;
    } finally { await upload.cleanup(); }
  }
  const existing = await existingCardsFor(deckId, cards);
  const summary = summarizePreview(cards, existing);
  const token = storePreview({ userId: userId(req), deckId: Number(deckId), format: 'csv', cards, skipped: 0, applyDailyLimit: false });
  res.json({ token, total: cards.length, skipped: 0, maxMB: UPLOAD_LIMITS.csvMaxMB, ...summary });
}));

router.post('/decks/:deckId/import/preview.apkg', auth, asyncRoute(async (req, res) => {
  const deckId = routeParam(req.params.deckId);
  if (!await ownedDeck(deckId, userId(req))) { res.status(404).json({ error: 'Không tìm thấy bộ từ.' }); return; }
  if (contentLengthExceeds(req, APKG_MAX_BYTES)) throw new UploadLimitError('APKG', UPLOAD_LIMITS.apkgMaxMB);
  const upload = await receiveToTempFile(req, { maxBytes: APKG_MAX_BYTES, kind: 'APKG', limitMB: UPLOAD_LIMITS.apkgMaxMB, extension: 'apkg', tempDir: UPLOAD_TMP_DIR });
  try {
    if (!upload.size) { res.status(400).json({ error: 'File APKG bị trống hoặc không hợp lệ.' }); return; }
    let parsed;
    try {
      parsed = await withTimeoutReject(
        parseApkgFile(upload.path, { maxArchiveBytes: APKG_MAX_BYTES, maxDatabaseBytes: APKG_MAX_DATABASE_BYTES, maxEntries: APKG_MAX_ENTRIES, maxNotes: APKG_MAX_NOTES }),
        APKG_PARSE_TIMEOUT_MS,
        'Xử lý APKG quá lâu. Hãy thử file nhỏ hơn.',
      );
    } catch (error) {
      if (error instanceof ApkgImportError) { res.status(400).json({ error: error.message }); return; }
      if (error instanceof UploadTimeoutError) { res.status(408).json({ error: error.message }); return; }
      throw error;
    }
    const cards: PreviewCard[] = parsed.cards.map(card => ({ front: card.front, back: card.back, pronunciation: card.pronunciation, translation: card.translation, example: card.example, intervalDays: card.intervalDays, repetitions: card.repetitions, easeFactor: card.easeFactor, dueAt: card.dueAt }));
    const existing = await existingCardsFor(deckId, cards);
    const summary = summarizePreview(cards, existing);
    const token = storePreview({ userId: userId(req), deckId: Number(deckId), format: 'apkg', cards, skipped: parsed.skipped, applyDailyLimit: true });
    res.json({ token, total: cards.length, skipped: parsed.skipped, maxMB: UPLOAD_LIMITS.apkgMaxMB, ...summary });
  } finally {
    await upload.cleanup();
  }
}));

router.post('/decks/:deckId/import/commit', auth, asyncRoute(async (req, res) => {
  const deckId = routeParam(req.params.deckId);
  if (!await ownedDeck(deckId, userId(req))) { res.status(404).json({ error: 'Không tìm thấy bộ từ.' }); return; }
  const data = z.object({
    token: z.string().min(1).max(64),
    imageIndexes: z.array(z.number().int().min(0)).max(2000).optional().default([]),
    picks: z.array(z.object({
      index: z.number().int().min(0),
      query: z.string().trim().min(1).max(120),
      url: z.string().max(2048).regex(/^https?:\/\//i),
    })).max(2000).optional().default([]),
  }).parse(req.body);
  const preview = takePreview(data.token, userId(req), Number(deckId));
  if (!preview) { res.status(404).json({ error: 'Phiên nhập đã hết hạn hoặc không hợp lệ. Hãy chọn lại file.' }); return; }
  const imageIndexes = new Set(data.imageIndexes.filter(index => index >= 0 && index < preview.cards.length));
  const committed: Array<{ index: number; id: number }> = [];
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (preview.applyDailyLimit) {
      const [deckRows] = await conn.execute('SELECT daily_new_limit AS dailyNewLimit FROM decks WHERE id=? AND user_id=? FOR UPDATE', [deckId, userId(req)]);
      const storedLimit = (deckRows as Array<{ dailyNewLimit: number | string | null }>)[0]?.dailyNewLimit;
      const numericLimit = storedLimit === null || storedLimit === undefined || storedLimit === '' ? Number.NaN : Number(storedLimit);
      if (!Number.isInteger(numericLimit) || numericLimit < 0 || numericLimit > 500) {
        await conn.execute('UPDATE decks SET daily_new_limit=? WHERE id=? AND user_id=?', [DEFAULT_DAILY_NEW_LIMIT, deckId, userId(req)]);
      }
    }
    for (let index = 0; index < preview.cards.length; index += 1) {
      const card = preview.cards[index]!;
      // Import identity is the pair (term, meaning): the same English word with a
      // different Vietnamese meaning must produce two separate cards/images.
      const [existing] = await conn.execute('SELECT id, translation, back, image_url AS imageUrl FROM cards WHERE deck_id=? AND front=?', [deckId, card.front]);
      const match = (existing as Array<{ id: number; translation: string | null; back: string | null; imageUrl: string | null }>)
        .find(row => (row.translation || row.back) === (card.translation || card.back));
      if (match) {
        await conn.execute('UPDATE cards SET back=?, pronunciation=?, translation=?, example=? WHERE id=?', [card.back, card.pronunciation, card.translation, card.example, match.id]);
        committed.push({ index, id: match.id });
      } else {
        const [inserted] = await conn.execute('INSERT INTO cards (deck_id, front, back, pronunciation, translation, example, interval_days, repetitions, ease_factor, due_at) VALUES (?,?,?,?,?,?,?,?,?, COALESCE(?, UTC_TIMESTAMP()))', [deckId, card.front, card.back, card.pronunciation, card.translation, card.example, card.intervalDays, card.repetitions, card.easeFactor, card.dueAt]);
        committed.push({ index, id: Number((inserted as { insertId: number }).insertId) });
      }
    }
    await conn.commit();
  } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
  await touchUserActivity(userId(req));
  // Apply the images the user reviewed and confirmed in the import modal. Each
  // pick is re-validated against the provider/cache result, never an arbitrary URL.
  const appliedPicks = new Set<number>();
  let imageApplied = 0;
  for (const pick of data.picks) {
    if (!imageIndexes.has(pick.index)) continue;
    const committedCard = committed.find(item => item.index === pick.index);
    if (!committedCard) continue;
    try {
      const result = await searchImages(pick.query);
      const candidate = result.candidates.find(item => item.url === pick.url);
      if (!candidate) continue;
      await setCardImage(committedCard.id, candidate, true, pick.query);
      appliedPicks.add(pick.index);
      imageApplied += 1;
    } catch { /* leave this card to the background job */ }
  }
  const selectedCardIds = committed.filter(item => imageIndexes.has(item.index) && !appliedPicks.has(item.index)).map(item => item.id);
  let jobId: string | null = null;
  let imageTotal = 0;
  let imageSkipped = 0;
  let imageWarning: string | undefined;
  if (selectedCardIds.length) {
    if (!imageProviderStatus().configured) {
      imageWarning = 'not-configured';
      imageSkipped = selectedCardIds.length;
    } else {
      const placeholders = selectedCardIds.map(() => '?').join(',');
      const [rows] = await pool.execute(`SELECT id, front, back, translation, example FROM cards WHERE id IN (${placeholders}) AND image_url IS NULL AND image_is_manual = 0`, selectedCardIds);
      const eligible = rows as Array<{ id: number; front: string; back: string; translation: string | null; example: string | null }>;
      imageSkipped = selectedCardIds.length - eligible.length;
      if (eligible.length) {
        const job = startImageJob({ userId: userId(req), deckId: Number(deckId), cards: eligible.map(row => ({ id: row.id, front: row.front, back: row.back, translation: row.translation ?? '', example: row.example ?? null })) });
        jobId = job.id;
        imageTotal = job.total;
      }
    }
  }
  res.status(201).json({ imported: committed.length, skipped: preview.skipped, jobId, imageTotal, imageSkipped, imageApplied, imageWarning });
}));

// ── Administrator API ────────────────────────────────────────────────────────
// Authentication and the admin role are re-verified server-side for every
// request; a user-supplied role is never trusted.
const adminLimit = rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: true, legacyHeaders: false });
router.use('/admin', auth, requireAdmin, adminLimit, adminRouter);
