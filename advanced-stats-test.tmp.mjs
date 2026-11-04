import { config } from 'dotenv';
config({ path: 'backend/.env' });
import mysql from 'mysql2/promise';
const BASE = 'http://127.0.0.1:4100/api';
const api = async (path, opts = {}) => {
  const res = await fetch(BASE + path, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, cookie: res.headers.getSetCookie?.() ?? [] };
};
const db = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
const suffix = Date.now().toString(36);
const reg = await api('/auth/register', { method: 'POST', body: JSON.stringify({ email: `adv-${suffix}@example.test`, password: 'Test12345!', name: 'adv' }) });
const H = { Cookie: reg.cookie.find(c => c.startsWith('vocabup_session='))?.split(';')[0] ?? '' };
const deckA = (await api('/decks', { method: 'POST', headers: H, body: JSON.stringify({ name: `Advanced A ${suffix}` }) })).body.id;
const deckB = (await api('/decks', { method: 'POST', headers: H, body: JSON.stringify({ name: `Advanced B ${suffix}` }) })).body.id;
const c1 = (await api(`/decks/${deckA}/cards`, { method: 'POST', headers: H, body: JSON.stringify({ front: 'aa', back: 'a' }) })).body.id;
const c2 = (await api(`/decks/${deckA}/cards`, { method: 'POST', headers: H, body: JSON.stringify({ front: 'bb', back: 'b' }) })).body.id;
const c3 = (await api(`/decks/${deckB}/cards`, { method: 'POST', headers: H, body: JSON.stringify({ front: 'cc', back: 'c' }) })).body.id;
const review = (id, rating) => api(`/study/${id}/review`, { method: 'POST', headers: H, body: JSON.stringify({ rating }) });
await review(c1, 0); await review(c1, 2); await review(c1, 2); await review(c2, 2); await review(c3, 2);
const a = (await api('/stats/analysis?range=30d', { headers: H })).body;
const deck = (await api(`/decks/${deckA}/stats`, { headers: H })).body;
const p0 = (await api('/stats/preferences', { headers: H })).body;
const saved = (await api('/stats/preferences', { method: 'PUT', headers: H, body: JSON.stringify({ ...p0, range: '7d', chart: 'line', bucket: 'week', compare: false, cards: ['newCount', 'currentStreak'], order: ['currentStreak', 'newCount'], view: 'compact', hidden: ['heatmap'] }) })).body;
const p2 = (await api('/stats/preferences', { headers: H })).body;
const rangeStatuses = {};
for (const r of ['today', 'yesterday', '7d', '30d', '90d', '365d', 'week', 'month', 'year']) rangeStatuses[r] = (await api(`/stats/analysis?range=${r}`, { headers: H })).status;
const customOk = (await api('/stats/analysis?range=custom&from=2026-01-01&to=2026-03-01', { headers: H })).status;
const customBad = (await api('/stats/analysis?range=custom&from=2026-03-01&to=2026-01-01', { headers: H })).status;
const badRange = (await api('/stats/analysis?range=nope', { headers: H })).status;
const multi = (await api(`/stats/analysis?range=30d&decks=${deckA},${deckB}`, { headers: H })).body;
const reg2 = await api('/auth/register', { method: 'POST', body: JSON.stringify({ email: `adv2-${suffix}@example.test`, password: 'Test12345!', name: 'adv2' }) });
const H2 = { Cookie: reg2.cookie.find(c => c.startsWith('vocabup_session='))?.split(';')[0] ?? '' };
const a2 = (await api('/stats/analysis?range=30d', { headers: H2 })).body;
const deckOther = (await api(`/decks/${deckA}/stats`, { headers: H2 })).status;
const pOther = (await api('/stats/preferences', { headers: H2 })).body;
console.log(JSON.stringify({
  analysis: { status: (await api('/stats/analysis?range=30d', { headers: H })).status, new: a.summary.newCount, reviews: a.summary.reviewCount, learned: a.summary.learnedTotal, decks: a.summary.decksLearned, completion: a.summary.completionRate, series: a.series.length, heatmap: a.heatmap.length, habits: a.habits, compare: a.compare ? { new: a.compare.summary.newCount, series: a.compare.series.length } : null, deckRows: a.decks.map(d => ({ name: d.name, new: d.newCount, reviews: d.reviewCount, total: d.totalCards, learned: d.learned, progress: d.progress })) },
  deckDetail: { status: (await api(`/decks/${deckA}/stats`, { headers: H })).status, newToday: deck.today?.newCount, reviewToday: deck.today?.reviewCount, total: deck.totalCards, learned: deck.learned, progress: deck.progress },
  preferences: { defaultRange: p0.range, saved, reloaded: p2 },
  filters: { rangeStatuses, customOk, customBad, badRange },
  multiDeck: { new: multi.summary.newCount, reviews: multi.summary.reviewCount },
  isolation: { otherNew: a2.summary.newCount, otherLearned: a2.summary.learnedTotal, deckAccess: deckOther, otherPrefsRange: pOther.range },
}, null, 1));
await db.query('DELETE FROM users WHERE email IN (?,?)', [`adv-${suffix}@example.test`, `adv2-${suffix}@example.test`]);
await db.end();
