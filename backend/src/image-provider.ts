import { pool } from './db.js';
import { expandImageQueries, normalizeQuery, resolveImageSense, tokenize, type SemanticCard, type SenseResolution } from './image-semantics.js';

export { normalizeQuery, normalizeText, tokenize } from './image-semantics.js';
export type { SemanticCard, SenseResolution } from './image-semantics.js';

export type ImageProviderName = 'pixabay' | 'unsplash' | 'pexels' | 'wikimedia' | 'openverse' | 'flickr';
export type ImageCacheStatus = 'ok' | 'empty' | 'error';

export interface ImageCandidate {
  provider: ImageProviderName;
  url: string;
  thumbnailUrl: string;
  width: number;
  height: number;
  author: string | null;
  sourceUrl: string | null;
  tags: string[];
  license?: string | null;
  licenseUrl?: string | null;
}

export interface RankedCandidate extends ImageCandidate {
  score: number;
  overlap: number;
  query: string;
}

export interface ImageSearchResult {
  candidates: RankedCandidate[];
  provider: ImageProviderName | null;
  status: ImageCacheStatus;
  providers: ImageProviderName[];
  failed: ImageProviderName[];
  cached: boolean;
}

export interface ImageProviderStatus {
  configured: boolean;
  provider: ImageProviderName | null;
  providers: ImageProviderName[];
}

export class ImageProviderError extends Error {
  code: 'not-configured' | 'timeout' | 'rate-limited' | 'provider-error';
  constructor(code: ImageProviderError['code'], message: string) {
    super(message);
    this.name = 'ImageProviderError';
    this.code = code;
  }
}

export interface ImageSuggestion {
  sense: SenseResolution;
  candidate: RankedCandidate | null;
  query: string | null;
  reason: 'ok' | 'low-confidence' | 'no-match' | 'provider-error';
  error?: string;
}

// Automatic image search is restricted to the two approved sources. The other
// parsers stay in the file for reference but can never be selected at runtime.
const ALL_PROVIDERS: ImageProviderName[] = ['pixabay', 'unsplash'];

/** Default licences for providers whose API does not return per-image terms. */
const PROVIDER_LICENSE: Record<ImageProviderName, { license: string; licenseUrl: string | null }> = {
  pixabay: { license: 'Pixabay Content License', licenseUrl: 'https://pixabay.com/service/license-summary/' },
  unsplash: { license: 'Unsplash License', licenseUrl: 'https://unsplash.com/license' },
  pexels: { license: 'Pexels License', licenseUrl: 'https://www.pexels.com/license/' },
  wikimedia: { license: 'Wikimedia Commons', licenseUrl: 'https://commons.wikimedia.org/wiki/Commons:Licensing' },
  openverse: { license: 'Openverse (CC)', licenseUrl: 'https://openverse.org/' },
  flickr: { license: 'Flickr (CC)', licenseUrl: 'https://www.flickr.com/creativecommons/' },
};

const PROVIDER_TRUST: Record<ImageProviderName, number> = {
  pixabay: 0.02, unsplash: 0.02, pexels: 0.02, wikimedia: 0.015, openverse: 0.01, flickr: 0.01,
};

const INTERVALS: Record<ImageProviderName, number> = {
  pixabay: 650, unsplash: 1100, pexels: 400, wikimedia: 250, openverse: 350, flickr: 500,
};

function envAllowlist(): ImageProviderName[] | null {
  const raw = process.env.IMAGE_PROVIDERS?.trim();
  if (!raw) return null;
  const selected = raw.split(',').map(value => value.trim().toLowerCase()).filter((value): value is ImageProviderName => (ALL_PROVIDERS as string[]).includes(value));
  return selected.length ? selected : null;
}

function providerEnabled(name: ImageProviderName): boolean {
  switch (name) {
    case 'pixabay': return Boolean(process.env.PIXABAY_API_KEY?.trim());
    case 'unsplash': return Boolean(process.env.UNSPLASH_ACCESS_KEY?.trim());
    case 'pexels': return Boolean(process.env.PEXELS_API_KEY?.trim());
    case 'flickr': return Boolean(process.env.FLICKR_API_KEY?.trim());
    case 'wikimedia': return process.env.IMAGE_DISABLE_WIKIMEDIA !== '1';
    case 'openverse': return process.env.IMAGE_DISABLE_OPENVERSE !== '1';
  }
}

