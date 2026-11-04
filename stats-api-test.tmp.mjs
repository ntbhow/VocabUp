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
const reg = await api('/auth/register', { method: 'POST', body: JSON.stringify({ email: `stats-${suffix}@example.test`, password: 'Test12345!', name: 'stats' }) });
if (reg.status !== 201) { console.log('REGISTER_FAILED', reg); process.exit(1); }
const cookie = reg.cookie.find(c => c.startsWith('vocabup_session='))?.split(';')[0] ?? '';
const H = { Cookie: cookie };
const [userRows] = await db.query('SELECT id FROM users WHERE email=?', [`stats-${suffix}@example.test`]);
const userId = userRows[0].id;
const deckA = (await api('/decks', { method: 'POST', headers: H, body: JSON.stringify({ name: `Deck A ${suffix}` }) })).body.id;
const deckB = (await api('/decks', { method: 'POST', headers: H, body: JSON.stringify({ name: `Deck B ${suffix}` }) })).body.id;
const A1 = (await api(`/decks/${deckA}/cards`, { method: 'POST', headers: H, body: JSON.stringify({ front: 'alpha', back: 'a' }) })).body.id;
const A2 = (await api(`/decks/${deckA}/cards`, { method: 'POST', headers: H, body: JSON.stringify({ front: 'beta', back: 'b' }) })).body.id;
const B1 = (await api(`/decks/${deckB}/cards`, { method: 'POST', headers: H, body: JSON.stringify({ front: 'gamma', back: 'c' }) })).body.id;
const B2 = (await api(`/decks/${deckB}/cards`, { method: 'POST', headers: H, body: JSON.stringify({ front: 'delta', back: 'd' }) })).body.id;
const review = (id, rating) => api(`/study/${id}/review`, { method: 'POST', headers: H, body: JSON.stringify({ rating }) });
const stats = async () => (await api('/stats/learning', { headers: H })).body;
const s0 = await stats();
await review(A1, 0); const s1 = await stats();
await review(A1, 2); const s2 = await stats();
await review(A1, 2); const s3 = await stats();
await review(A2, 2); const s4 = await stats();
const aAfter = (await api(`/decks/${deckA}/stats`, { headers: H })).body;
await review(B1, 2); const s5 = await stats();
const aAfterB = (await api(`/decks/${deckA}/stats`, { headers: H })).body;
const bAfter = (await api(`/decks/${deckB}/stats`, { headers: H })).body;
// Boundary: a brand-new card whose first successful review happened at Vietnam yesterday 23:59.
const boundary = new Date(`${new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)}T00:00:00+07:00`);
boundary.setDate(boundary.getDate() - 1); boundary.setHours(23, 59, 0, 0);
await db.execute('INSERT INTO reviews (card_id,user_id,rating,reviewed_at) VALUES (?,?,?,?)', [B2, userId, 2, boundary]);
const s6 = await stats();
const reload = await stats();
const reg2 = await api('/auth/register', { method: 'POST', body: JSON.stringify({ email: `stats2-${suffix}@example.test`, password: 'Test12345!', name: 'stats2' }) });
const H2 = { Cookie: reg2.cookie.find(c => c.startsWith('vocabup_session='))?.split(';')[0] ?? '' };
const sOther = (await api('/stats/learning', { headers: H2 })).body;
const deckOther = (await api(`/decks/${deckA}/stats`, { headers: H2 })).status;
const result = {
  initial: { todayNew: s0.today.newCount, todayReview: s0.today.reviewCount },
  failedRating0: { new: s1.today.newCount, review: s1.today.reviewCount },
  firstSuccess: { new: s2.today.newCount, review: s2.today.reviewCount },
  secondSuccess: { new: s3.today.newCount, review: s3.today.reviewCount },
  secondCard: { new: s4.today.newCount, review: s4.today.reviewCount },
  deckAAfter: { newToday: aAfter.today.newCount, reviewToday: aAfter.today.reviewCount, learned: aAfter.learned, total: aAfter.totalCards, progress: aAfter.progress },
  afterDeckB: { global: { new: s5.today.newCount, review: s5.today.reviewCount }, deckA: { newToday: aAfterB.today.newCount, reviewToday: aAfterB.today.reviewCount }, deckB: { newToday: bAfter.today.newCount, reviewToday: bAfter.today.reviewCount } },
  boundary: { todayNew: s6.today.newCount, last7New: s6.last7.newCount, last30New: s6.last30.newCount, last365New: s6.last365.newCount },
  totals: { learnedTotal: s6.learnedTotal, reviewsTotal: s6.reviewsTotal, decksLearned: s6.decksLearned },
  deckRows: s6.decks.map(d => ({ name: d.name, total: d.totalCards, learned: d.learned, newToday: d.today.newCount, reviews: d.reviewsTotal, progress: d.progress })),
  reloadStable: JSON.stringify(reload.today) === JSON.stringify(s6.today) && reload.learnedTotal === s6.learnedTotal,
  otherUser: { new: sOther.today.newCount, learned: sOther.learnedTotal, decks: sOther.decks.length },
  otherUserDeckAccess: deckOther,
};
console.log(JSON.stringify(result, null, 1));
await db.query('DELETE FROM users WHERE email IN (?,?)', [`stats-${suffix}@example.test`, `stats2-${suffix}@example.test`]);
await db.end();
