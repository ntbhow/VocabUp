import { pool } from './db.js';
import { downloadCandidateImage, removeStoredImage } from './image-download.js';
import type { ImageCandidate } from './image-provider.js';

export const imageColumns = 'image_url AS imageUrl, image_thumbnail_url AS imageThumbnailUrl, image_source AS imageSource, image_author AS imageAuthor, image_source_url AS imageSourceUrl, image_license AS imageLicense, image_license_url AS imageLicenseUrl, image_query AS imageQuery, image_status AS imageStatus, image_is_manual AS imageIsManual, image_is_fallback AS imageIsFallback, image_updated_at AS imageUpdatedAt';

/** Reads only the illustration fields of one card. */
export async function cardImageFields(cardId: number): Promise<Record<string, unknown>> {
  const [rows] = await pool.execute(`SELECT ${imageColumns} FROM cards WHERE id = ?`, [cardId]);
  return (rows as Record<string, unknown>[])[0] ?? {};
}

/**
 * Downloads the chosen provider image to local storage, stores its attribution,
 * licence and search query, and resets the retry counters. The DB only ever
 * points at a local `/uploads/images/...` file for automatic images.
 */
export async function setCardImage(cardId: number, candidate: ImageCandidate & { query?: string }, manual: boolean, query?: string | null): Promise<Record<string, unknown>> {
  const stored = await downloadCandidateImage(candidate);
  const [previousRows] = await pool.execute('SELECT image_url FROM cards WHERE id = ?', [cardId]);
  const previous = (previousRows as Array<{ image_url: string | null }>)[0]?.image_url ?? null;
  await pool.execute(
    "UPDATE cards SET image_url = ?, image_thumbnail_url = ?, image_source = ?, image_author = ?, image_source_url = ?, image_license = ?, image_license_url = ?, image_query = ?, image_status = 'ready', image_is_manual = ?, image_is_fallback = 0, image_retry_count = 0, image_retry_at = NULL, image_updated_at = UTC_TIMESTAMP() WHERE id = ?",
    [stored.url, stored.url, candidate.provider, candidate.author, candidate.sourceUrl, candidate.license ?? null, candidate.licenseUrl ?? null, query ?? candidate.query ?? null, manual ? 1 : 0, cardId],
  );
  if (previous && previous !== stored.url) removeStoredImage(previous);
  return cardImageFields(cardId);
}

export async function clearCardImage(cardId: number): Promise<Record<string, unknown>> {
  const [previousRows] = await pool.execute('SELECT image_url FROM cards WHERE id = ?', [cardId]);
  const previous = (previousRows as Array<{ image_url: string | null }>)[0]?.image_url ?? null;
  await pool.execute("UPDATE cards SET image_url = NULL, image_thumbnail_url = NULL, image_source = NULL, image_author = NULL, image_source_url = NULL, image_license = NULL, image_license_url = NULL, image_query = NULL, image_status = 'none', image_is_manual = 0, image_is_fallback = 0, image_retry_count = 0, image_retry_at = NULL, image_updated_at = UTC_TIMESTAMP() WHERE id = ?", [cardId]);
  removeStoredImage(previous);
  return cardImageFields(cardId);
}
