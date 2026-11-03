import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assessJwtSecret, validateAuthConfig } from './auth.js';

const previousEnv = { nodeEnv: process.env.NODE_ENV, jwtSecret: process.env.JWT_SECRET };
afterEach(() => {
  if (previousEnv.nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousEnv.nodeEnv;
  if (previousEnv.jwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousEnv.jwtSecret;
  vi.restoreAllMocks();
});

describe('JWT secret security', () => {
  it('rejects documented and obvious placeholders', () => {
    expect(assessJwtSecret('replace-with-a-long-random-secret-at-least-32-characters').valid).toBe(false);
    expect(assessJwtSecret('your-very-long-secret-value-that-is-not-random-123456789').valid).toBe(false);
  });

  it('rejects repeated, low-entropy and predictable sequence secrets', () => {
    expect(assessJwtSecret('a'.repeat(64)).valid).toBe(false);
    expect(assessJwtSecret('Ab3!'.repeat(16)).valid).toBe(false);
    expect(assessJwtSecret('abcdefghijklmnopqrstuvwxyz0123456789').valid).toBe(false);
  });

  it('accepts a CSPRNG-generated secret with sufficient estimated entropy', () => {
    const secret = randomBytes(32).toString('hex');
    expect(assessJwtSecret(secret)).toEqual({ valid: true });
  });

  it('fails closed in production when the secret is weak', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'a'.repeat(64);
    expect(() => validateAuthConfig()).toThrow(/JWT_SECRET/i);
  });

  it('warns in development for weak secrets without changing production validation', () => {
    process.env.NODE_ENV = 'development';
    process.env.JWT_SECRET = 'a'.repeat(64);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(() => validateAuthConfig()).not.toThrow();
    expect(warning).toHaveBeenCalledOnce();

    process.env.NODE_ENV = 'production';
    expect(() => validateAuthConfig()).toThrow(/JWT_SECRET/i);
  });
});
