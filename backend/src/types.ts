import type { Request } from 'express';

export interface AuthUser { id: number; email: string; name: string }
export interface AuthRequest extends Request { user?: AuthUser }