/** Providers in priority order. Wikimedia/Openverse are keyless and enabled by default. */
export function configuredProviders(): ImageProviderName[] {
  const allow = envAllowlist();
  return ALL_PROVIDERS.filter(name => (!allow || allow.includes(name)) && providerEnabled(name));
}

export function imageProviderStatus(): ImageProviderStatus {
  const providers = configuredProviders();
  return { configured: providers.length > 0, provider: providers[0] ?? null, providers };
}

/** Convenience for callers/tests: all semantic query variants for a card. */
export function buildQueries(card: SemanticCard): string[] {
  return resolveImageSense(card).queries;
}

function tokenMatches(queryToken: string, candidateToken: string): boolean {
  if (queryToken === candidateToken) return true;
  if (queryToken.length >= 4 && candidateToken.startsWith(queryToken)) return true;
  if (candidateToken.length >= 4 && queryToken.startsWith(candidateToken)) return true;
  return false;
}

export function rankCandidates(candidates: ImageCandidate[], query: string): RankedCandidate[] {
  const queryTokens = tokenize(query);
  const total = candidates.length;
  return candidates
    .map((candidate, index) => {
      const haystack = tokenize(candidate.tags.join(' '));
      let matches = 0;
      for (const token of queryTokens) {
        if (haystack.some(hay => tokenMatches(token, hay))) matches += 1;
      }
      const overlap = queryTokens.length ? matches / queryTokens.length : 0;
      const rankBonus = total > 1 ? (1 - index / (total - 1)) * 0.15 : 0.15;
      const resolutionBonus = Math.min(0.1, (candidate.width * candidate.height) / (1600 * 1000) * 0.1);
      const score = overlap >= 0.5
        ? 0.7 + overlap * 0.2 + rankBonus + resolutionBonus
        : overlap > 0
          ? 0.3 + overlap + rankBonus + resolutionBonus
          : rankBonus + resolutionBonus;
      return { ...candidate, overlap, score: Math.round(score * 1000) / 1000, query };
    })
    .sort((left, right) => right.score - left.score);
}

/** Kept for callers/tests; the multi-provider pipeline uses pickSemanticCandidate. */
export function pickBestCandidate(candidates: RankedCandidate[], options: { requireOverlap: boolean }): RankedCandidate | null {
  const best = candidates[0];
  if (!best) return null;
  if (options.requireOverlap && best.overlap <= 0) return null;
  if (!options.requireOverlap && (best.width < 400 || best.height < 300)) return null;
  return best;
}

function isSafeImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:') return true;
    return process.env.NODE_ENV !== 'production' && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
}

export function parsePixabayPayload(payload: unknown): ImageCandidate[] {
  const hits = (payload as { hits?: unknown } | null)?.hits;
  if (!Array.isArray(hits)) return [];
  return hits.flatMap(hit => {
    if (!hit || typeof hit !== 'object') return [];
    const row = hit as Record<string, unknown>;
    const url = String(row.largeImageURL ?? row.webformatURL ?? '');
    if (!url || url.length > 2048 || !isSafeImageUrl(url)) return [];
    const thumbnail = String(row.previewURL ?? row.webformatURL ?? url);
    const tags = String(row.tags ?? '').split(',').map(tag => tag.trim()).filter(Boolean).slice(0, 20);
    const pageUrl = row.pageURL ? String(row.pageURL) : '';
    return [{
      provider: 'pixabay' as const,
      url,
      thumbnailUrl: isSafeImageUrl(thumbnail) ? thumbnail : url,
      width: Number(row.imageWidth ?? 0) || 0,
      height: Number(row.imageHeight ?? 0) || 0,
      author: row.user ? String(row.user).slice(0, 255) : null,
      sourceUrl: pageUrl && isSafeImageUrl(pageUrl) ? pageUrl : null,
      tags,
      license: PROVIDER_LICENSE.pixabay.license,
      licenseUrl: PROVIDER_LICENSE.pixabay.licenseUrl,
    }];
  }).slice(0, 20);
}

