import type { NextFunction, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { AuthRequest, AuthUser } from './types.js';

const secret = () => {
  const value = process.env.JWT_SECRET;
  if (!value || value.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters');
  return value;
};

export function signToken(user: AuthUser): string {
  return jwt.sign({ email: user.email, name: user.name }, secret(), { subject: String(user.id), issuer: 'vocabup-api', audience: 'vocabup-web', algorithm: 'HS256', expiresIn: process.env.JWT_EXPIRES_IN ?? '7d' } as jwt.SignOptions);
}

export function authenticate(req: AuthRequest, res: Response, next: NextFunction): void {
  const cookieHeader = req.headers.cookie ?? '';
  const token = cookieHeader.split(';').map(part => part.trim()).find(part => part.startsWith('vocabup_session='))?.slice('vocabup_session='.length);
  if (!token) { res.status(401).json({ error: 'Vui lòng đăng nhập.' }); return; }
  try {
    const payload = jwt.verify(decodeURIComponent(token), secret(), { algorithms: ['HS256'], issuer: 'vocabup-api', audience: 'vocabup-web' }) as jwt.JwtPayload;
    const id = Number(payload.sub);
    if (!Number.isSafeInteger(id) || id < 1) throw new Error('Invalid subject');
    req.user = { id, email: String(payload.email), name: String(payload.name) };
    next();
  } catch { res.status(401).json({ error: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.' }); }
}
