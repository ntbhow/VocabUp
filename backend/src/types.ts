import type { Request } from 'express';

export type UserRole = 'user' | 'admin';
export type UserStatus = 'active' | 'locked';

export interface AuthUser { id: number; email: string; name: string; role: UserRole }
export interface AuthRequest extends Request { user?: AuthUser }
