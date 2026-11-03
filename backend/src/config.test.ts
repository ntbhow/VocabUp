import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { validateProductionConfig } from './config.js';

const validProductionEnv = (): NodeJS.ProcessEnv => ({
  NODE_ENV: 'production',
  DB_USER: 'vocabup_app',
  DB_PASSWORD: randomBytes(32).toString('hex'),
  FRONTEND_URL: 'https://vocabup.example.com',
  TRUST_PROXY: '1',
});

describe('production configuration validation', () => {
  it('rejects example database credentials', () => {
    const env = validProductionEnv();
    env.DB_USER = 'vocabup';
    env.DB_PASSWORD = 'vocabup';
    expect(() => validateProductionConfig(env)).toThrow(/DB_PASSWORD/i);
  });

  it('rejects root database users even with a random password', () => {
    const env = validProductionEnv();
    env.DB_USER = 'root';
    expect(() => validateProductionConfig(env)).toThrow(/DB_USER/i);
  });

  it('rejects HTTP, malformed or non-origin frontend URLs', () => {
    const env = validProductionEnv();
    env.FRONTEND_URL = 'http://vocabup.example.com';
    expect(() => validateProductionConfig(env)).toThrow(/FRONTEND_URL/i);
    env.FRONTEND_URL = 'https://vocabup.example.com/path';
    expect(() => validateProductionConfig(env)).toThrow(/FRONTEND_URL/i);
  });

  it('accepts strong credentials, exact HTTPS origins and valid proxy values', () => {
    expect(() => validateProductionConfig(validProductionEnv())).not.toThrow();
  });

  it('does not impose production requirements in development', () => {
    expect(() => validateProductionConfig({ NODE_ENV: 'development', DB_USER: 'vocabup', DB_PASSWORD: 'vocabup' })).not.toThrow();
  });
});
