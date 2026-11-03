import { access, unlink } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { ImageProviderError, type ImageCandidate } from './image-provider.js';
import { MAX_IMAGE_BYTES, saveUploadedImage, UPLOAD_DIR } from './uploads.js';

/**
 * Hosts we are willing to download provider images from. Restricting the initial
 * URL prevents a malicious/compromised provider payload from turning the image
 * worker into an SSRF gadget against internal services.
 */
const ALLOWED_HOSTS = [
  'cdn.pixabay.com',
  'pixabay.com',
  'images.unsplash.com',
  'plus.unsplash.com',
  'images.pexels.com',
  'upload.wikimedia.org',
  'api.openverse.org',
  'openverse.org',
  'live.staticflickr.com',
  'staticflickr.com',
];

const IS_DEV = process.env.NODE_ENV !== 'production';

function isAllowed(url: string): boolean {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return false; }
  const local = ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(parsed.hostname);
  if (IS_DEV && local) return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  if (parsed.protocol !== 'https:') return false;
  return ALLOWED_HOSTS.some(host => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`));
}

export type StoredImage = { url: string; mime: string; bytes: number };

/** One download per provider URL per server process; cards sharing a sense reuse the file. */
const downloaded = new Map<string, StoredImage>();

async function fetchBuffer(url: string): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'VocabUp/1.0 (vocabulary illustrations)', Accept: 'image/*' },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!response.ok) throw new ImageProviderError('provider-error', `Không tải được ảnh (${response.status}).`);
    const contentLength = Number(response.headers.get('content-length') ?? 0);
    if (contentLength > MAX_IMAGE_BYTES) throw new ImageProviderError('provider-error', 'Ảnh từ provider vượt quá giới hạn dung lượng.');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) throw new ImageProviderError('provider-error', 'Ảnh tải về bị trống.');
    return buffer;
  } catch (error) {
    if (error instanceof ImageProviderError) throw error;
    if ((error as { name?: string }).name === 'AbortError') throw new ImageProviderError('timeout', 'Tải ảnh quá lâu.');
    throw new ImageProviderError('provider-error', 'Không tải được ảnh từ provider.');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Downloads the winning candidate to local disk (never hotlinks the provider).
 * Tries the full image, then the thumbnail, and verifies real bytes/size/magic.
 */
export async function downloadCandidateImage(candidate: ImageCandidate): Promise<StoredImage> {
  const key = candidate.url;
  const cached = downloaded.get(key);
  if (cached) {
    try { await access(resolve(UPLOAD_DIR, 'images', basename(cached.url))); return cached; } catch { downloaded.delete(key); }
  }
  const urls = [candidate.url, candidate.thumbnailUrl].filter((url, index, list) => Boolean(url) && list.indexOf(url) === index && isAllowed(url));
  if (!urls.length) throw new ImageProviderError('provider-error', 'URL ảnh không thuộc nguồn được phép tải.');
  let lastError: unknown;
  for (const url of urls) {
    try {
      const buffer = await fetchBuffer(url);
      const stored = await saveUploadedImage(buffer);
      downloaded.set(key, stored);
      return stored;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof ImageProviderError ? lastError : new ImageProviderError('provider-error', 'Không tải được ảnh từ provider.');
}

/** Removes a previously stored local image when a card image is replaced/deleted. */
export function removeStoredImage(url: string | null | undefined): void {
  const match = /^\/uploads\/images\/([a-z0-9-]+\.(?:jpg|png|webp|gif|svg))$/i.exec(url ?? '');
  if (!match) return;
  void unlink(resolve(UPLOAD_DIR, 'images', match[1]!)).catch(() => undefined);
}

export function isStoredImageUrl(url: string | null | undefined): boolean {
  return /^\/uploads\/images\/[a-z0-9-]+\.(?:jpg|png|webp|gif|svg)$/i.test(url ?? '');
}
