import { Router, raw } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { authenticate } from './auth.js';
import { pool } from './db.js';
import { saveUploadedImage, ImageUploadError } from './uploads.js';
import type { AuthRequest } from './types.js';

export const profileSchema = z.object({ name: z.string().trim().min(1).max(100), bio: z.string().trim().max(500) }).strict();
export const usersRouter = Router();
usersRouter.use(authenticate);
usersRouter.use(rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false }));
const route = (fn: (req: AuthRequest, res: import('express').Response) => Promise<unknown>) => (req: AuthRequest, res: import('express').Response, next: import('express').NextFunction) => { void fn(req, res).catch(next); };
async function profile(id: number) {
  const [rows] = await pool.execute('SELECT u.id, u.name, u.email, u.role, u.created_at AS createdAt, COALESCE(p.bio, \'\') AS bio, p.avatar_url AS avatarUrl FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id WHERE u.id = ?', [id]);
  return (rows as unknown[])[0];
}
usersRouter.get('/me', route(async (req, res) => { res.json(await profile(req.user!.id)); }));
usersRouter.patch('/me', route(async (req, res) => {
  const data = profileSchema.parse(req.body);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute('INSERT INTO user_profiles (user_id, bio) VALUES (?, ?) ON DUPLICATE KEY UPDATE bio = VALUES(bio)', [req.user!.id, data.bio]);
    await connection.execute('UPDATE users SET name = ? WHERE id = ?', [data.name, req.user!.id]);
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
  res.json(await profile(req.user!.id));
}));
usersRouter.post('/me/avatar', raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '2mb' }), route(async (req, res) => {
  if (!Buffer.isBuffer(req.body)) { res.status(400).json({ error: 'Chọn ảnh JPEG, PNG hoặc WebP.' }); return; }
  // Check schema availability before storing an image.
  await profile(req.user!.id);
  try {
    const image = await saveUploadedImage(req.body);
    await pool.execute('INSERT INTO user_profiles (user_id, avatar_url) VALUES (?, ?) ON DUPLICATE KEY UPDATE avatar_url = VALUES(avatar_url)', [req.user!.id, image.url]);
    res.json(await profile(req.user!.id));
  } catch (error) { if (error instanceof ImageUploadError) { res.status(400).json({ error: error.message }); return; } throw error; }
}));
usersRouter.delete('/me/avatar', route(async (req, res) => {
  await pool.execute('UPDATE user_profiles SET avatar_url = NULL WHERE user_id = ?', [req.user!.id]);
  res.json(await profile(req.user!.id));
}));
