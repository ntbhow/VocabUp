import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IMAGE_MAX_BYTES, UPLOAD_LIMITS } from './config.js';

/** Filesystem root for uploaded illustrations (never stored in MySQL). */
export const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? resolve(process.env.UPLOAD_DIR)
  : resolve(dirname(fileURLToPath(import.meta.url)), '../uploads');

const IMAGE_DIR = resolve(UPLOAD_DIR, 'images');

export const MAX_IMAGE_BYTES = IMAGE_MAX_BYTES;
export const ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

type ImageSignature = { ext: string; mime: string; test: (buffer: Buffer) => boolean };
const SIGNATURES: ImageSignature[] = [
  { ext: 'jpg', mime: 'image/jpeg', test: buffer => buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff },
  { ext: 'png', mime: 'image/png', test: buffer => buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'webp', mime: 'image/webp', test: buffer => buffer.length > 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP' },
  { ext: 'gif', mime: 'image/gif', test: buffer => buffer.length > 6 && (buffer.toString('ascii', 0, 6) === 'GIF87a' || buffer.toString('ascii', 0, 6) === 'GIF89a') },
];

export class ImageUploadError extends Error {
  constructor(message: string) { super(message); this.name = 'ImageUploadError'; }
}

/** Detects the real file type from magic bytes instead of trusting the client MIME. */
export function detectImageType(buffer: Buffer): ImageSignature | null {
  return SIGNATURES.find(signature => signature.test(buffer)) ?? null;
}

/**
 * Validates and stores an uploaded image with a random, traversal-proof name.
 * Returns the public same-origin URL used by the browser.
 */
export async function saveUploadedImage(buffer: Buffer): Promise<{ url: string; mime: string; bytes: number }> {
  if (!buffer.length) throw new ImageUploadError('Ảnh tải lên bị trống.');
  if (buffer.length > MAX_IMAGE_BYTES) throw new ImageUploadError(`Ảnh vượt quá giới hạn ${UPLOAD_LIMITS.imageMaxMB} MB.`);
  const type = detectImageType(buffer);
  if (!type) throw new ImageUploadError('Chỉ hỗ trợ ảnh JPEG, PNG, WebP hoặc GIF.');
  await mkdir(IMAGE_DIR, { recursive: true });
  const filename = `${randomUUID()}.${type.ext}`;
  await writeFile(resolve(IMAGE_DIR, filename), buffer, { flag: 'wx' });
  return { url: `/uploads/images/${filename}`, mime: type.mime, bytes: buffer.length };
}

/**
 * Stores a trusted, server-generated SVG illustration (never user-provided
 * markup; all text is XML-escaped upstream). Used as the guaranteed fallback so
 * no vocabulary card is ever left without a visible image.
 */
export async function saveGeneratedSvg(svg: string): Promise<{ url: string; mime: string; bytes: number }> {
  const buffer = Buffer.from(svg, 'utf8');
  if (!buffer.length || buffer.length > 64 * 1024) throw new ImageUploadError('Ảnh minh họa không hợp lệ.');
  await mkdir(IMAGE_DIR, { recursive: true });
  const filename = `${randomUUID()}.svg`;
  await writeFile(resolve(IMAGE_DIR, filename), buffer, { flag: 'wx' });
  return { url: `/uploads/images/${filename}`, mime: 'image/svg+xml', bytes: buffer.length };
}
