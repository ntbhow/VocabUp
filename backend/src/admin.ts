import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { pool } from './db.js';
import type { AuthRequest, UserRole, UserStatus } from './types.js';
import { clientIp, recordActivity } from './activity.js';

export const adminRouter = Router();

const RANGES = [7, 30, 90, 365] as const;
const LIKE = "LIKE ? ESCAPE '\\\\'";

type AsyncHandler = (req: AuthRequest, res: import('express').Response) => Promise<unknown>;
const asyncRoute = (fn: AsyncHandler) => (req: AuthRequest, res: import('express').Response, next: import('express').NextFunction) => { void fn(req, res).catch(next); };
const routeParam = (value: string | string[] | undefined): string => Array.isArray(value) ? value[0] ?? '' : value ?? '';
const actor = (req: AuthRequest) => req.user!;
const stringParam = (value: unknown, max = 200): string => typeof value === 'string' ? value.trim().slice(0, max) : '';

adminRouter.param('id', (req, res, next, value) => {
  if (!/^[1-9]\d*$/.test(String(value))) { res.status(400).json({ error: 'ID không hợp lệ.' }); return; }
  next();
});

export function parseRange(value: unknown): number {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return (RANGES as readonly number[]).includes(n) ? n : 30;
}
export function parseEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const candidate = Array.isArray(value) ? value[0] : value;
  return typeof candidate === 'string' && (allowed as readonly string[]).includes(candidate) ? candidate as T : fallback;
}
export function parseLimit(value: unknown, fallback = 20, max = 100): number {
  const n = Number(Array.isArray(value) ? value[0] : value);
  if (!Number.isInteger(n) || n < 1) return fallback;
  return Math.min(max, n);
}
export function parseOffset(value: unknown): number {
  const n = Number(Array.isArray(value) ? value[0] : value);
  if (!Number.isInteger(n) || n < 0) return 0;
  return Math.min(1_000_000, n);
}
function parseDateParam(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}
export function escapeLike(value: string): string {
  return `%${value.replace(/[\\%_]/g, '\\$&')}%`;
}

type SeriesPoint = { date: string; count: number };
function toDateKey(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}
export function dateSeries(days: number): string[] {
  const dates: string[] = [];
  const cursor = new Date();
  cursor.setUTCHours(0, 0, 0, 0);
  for (let index = days - 1; index >= 0; index -= 1) {
    const day = new Date(cursor);
    day.setUTCDate(day.getUTCDate() - index);
    dates.push(day.toISOString().slice(0, 10));
  }
  return dates;
}
export function mergeSeries(series: string[], rows: Array<{ day: unknown; count: unknown }>): SeriesPoint[] {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(toDateKey(row.day), Number(row.count ?? 0));
  return series.map(date => ({ date, count: counts.get(date) ?? 0 }));
}
function num(value: unknown): number {
  return Number(value ?? 0);
}

type PoolConnection = Awaited<ReturnType<typeof pool.getConnection>>;
async function transaction<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

// ── Dashboard ────────────────────────────────────────────────────────────────
async function countActiveUsers(days: number): Promise<number> {
  const [rows] = await pool.execute(
    `SELECT COUNT(DISTINCT user_id) AS n FROM (
       SELECT user_id FROM reviews WHERE reviewed_at >= DATE_SUB(UTC_DATE(), INTERVAL ${days} DAY)
       UNION
       SELECT id AS user_id FROM users WHERE last_active_at >= DATE_SUB(UTC_DATE(), INTERVAL ${days} DAY)
     ) active_users`,
  );
  return num((rows as Array<{ n: unknown }>)[0]?.n);
}