export function parseUnsplashPayload(payload: unknown): ImageCandidate[] {
  const results = (payload as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return [];
  return results.flatMap(result => {
    if (!result || typeof result !== 'object') return [];
    const row = result as Record<string, unknown>;
    const urls = (row.urls ?? {}) as Record<string, unknown>;
    const url = String(urls.regular ?? urls.full ?? '');
    if (!url || url.length > 2048 || !isSafeImageUrl(url)) return [];
    const thumbnail = String(urls.small ?? urls.thumb ?? url);
    const links = (row.links ?? {}) as Record<string, unknown>;
    const sourceUrl = links.html ? String(links.html) : '';
    const user = (row.user ?? {}) as Record<string, unknown>;
    const alt = String(row.alt_description ?? row.description ?? '');
    return [{
      provider: 'unsplash' as const,
      url,
      thumbnailUrl: isSafeImageUrl(thumbnail) ? thumbnail : url,
      width: Number(row.width ?? 0) || 0,
      height: Number(row.height ?? 0) || 0,
      author: user.name ? String(user.name).slice(0, 255) : null,
      sourceUrl: sourceUrl && isSafeImageUrl(sourceUrl) ? sourceUrl : null,
      tags: alt.split(/\s+/).filter(Boolean).slice(0, 24),
      license: PROVIDER_LICENSE.unsplash.license,
      licenseUrl: PROVIDER_LICENSE.unsplash.licenseUrl,
    }];
  }).slice(0, 20);
}

export function parsePexelsPayload(payload: unknown): ImageCandidate[] {
  const photos = (payload as { photos?: unknown } | null)?.photos;
  if (!Array.isArray(photos)) return [];
  return photos.flatMap(photo => {
    if (!photo || typeof photo !== 'object') return [];
    const row = photo as Record<string, unknown>;
    const src = (row.src ?? {}) as Record<string, unknown>;
    const url = String(src.large2x ?? src.original ?? src.large ?? '');
    if (!url || url.length > 2048 || !isSafeImageUrl(url)) return [];
    const thumbnail = String(src.medium ?? src.small ?? src.tiny ?? url);
    const alt = String(row.alt ?? '');
    return [{
      provider: 'pexels' as const,
      url,
      thumbnailUrl: isSafeImageUrl(thumbnail) ? thumbnail : url,
      width: Number(row.width ?? 0) || 0,
      height: Number(row.height ?? 0) || 0,
      author: row.photographer ? String(row.photographer).slice(0, 255) : null,
      sourceUrl: row.url && isSafeImageUrl(String(row.url)) ? String(row.url) : null,
      tags: alt.split(/\s+/).filter(Boolean).slice(0, 24),
      license: PROVIDER_LICENSE.pexels.license,
      licenseUrl: PROVIDER_LICENSE.pexels.licenseUrl,
    }];
  }).slice(0, 20);
}

export function parseWikimediaPayload(payload: unknown): ImageCandidate[] {
  const pages = (payload as { query?: { pages?: unknown } } | null)?.query?.pages;
  if (!pages || typeof pages !== 'object') return [];
  return Object.values(pages as Record<string, unknown>).flatMap(page => {
    if (!page || typeof page !== 'object') return [];
    const row = page as Record<string, unknown>;
    const info = Array.isArray(row.imageinfo) ? row.imageinfo[0] as Record<string, unknown> | undefined : undefined;
    if (!info) return [];
    const mime = String(info.mime ?? '');
    if (mime && !/^image\/(jpeg|png|webp)$/i.test(mime)) return [];
    const url = String(info.thumburl ?? info.url ?? '');
    if (!url || url.length > 2048 || !isSafeImageUrl(url)) return [];
    const thumbnail = String(info.thumburl ?? info.url ?? url);
    const meta = (info.extmetadata ?? {}) as Record<string, { value?: unknown } | undefined>;
    const value = (key: string): string => meta[key]?.value ? stripHtml(String(meta[key]!.value)) : '';
    const license = value('LicenseShortName') || PROVIDER_LICENSE.wikimedia.license;
    const licenseUrl = value('LicenseUrl');
    const author = value('Artist') || null;
    const description = value('ImageDescription');
    const title = String(row.title ?? '').replace(/^File:/i, '');
    return [{
      provider: 'wikimedia' as const,
      url,
      thumbnailUrl: isSafeImageUrl(thumbnail) ? thumbnail : url,
      width: Number(info.thumbwidth ?? info.width ?? 0) || 0,
      height: Number(info.thumbheight ?? info.height ?? 0) || 0,
      author,
      sourceUrl: info.descriptionurl && isSafeImageUrl(String(info.descriptionurl)) ? String(info.descriptionurl) : null,
      tags: `${title} ${description}`.split(/\s+/).filter(Boolean).slice(0, 24),
      license,
      licenseUrl: licenseUrl && isSafeImageUrl(licenseUrl) ? licenseUrl : null,
    }];
  }).slice(0, 20);
}

function openverseLicense(license: string, version: string): string {
  const code = license.toLowerCase();
  if (!code) return PROVIDER_LICENSE.openverse.license;
  if (code === 'cc0') return 'CC0 1.0';
  if (code === 'pdm') return 'Public Domain Mark';
  return `CC ${code.split('-').map(part => part.toUpperCase()).join('-')}${version ? ` ${version}` : ''}`;
}

export function parseOpenversePayload(payload: unknown): ImageCandidate[] {
  const results = (payload as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return [];
  return results.flatMap(result => {
    if (!result || typeof result !== 'object') return [];
    const row = result as Record<string, unknown>;
    const url = String(row.url ?? '');
    if (!url || url.length > 2048 || !isSafeImageUrl(url)) return [];
    const thumbnail = String(row.thumbnail ?? row.url ?? '');
    const tags = Array.isArray(row.tags)
      ? row.tags.map(tag => tag && typeof tag === 'object' ? String((tag as { name?: unknown }).name ?? '') : String(tag ?? ''))
      : [];
    const title = String(row.title ?? '');
    return [{
      provider: 'openverse' as const,
      url,
      thumbnailUrl: isSafeImageUrl(thumbnail) ? thumbnail : url,
      width: Number(row.width ?? 0) || 0,
      height: Number(row.height ?? 0) || 0,
      author: row.creator ? String(row.creator).slice(0, 255) : null,
      sourceUrl: row.foreign_landing_url && isSafeImageUrl(String(row.foreign_landing_url)) ? String(row.foreign_landing_url) : null,
      tags: [...tags, title].filter(Boolean).join(' ').split(/\s+/).filter(Boolean).slice(0, 24),
      license: openverseLicense(String(row.license ?? ''), String(row.license_version ?? '')),
      licenseUrl: row.license_url && isSafeImageUrl(String(row.license_url)) ? String(row.license_url) : null,
    }];
  }).slice(0, 20);
}

const FLICKR_LICENSES: Record<string, string> = {
  '0': 'All Rights Reserved',
  '1': 'CC BY-NC-SA 2.0',
  '2': 'CC BY-NC 2.0',
  '3': 'CC BY-NC-ND 2.0',
  '4': 'CC BY 2.0',
  '5': 'CC BY-SA 2.0',
  '6': 'CC BY-ND 2.0',
  '7': 'No known copyright restrictions',
  '8': 'United States Government Work',
  '9': 'CC0 1.0',
  '10': 'Public Domain Mark 1.0',
};

export function parseFlickrPayload(payload: unknown): ImageCandidate[] {
  const photos = (payload as { photos?: { photo?: unknown } } | null)?.photos?.photo;
  if (!Array.isArray(photos)) return [];
  return photos.flatMap(photo => {
    if (!photo || typeof photo !== 'object') return [];
    const row = photo as Record<string, unknown>;
    const url = String(row.url_l ?? row.url_m ?? '');
    if (!url || url.length > 2048 || !isSafeImageUrl(url)) return [];
    const thumbnail = String(row.url_m ?? row.url_l ?? url);
    const description = String((row.description as { _content?: unknown } | undefined)?._content ?? '');
    const licenseId = String(row.license ?? '');
    if (licenseId === '0') return [];
    const owner = String(row.owner ?? '');
    const id = String(row.id ?? '');
    return [{
      provider: 'flickr' as const,
      url,
      thumbnailUrl: isSafeImageUrl(thumbnail) ? thumbnail : url,
      width: row.url_l ? 1024 : 640,
      height: row.url_l ? 768 : 480,
      author: row.ownername ? String(row.ownername).slice(0, 255) : null,
      sourceUrl: owner && id ? `https://www.flickr.com/photos/${owner}/${id}` : null,
      tags: `${String(row.title ?? '')} ${description} ${String(row.tags ?? '')}`.split(/\s+/).filter(Boolean).slice(0, 24),
      license: FLICKR_LICENSES[licenseId] ?? 'Flickr (CC)',
      licenseUrl: 'https://www.flickr.com/creativecommons/',
    }];
  }).slice(0, 20);
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function requestJson(url: URL, headers: Record<string, string>, timeoutMs = 6000): Promise<unknown> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { headers, signal: controller.signal });
      if (response.status === 429 || response.status === 403) throw new ImageProviderError('rate-limited', 'Dịch vụ ảnh đang giới hạn truy cập.');
      if (response.status >= 500) throw new ImageProviderError('provider-error', `Dịch vụ ảnh tạm thời không khả dụng (${response.status}).`);
      if (!response.ok) throw new ImageProviderError('provider-error', `Dịch vụ ảnh trả lỗi ${response.status}.`);
      return await response.json();
    } catch (error) {
      const retryable = !(error instanceof ImageProviderError) || error.code === 'provider-error' || error.code === 'timeout';
      if (!retryable) throw error;
      if (attempt === 0) { await delay(400); continue; }
      throw error instanceof ImageProviderError ? error : new ImageProviderError('timeout', 'Không thể kết nối dịch vụ ảnh.');
    } finally {
      clearTimeout(timer);
    }
  }
  throw new ImageProviderError('timeout', 'Không thể kết nối dịch vụ ảnh.');
}

