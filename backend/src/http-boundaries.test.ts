import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./db.js', () => ({ pool: { execute: vi.fn(), query: vi.fn() } }));
vi.mock('./auth.js', () => ({ authenticate: (req: any, _res: any, next: () => void) => { req.user = { id: 7, role: 'user' }; next(); }, requireAdmin: vi.fn(), signToken: vi.fn() }));
vi.mock('./activity.js', () => ({ clientIp: vi.fn(), touchUserActivity: vi.fn(), recordActivity: vi.fn() }));
import app from './app.js';
import { pool } from './db.js';

let server: Server;
let base: string;
beforeAll(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test address');
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
beforeEach(() => { vi.mocked(pool.execute).mockReset(); vi.mocked(pool.execute).mockResolvedValue([{ affectedRows: 1 }, []] as any); });

describe('HTTP boundaries with a mocked database', () => {
  it('allows PUT preflight for statistics preferences from the configured frontend', async () => {
    const response = await fetch(`${base}/api/stats/preferences`, { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'PUT' } });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-methods')?.split(',')).toContain('PUT');
  });
  it('rejects writes from untrusted origins before database access', async () => {
    const response = await fetch(`${base}/api/cards/2`, { method: 'PATCH', headers: { Origin: 'https://untrusted.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ example: null }) });
    expect(response.status).toBe(403);
    expect(pool.execute).not.toHaveBeenCalled();
  });
  it.each([null, '', 'New example', undefined])('distinguishes explicit example %s from an omitted field', async example => {
    const response = await fetch(`${base}/api/cards/2`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ example }) });
    expect(response.status).toBe(200);
    const [sql, values] = vi.mocked(pool.execute).mock.calls[0]!;
    expect(sql).toContain('c.example=CASE WHEN ? THEN ? ELSE c.example END');
    expect(values).toEqual([null, null, null, null, example !== undefined, example ?? null, '2', 7]);
  });
  it('preserves deck settings when only its name changes', async () => {
    const response = await fetch(`${base}/api/decks/2`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Renamed' }) });
    expect(response.status).toBe(200);
    expect(vi.mocked(pool.execute).mock.calls[0]?.[1]).toEqual(['Renamed', null, null, null, null, '2', 7]);
  });
  it('accepts explicit empty descriptions, zero quotas and private visibility', async () => {
    const response = await fetch(`${base}/api/decks/2`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ description: '', dailyNewLimit: 0, isPublic: false }) });
    expect(response.status).toBe(200);
    expect(vi.mocked(pool.execute).mock.calls[0]?.[1]).toEqual([null, '', null, 0, 0, '2', 7]);
  });
  it('rejects invalid edits before database access', async () => {
    const response = await fetch(`${base}/api/cards/2`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ front: '   ' }) });
    expect(response.status).toBe(400);
    expect(pool.execute).not.toHaveBeenCalled();
  });
});
