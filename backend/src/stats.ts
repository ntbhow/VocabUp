import { pool } from './db.js';
import { STUDY_TIME_ZONE, studyDateKey, shiftDateKey, studyDayStart, toDateKey } from './timezone.js';

/**
 * Learning statistics shared by the dashboard, /statics and the deck detail.
 *
 * A card counts as a "new" word exactly once: on its first *successful* review
 * (rating > 0). Every later successful review is a "review". Failed attempts
 * (rating 0) are not completed learning and are excluded from both. The existing
 * `reviews` table is the reliable event history; the first successful review per
 * card is the single source of truth for "new". Nothing is fabricated: the
 * study duration is not tracked and is reported as null.
 */

export type RangeKey = 'today' | 'yesterday' | '7d' | '30d' | '90d' | '365d' | 'week' | 'month' | 'year' | 'custom';
export type Bucket = 'day' | 'week' | 'month';

export interface DateRange {
  key: RangeKey;
  label: string;
  from: Date;
  to: Date;
  previousFrom: Date;
  previousTo: Date;
  days: number;
}

export interface PeriodCounts { newCount: number; reviewCount: number }
export interface StudyPeriods { todayKey: string; today: Date; last7: Date; last30: Date; last365: Date }

export interface LearningOverview {
  timeZone: string;
  studyDate: string;
  generatedAt: string;
  today: PeriodCounts;
  last7: PeriodCounts;
  last30: PeriodCounts;
  last365: PeriodCounts;
  learnedTotal: number;
  reviewsTotal: number;
  decksLearned: number;
}

export interface ActivityDay { day: string; newCount: number; reviewCount: number }
export interface ActivityMonth { month: string; newCount: number; reviewCount: number }

export interface DeckLearning {
  deckId: number;
  name: string;
  totalCards: number;
  learned: number;
  progress: number;
  today: PeriodCounts;
  last7: PeriodCounts;
  last30: PeriodCounts;
  last365: PeriodCounts;
  reviewsTotal: number;
}

export interface AnalysisSummary {
  newCount: number;
  reviewCount: number;
  learnedTotal: number;
  decksLearned: number;
  totalCards: number;
  completionRate: number;
  avgNewPerDay: number;
  avgReviewsPerDay: number;
  studyMinutes: null;
}

export interface AnalysisDeck {
  deckId: number;
  name: string;
  totalCards: number;
  learned: number;
  progress: number;
  newCount: number;
  reviewCount: number;
  lastActivityAt: string | null;
}

export interface AnalysisHabits {
  currentStreak: number;
  longestStreak: number;
  studyDays: number;
  bestDay: { day: string; total: number } | null;
  bestHour: { hour: number; count: number } | null;
  avgNewPerDay: number;
  avgReviewsPerDay: number;
  trend: 'up' | 'down' | 'flat' | 'unknown';
}

export interface LearningAnalysis {
  timeZone: string;
  generatedAt: string;
  range: { key: RangeKey; label: string; from: string; to: string; days: number };
  compare: { from: string; to: string; summary: AnalysisSummary; series: Array<{ bucket: string; newCount: number; reviewCount: number }> } | null;
  summary: AnalysisSummary;
  series: Array<{ bucket: string; newCount: number; reviewCount: number }>;
  heatmap: ActivityDay[];
  habits: AnalysisHabits;
  decks: AnalysisDeck[];
}

const num = (value: unknown): number => Number(value ?? 0);