async function searchPixabay(query: string): Promise<ImageCandidate[]> {
  const key = process.env.PIXABAY_API_KEY?.trim();
  if (!key) throw new ImageProviderError('not-configured', 'Chưa cấu hình PIXABAY_API_KEY.');
  const url = new URL(process.env.PIXABAY_API_BASE_URL?.trim() || 'https://pixabay.com/api/');
  url.searchParams.set('key', key);
  url.searchParams.set('q', query);
  url.searchParams.set('image_type', 'photo');
  url.searchParams.set('orientation', 'horizontal');
  url.searchParams.set('safesearch', 'true');
  url.searchParams.set('per_page', '20');
  url.searchParams.set('lang', 'en');
  return parsePixabayPayload(await requestJson(url, { Accept: 'application/json' }));
}

async function searchUnsplash(query: string): Promise<ImageCandidate[]> {
  const key = process.env.UNSPLASH_ACCESS_KEY?.trim();
  if (!key) throw new ImageProviderError('not-configured', 'Chưa cấu hình UNSPLASH_ACCESS_KEY.');
  const url = new URL(process.env.UNSPLASH_API_BASE_URL?.trim() || 'https://api.unsplash.com/search/photos');
  url.searchParams.set('query', query);
  url.searchParams.set('per_page', '20');
  url.searchParams.set('orientation', 'landscape');
  url.searchParams.set('content_filter', 'high');
  const payload = await requestJson(url, { Accept: 'application/json', Authorization: `Client-ID ${key}`, 'Accept-Version': 'v1' });
  return parseUnsplashPayload(payload);
}