adminRouter.get('/dashboard', asyncRoute(async (req, res) => {
  const days = parseRange(req.query.range);
  const series = dateSeries(days);

  const [accountRows] = await pool.execute(
    `SELECT COUNT(*) AS total,
       SUM(status = 'active') AS active,
       SUM(status = 'locked') AS locked,
       SUM(role = 'admin') AS admins,
       SUM(created_at >= UTC_DATE()) AS newToday,
       SUM(created_at >= DATE_SUB(UTC_DATE(), INTERVAL 7 DAY)) AS new7Days,
       SUM(created_at >= DATE_SUB(UTC_DATE(), INTERVAL ${days} DAY)) AS newInRange
     FROM users`,
  );
  const accounts = (accountRows as Array<Record<string, unknown>>)[0] ?? {};

  const [learnersTotalRows] = await pool.execute('SELECT COUNT(DISTINCT user_id) AS n FROM reviews');
  const [learnersActiveRows] = await pool.execute('SELECT COUNT(DISTINCT user_id) AS n FROM reviews WHERE reviewed_at >= DATE_SUB(UTC_DATE(), INTERVAL 30 DAY)');
  const [totalReviewsRows] = await pool.execute('SELECT COUNT(*) AS n FROM reviews');
  const [reviewedCardsRows] = await pool.execute('SELECT COUNT(DISTINCT card_id) AS n FROM reviews');
  const dau = await countActiveUsers(0);
  const wau = await countActiveUsers(7);
  const mau = await countActiveUsers(30);

  const [deckRows] = await pool.execute(
    `SELECT COUNT(*) AS total,
       (SELECT COUNT(*) FROM cards) AS cards,
       SUM(is_public = 1) AS publicDecks,
       SUM(is_public = 0) AS privateDecks,
       SUM(created_at >= UTC_DATE()) AS createdToday,
       SUM(created_at >= DATE_SUB(UTC_DATE(), INTERVAL ${days} DAY)) AS createdInRange
     FROM decks`,
  );
  const deckStats = (deckRows as Array<Record<string, unknown>>)[0] ?? {};

  const [registrationRows] = await pool.execute(
    `SELECT DATE(created_at) AS day, COUNT(*) AS count FROM users
     WHERE created_at >= DATE_SUB(UTC_DATE(), INTERVAL ${days - 1} DAY) GROUP BY DATE(created_at)`,
  );
  const [activeRows] = await pool.execute(
    `SELECT day, COUNT(DISTINCT user_id) AS count FROM (
       SELECT DATE(reviewed_at) AS day, user_id FROM reviews WHERE reviewed_at >= DATE_SUB(UTC_DATE(), INTERVAL ${days - 1} DAY)
       UNION ALL
       SELECT DATE(created_at) AS day, actor_user_id AS user_id FROM admin_activity_logs
       WHERE created_at >= DATE_SUB(UTC_DATE(), INTERVAL ${days - 1} DAY) AND actor_user_id IS NOT NULL
     ) activity GROUP BY day`,
  );
  const [reviewSeriesRows] = await pool.execute(
    `SELECT DATE(reviewed_at) AS day, COUNT(*) AS count FROM reviews
     WHERE reviewed_at >= DATE_SUB(UTC_DATE(), INTERVAL ${days - 1} DAY) GROUP BY DATE(reviewed_at)`,
  );
  const [deckSeriesRows] = await pool.execute(
    `SELECT DATE(created_at) AS day, COUNT(*) AS count FROM decks
     WHERE created_at >= DATE_SUB(UTC_DATE(), INTERVAL ${days - 1} DAY) GROUP BY DATE(created_at)`,
  );
  const [statusRows] = await pool.execute('SELECT status, COUNT(*) AS count FROM users GROUP BY status');

  res.json({
    range: days,
    accounts: {
      total: num(accounts.total),
      active: num(accounts.active),
      locked: num(accounts.locked),
      admins: num(accounts.admins),
      newToday: num(accounts.newToday),
      new7Days: num(accounts.new7Days),
      newInRange: num(accounts.newInRange),
    },
    learning: {
      learnersTotal: num((learnersTotalRows as Array<{ n: unknown }>)[0]?.n),
      learnersActive: num((learnersActiveRows as Array<{ n: unknown }>)[0]?.n),
      dau,
      wau,
      mau,
      totalReviews: num((totalReviewsRows as Array<{ n: unknown }>)[0]?.n),
      reviewedCards: num((reviewedCardsRows as Array<{ n: unknown }>)[0]?.n),
    },
    decks: {
      total: num(deckStats.total),
      cards: num(deckStats.cards),
      public: num(deckStats.publicDecks),
      private: num(deckStats.privateDecks),
      createdToday: num(deckStats.createdToday),
      createdInRange: num(deckStats.createdInRange),
    },
    charts: {
      registrations: mergeSeries(series, registrationRows as Array<{ day: unknown; count: unknown }>),
      activeUsers: mergeSeries(series, activeRows as Array<{ day: unknown; count: unknown }>),
      reviews: mergeSeries(series, reviewSeriesRows as Array<{ day: unknown; count: unknown }>),
      decks: mergeSeries(series, deckSeriesRows as Array<{ day: unknown; count: unknown }>),
      status: (statusRows as Array<{ status: UserStatus; count: unknown }>).map(row => ({ status: row.status, count: num(row.count) })),
    },
  });
}));