export function studyPeriods(now: Date = new Date()): StudyPeriods {
  const todayKey = studyDateKey(now);
  const day = (offset: number) => studyDayStart(shiftDateKey(todayKey, offset));
  return { todayKey, today: day(0), last7: day(-6), last30: day(-29), last365: day(-364) };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function dayKeyAt(instant: Date): string { return studyDateKey(instant); }
function startOf(key: string): Date { return studyDayStart(key); }
function endExclusiveOf(key: string): Date { return studyDayStart(shiftDateKey(key, 1)); }
function jsWeekday(key: string): number { return new Date(`${key}T12:00:00+07:00`).getUTCDay(); }
function mondayOf(key: string): string { return shiftDateKey(key, -((jsWeekday(key) + 6) % 7)); }
function firstOfMonth(key: string): string { return `${key.slice(0, 7)}-01`; }
function previousMonthFirst(key: string): string {
  const [year, month] = key.split('-').map(Number) as [number, number];
  const date = new Date(Date.UTC(year, month - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

const RANGE_LABELS: Record<RangeKey, string> = {
  today: 'Hôm nay', yesterday: 'Hôm qua', '7d': '7 ngày gần nhất', '30d': '30 ngày gần nhất',
  '90d': '90 ngày gần nhất', '365d': '365 ngày gần nhất', week: 'Tuần này', month: 'Tháng này',
  year: 'Năm nay', custom: 'Tùy chỉnh',
};

/** Resolves every supported range to concrete UTC instants with Vietnam boundaries. */
export function resolveRange(input: { range?: string; from?: string; to?: string }, now: Date = new Date()): DateRange | null {
  try {
    const key = (input.range ?? '30d') as RangeKey;
    if (!(key in RANGE_LABELS)) return null;
    const todayKey = officeToday(now);
    const nowExclusive = now;
    let fromKey = todayKey; let toKey = todayKey; let toInstant = nowExclusive;
    let previousFrom: Date; let previousTo: Date;
    if (key === 'today') {
      previousFrom = startOf(shiftDateKey(todayKey, -1)); previousTo = startOf(todayKey);
    } else if (key === 'yesterday') {
      fromKey = shiftDateKey(todayKey, -1); toInstant = endExclusiveOf(fromKey);
      previousFrom = startOf(shiftDateKey(todayKey, -2)); previousTo = startOf(shiftDateKey(todayKey, -1));
    } else if (key === '7d' || key === '30d' || key === '90d' || key === '365d') {
      const count = Number(key.slice(0, -1));
      fromKey = shiftDateKey(todayKey, -(count - 1));
      previousTo = startOf(fromKey); previousFrom = new Date(previousTo.getTime() - count * 86_400_000);
    } else if (key === 'week') {
      fromKey = mondayOf(todayKey);
      previousFrom = startOf(shiftDateKey(fromKey, -7)); previousTo = startOf(fromKey);
    } else if (key === 'month') {
      fromKey = firstOfMonth(todayKey);
      previousFrom = startOf(previousMonthFirst(fromKey)); previousTo = startOf(fromKey);
    } else if (key === 'year') {
      fromKey = `${todayKey.slice(0, 4)}-01-01`;
      previousFrom = startOf(`${Number(todayKey.slice(0, 4)) - 1}-01-01`); previousTo = startOf(fromKey);
    } else {
      if (!input.from || !input.to || !DATE_RE.test(input.from) || !DATE_RE.test(input.to)) return null;
      fromKey = input.from; toKey = input.to;
      if (fromKey > toKey) return null;
      toInstant = endExclusiveOf(toKey);
      const span = toInstant.getTime() - startOf(fromKey).getTime();
      previousTo = startOf(fromKey); previousFrom = new Date(previousTo.getTime() - span);
    }
    const from = startOf(fromKey);
    const to = toInstant;
    const span = Math.max(86_400_000, to.getTime() - from.getTime());
    const days = Math.max(1, Math.round(span / 86_400_000));
    return { key, label: RANGE_LABELS[key], from, to, previousFrom, previousTo, days };
  } catch { return null; }
}

function officeToday(now: Date): string { return studyDateKey(now); }

/** One `?` for the user id; optional deck ids appended after it. */
function baseSql(deckIds: number[]): { sql: string; params: number[] } {
  const deckSql = deckIds.length ? ` AND c.deck_id IN (${deckIds.map(() => '?').join(',')})` : '';
  return {
    sql: `SELECT r.id AS reviewId, r.card_id AS cardId, c.deck_id AS deckId, r.reviewed_at AS reviewedAt,
                 (r.id = (SELECT p.id FROM reviews p WHERE p.card_id = r.card_id AND p.rating > 0 ORDER BY p.reviewed_at, p.id LIMIT 1)) AS isNew
            FROM reviews r
            JOIN cards c ON c.id = r.card_id
            JOIN decks d ON d.id = c.deck_id
           WHERE r.user_id = ? AND r.user_id = d.user_id AND r.rating > 0${deckSql}`,
    params: deckIds,
  };
}

async function rangeSummary(userId: number, deckIds: number[], from: Date, to: Date): Promise<PeriodCounts> {
  const base = baseSql(deckIds);
  const [rows] = await pool.execute(
    `SELECT COALESCE(SUM(x.isNew = 1), 0) AS newCount, COALESCE(SUM(x.isNew = 0), 0) AS reviewCount
       FROM (${base.sql}) x WHERE x.reviewedAt >= ? AND x.reviewedAt < ?`,
    [userId, ...base.params, from, to],
  );
  const row = (rows as Array<Record<string, unknown>>)[0] ?? {};
  return { newCount: num(row.newCount), reviewCount: num(row.reviewCount) };
}

async function learnedSummary(userId: number, deckIds: number[]): Promise<{ learnedTotal: number; decksLearned: number; totalCards: number }> {
  const deckSql = deckIds.length ? ` AND d.id IN (${deckIds.map(() => '?').join(',')})` : '';
  const [rows] = await pool.execute(
    `SELECT COUNT(DISTINCT CASE WHEN EXISTS (SELECT 1 FROM reviews rr WHERE rr.card_id = c.id AND rr.rating > 0) THEN c.id END) AS learnedTotal,
            COUNT(DISTINCT c.id) AS totalCards,
            COUNT(DISTINCT d.id) AS decksLearned
       FROM decks d LEFT JOIN cards c ON c.deck_id = d.id
      WHERE d.user_id = ?${deckSql}`,
    [userId, ...deckIds],
  );
  const row = (rows as Array<Record<string, unknown>>)[0] ?? {};
  return { learnedTotal: num(row.learnedTotal), decksLearned: num(row.decksLearned), totalCards: num(row.totalCards) };
}

async function seriesFor(userId: number, deckIds: number[], from: Date, to: Date, bucket: Bucket): Promise<Array<{ bucket: string; newCount: number; reviewCount: number }>> {
  const base = baseSql(deckIds);
  const bucketSql = bucket === 'month'
    ? `DATE_FORMAT(CONVERT_TZ(x.reviewedAt, '+00:00', '+07:00'), '%Y-%m')`
    : bucket === 'week'
      ? `DATE_FORMAT(DATE_SUB(CONVERT_TZ(x.reviewedAt, '+00:00', '+07:00'), INTERVAL WEEKDAY(CONVERT_TZ(x.reviewedAt, '+00:00', '+07:00')) DAY), '%Y-%m-%d')`
      : `DATE_FORMAT(CONVERT_TZ(x.reviewedAt, '+00:00', '+07:00'), '%Y-%m-%d')`;
  const [rows] = await pool.execute(
    `SELECT ${bucketSql} AS bucket, COALESCE(SUM(x.isNew = 1), 0) AS newCount, COALESCE(SUM(x.isNew = 0), 0) AS reviewCount
       FROM (${base.sql}) x WHERE x.reviewedAt >= ? AND x.reviewedAt < ?
      GROUP BY bucket ORDER BY bucket`,
    [userId, ...base.params, from, to],
  );
  const byBucket = new Map<string, { newCount: number; reviewCount: number }>();
  for (const row of rows as Array<Record<string, unknown>>) byBucket.set(String(row.bucket), { newCount: num(row.newCount), reviewCount: num(row.reviewCount) });
  const out: Array<{ bucket: string; newCount: number; reviewCount: number }> = [];
  const lastKey = studyDateKey(new Date(to.getTime() - 1));
  if (bucket === 'month') {
    let cursor = `${studyDateKey(from).slice(0, 7)}-01`;
    const lastMonth = `${lastKey.slice(0, 7)}-01`;
    while (cursor <= lastMonth) {
      const value = byBucket.get(cursor.slice(0, 7)) ?? { newCount: 0, reviewCount: 0 };
      out.push({ bucket: cursor.slice(0, 7), ...value });
      const [year, month] = cursor.split('-').map(Number) as [number, number];
      const next = new Date(Date.UTC(year, month, 1));
      cursor = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-01`;
    }
  } else {
    let cursor = bucket === 'week' ? mondayOf(studyDateKey(from)) : studyDateKey(from);
    const last = bucket === 'week' ? mondayOf(lastKey) : lastKey;
    while (cursor <= last) {
      const value = byBucket.get(cursor) ?? { newCount: 0, reviewCount: 0 };
      out.push({ bucket: cursor, ...value });
      cursor = shiftDateKey(cursor, bucket === 'week' ? 7 : 1);
    }
  }
  return out;
}

async function heatmapFor(userId: number, deckIds: number[]): Promise<ActivityDay[]> {
  const base = baseSql(deckIds);
  const todayKey = studyDateKey();
  const startKey = shiftDateKey(todayKey, -364);
  const [rows] = await pool.execute(
    `SELECT DATE_FORMAT(CONVERT_TZ(x.reviewedAt, '+00:00', '+07:00'), '%Y-%m-%d') AS day,
            COALESCE(SUM(x.isNew = 1), 0) AS newCount, COALESCE(SUM(x.isNew = 0), 0) AS reviewCount
       FROM (${base.sql}) x WHERE x.reviewedAt >= ? GROUP BY day`,
    [userId, ...base.params, startOf(startKey)],
  );
  const byDay = new Map<string, ActivityDay>();
  for (const row of rows as Array<Record<string, unknown>>) {
    const day = toDateKey(row.day as string | Date);
    byDay.set(day, { day, newCount: num(row.newCount), reviewCount: num(row.reviewCount) });
  }
  return Array.from({ length: 365 }, (_, index) => {
    const day = shiftDateKey(startKey, index);
    return byDay.get(day) ?? { day, newCount: 0, reviewCount: 0 };
  });
}

async function decksFor(userId: number, from: Date, to: Date): Promise<AnalysisDeck[]> {
  const base = baseSql([]);
  const [rows] = await pool.execute(
    `SELECT d.id AS deckId, d.name,
            (SELECT COUNT(*) FROM cards cc WHERE cc.deck_id = d.id) AS totalCards,
            (SELECT COUNT(DISTINCT rr.card_id) FROM reviews rr JOIN cards cc ON cc.id = rr.card_id WHERE cc.deck_id = d.id AND rr.user_id = ? AND rr.rating > 0) AS learned,
            COALESCE(SUM(x.isNew = 1), 0) AS newCount, COALESCE(SUM(x.isNew = 0), 0) AS reviewCount,
            (SELECT MAX(rr.reviewed_at) FROM reviews rr JOIN cards cc ON cc.id = rr.card_id WHERE cc.deck_id = d.id AND rr.user_id = ? AND rr.rating > 0) AS lastActivityAt
       FROM decks d
       LEFT JOIN (${base.sql}) x ON x.deckId = d.id AND x.reviewedAt >= ? AND x.reviewedAt < ?
      WHERE d.user_id = ?
      GROUP BY d.id, d.name
      ORDER BY d.name`,
    [userId, userId, userId, from, to, userId],
  );
  return (rows as Array<Record<string, unknown>>).map(row => {
    const totalCards = num(row.totalCards);
    const learned = num(row.learned);
    return {
      deckId: num(row.deckId), name: String(row.name ?? ''), totalCards, learned,
      progress: totalCards ? Math.round((learned / totalCards) * 100) : 0,
      newCount: num(row.newCount), reviewCount: num(row.reviewCount),
      lastActivityAt: row.lastActivityAt ? new Date(row.lastActivityAt as string).toISOString() : null,
    };
  });
}

function longestStreak(days: string[]): number {
  let best = 0; let current = 0; let previous: string | null = null;
  for (const day of days) {
    current = previous && shiftDateKey(previous, 1) === day ? current + 1 : 1;
    previous = day;
    if (current > best) best = current;
  }
  return best;
}

function currentStreak(days: string[], todayKey: string): number {
  const set = new Set(days);
  let cursor = set.has(todayKey) ? todayKey : shiftDateKey(todayKey, -1);
  let streak = 0;
  while (set.has(cursor)) { streak += 1; cursor = shiftDateKey(cursor, -1); }
  return streak;
}

async function habitsFor(userId: number, range: DateRange, summary: AnalysisSummary): Promise<AnalysisHabits> {
  const [dayRows] = await pool.execute(
    `SELECT DISTINCT DATE_FORMAT(CONVERT_TZ(reviewed_at, '+00:00', '+07:00'), '%Y-%m-%d') AS day
       FROM reviews WHERE user_id = ? AND rating > 0 ORDER BY day`,
    [userId],
  );
  const days = (dayRows as Array<{ day: string }>).map(row => toDateKey(row.day as string | Date));
  const [bestDayRows] = await pool.execute(
    `SELECT DATE_FORMAT(CONVERT_TZ(reviewed_at, '+00:00', '+07:00'), '%Y-%m-%d') AS day, COUNT(*) AS total
       FROM reviews WHERE user_id = ? AND rating > 0
      GROUP BY day ORDER BY total DESC, day DESC LIMIT 1`,
    [userId],
  );
  const [hourRows] = await pool.execute(
    `SELECT HOUR(CONVERT_TZ(reviewed_at, '+00:00', '+07:00')) AS hour, COUNT(*) AS count
       FROM reviews WHERE user_id = ? AND rating > 0
      GROUP BY hour ORDER BY count DESC, hour ASC LIMIT 1`,
    [userId],
  );
  const best = (bestDayRows as Array<Record<string, unknown>>)[0];
  const hour = (hourRows as Array<Record<string, unknown>>)[0];
  const todayKey = studyDateKey();
  return {
    currentStreak: currentStreak(days, todayKey),
    longestStreak: longestStreak(days),
    studyDays: days.length,
    bestDay: best ? { day: toDateKey(best.day as string | Date), total: num(best.total) } : null,
    bestHour: hour ? { hour: num(hour.hour), count: num(hour.count) } : null,
    avgNewPerDay: summary.avgNewPerDay,
    avgReviewsPerDay: summary.avgReviewsPerDay,
    trend: summary.newCount > 0 && summary.reviewCount > 0 ? 'up' : summary.newCount + summary.reviewCount > 0 ? 'flat' : 'unknown',
  };
}

export async function analyze(userId: number, range: DateRange, deckIds: number[], bucket: Bucket = 'day'): Promise<LearningAnalysis> {
  const [current, previous, learned, series, heatmap, decks] = await Promise.all([
    rangeSummary(userId, deckIds, range.from, range.to),
    rangeSummary(userId, deckIds, range.previousFrom, range.previousTo),
    learnedSummary(userId, deckIds),
    seriesFor(userId, deckIds, range.from, range.to, bucket),
    heatmapFor(userId, deckIds),
    decksFor(userId, range.from, range.to),
  ]);
  const summary: AnalysisSummary = {
    newCount: current.newCount,
    reviewCount: current.reviewCount,
    learnedTotal: learned.learnedTotal,
    decksLearned: learned.decksLearned,
    totalCards: learned.totalCards,
    completionRate: learned.totalCards ? Math.round((learned.learnedTotal / learned.totalCards) * 100) : 0,
    avgNewPerDay: Math.round((current.newCount / range.days) * 10) / 10,
    avgReviewsPerDay: Math.round((current.reviewCount / range.days) * 10) / 10,
    studyMinutes: null,
  };
  const previousSummary: AnalysisSummary = {
    ...summary,
    newCount: previous.newCount,
    reviewCount: previous.reviewCount,
    avgNewPerDay: Math.round((previous.newCount / range.days) * 10) / 10,
    avgReviewsPerDay: Math.round((previous.reviewCount / range.days) * 10) / 10,
  };
  const previousSeries = await seriesFor(userId, deckIds, range.previousFrom, range.previousTo, bucket);
  return {
    timeZone: STUDY_TIME_ZONE,
    generatedAt: new Date().toISOString(),
    range: { key: range.key, label: range.label, from: range.from.toISOString(), to: range.to.toISOString(), days: range.days },
    compare: { from: range.previousFrom.toISOString(), to: range.previousTo.toISOString(), summary: previousSummary, series: previousSeries },
    summary,
    series,
    heatmap,
    habits: await habitsFor(userId, range, summary),
    decks,
  };
}

export interface StatsPreferences {
  range: RangeKey;
  decks: number[];
  cards: string[];
  order: string[];
  chart: 'bar' | 'line' | 'area';
  series: { new: boolean; review: boolean };
  bucket: Bucket;
  compare: boolean;
  view: 'compact' | 'detailed';
  hidden: string[];
}

const CARD_KEYS = ['newCount', 'reviewCount', 'learnedTotal', 'decksLearned', 'completionRate', 'currentStreak', 'avgNewPerDay', 'avgReviewsPerDay'] as const;
const VIEW_KEYS = ['overview', 'chart', 'heatmap', 'habits', 'decks'] as const;

export const DEFAULT_STATS_PREFERENCES: StatsPreferences = {
  range: '30d', decks: [], cards: [...CARD_KEYS], order: [...CARD_KEYS],
  chart: 'bar', series: { new: true, review: true }, bucket: 'day', compare: true,
  view: 'detailed', hidden: [],
};

export function sanitizePreferences(raw: unknown): StatsPreferences {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const range = typeof value.range === 'string' && value.range in RANGE_LABELS ? value.range as RangeKey : DEFAULT_STATS_PREFERENCES.range;
  const chart = value.chart === 'line' || value.chart === 'area' ? value.chart : 'bar';
  const bucket = value.bucket === 'week' || value.bucket === 'month' ? value.bucket : 'day';
  const view = value.view === 'compact' ? 'compact' : 'detailed';
  const cards = Array.isArray(value.cards) ? value.cards.filter((item): item is string => typeof item === 'string' && (CARD_KEYS as readonly string[]).includes(item)) : [...DEFAULT_STATS_PREFERENCES.cards];
  const order = Array.isArray(value.order) ? value.order.filter((item): item is string => typeof item === 'string' && (CARD_KEYS as readonly string[]).includes(item)) : [...DEFAULT_STATS_PREFERENCES.order];
  const decks = Array.isArray(value.decks) ? [...new Set(value.decks.filter((item): item is number => typeof item === 'number' && Number.isInteger(item) && item > 0))].slice(0, 100) : [];
  const hidden = Array.isArray(value.hidden) ? value.hidden.filter((item): item is string => typeof item === 'string' && (VIEW_KEYS as readonly string[]).includes(item)) : [];
  const seriesValue = (value.series && typeof value.series === 'object' ? value.series : {}) as Record<string, unknown>;
  return {
    range, decks, cards: cards.length ? cards : [...DEFAULT_STATS_PREFERENCES.cards],
    order: order.length ? order : [...DEFAULT_STATS_PREFERENCES.order], chart, bucket, view,
    series: { new: seriesValue.new !== false, review: seriesValue.review !== false },
    compare: value.compare !== false, hidden,
  };
}

export async function getPreferences(userId: number): Promise<StatsPreferences> {
  const [rows] = await pool.execute('SELECT preferences FROM user_statistics_preferences WHERE user_id = ?', [userId]);
  const row = (rows as Array<{ preferences: unknown }>)[0];
  return row ? sanitizePreferences(row.preferences) : { ...DEFAULT_STATS_PREFERENCES };
}

export async function savePreferences(userId: number, raw: unknown): Promise<StatsPreferences> {
  const safe = sanitizePreferences(raw);
  await pool.execute(
    'INSERT INTO user_statistics_preferences (user_id, preferences) VALUES (?, ?) ON DUPLICATE KEY UPDATE preferences = VALUES(preferences)',
    [userId, JSON.stringify(safe)],
  );
  return safe;
}

export async function learningOverview(userId: number): Promise<LearningOverview> {
  const p = studyPeriods();
  const pairs: Array<[string, Date]> = [['today', p.today], ['last7', p.last7], ['last30', p.last30], ['last365', p.last365]];
  const select = pairs.map(([name]) => [
    `COALESCE(SUM(x.isNew = 1 AND x.reviewedAt >= ?), 0) AS ${name}New`,
    `COALESCE(SUM(x.isNew = 0 AND x.reviewedAt >= ?), 0) AS ${name}Review`,
  ].join(', ')).join(', ');
  const periodParams = pairs.flatMap(([, start]) => [start, start]);
  const base = baseSql([]);
  const [periodRows] = await pool.execute(
    `SELECT ${select} FROM (${base.sql}) x WHERE x.reviewedAt >= ?`,
    [...periodParams, userId, p.last365],
  );
  const [totalRows] = await pool.execute(
    `SELECT COALESCE(SUM(x.isNew = 1), 0) AS learnedTotal, COALESCE(SUM(x.isNew = 0), 0) AS reviewsTotal,
            COUNT(DISTINCT x.deckId) AS decksLearned FROM (${base.sql}) x`,
    [userId, userId],
  );
  const row = (periodRows as Array<Record<string, unknown>>)[0] ?? {};
  const totals = (totalRows as Array<Record<string, unknown>>)[0] ?? {};
  return {
    timeZone: STUDY_TIME_ZONE, studyDate: p.todayKey, generatedAt: new Date().toISOString(),
    today: { newCount: num(row.todayNew), reviewCount: num(row.todayReview) },
    last7: { newCount: num(row.last7New), reviewCount: num(row.last7Review) },
    last30: { newCount: num(row.last30New), reviewCount: num(row.last30Review) },
    last365: { newCount: num(row.last365New), reviewCount: num(row.last365Review) },
    learnedTotal: num(totals.learnedTotal), reviewsTotal: num(totals.reviewsTotal), decksLearned: num(totals.decksLearned),
  };
}

export async function learningDecks(userId: number): Promise<DeckLearning[]> {
  const p = studyPeriods();
  const pairs: Array<[string, Date]> = [['today', p.today], ['last7', p.last7], ['last30', p.last30], ['last365', p.last365]];
  const select = pairs.map(([name]) => [
    `COALESCE(SUM(x.isNew = 1 AND x.reviewedAt >= ?), 0) AS ${name}New`,
    `COALESCE(SUM(x.isNew = 0 AND x.reviewedAt >= ?), 0) AS ${name}Review`,
  ].join(', ')).join(', ');
  const periodParams = pairs.flatMap(([, start]) => [start, start]);
  const base = baseSql([]);
  const [rows] = await pool.execute(
    `SELECT d.id AS deckId, d.name, COUNT(DISTINCT c.id) AS totalCards,
            COUNT(DISTINCT x.cardId) AS learned, ${select}, COALESCE(SUM(x.isNew = 0), 0) AS reviewsTotal
       FROM decks d LEFT JOIN cards c ON c.deck_id = d.id LEFT JOIN (${base.sql}) x ON x.deckId = d.id
      WHERE d.user_id = ? GROUP BY d.id, d.name ORDER BY d.name`,
    [...periodParams, userId, userId],
  );
  return (rows as Array<Record<string, unknown>>).map(row => {
    const totalCards = num(row.totalCards); const learned = num(row.learned);
    return {
      deckId: num(row.deckId), name: String(row.name ?? ''), totalCards, learned,
      progress: totalCards ? Math.round((learned / totalCards) * 100) : 0,
      today: { newCount: num(row.todayNew), reviewCount: num(row.todayReview) },
      last7: { newCount: num(row.last7New), reviewCount: num(row.last7Review) },
      last30: { newCount: num(row.last30New), reviewCount: num(row.last30Review) },
      last365: { newCount: num(row.last365New), reviewCount: num(row.last365Review) },
      reviewsTotal: num(row.reviewsTotal),
    };
  });
}

export async function deckLearning(userId: number, deckId: number): Promise<DeckLearning | null> {
  const p = studyPeriods();
  const pairs: Array<[string, Date]> = [['today', p.today], ['last7', p.last7], ['last30', p.last30], ['last365', p.last365]];
  const select = pairs.map(([name]) => [
    `COALESCE(SUM(x.isNew = 1 AND x.reviewedAt >= ?), 0) AS ${name}New`,
    `COALESCE(SUM(x.isNew = 0 AND x.reviewedAt >= ?), 0) AS ${name}Review`,
  ].join(', ')).join(', ');
  const periodParams = pairs.flatMap(([, start]) => [start, start]);
  const base = baseSql([]);
  const [rows] = await pool.execute(
    `SELECT d.id AS deckId, d.name,
            (SELECT COUNT(*) FROM cards cc WHERE cc.deck_id = d.id) AS totalCards,
            (SELECT COUNT(DISTINCT rr.card_id) FROM reviews rr JOIN cards cc ON cc.id = rr.card_id WHERE cc.deck_id = d.id AND rr.user_id = ? AND rr.rating > 0) AS learned,
            ${select}, COALESCE(SUM(x.isNew = 0), 0) AS reviewsTotal
       FROM decks d LEFT JOIN (${base.sql}) x ON x.deckId = d.id
      WHERE d.id = ? AND d.user_id = ? GROUP BY d.id, d.name`,
    [userId, ...periodParams, userId, deckId, userId],
  );
  const row = (rows as Array<Record<string, unknown>>)[0];
  if (!row) return null;
  const totalCards = num(row.totalCards); const learned = num(row.learned);
  return {
    deckId: num(row.deckId), name: String(row.name ?? ''), totalCards, learned,
    progress: totalCards ? Math.round((learned / totalCards) * 100) : 0,
    today: { newCount: num(row.todayNew), reviewCount: num(row.todayReview) },
    last7: { newCount: num(row.last7New), reviewCount: num(row.last7Review) },
    last30: { newCount: num(row.last30New), reviewCount: num(row.last30Review) },
    last365: { newCount: num(row.last365New), reviewCount: num(row.last365Review) },
    reviewsTotal: num(row.reviewsTotal),
  };
}

export async function learningActivity(userId: number, days = 30, months = 12): Promise<{ days: ActivityDay[]; months: ActivityMonth[] }> {
  const safeDays = Math.min(365, Math.max(1, Math.trunc(days)));
  const safeMonths = Math.min(24, Math.max(1, Math.trunc(months)));
  const base = baseSql([]);
  const dayStart = new Date(studyPeriods().today.getTime() - (safeDays - 1) * 86_400_000);
  const [year, month] = studyDateKey().split('-').map(Number) as [number, number];
  const monthStartUtc = new Date(Date.UTC(year, month - (safeMonths - 1) - 1, 1));
  const monthStartKey = `${monthStartUtc.getUTCFullYear()}-${String(monthStartUtc.getUTCMonth() + 1).padStart(2, '0')}-01`;
  const [dayRows] = await pool.execute(
    `SELECT DATE_FORMAT(CONVERT_TZ(x.reviewedAt, '+00:00', '+07:00'), '%Y-%m-%d') AS day,
            COALESCE(SUM(x.isNew = 1), 0) AS newCount, COALESCE(SUM(x.isNew = 0), 0) AS reviewCount
       FROM (${base.sql}) x WHERE x.reviewedAt >= ? GROUP BY day ORDER BY day`,
    [userId, dayStart],
  );
  const [monthRows] = await pool.execute(
    `SELECT DATE_FORMAT(CONVERT_TZ(x.reviewedAt, '+00:00', '+07:00'), '%Y-%m') AS month,
            COALESCE(SUM(x.isNew = 1), 0) AS newCount, COALESCE(SUM(x.isNew = 0), 0) AS reviewCount
       FROM (${base.sql}) x WHERE x.reviewedAt >= ? GROUP BY month ORDER BY month`,
    [userId, studyDayStart(monthStartKey)],
  );
  const byDay = new Map<string, ActivityDay>();
  for (const row of dayRows as Array<Record<string, unknown>>) {
    const day = toDateKey(row.day as string | Date);
    byDay.set(day, { day, newCount: num(row.newCount), reviewCount: num(row.reviewCount) });
  }
  const todayKey = studyDateKey();
  const byMonth = new Map<string, ActivityMonth>();
  for (const row of monthRows as Array<Record<string, unknown>>) byMonth.set(String(row.month), { month: String(row.month), newCount: num(row.newCount), reviewCount: num(row.reviewCount) });
  return {
    days: Array.from({ length: safeDays }, (_, index) => {
      const day = shiftDateKey(todayKey, -(safeDays - 1 - index));
      return byDay.get(day) ?? { day, newCount: 0, reviewCount: 0 };
    }),
    months: Array.from({ length: safeMonths }, (_, index) => {
      const date = new Date(Date.UTC(year, month - (safeMonths - index), 1));
      const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
      return byMonth.get(key) ?? { month: key, newCount: 0, reviewCount: 0 };
    }),
  };
}