async function searchPexels(query: string): Promise<ImageCandidate[]> {
  const key = process.env.PEXELS_API_KEY?.trim();
  if (!key) throw new ImageProviderError('not-configured', 'Chưa cấu hình PEXELS_API_KEY.');
  const url = new URL(process.env.PEXELS_API_BASE_URL?.trim() || 'https://api.pexels.com/v1/search');
  url.searchParams.set('query', query);
  url.searchParams.set('per_page', '20');
  url.searchParams.set('orientation', 'landscape');
  return parsePexelsPayload(await requestJson(url, { Accept: 'application/json', Authorization: key }));
}

async function searchWikimedia(query: string): Promise<ImageCandidate[]> {
  const url = new URL(process.env.WIKIMEDIA_API_BASE_URL?.trim() || 'https://commons.wikimedia.org/w/api.php');
  url.searchParams.set('action', 'query');
  url.searchParams.set('generator', 'search');
  url.searchParams.set('gsrsearch', query);
  url.searchParams.set('gsrnamespace', '6');
  url.searchParams.set('gsrlimit', '20');
  url.searchParams.set('prop', 'imageinfo');
  url.searchParams.set('iiprop', 'url|extmetadata|mime|size');
  url.searchParams.set('iiurlwidth', '1200');
  url.searchParams.set('format', 'json');
  const payload = await requestJson(url, { Accept: 'application/json', 'User-Agent': 'VocabUp/1.0 (vocabulary images)' }, 5000);
  return parseWikimediaPayload(payload);
}

