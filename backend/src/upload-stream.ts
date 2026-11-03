import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export type UploadKind = 'APKG' | 'CSV';

/** A friendly, typed 413 used for both Content-Length pre-checks and streaming guards. */
export class UploadLimitError extends Error {
  readonly status = 413;
  readonly code = 'FILE_TOO_LARGE';
  constructor(readonly kind: UploadKind, readonly limitMB: number) {
    super(`File ${kind} vượt quá giới hạn ${limitMB} MB.`);
    this.name = 'UploadLimitError';
  }
}

export class UploadTimeoutError extends Error {
  readonly status = 408;
  constructor(message: string) {
    super(message);
    this.name = 'UploadTimeoutError';
  }
}

export interface TempUpload {
  path: string;
  dir: string;
  size: number;
  cleanup: () => Promise<void>;
}

/** Rejects before the body is read when the client declared an oversized body. */
export function contentLengthExceeds(req: IncomingMessage, maxBytes: number): boolean {
  const raw = req.headers['content-length'];
  if (!raw) return false;
  const length = Number(raw);
  return Number.isFinite(length) && length > maxBytes;
}

/**
 * Streams a request body to a private temp file. Nothing is buffered in RAM, the
 * byte guard aborts oversized bodies mid-stream, and every error path cleans up.
 */
export async function receiveToTempFile(
  req: IncomingMessage,
  options: { maxBytes: number; kind: UploadKind; limitMB: number; extension: string; tempDir: string },
): Promise<TempUpload> {
  await mkdir(options.tempDir, { recursive: true });
  const dir = await mkdtemp(join(options.tempDir, 'vocabup-upload-'));
  const path = join(dir, `upload.${options.extension}`);
  let size = 0;
  const guard = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      if (size > options.maxBytes) { callback(new UploadLimitError(options.kind, options.limitMB)); return; }
      callback(null, chunk);
    },
  });
  try {
    await pipeline(req, guard, createWriteStream(path, { flags: 'wx' }));
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
  return { path, dir, size, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/** Rejects a slow parse without leaving the caller without a typed error. */
export function withTimeoutReject<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new UploadTimeoutError(message)), ms); });
  return Promise.race([promise, timeout]).finally(() => { if (timer) clearTimeout(timer); });
}
