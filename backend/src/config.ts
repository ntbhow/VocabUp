import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

export const DEFAULT_DAILY_NEW_LIMIT = 20;

function positiveIntEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

/**
 * Per-file-type upload caps. They are deliberately independent: an APKG deck can
 * be much larger than a CSV or an illustration. Values come from `.env` so a
 * deployment can raise them without a code change.
 */
export const UPLOAD_LIMITS = {
  apkgMaxMB: positiveIntEnv('APKG_MAX_SIZE_MB', 200, 1, 2048),
  csvMaxMB: positiveIntEnv('CSV_MAX_SIZE_MB', 50, 1, 500),
  imageMaxMB: positiveIntEnv('IMAGE_MAX_SIZE_MB', 5, 1, 50),
};

export const APKG_MAX_BYTES = UPLOAD_LIMITS.apkgMaxMB * 1024 * 1024;
export const CSV_MAX_BYTES = UPLOAD_LIMITS.csvMaxMB * 1024 * 1024;
export const IMAGE_MAX_BYTES = UPLOAD_LIMITS.imageMaxMB * 1024 * 1024;

/** Uncompressed collection cap and zip-bomb ratio; both are bounded independently of the upload size. */
export const APKG_MAX_DATABASE_BYTES = Math.max(384, UPLOAD_LIMITS.apkgMaxMB * 2) * 1024 * 1024;
export const APKG_MAX_ENTRIES = 10_000;
export const APKG_MAX_NOTES = 5_000;
export const APKG_MAX_COMPRESSION_RATIO = 120;

/** Disk-backed directory for streamed uploads and extracted APKG databases. */
export const UPLOAD_TMP_DIR = resolve(process.env.UPLOAD_TMP_DIR?.trim() || tmpdir());
/** Node HTTP request timeout; large uploads need far more than the 5 minute default. */
export const REQUEST_TIMEOUT_MS = Math.max(60_000, Number(process.env.REQUEST_TIMEOUT_MS ?? 600_000) || 600_000);
export const APKG_PARSE_TIMEOUT_MS = Math.max(30_000, Number(process.env.APKG_PARSE_TIMEOUT_MS ?? 120_000) || 120_000);
export const CSV_PARSE_TIMEOUT_MS = Math.max(15_000, Number(process.env.CSV_PARSE_TIMEOUT_MS ?? 60_000) || 60_000);

/**
 * Persistent retry queue for cards that still have no image. A bounded batch per
 * interval keeps provider quotas and disk usage under control while gradually
 * covering the whole vocabulary library.
 */
export const IMAGE_RETRY_ENABLED = process.env.IMAGE_RETRY_ENABLED !== '0';
export const IMAGE_RETRY_INTERVAL_MINUTES = Math.max(1, Math.round(Number(process.env.IMAGE_RETRY_INTERVAL_MINUTES ?? 360)) || 360);
export const IMAGE_RETRY_BATCH = Math.max(1, Math.min(500, Math.round(Number(process.env.IMAGE_RETRY_BATCH ?? 100)) || 100));
export const IMAGE_RETRY_MAX_ATTEMPTS = Math.max(1, Math.min(20, Math.round(Number(process.env.IMAGE_RETRY_MAX_ATTEMPTS ?? 5)) || 5));

function hasSufficientCredentialEntropy(value: string): boolean {
  const chars = [...value];
  if (chars.length < 24) return false;
  const counts = new Map<string, number>();
  for (const char of chars) counts.set(char, (counts.get(char) ?? 0) + 1);
  if (counts.size < 8) return false;
  const bits = [...counts.values()].reduce((sum, count) => {
    const probability = count / chars.length;
    return sum - probability * Math.log2(probability);
  }, 0) * chars.length;
  if (bits < 128) return false;
  for (let period = 1; period <= Math.min(8, Math.floor(chars.length / 2)); period++) {
    if (chars.every((char, index) => char === chars[index % period])) return false;
  }
  return true;
}

/** Refuse development defaults and insecure origins in production deployments. */
export function validateProductionConfig(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== 'production') return;

  const databaseUser = env.DB_USER?.trim();
  const databasePassword = env.DB_PASSWORD;
  if (!databaseUser || databaseUser.toLowerCase() === 'root') {
    throw new Error('DB_USER must be a dedicated non-root user in production.');
  }
  const normalizedPassword = databasePassword?.trim().toLowerCase() ?? '';
  if (!databasePassword || /^(?:vocabup|root|password|changeme|change|replace|your|test|dev)(?:[-_ ]|$)/i.test(normalizedPassword) || !hasSufficientCredentialEntropy(databasePassword)) {
    throw new Error('DB_PASSWORD must be a strong, non-placeholder credential in production.');
  }

  const frontendOrigins = env.FRONTEND_URL?.split(',').map(value => value.trim()).filter(Boolean) ?? [];
  if (!frontendOrigins.length || frontendOrigins.some(origin => {
    try { const parsed = new URL(origin); return parsed.protocol !== 'https:' || parsed.origin !== origin; }
    catch { return true; }
  })) {
    throw new Error('FRONTEND_URL must list exact HTTPS origins in production.');
  }
  if (env.TRUST_PROXY !== undefined && !['0', '1'].includes(env.TRUST_PROXY)) {
    throw new Error('TRUST_PROXY must be 0 or 1.');
  }
}