async function searchOpenverse(query: string): Promise<ImageCandidate[]> {
  const url = new URL(process.env.OPENVERSE_API_BASE_URL?.trim() || 'https://api.openverse.org/v1/images/');
  url.searchParams.set('q', query);
  url.searchParams.set('page_size', '20');
  url.searchParams.set('license_type', 'all');
  url.searchParams.set('safe', 'true');
  const payload = await requestJson(url, { Accept: 'application/json', 'User-Agent': 'VocabUp/1.0 (vocabulary images)' }, 3500);
  return parseOpenversePayload(payload);
}

async function searchFlickr(query: string): Promise<ImageCandidate[]> {
  const key = process.env.FLICKR_API_KEY?.trim();
  if (!key) throw new ImageProviderError('not-configured', 'Chưa cấu hình FLICKR_API_KEY.');
  const url = new URL(process.env.FLICKR_API_BASE_URL?.trim() || 'https://api.flickr.com/services/rest/');
  url.searchParams.set('method', 'flickr.photos.search');
  url.searchParams.set('api_key', key);
  url.searchParams.set('text', query);
  url.searchParams.set('per_page', '20');
  url.searchParams.set('content_type', '1');
  url.searchParams.set('media', 'photos');
  url.searchParams.set('license', '1,2,3,4,5,6,7,8,9,10');
  url.searchParams.set('extras', 'url_m,url_l,owner_name,license,description,tags');
  url.searchParams.set('format', 'json');
  url.searchParams.set('nojsoncallback', '1');
  url.searchParams.set('safe_search', '1');
  return parseFlickrPayload(await requestJson(url, { Accept: 'application/json' }));
}

const SEARCHERS: Record<ImageProviderName, (query: string) => Promise<ImageCandidate[]>> = {
  pixabay: searchPixabay,
  unsplash: searchUnsplash,
  pexels: searchPexels,
  wikimedia: searchWikimedia,
  openverse: searchOpenverse,
  flickr: searchFlickr,
};

const nextAllowedAt = new Map<ImageProviderName, number>();

async function throttle(name: ImageProviderName): Promise<void> {
  const now = Date.now();
  const wait = Math.max(0, (nextAllowedAt.get(name) ?? 0) - now);
  if (wait > 0) await delay(wait);
  nextAllowedAt.set(name, Date.now() + INTERVALS[name]);
}

async function searchProvider(name: ImageProviderName, query: string): Promise<ImageCandidate[]> {
  await throttle(name);
  return SEARCHERS[name](query);
}

interface CacheRow { provider: ImageProviderName; status: ImageCacheStatus; candidates: unknown }

async function readCache(key: string): Promise<{ provider: ImageProviderName; status: ImageCacheStatus; candidates: RankedCandidate[] } | null> {
  const [rows] = await pool.execute('SELECT provider, status, candidates FROM image_search_cache WHERE query_key = ? AND expires_at > UTC_TIMESTAMP()', [key]);
  const row = (rows as CacheRow[])[0];
  if (!row) return null;
  return { provider: row.provider, status: row.status, candidates: Array.isArray(row.candidates) ? row.candidates as RankedCandidate[] : [] };
}

