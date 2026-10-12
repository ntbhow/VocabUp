import type { NextFunction, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { AuthRequest, AuthUser } from './types.js';

const secret = () => {
  const value = process.env.JWT_SECRET;
  if (!value || value.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters');
  return value;
};

export function signToken(user: AuthUser): string {
  return jwt.sign({ email: user.email, name: user.name }, secret(), { subject: String(user.id), expiresIn: process.env.JWT_EXPIRES_IN ?? '7d' } as jwt.SignOptions);
}

export function authenticate(req: AuthRequest, res: Response, next: NextFunction): void {
  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) { res.status(401).json({ error: 'Vui lòng đăng nhập.' }); return; }
  try {
    const payload = jwt.verify(header.slice(7), secret()) as jwt.JwtPayload;
    const id = Number(payload.sub);
    if (!Number.isSafeInteger(id) || id < 1) throw new Error('Invalid subject');
    req.user = { id, email: String(payload.email), name: String(payload.name) };
    next();
  } catch { res.status(401).json({ error: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.' }); }
}