// ── Users ────────────────────────────────────────────────────────────────────
adminRouter.get('/users', asyncRoute(async (req, res) => {
  const search = stringParam(req.query.search, 100);
  const role = parseEnum(req.query.role, ['all', 'user', 'admin'] as const, 'all');
  const status = parseEnum(req.query.status, ['all', 'active', 'locked'] as const, 'all');
  const sortKey = parseEnum(req.query.sort, ['created', 'lastActive', 'name'] as const, 'created');
  const order = parseEnum(req.query.order, ['asc', 'desc'] as const, 'desc');
  const limit = parseLimit(req.query.limit);
  const offset = parseOffset(req.query.offset);
  const sortColumn = { created: 'u.created_at', lastActive: 'u.last_active_at', name: 'u.name' }[sortKey];

  const where: string[] = [];
  const values: Array<string | number> = [];
  if (search) {
    where.push(`(u.name ${LIKE} OR u.email ${LIKE} OR CAST(u.id AS CHAR) = ?)`);
    const like = escapeLike(search);
    values.push(like, like, search);
  }
  if (role !== 'all') { where.push('u.role = ?'); values.push(role); }
  if (status !== 'all') { where.push('u.status = ?'); values.push(status); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [countRows] = await pool.execute(`SELECT COUNT(*) AS total FROM users u ${whereSql}`, values);
  const [rows] = await pool.execute(
    `SELECT u.id, u.name, u.email, u.role, u.status, u.created_at AS createdAt, u.last_active_at AS lastActiveAt,
       (SELECT COUNT(*) FROM decks d WHERE d.user_id = u.id) AS deckCount,
       (SELECT COUNT(*) FROM cards c JOIN decks d ON d.id = c.deck_id WHERE d.user_id = u.id) AS cardCount
     FROM users u ${whereSql}
     ORDER BY ${sortColumn} ${order === 'asc' ? 'ASC' : 'DESC'}, u.id DESC
     LIMIT ? OFFSET ?`,
    [...values, limit, offset],
  );
  res.json({ users: rows, total: num((countRows as Array<{ total: unknown }>)[0]?.total), limit, offset });
}));

adminRouter.get('/users/:id', asyncRoute(async (req, res) => {
  const id = Number(routeParam(req.params.id));
  const [rows] = await pool.execute(
    'SELECT id, name, email, role, status, created_at AS createdAt, last_active_at AS lastActiveAt FROM users WHERE id = ?', [id],
  );
  const user = (rows as Array<Record<string, unknown>>)[0];
  if (!user) { res.status(404).json({ error: 'Không tìm thấy người dùng.' }); return; }

  const [deckRows] = await pool.execute(
    `SELECT d.id, d.name, d.created_at AS createdAt, d.is_public AS isPublic,
       (SELECT COUNT(*) FROM cards c WHERE c.deck_id = d.id) AS cardCount
     FROM decks d WHERE d.user_id = ? ORDER BY d.created_at DESC`, [id],
  );
  const [statRows] = await pool.execute(
    `SELECT
       (SELECT COUNT(*) FROM decks WHERE user_id = ?) AS deckCount,
       (SELECT COUNT(*) FROM cards c JOIN decks d ON d.id = c.deck_id WHERE d.user_id = ?) AS cardCount,
       (SELECT COUNT(*) FROM reviews WHERE user_id = ?) AS reviewCount,
       (SELECT COUNT(DISTINCT card_id) FROM reviews WHERE user_id = ?) AS reviewedCards,
       (SELECT MAX(reviewed_at) FROM reviews WHERE user_id = ?) AS lastReviewAt`,
    [id, id, id, id, id],
  );
  const [activityRows] = await pool.execute(
    `SELECT id, action, target_type AS targetType, target_id AS targetId, ip_address AS ipAddress, metadata, created_at AS createdAt
     FROM admin_activity_logs WHERE actor_user_id = ? ORDER BY created_at DESC, id DESC LIMIT 20`, [id],
  );
  res.json({ user, stats: (statRows as Array<Record<string, unknown>>)[0] ?? {}, decks: deckRows, recentActivity: activityRows });
}));

adminRouter.patch('/users/:id/status', asyncRoute(async (req, res) => {
  const data = z.object({ status: z.enum(['active', 'locked']) }).parse(req.body);
  const targetId = Number(routeParam(req.params.id));
  const admin = actor(req);

  const outcome = await transaction(async conn => {
    const [targetRows] = await conn.execute('SELECT id, role, status FROM users WHERE id = ? FOR UPDATE', [targetId]);
    const target = (targetRows as Array<{ id: number; role: UserRole; status: UserStatus }>)[0];
    if (!target) return { kind: 'missing' as const };
    if (target.status === data.status) return { kind: 'unchanged' as const };
    if (target.role === 'admin' && target.status === 'active' && data.status === 'locked') {
      const [adminRows] = await conn.execute("SELECT id FROM users WHERE role = 'admin' AND status = 'active' FOR UPDATE");
      if ((adminRows as unknown[]).length <= 1) return { kind: 'lastAdmin' as const };
    }
    await conn.execute('UPDATE users SET status = ? WHERE id = ?', [data.status, targetId]);
    return { kind: 'ok' as const };
  });

  if (outcome.kind === 'missing') { res.status(404).json({ error: 'Không tìm thấy người dùng.' }); return; }
  if (outcome.kind === 'lastAdmin') { res.status(409).json({ error: 'Không thể khóa quản trị viên cuối cùng của hệ thống.' }); return; }
  if (outcome.kind === 'ok') {
    await recordActivity({
      actorUserId: admin.id, actorRole: 'admin',
      action: data.status === 'locked' ? 'admin.user.lock' : 'admin.user.unlock',
      targetType: 'user', targetId, ip: clientIp(req),
    });
  }
  res.json({ ok: true, status: data.status });
}));

adminRouter.patch('/users/:id/role', asyncRoute(async (req, res) => {
  const data = z.object({ role: z.enum(['user', 'admin']) }).parse(req.body);
  const targetId = Number(routeParam(req.params.id));
  const admin = actor(req);

  const outcome = await transaction(async conn => {
    const [targetRows] = await conn.execute('SELECT id, role, status FROM users WHERE id = ? FOR UPDATE', [targetId]);
    const target = (targetRows as Array<{ id: number; role: UserRole; status: UserStatus }>)[0];
    if (!target) return { kind: 'missing' as const, previousRole: null };
    if (target.role === data.role) return { kind: 'unchanged' as const, previousRole: target.role };
    if (target.role === 'admin' && target.status === 'active' && data.role === 'user') {
      const [adminRows] = await conn.execute("SELECT id FROM users WHERE role = 'admin' AND status = 'active' FOR UPDATE");
      if ((adminRows as unknown[]).length <= 1) return { kind: 'lastAdmin' as const, previousRole: target.role };
    }
    await conn.execute('UPDATE users SET role = ? WHERE id = ?', [data.role, targetId]);
    return { kind: 'ok' as const, previousRole: target.role };
  });

  if (outcome.kind === 'missing') { res.status(404).json({ error: 'Không tìm thấy người dùng.' }); return; }
  if (outcome.kind === 'lastAdmin') { res.status(409).json({ error: 'Không thể hạ quyền quản trị viên cuối cùng của hệ thống.' }); return; }
  if (outcome.kind === 'ok') {
    await recordActivity({
      actorUserId: admin.id, actorRole: 'admin', action: 'admin.user.role',
      targetType: 'user', targetId, ip: clientIp(req), metadata: { from: outcome.previousRole, to: data.role },
    });
  }
  res.json({ ok: true, role: data.role });
}));

adminRouter.delete('/users/:id', asyncRoute(async (req, res) => {
  const targetId = Number(routeParam(req.params.id));
  const admin = actor(req);
  if (targetId === admin.id) { res.status(409).json({ error: 'Bạn không thể xóa tài khoản của chính mình.' }); return; }

  const outcome = await transaction(async conn => {
    const [targetRows] = await conn.execute('SELECT id, name, role, status FROM users WHERE id = ? FOR UPDATE', [targetId]);
    const target = (targetRows as Array<{ id: number; name: string; role: UserRole; status: UserStatus }>)[0];
    if (!target) return { kind: 'missing' as const, name: null };
    if (target.role === 'admin' && target.status === 'active') {
      const [adminRows] = await conn.execute("SELECT id FROM users WHERE role = 'admin' AND status = 'active' FOR UPDATE");
      if ((adminRows as unknown[]).length <= 1) return { kind: 'lastAdmin' as const, name: target.name };
    }
    await conn.execute('DELETE FROM users WHERE id = ?', [targetId]);
    return { kind: 'ok' as const, name: target.name };
  });

  if (outcome.kind === 'missing') { res.status(404).json({ error: 'Không tìm thấy người dùng.' }); return; }
  if (outcome.kind === 'lastAdmin') { res.status(409).json({ error: 'Không thể xóa quản trị viên cuối cùng của hệ thống.' }); return; }
  await recordActivity({
    actorUserId: admin.id, actorRole: 'admin', action: 'admin.user.delete',
    targetType: 'user', targetId, ip: clientIp(req), metadata: { name: outcome.name },
  });
  res.status(204).end();
}));

// ── Decks ────────────────────────────────────────────────────────────────────
adminRouter.get('/decks', asyncRoute(async (req, res) => {
  const search = stringParam(req.query.search, 100);
  const ownerId = Number(Array.isArray(req.query.ownerId) ? req.query.ownerId[0] : req.query.ownerId);
  const visibility = parseEnum(req.query.visibility, ['all', 'public', 'private'] as const, 'all');
  const sortKey = parseEnum(req.query.sort, ['created', 'cards', 'name'] as const, 'created');
  const order = parseEnum(req.query.order, ['asc', 'desc'] as const, 'desc');
  const limit = parseLimit(req.query.limit);
  const offset = parseOffset(req.query.offset);
  const sortColumn = { created: 'd.created_at', cards: 'cardCount', name: 'd.name' }[sortKey];

  const where: string[] = [];
  const values: Array<string | number> = [];
  if (search) {
    where.push(`(d.name ${LIKE} OR u.email ${LIKE} OR u.name ${LIKE} OR CAST(d.id AS CHAR) = ?)`);
    const like = escapeLike(search);
    values.push(like, like, like, search);
  }
  if (Number.isInteger(ownerId) && ownerId > 0) { where.push('d.user_id = ?'); values.push(ownerId); }
  if (visibility !== 'all') { where.push('d.is_public = ?'); values.push(visibility === 'public' ? 1 : 0); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [countRows] = await pool.execute(
    `SELECT COUNT(*) AS total FROM decks d JOIN users u ON u.id = d.user_id ${whereSql}`, values,
  );
  const [rows] = await pool.execute(
    `SELECT d.id, d.name, d.user_id AS ownerId, u.name AS ownerName, u.email AS ownerEmail,
       (SELECT COUNT(*) FROM cards c WHERE c.deck_id = d.id) AS cardCount,
       d.created_at AS createdAt, d.is_public AS isPublic
     FROM decks d JOIN users u ON u.id = d.user_id ${whereSql}
     ORDER BY ${sortColumn} ${order === 'asc' ? 'ASC' : 'DESC'}, d.id DESC
     LIMIT ? OFFSET ?`,
    [...values, limit, offset],
  );
  res.json({ decks: rows, total: num((countRows as Array<{ total: unknown }>)[0]?.total), limit, offset });
}));

adminRouter.get('/decks/:id', asyncRoute(async (req, res) => {
  const deckId = Number(routeParam(req.params.id));
  const [deckRows] = await pool.execute(
    `SELECT d.id, d.name, d.description, d.color, d.daily_new_limit AS dailyNewLimit, d.is_public AS isPublic,
       d.created_at AS createdAt, u.id AS ownerId, u.name AS ownerName, u.email AS ownerEmail
     FROM decks d JOIN users u ON u.id = d.user_id WHERE d.id = ?`, [deckId],
  );
  const deck = (deckRows as Array<Record<string, unknown>>)[0];
  if (!deck) { res.status(404).json({ error: 'Không tìm thấy bộ từ.' }); return; }

  const limit = parseLimit(req.query.limit, 50, 200);
  const offset = parseOffset(req.query.offset);
  const search = stringParam(req.query.search, 100);
  const where = ['deck_id = ?'];
  const values: Array<string | number> = [deckId];
  if (search) {
    where.push(`(front ${LIKE} OR back ${LIKE} OR translation ${LIKE})`);
    const like = escapeLike(search);
    values.push(like, like, like);
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;
  const [cards] = await pool.execute(
    `SELECT id, front, back, pronunciation, translation, example, interval_days AS intervalDays, repetitions, due_at AS dueAt
     FROM cards ${whereSql} ORDER BY front LIMIT ? OFFSET ?`, [...values, limit, offset],
  );
  const [countRows] = await pool.execute(`SELECT COUNT(*) AS total FROM cards ${whereSql}`, values);
  res.json({ deck, cards, totalCards: num((countRows as Array<{ total: unknown }>)[0]?.total), limit, offset });
}));

adminRouter.delete('/decks/:id', asyncRoute(async (req, res) => {
  const deckId = Number(routeParam(req.params.id));
  const admin = actor(req);
  const [rows] = await pool.execute(
    `SELECT d.id, d.name, d.user_id AS ownerId, (SELECT COUNT(*) FROM cards c WHERE c.deck_id = d.id) AS cardCount
     FROM decks d WHERE d.id = ?`, [deckId],
  );
  const deck = (rows as Array<{ id: number; name: string; ownerId: number; cardCount: unknown }>)[0];
  if (!deck) { res.status(404).json({ error: 'Không tìm thấy bộ từ.' }); return; }
  await pool.execute('DELETE FROM decks WHERE id = ?', [deckId]);
  await recordActivity({
    actorUserId: admin.id, actorRole: 'admin', action: 'admin.deck.delete',
    targetType: 'deck', targetId: deckId, ip: clientIp(req),
    metadata: { name: deck.name, ownerId: deck.ownerId, cardCount: num(deck.cardCount) },
  });
  res.status(204).end();
}));

// ── Statistics ───────────────────────────────────────────────────────────────
adminRouter.get('/statistics', asyncRoute(async (req, res) => {
  const days = parseRange(req.query.range);
  const series = dateSeries(days);

  const [registrationRows] = await pool.execute(
    `SELECT DATE(created_at) AS day, COUNT(*) AS count FROM users
     WHERE created_at >= DATE_SUB(UTC_DATE(), INTERVAL ${days - 1} DAY) GROUP BY DATE(created_at)`,
  );
  const [cardRows] = await pool.execute(
    `SELECT DATE(created_at) AS day, COUNT(*) AS count FROM cards
     WHERE created_at >= DATE_SUB(UTC_DATE(), INTERVAL ${days - 1} DAY) GROUP BY DATE(created_at)`,
  );
  const [reviewRows] = await pool.execute(
    `SELECT DATE(reviewed_at) AS day, COUNT(*) AS count FROM reviews
     WHERE reviewed_at >= DATE_SUB(UTC_DATE(), INTERVAL ${days - 1} DAY) GROUP BY DATE(reviewed_at)`,
  );
  const [recentLearnersRows] = await pool.execute(
    `SELECT COUNT(DISTINCT user_id) AS n FROM reviews WHERE reviewed_at >= DATE_SUB(UTC_DATE(), INTERVAL ${days} DAY)`,
  );
  const [returningRows] = await pool.execute(
    `SELECT COUNT(*) AS n FROM (
       SELECT DISTINCT r.user_id FROM reviews r
       WHERE r.reviewed_at >= DATE_SUB(UTC_DATE(), INTERVAL ${days} DAY)
         AND EXISTS (SELECT 1 FROM reviews p WHERE p.user_id = r.user_id AND p.reviewed_at < DATE_SUB(UTC_DATE(), INTERVAL ${days} DAY))
     ) returning_users`,
  );
  const [reviewTotalRows] = await pool.execute(
    `SELECT COUNT(*) AS n FROM reviews WHERE reviewed_at >= DATE_SUB(UTC_DATE(), INTERVAL ${days} DAY)`,
  );
  const [activeDayRows] = await pool.execute(
    `SELECT COUNT(DISTINCT DATE(reviewed_at)) AS n FROM reviews WHERE reviewed_at >= DATE_SUB(UTC_DATE(), INTERVAL ${days} DAY)`,
  );
  const [topUserRows] = await pool.execute(
    `SELECT u.id, u.name, u.email, COUNT(*) AS reviewCount
     FROM reviews r JOIN users u ON u.id = r.user_id
     WHERE r.reviewed_at >= DATE_SUB(UTC_DATE(), INTERVAL ${days} DAY)
     GROUP BY u.id ORDER BY reviewCount DESC, u.id ASC LIMIT 10`,
  );
  const [topDeckRows] = await pool.execute(
    `SELECT d.id, d.name, u.email AS ownerEmail, COUNT(r.id) AS reviewCount
     FROM reviews r JOIN cards c ON c.id = r.card_id JOIN decks d ON d.id = c.deck_id JOIN users u ON u.id = d.user_id
     WHERE r.reviewed_at >= DATE_SUB(UTC_DATE(), INTERVAL ${days} DAY)
     GROUP BY d.id ORDER BY reviewCount DESC, d.id ASC LIMIT 10`,
  );

  const recentLearners = num((recentLearnersRows as Array<{ n: unknown }>)[0]?.n);
  const returningUsers = num((returningRows as Array<{ n: unknown }>)[0]?.n);
  const totalReviewsInRange = num((reviewTotalRows as Array<{ n: unknown }>)[0]?.n);
  const activeDays = num((activeDayRows as Array<{ n: unknown }>)[0]?.n);

  res.json({
    range: days,
    users: {
      registrations: mergeSeries(series, registrationRows as Array<{ day: unknown; count: unknown }>),
      recentLearners,
      returningUsers,
      returnRate: recentLearners ? Math.round((returningUsers / recentLearners) * 1000) / 10 : 0,
    },
    study: {
      reviews: mergeSeries(series, reviewRows as Array<{ day: unknown; count: unknown }>),
      cardsCreated: mergeSeries(series, cardRows as Array<{ day: unknown; count: unknown }>),
      totalReviewsInRange,
      activeDays,
      avgReviewsPerLearner: recentLearners ? Math.round((totalReviewsInRange / recentLearners) * 10) / 10 : 0,
      avgReviewsPerActiveDay: activeDays ? Math.round((totalReviewsInRange / activeDays) * 10) / 10 : 0,
      avgStudyTimeMinutes: null,
    },
    topUsers: topUserRows,
    topDecks: topDeckRows,
  });
}));

// ── Activity log ─────────────────────────────────────────────────────────────
adminRouter.get('/activity', asyncRoute(async (req, res) => {
  const action = stringParam(req.query.action, 64);
  const actorId = Number(Array.isArray(req.query.actorId) ? req.query.actorId[0] : req.query.actorId);
  const targetType = stringParam(req.query.targetType, 32);
  const from = parseDateParam(req.query.from);
  const to = parseDateParam(req.query.to);
  const limit = parseLimit(req.query.limit, 30);
  const offset = parseOffset(req.query.offset);

  const where: string[] = [];
  const values: Array<string | number> = [];
  if (action) { where.push('a.action LIKE ?'); values.push(`${action}%`); }
  if (Number.isInteger(actorId) && actorId > 0) { where.push('a.actor_user_id = ?'); values.push(actorId); }
  if (targetType) { where.push('a.target_type = ?'); values.push(targetType); }
  if (from) { where.push('a.created_at >= ?'); values.push(`${from} 00:00:00`); }
  if (to) { where.push('a.created_at < DATE_ADD(?, INTERVAL 1 DAY)'); values.push(to); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [countRows] = await pool.execute(`SELECT COUNT(*) AS total FROM admin_activity_logs a ${whereSql}`, values);
  const [rows] = await pool.execute(
    `SELECT a.id, a.action, a.target_type AS targetType, a.target_id AS targetId, a.ip_address AS ipAddress,
       a.metadata, a.created_at AS createdAt, a.actor_user_id AS actorId, u.name AS actorName, u.email AS actorEmail
     FROM admin_activity_logs a LEFT JOIN users u ON u.id = a.actor_user_id
     ${whereSql} ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?`,
    [...values, limit, offset],
  );
  res.json({ logs: rows, total: num((countRows as Array<{ total: unknown }>)[0]?.total), limit, offset });
}));

// ── Settings ─────────────────────────────────────────────────────────────────
adminRouter.get('/settings', asyncRoute(async (req, res) => {
  const admin = actor(req);
  const [rows] = await pool.execute('SELECT id, name, email, role, created_at AS createdAt FROM users WHERE id = ?', [admin.id]);
  let database = 'ok';
  try { await pool.query('SELECT 1'); } catch { database = 'unavailable'; }
  const [counts] = await pool.execute('SELECT (SELECT COUNT(*) FROM users) AS userCount, (SELECT COUNT(*) FROM users WHERE role = ?) AS adminCount', ['admin']);
  const summary = (counts as Array<{ userCount: unknown; adminCount: unknown }>)[0];
  res.json({
    admin: (rows as unknown[])[0],
    system: {
      appName: 'VocabUp',
      environment: process.env.NODE_ENV ?? 'development',
      database,
      serverTime: new Date().toISOString(),
      sessionTtl: process.env.JWT_EXPIRES_IN ?? '7d',
      userCount: num(summary?.userCount),
      adminCount: num(summary?.adminCount),
    },
  });
}));

adminRouter.post('/settings/password', asyncRoute(async (req, res) => {
  const data = z.object({ currentPassword: z.string().min(1).max(72), newPassword: z.string().min(12).max(72) }).parse(req.body);
  const admin = actor(req);
  const [rows] = await pool.execute('SELECT password_hash AS passwordHash FROM users WHERE id = ?', [admin.id]);
  const row = (rows as Array<{ passwordHash: string }>)[0];
  if (!row || !(await bcrypt.compare(data.currentPassword, row.passwordHash))) {
    res.status(400).json({ error: 'Mật khẩu hiện tại không đúng.' }); return;
  }
  if (data.currentPassword === data.newPassword) {
    res.status(400).json({ error: 'Mật khẩu mới phải khác mật khẩu hiện tại.' }); return;
  }
  const hash = await bcrypt.hash(data.newPassword, 12);
  await pool.execute('UPDATE users SET password_hash = ? WHERE id = ?', [hash, admin.id]);
  await recordActivity({ actorUserId: admin.id, actorRole: 'admin', action: 'admin.password.change', targetType: 'user', targetId: admin.id, ip: clientIp(req) });
  res.status(204).end();
}));