async function writeCache(key: string, provider: ImageProviderName, status: ImageCacheStatus, candidates: RankedCandidate[], ttlSeconds: number): Promise<void> {
  try {
    await pool.execute(
      'INSERT INTO image_search_cache (query_key, provider, status, candidates, expires_at) VALUES (?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND)) ON DUPLICATE KEY UPDATE provider = VALUES(provider), status = VALUES(status), candidates = VALUES(candidates), expires_at = VALUES(expires_at)',
      [key, provider, status, JSON.stringify(candidates), ttlSeconds],
    );
  } catch (error) {
    console.error('[vocabup] Failed to write image search cache.', { code: (error as { code?: string }).code });
  }
}

function dedupeCandidates(candidates: ImageCandidate[]): ImageCandidate[] {
  const seen = new Set<string>();
  const result: ImageCandidate[] = [];
  for (const candidate of candidates) {
    const key = candidate.url.split('#')[0] ?? candidate.url;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(candidate);
  }
  return result;
}

const inflight = new Map<string, Promise<ImageSearchResult>>();

/**
 * Searches every configured provider in parallel for one query, merges and ranks
 * the results, and caches them. A provider failure is recorded instead of being
 * reported as NOT_FOUND; only when every provider fails does the call throw.
 */
export async function searchImages(query: string): Promise<ImageSearchResult> {
  const key = normalizeQuery(query);
  if (!key) throw new ImageProviderError('provider-error', 'Từ khóa tìm ảnh bị trống.');
  const cached = await readCache(key);
  if (cached && cached.status !== 'error') {
    // Older cache rows predate licence capture; fill the provider default so a
    // cached image still records attribution terms when it is attached.
    const candidates = cached.candidates.map(candidate => ({
      ...candidate,
      license: candidate.license ?? PROVIDER_LICENSE[candidate.provider]?.license ?? null,
      licenseUrl: candidate.licenseUrl ?? PROVIDER_LICENSE[candidate.provider]?.licenseUrl ?? null,
    }));
    return { candidates, provider: cached.provider, status: cached.status, providers: [], failed: [], cached: true };
  }
  const running = inflight.get(key);
  if (running) return running;
  const promise = (async (): Promise<ImageSearchResult> => {
    const providers = configuredProviders();
    if (!providers.length) throw new ImageProviderError('not-configured', 'Chưa cấu hình API key cho dịch vụ ảnh. Thêm PIXABAY_API_KEY, UNSPLASH_ACCESS_KEY hoặc PEXELS_API_KEY vào backend/.env.');
    const settled = await Promise.allSettled(providers.map(name => searchProvider(name, query)));
    const candidates: ImageCandidate[] = [];
    const failed: ImageProviderName[] = [];
    const used: ImageProviderName[] = [];
    settled.forEach((result, index) => {
      const name = providers[index]!;
      if (result.status === 'fulfilled') { used.push(name); candidates.push(...result.value); }
      else failed.push(name);
    });
    const ranked = rankCandidates(dedupeCandidates(candidates), query).slice(0, 80);
    const status: ImageCacheStatus = ranked.length ? 'ok' : (used.length === 0 ? 'error' : 'empty');
    const provider = ranked[0]?.provider ?? used[0] ?? providers[0]!;
    if (status === 'error') {
      await writeCache(key, provider, 'error', [], 60);
      throw new ImageProviderError('provider-error', 'Không thể kết nối dịch vụ ảnh. Vui lòng thử lại sau.');
    }
    await writeCache(key, provider, status, ranked, ranked.length ? 24 * 3600 : 3600);
    return { candidates: ranked, provider: ranked.length ? provider : null, status, providers: used, failed, cached: false };
  })();
  inflight.set(key, promise);
  try { return await promise; } finally { inflight.delete(key); }
}

function candidateMatchesTerms(candidate: RankedCandidate, terms: string[]): boolean {
  const required = terms.filter(term => term.length >= 2);
  if (!required.length) return true;
  const tags = tokenize(candidate.tags.join(' '));
  const matched = required.filter(term => tags.some(tag => tokenMatches(term, tag))).length;
  return matched >= Math.min(2, required.length);
}

