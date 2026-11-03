import type { NextFunction, Response } from 'express';
import jwt from 'jsonwebtoken';
import { pool } from './db.js';
import type { AuthRequest, AuthUser, UserRole, UserStatus } from './types.js';

const PLACEHOLDER = /^(?:change|replace|secret|test|dev|your)(?:[-_ ]|$)/i;
const OBVIOUS_PATTERNS = [
  'password', 'changeme', 'letmein', 'qwerty', 'asdfgh', 'iloveyou',
  '0123456789', '9876543210', 'abcdefgh', 'hgfedcba',
  'abcdefghijklmnopqrstuvwxyz', 'zyxwvutsrqponmlkjihgfedcba',
];

export type JwtSecretAssessment = { valid: true } | { valid: false; reason: string };

/**
 * Entropy is an estimate, not proof of randomness. Reject common examples,
 * obvious sequences and short repeating cycles in addition to measuring the
 * observed Shannon entropy; recommend a CSPRNG-generated secret operationally.
 */
export function assessJwtSecret(value: string | undefined): JwtSecretAssessment {
  if (!value || value.length < 32) return { valid: false, reason: 'JWT_SECRET must contain at least 32 characters.' };
  const normalized = value.trim().toLowerCase();
  if (PLACEHOLDER.test(normalized) || OBVIOUS_PATTERNS.some(pattern => normalized.includes(pattern))) {
    return { valid: false, reason: 'JWT_SECRET is a placeholder or contains an easily guessed pattern.' };
  }

  const chars = [...value];
  const counts = new Map<string, number>();
  for (const char of chars) counts.set(char, (counts.get(char) ?? 0) + 1);
  if (counts.size < 8) return { valid: false, reason: 'JWT_SECRET has too few distinct characters.' };
  const entropyPerCharacter = [...counts.values()].reduce((sum, count) => {
    const probability = count / chars.length;
    return sum - probability * Math.log2(probability);
  }, 0);
  if (entropyPerCharacter * chars.length < 128) {
    return { valid: false, reason: 'JWT_SECRET has less than 128 bits of estimated entropy.' };
  }

  for (let period = 1; period <= Math.min(8, Math.floor(chars.length / 2)); period++) {
    if (chars.every((char, index) => char === chars[index % period])) {
      return { valid: false, reason: 'JWT_SECRET is a short repeating pattern.' };
    }
  }
  return { valid: true };
}

const secret = () => {
  const value = process.env.JWT_SECRET;
  const assessment = assessJwtSecret(value);
  if (!assessment.valid) {
    const message = `${assessment.reason} Generate one with a cryptographically secure random generator (for example, openssl rand -hex 32).`;
    if (process.env.NODE_ENV === 'production') throw new Error(message);
    console.warn(`[vocabup] ${message}`);
    return value || '';
  }
  return value!;
};

/** Validate cấu hình auth lúc khởi động: production sẽ dừng nếu secret yếu/placeholder. */
export function validateAuthConfig(): void {
  secret();
}

export function signToken(user: AuthUser): string {
  return jwt.sign({ email: user.email, name: user.name }, secret(), { subject: String(user.id), issuer: 'vocabup-api', audience: 'vocabup-web', algorithm: 'HS256', expiresIn: process.env.JWT_EXPIRES_IN ?? '7d' } as jwt.SignOptions);
}

const SESSION_INVALID = 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.';

/**
 * Verifies the session JWT and then re-reads the account from MySQL on every
 * request. The database — never the cookie/token — is the source of truth for
 * the role and status, so a locked or demoted account loses access immediately.
 */
export function authenticate(req: AuthRequest, res: Response, next: NextFunction): void {
  const cookieHeader = req.headers.cookie ?? '';
  const token = cookieHeader.split(';').map(part => part.trim()).find(part => part.startsWith('vocabup_session='))?.slice('vocabup_session='.length);
  if (!token) { res.status(401).json({ error: 'Vui lòng đăng nhập.' }); return; }

  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(decodeURIComponent(token), secret(), { algorithms: ['HS256'], issuer: 'vocabup-api', audience: 'vocabup-web' }) as jwt.JwtPayload;
  } catch {
    res.status(401).json({ error: SESSION_INVALID });
    return;
  }
  const id = Number(payload.sub);
  if (!Number.isSafeInteger(id) || id < 1) { res.status(401).json({ error: SESSION_INVALID }); return; }

  void (async () => {
    try {
      const [rows] = await pool.execute('SELECT id, name, email, role, status FROM users WHERE id = ?', [id]);
      const row = (rows as Array<{ id: number; name: string; email: string; role: UserRole; status: UserStatus }>)[0];
      if (!row) { res.status(401).json({ error: SESSION_INVALID }); return; }
      if (row.status !== 'active') { res.status(401).json({ error: 'Tài khoản đã bị khóa. Vui lòng đăng nhập lại.' }); return; }
      req.user = { id: row.id, email: row.email, name: row.name, role: row.role };
      next();
    } catch (error) {
      next(error);
    }
  })();
}

/** Must run after `authenticate`: rejects authenticated non-admin accounts with 403. */
export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.user) { res.status(401).json({ error: 'Vui lòng đăng nhập.' }); return; }
  if (req.user.role !== 'admin') { res.status(403).json({ error: 'Bạn không có quyền truy cập chức năng quản trị.' }); return; }
  next();
}
