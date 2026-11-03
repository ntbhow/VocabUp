import type { Request } from 'express';
import { pool } from './db.js';
import type { UserRole } from './types.js';

const SENSITIVE_KEY = /pass(?:word)?|secret|token|authorization|cookie|jwt|session|hash/i;

export type ActivityAction =
  | 'auth.register' | 'auth.login' | 'auth.logout'
  | 'deck.create' | 'deck.update' | 'deck.delete'
  | 'card.create' | 'card.update' | 'card.delete'
  | 'study.review'
  | 'admin.user.lock' | 'admin.user.unlock' | 'admin.user.role' | 'admin.user.delete'
  | 'admin.deck.delete'
  | 'admin.password.change';

export interface ActivityEntry {
  actorUserId?: number | null;
  actorRole?: UserRole | null;
  action: ActivityAction;
  targetType?: string | null;
  targetId?: number | null;
  ip?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Best-effort IP extraction. Only trusts forwarding headers when the deployment
 * explicitly enables a single trusted proxy (`TRUST_PROXY=1`).
 */
export function clientIp(req: Request): string | null {
  if (process.env.TRUST_PROXY === '1') {
    const header = req.headers['x-forwarded-for'];
    const value = Array.isArray(header) ? header[0] : header;
    const first = value?.split(',')[0]?.trim();
    if (first) return first.slice(0, 45);
  }
  return req.socket.remoteAddress?.slice(0, 45) ?? null;
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.length > 300 ? `${value.slice(0, 300)}…` : value;
  if (depth > 4) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 20).map(item => sanitizeValue(item, depth + 1));
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(key)) continue;
      result[key] = sanitizeValue(item, depth + 1);
    }
    return result;
  }
  return '[unsupported]';
}

/** Removes credential-looking keys and truncates oversized strings before storage. */
export function sanitizeMetadata(metadata: Record<string, unknown> | null | undefined): string | null {
  if (!metadata) return null;
  return JSON.stringify(sanitizeValue(metadata));
}

/**
 * Appends an audit record. Logging failures are swallowed (and reported to the
 * server log) so that a full audit table can never break a user-facing action.
 */
export async function recordActivity(entry: ActivityEntry): Promise<void> {
  try {
    await pool.execute(
      'INSERT INTO admin_activity_logs (actor_user_id, actor_role, action, target_type, target_id, ip_address, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [entry.actorUserId ?? null, entry.actorRole ?? null, entry.action, entry.targetType ?? null, entry.targetId ?? null, entry.ip ?? null, sanitizeMetadata(entry.metadata)],
    );
  } catch (error) {
    console.error('[vocabup] Failed to write activity log.', { action: entry.action, code: (error as { code?: string }).code });
  }
}

/** Marks the account as recently active (drives DAU/WAU/MAU and the "last active" column). */
export async function touchUserActivity(userId: number): Promise<void> {
  try {
    await pool.execute('UPDATE users SET last_active_at = UTC_TIMESTAMP() WHERE id = ?', [userId]);
  } catch (error) {
    console.error('[vocabup] Failed to update last_active_at.', { code: (error as { code?: string }).code });
  }
}