function senseScore(candidate: RankedCandidate, sense: SenseResolution): number {
  const tags = tokenize(candidate.tags.join(' '));
  const matches = (term: string) => tags.some(tag => tokenMatches(term, tag));
  const required = sense.requiredTerms.filter(term => term.length >= 2);
  const core = required.slice(0, 2);
  const context = sense.contextTerms.filter(term => term.length >= 3);
  const requiredRatio = required.length ? required.filter(matches).length / required.length : 1;
  const coreRatio = core.length ? core.filter(matches).length / core.length : 1;
  const contextRatio = context.length ? context.filter(matches).length / context.length : 0;
  const semantic = coreRatio * 0.45 + requiredRatio * 0.2 + candidate.overlap * 0.15 + contextRatio * 0.05;
  const resolution = Math.min(1, (candidate.width * candidate.height) / (1600 * 1000)) * 0.06;
  const orientation = candidate.width >= candidate.height ? 0.03 : 0;
  const license = candidate.license ? 0.01 : 0;
  return semantic + resolution + orientation + license + (PROVIDER_TRUST[candidate.provider] ?? 0);
}

/**
 * Chooses the best candidate across all providers for a resolved sense. The gate
 * refuses weak matches instead of attaching an unrelated image.
 */
export function pickSemanticCandidate(candidates: RankedCandidate[], sense: SenseResolution, excludeUrls?: Set<string>): RankedCandidate | null {
  const scored = candidates
    .filter(candidate => !excludeUrls?.has(candidate.url))
    .map(candidate => ({ candidate, finalScore: senseScore(candidate, sense) + (candidate.provider === 'pixabay' ? 0.04 : 0) }))
    .sort((left, right) => right.finalScore - left.finalScore);
  for (const { candidate, finalScore } of scored) {
    if (finalScore < 0.55) continue;
    if (candidate.overlap < 0.5) continue;
    if (candidate.width < 400 || candidate.height < 300) continue;
    if (!candidateMatchesTerms(candidate, sense.requiredTerms)) continue;
    return candidate;
  }
  return null;
}

/**
 * Tries every query variant (stopping as soon as a safe candidate is found) and
 * reports provider errors separately from a genuine "no matching image".
 */
export async function suggestImageForCard(card: SemanticCard, options: { excludeUrls?: Set<string>; expanded?: boolean } = {}): Promise<ImageSuggestion> {
  const sense = resolveImageSense(card);
  if (!sense.queries.length || sense.confidence < 0.5) {
    return { sense, candidate: null, query: sense.queries[0] ?? null, reason: 'low-confidence' };
  }
  let providerErrors = 0;
  let lastError: string | undefined;
  const queries = options.expanded ? expandImageQueries(card, sense) : sense.queries.slice(0, 4);
  for (const query of queries) {
    try {
      const result = await searchImages(query);
      // Expanded queries answer a different phrasing (synonym/definition/example),
      // so their gate uses the query's own content words, not the sense's concept.
      const extra = options.expanded && !sense.queries.includes(query);
      const gate = extra
        ? { ...sense, requiredTerms: tokenize(query).filter(token => token.length >= 3).slice(0, 3) }
        : sense;
      const candidate = pickSemanticCandidate(result.candidates, gate, options.excludeUrls);
      if (candidate) return { sense, candidate, query, reason: 'ok' };
    } catch (error) {
      if (error instanceof ImageProviderError && error.code === 'not-configured') {
        return { sense, candidate: null, query, reason: 'low-confidence' };
      }
      providerErrors += 1;
      lastError = error instanceof Error ? error.message : 'Không thể kết nối dịch vụ ảnh.';
    }
  }
  if (providerErrors > 0 && providerErrors === queries.length) {
    return { sense, candidate: null, query: queries[0] ?? null, reason: 'provider-error', error: lastError };
  }
  return { sense, candidate: null, query: queries[0] ?? null, reason: 'no-match' };
}

/** Backwards-compatible helper: the best image for a card, or null. */
export async function findImageForCard(card: SemanticCard): Promise<RankedCandidate | null> {
  const suggestion = await suggestImageForCard(card);
  return suggestion.candidate;
}
