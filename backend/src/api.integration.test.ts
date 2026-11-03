import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, rm, unlink } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UPLOAD_DIR } from './uploads.js';

const enabled = process.env.RUN_API_INTEGRATION === '1';
const databaseName = process.env.DB_NAME ?? '';
if (enabled && (process.env.NODE_ENV === 'production' || databaseName !== 'vocabup_test')) {
  throw new Error('API integration tests require NODE_ENV other than production and DB_NAME exactly "vocabup_test".');
}
if (enabled) {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = randomBytes(32).toString('hex');
}
let baseUrl = '';
let server: Server | undefined;
let pool: (typeof import('./db.js'))['pool'] | undefined;
let poolClosed = false;

type ApiResult = { response: Response; body: any };
async function api(path: string, options: RequestInit = {}, cookie?: string): Promise<ApiResult> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof Blob)) headers.set('Content-Type', 'application/json');
  if (cookie) headers.set('Cookie', cookie);
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers, redirect: 'manual' });
  const contentType = response.headers.get('content-type') ?? '';
  const body = contentType.includes('json') ? await response.json() : await response.text();
  return { response, body };
}

function cookieFrom(response: Response): string {
  const value = response.headers.get('set-cookie')?.split(';', 1)[0];
  if (!value) throw new Error('Expected API response to set the session cookie.');
  return value;
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function oneNoteApkg(): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'vocabup-test-apkg-'));
  const path = join(dir, 'collection.anki2');
  try {
    const db = new DatabaseSync(path);
    try {
      db.exec('CREATE TABLE col (crt INTEGER, models TEXT); CREATE TABLE notes (id INTEGER, mid INTEGER, flds TEXT); CREATE TABLE cards (id INTEGER, nid INTEGER, queue INTEGER, type INTEGER, due INTEGER, ivl INTEGER, factor INTEGER, reps INTEGER);');
      const models = JSON.stringify({ '1': { flds: [{ name: 'Front' }, { name: 'Back' }] } });
      db.prepare('INSERT INTO col (crt, models) VALUES (?, ?)').run(1_700_000_000, models);
      db.prepare('INSERT INTO notes (id, mid, flds) VALUES (?, ?, ?)').run(1, 1, 'APKG integration\u001fAPKG definition');
      db.prepare('INSERT INTO cards (id, nid, queue, type, due, ivl, factor, reps) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(1, 1, 0, 0, 1, 0, 0, 0);
    } finally { db.close(); }
    const payload = await readFile(path);
    const name = Buffer.from('collection.anki2');
    const checksum = crc32(payload);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(payload.length, 18); local.writeUInt32LE(payload.length, 22);
    local.writeUInt16LE(name.length, 26); name.copy(local, 30);
    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt32LE(checksum, 16); central.writeUInt32LE(payload.length, 20); central.writeUInt32LE(payload.length, 24);
    central.writeUInt16LE(name.length, 28); name.copy(central, 46);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(central.length, 12); eocd.writeUInt32LE(local.length + payload.length, 16);
    return Buffer.concat([local, payload, central, eocd]);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

describe.skipIf(!enabled)('VocabUp MySQL API integration (isolated test database only)', () => {
  const suffix = `${Date.now()}-${randomBytes(4).toString('hex')}`;
  const emailA = `integration-a-${suffix}@example.test`;
  const emailB = `integration-b-${suffix}@example.test`;
  const password = `T!${randomBytes(24).toString('base64url')}9z`;
  let cookieA = '';
  let cookieB = '';
  let deckId = 0;
  let cardId = 0;
  const uploadedFiles: string[] = [];

  beforeAll(async () => {
    const [{ default: app }, database] = await Promise.all([import('./app.js'), import('./db.js')]);
    pool = database.pool;
    await new Promise<void>((resolve, reject) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
      server!.once('error', reject);
    });
    const startedServer = server;
    if (!startedServer) throw new Error('Could not start the local integration-test HTTP server.');
    const address = startedServer.address();
    if (!address || typeof address === 'string') throw new Error('Could not bind the local integration-test HTTP server.');
    baseUrl = `http://127.0.0.1:${address.port}/api`;
    const health = await api('/health');
    if (!health.response.ok || health.body?.database !== 'ok') throw new Error('Test API is not healthy against MySQL.');
    const registerA = await api('/auth/register', { method: 'POST', body: JSON.stringify({ name: 'Integration A', email: emailA, password }) });
    expect(registerA.response.status).toBe(201);
    cookieA = cookieFrom(registerA.response);
    const registerB = await api('/auth/register', { method: 'POST', body: JSON.stringify({ name: 'Integration B', email: emailB, password }) });
    expect(registerB.response.status).toBe(201);
    cookieB = cookieFrom(registerB.response);
  }, 30_000);

  afterAll(async () => {
    if (cookieA && deckId && !poolClosed) await api(`/decks/${deckId}`, { method: 'DELETE' }, cookieA);
    for (const file of uploadedFiles) await unlink(resolve(UPLOAD_DIR, 'images', basename(file))).catch(() => {});
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    if (pool && !poolClosed) await pool.end();
  });

  it('registers, logs in and logs out with an HttpOnly session cookie', async () => {
    const login = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email: emailA, password }) });
    expect(login.response.status).toBe(200);
    const loginCookie = cookieFrom(login.response);
    expect(login.response.headers.get('set-cookie')).toMatch(/HttpOnly/i);
    expect((await api('/me', {}, loginCookie)).response.status).toBe(200);
    const logout = await api('/auth/logout', { method: 'POST' }, loginCookie);
    expect(logout.response.status).toBe(204);
    expect(logout.response.headers.get('set-cookie')).toMatch(/Max-Age=0/i);
  });

  it('creates, edits and deletes decks and vocabulary; enforces ownership, search and pagination', async () => {
    const created = await api('/decks', { method: 'POST', body: JSON.stringify({ name: `Integration ${suffix}` }) }, cookieA);
    expect(created.response.status).toBe(201);
    deckId = Number(created.body.id);
    expect((await api(`/decks/${deckId}`, { method: 'PATCH', body: JSON.stringify({ description: 'updated' }) }, cookieA)).response.status).toBe(200);

    const card = await api(`/decks/${deckId}/cards`, { method: 'POST', body: JSON.stringify({ front: `alpha-${suffix}`, back: 'first meaning' }) }, cookieA);
    expect(card.response.status).toBe(201);
    cardId = Number(card.body.id);
    const second = await api(`/decks/${deckId}/cards`, { method: 'POST', body: JSON.stringify({ front: `beta-${suffix}`, back: 'second meaning' }) }, cookieA);
    expect(second.response.status).toBe(201);

    const page = await api(`/decks/${deckId}/cards?search=alpha-${suffix}&limit=1&offset=0`, {}, cookieA);
    expect(page.response.status).toBe(200);
    expect(page.body.total).toBe(1);
    expect(page.body.cards).toHaveLength(1);
    expect((await api(`/decks/${deckId}/cards?limit=1&offset=1`, {}, cookieA)).body.cards).toHaveLength(1);
    expect((await api(`/decks/${deckId}/cards`, {}, cookieB)).response.status).toBe(404);
    expect((await api(`/cards/${cardId}`, { method: 'PATCH', body: JSON.stringify({ back: 'stolen' }) }, cookieB)).response.status).toBe(404);
    expect((await api(`/cards/${cardId}`, { method: 'PATCH', body: JSON.stringify({ back: 'updated meaning' }) }, cookieA)).response.status).toBe(200);
    expect((await api(`/cards/${cardId}`, { method: 'DELETE' }, cookieA)).response.status).toBe(204);
    cardId = 0;
  });

  it('favourites the owner\'s decks through idempotent, access-controlled endpoints', async () => {
    const empty = await api('/decks/favorites', {}, cookieA);
    expect(empty.response.status).toBe(200);
    expect(empty.body.some((deck: { id: number }) => deck.id === deckId)).toBe(false);

    const favourited = await api(`/decks/${deckId}/favorite`, { method: 'POST' }, cookieA);
    expect(favourited.response.status).toBe(200);
    expect(favourited.body).toEqual({ id: deckId, isFavorite: true });

    const favourites = await api('/decks/favorites', {}, cookieA);
    expect(favourites.body.filter((deck: { id: number }) => deck.id === deckId)).toHaveLength(1);
    expect(favourites.body.find((deck: { id: number }) => deck.id === deckId)?.isFavorite).toBe(true);
    expect((await api('/decks', {}, cookieA)).body.find((deck: { id: number }) => deck.id === deckId)?.isFavorite).toBe(true);

    // Repeating the request is idempotent and never duplicates the favourite.
    expect((await api(`/decks/${deckId}/favorite`, { method: 'POST' }, cookieA)).response.status).toBe(200);
    expect((await api('/decks/favorites', {}, cookieA)).body.filter((deck: { id: number }) => deck.id === deckId)).toHaveLength(1);

    // Another user can neither favourite nor see the deck in their own list.
    expect((await api(`/decks/${deckId}/favorite`, { method: 'POST' }, cookieB)).response.status).toBe(404);
    expect((await api('/decks/favorites', {}, cookieB)).body).toHaveLength(0);

    expect((await api(`/decks/${deckId}/favorite`, { method: 'DELETE' }, cookieA)).body.isFavorite).toBe(false);
    expect((await api(`/decks/${deckId}/favorite`, { method: 'DELETE' }, cookieA)).response.status).toBe(200);
    expect((await api('/decks/favorites', {}, cookieA)).body.some((deck: { id: number }) => deck.id === deckId)).toBe(false);

    expect((await api('/decks/999999/favorite', { method: 'POST' }, cookieA)).response.status).toBe(404);
    expect((await api('/decks/999999/favorite', { method: 'DELETE' }, cookieA)).response.status).toBe(404);
  });

  it('manages illustrations with ownership, validation and a safe upload path', async () => {
    const status = await api('/images/status', {}, cookieA);
    expect(status.response.status).toBe(200);
    expect(typeof status.body.configured).toBe('boolean');

    const created = await api(`/decks/${deckId}/cards`, { method: 'POST', body: JSON.stringify({ front: `image-${suffix}`, back: 'illustration target' }) }, cookieA);
    expect(created.response.status).toBe(201);
    const imageCardId = Number(created.body.id);

    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const uploaded = await api(`/cards/${imageCardId}/image/upload`, { method: 'POST', body: new Blob([png], { type: 'image/png' }) }, cookieA);
    expect(uploaded.response.status).toBe(200);
    expect(uploaded.body.imageUrl).toMatch(/^\/uploads\/images\/[0-9a-f-]+\.png$/);
    uploadedFiles.push(resolve(UPLOAD_DIR, 'images', basename(String(uploaded.body.imageUrl))));

    const cards = await api(`/decks/${deckId}/cards?search=image-${suffix}`, {}, cookieA);
    expect(cards.body.cards[0].imageUrl).toBe(uploaded.body.imageUrl);
    expect(cards.body.cards[0].imageSource).toBe('upload');
    expect(cards.body.cards[0].imageIsManual).toBe(1);

    expect((await api(`/cards/${imageCardId}/image/upload`, { method: 'POST', body: new Blob([png], { type: 'image/png' }) }, cookieB)).response.status).toBe(404);
    expect((await api(`/cards/${imageCardId}/image`, { method: 'DELETE' }, cookieB)).response.status).toBe(404);
    const invalid = await api(`/cards/${imageCardId}/image/upload`, { method: 'POST', body: new Blob([Buffer.from('not an image')], { type: 'image/png' }) }, cookieA);
    expect(invalid.response.status).toBe(400);

    const removed = await api(`/cards/${imageCardId}/image`, { method: 'DELETE' }, cookieA);
    expect(removed.response.status).toBe(200);
    expect(removed.body.imageUrl).toBeNull();
    expect((await api(`/cards/${imageCardId}`, { method: 'DELETE' }, cookieA)).response.status).toBe(204);
  });

  it('previews an import before writing and commits the confirmed selection', async () => {
    const csv = `front,back,translation\nPreview one ${suffix},first preview,Ăn một\nPreview two ${suffix},second preview,Ăn hai`;
    const preview = await api(`/decks/${deckId}/import/preview.csv`, { method: 'POST', body: JSON.stringify({ csv }) }, cookieA);
    expect(preview.response.status).toBe(200);
    expect(preview.body.total).toBe(2);
    expect(preview.body.withoutImage).toBe(2);
    expect(preview.body.cards.every((card: { hasImage: boolean }) => card.hasImage === false)).toBe(true);
    expect((await api(`/decks/${deckId}/import/preview.csv`, { method: 'POST', body: JSON.stringify({ csv }) }, cookieB)).response.status).toBe(404);

    const committed = await api(`/decks/${deckId}/import/commit`, { method: 'POST', body: JSON.stringify({ token: preview.body.token }) }, cookieA);
    expect(committed.response.status).toBe(201);
    expect(committed.body.imported).toBe(2);
    expect(committed.body.jobId).toBeNull();
    expect((await api(`/decks/${deckId}/import/commit`, { method: 'POST', body: JSON.stringify({ token: preview.body.token }) }, cookieA)).response.status).toBe(404);

    const preview2 = await api(`/decks/${deckId}/import/preview.csv`, { method: 'POST', body: JSON.stringify({ csv: `front,back\nPreview three ${suffix},third preview` }) }, cookieA);
    const committed2 = await api(`/decks/${deckId}/import/commit`, { method: 'POST', body: JSON.stringify({ token: preview2.body.token, imageIndexes: [0] }) }, cookieA);
    expect(committed2.response.status).toBe(201);
    expect(committed2.body.imported).toBe(1);
    const status = await api('/images/status', {}, cookieA);
    if (!status.body.configured) {
      expect(committed2.body.jobId).toBeNull();
      expect(committed2.body.imageWarning).toBe('not-configured');
    }
  });

  it('reviews due vocabulary and returns user statistics and streak', async () => {
    const created = await api(`/decks/${deckId}/cards`, { method: 'POST', body: JSON.stringify({ front: `review-${suffix}`, back: 'review meaning' }) }, cookieA);
    expect(created.response.status).toBe(201);
    const due = await api(`/study/due?deckId=${deckId}`, {}, cookieA);
    expect(due.response.status).toBe(200);
    expect(due.body.some((item: { id: number }) => item.id === Number(created.body.id))).toBe(true);
    expect((await api(`/study/${created.body.id}/review`, { method: 'POST', body: JSON.stringify({ rating: 3 }) }, cookieA)).response.status).toBe(200);
    const stats = await api('/stats', {}, cookieA);
    expect(stats.response.status).toBe(200);
    expect(stats.body.streak).toBeGreaterThanOrEqual(1);
  });

  it('imports and exports CSV and rejects invalid CSV/APKG inputs', async () => {
    const csv = await api(`/decks/${deckId}/import.csv`, { method: 'POST', body: JSON.stringify({ csv: 'front,back\nCSV integration,definition' }) }, cookieA);
    expect(csv.response.status).toBe(201);
    expect(csv.body.imported).toBe(1);
    const exported = await api(`/decks/${deckId}/export.csv`, {}, cookieA);
    expect(exported.response.status).toBe(200);
    expect(String(exported.body)).toContain('CSV integration');
    expect((await api(`/decks/${deckId}/import.csv`, { method: 'POST', body: JSON.stringify({ csv: 'front,back\nmissing-back,' }) }, cookieA)).response.status).toBe(400);
    const validApkg = await oneNoteApkg();
    const importedApkg = await fetch(`${baseUrl}/decks/${deckId}/import.apkg`, { method: 'POST', headers: { Cookie: cookieA, 'Content-Type': 'application/octet-stream' }, body: new Blob([Uint8Array.from(validApkg)]) });
    expect(importedApkg.status).toBe(201);
    expect((await importedApkg.json()).imported).toBe(1);
    const invalidApkg = await fetch(`${baseUrl}/decks/${deckId}/import.apkg`, { method: 'POST', headers: { Cookie: cookieA, 'Content-Type': 'application/octet-stream' }, body: new Blob(['not an APKG']) });
    expect(invalidApkg.status).toBe(400);
  });

  it('rejects invalid data and expired JWTs', async () => {
    expect((await api('/decks', { method: 'POST', body: JSON.stringify({ name: '' }) }, cookieA)).response.status).toBe(400);
    const secret = process.env.JWT_SECRET!;
    const expired = jwt.sign({ email: emailA, name: 'Integration A' }, secret, { subject: '1', issuer: 'vocabup-api', audience: 'vocabup-web', expiresIn: -1 });
    expect((await api('/me', {}, `vocabup_session=${encodeURIComponent(expired)}`)).response.status).toBe(401);
  });

  it('enforces admin RBAC and exposes dashboard aggregates to administrators only', async () => {
    await pool!.execute("UPDATE users SET role = 'admin' WHERE email = ?", [emailA]);
    expect((await api('/admin/dashboard')).response.status).toBe(401);
    expect((await api('/admin/dashboard', {}, cookieB)).response.status).toBe(403);
    expect((await api('/admin/users', {}, cookieB)).response.status).toBe(403);
    const dashboard = await api('/admin/dashboard?range=7', {}, cookieA);
    expect(dashboard.response.status).toBe(200);
    expect(dashboard.body.accounts.total).toBeGreaterThanOrEqual(2);
    expect(dashboard.body.charts.registrations).toHaveLength(7);
    expect(dashboard.body.charts.status.length).toBeGreaterThanOrEqual(1);
  });

  it('lists, searches and paginates users without leaking credentials', async () => {
    const list = await api('/admin/users?limit=1', {}, cookieA);
    expect(list.response.status).toBe(200);
    expect(list.body.users).toHaveLength(1);
    expect(list.body.total).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(list.body)).not.toContain('password');
    const search = await api(`/admin/users?search=${encodeURIComponent(emailB)}`, {}, cookieA);
    expect(search.body.users.some((user: { email: string }) => user.email === emailB)).toBe(true);
    expect((await api(`/admin/users?role=admin`, {}, cookieA)).body.users.every((user: { role: string }) => user.role === 'admin')).toBe(true);
  });

  it('returns account details without credentials and rejects unknown ids', async () => {
    const list = await api(`/admin/users?search=${encodeURIComponent(emailB)}`, {}, cookieA);
    const userId = list.body.users[0].id;
    const detail = await api(`/admin/users/${userId}`, {}, cookieA);
    expect(detail.response.status).toBe(200);
    expect(detail.body.user.email).toBe(emailB);
    expect(JSON.stringify(detail.body)).not.toContain('password');
    expect((await api('/admin/users/999999', {}, cookieA)).response.status).toBe(404);
    expect((await api('/admin/users/not-a-number', {}, cookieA)).response.status).toBe(400);
  });

  it('locks and unlocks accounts, revoking old sessions immediately', async () => {
    const list = await api(`/admin/users?search=${encodeURIComponent(emailB)}`, {}, cookieA);
    const userId = list.body.users[0].id;
    expect((await api(`/admin/users/${userId}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'locked' }) }, cookieA)).response.status).toBe(200);
    expect((await api('/me', {}, cookieB)).response.status).toBe(401);
    expect((await api('/auth/login', { method: 'POST', body: JSON.stringify({ email: emailB, password }) })).response.status).toBe(403);
    expect((await api(`/admin/users/${userId}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'active' }) }, cookieA)).response.status).toBe(200);
    expect((await api('/auth/login', { method: 'POST', body: JSON.stringify({ email: emailB, password }) })).response.status).toBe(200);
  });

  it('changes roles and protects the last administrator', async () => {
    const list = await api(`/admin/users?search=${encodeURIComponent(emailB)}`, {}, cookieA);
    const userId = list.body.users[0].id;
    expect((await api(`/admin/users/${userId}/role`, { method: 'PATCH', body: JSON.stringify({ role: 'admin' }) }, cookieA)).response.status).toBe(200);
    expect((await api(`/admin/users/${userId}/role`, { method: 'PATCH', body: JSON.stringify({ role: 'user' }) }, cookieA)).response.status).toBe(200);
    const me = await api('/me', {}, cookieA);
    const adminId = me.body.id;
    expect((await api(`/admin/users/${adminId}/role`, { method: 'PATCH', body: JSON.stringify({ role: 'user' }) }, cookieA)).response.status).toBe(409);
    expect((await api(`/admin/users/${adminId}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'locked' }) }, cookieA)).response.status).toBe(409);
    expect((await api(`/admin/users/${adminId}`, { method: 'DELETE' }, cookieA)).response.status).toBe(409);
  });

  it('lists decks and activity logs, and records admin actions', async () => {
    const decks = await api('/admin/decks?limit=5', {}, cookieA);
    expect(decks.response.status).toBe(200);
    expect(Array.isArray(decks.body.decks)).toBe(true);
    const activity = await api('/admin/activity?limit=10', {}, cookieA);
    expect(activity.response.status).toBe(200);
    expect(Array.isArray(activity.body.logs)).toBe(true);
    expect(JSON.stringify(activity.body)).not.toContain('password');
    expect(activity.body.logs.some((log: { action: string }) => log.action.startsWith('admin.'))).toBe(true);
  });

  it('returns 503 after the test-only MySQL pool is closed', async () => {
    await pool!.end();
    poolClosed = true;
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(503);
    expect((await response.json()).database).toBe('unavailable');
  });
});
