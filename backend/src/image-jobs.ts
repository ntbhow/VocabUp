import { randomUUID } from 'node:crypto';
import { pool } from './db.js';
import { suggestImageForCard, type RankedCandidate } from './image-provider.js';
import { setCardImage } from './image-store.js';

export type ImageJobItemStatus = 'pending' | 'searching' | 'ready' | 'not_found' | 'error';

export interface ImageJobItem { cardId: number; front: string; status: ImageJobItemStatus; message?: string; query?: string }

export interface ImageJobView {
  id: string;
  deckId: number | null;
  status: 'running' | 'done';
  total: number;
  processed: number;
  succeeded: number;
  notFound: number;
  failed: number;
  createdAt: number;
  finishedAt?: number;
  items: ImageJobItem[];
}

export interface JobCard { id: number; front: string; back: string; translation: string; example?: string | null }

interface InternalJob extends ImageJobView {
  userId: number;
  cards: Map<number, JobCard>;
  /** Retry jobs also try synonyms/definition/example queries. */
  expanded: boolean;
}

const jobs = new Map<string, InternalJob>();
const MAX_JOBS = 40;
const JOB_TTL_MS = 60 * 60 * 1000;
/** One provider request at a time, with a configurable pause to respect free-tier limits. */
const REQUEST_DELAY_MS = Math.max(0, Number(process.env.IMAGE_REQUEST_DELAY_MS ?? 650));

function view(job: InternalJob): ImageJobView {
  return {
    id: job.id,
    deckId: job.deckId,
    status: job.status,
    total: job.total,
    processed: job.processed,
    succeeded: job.succeeded,
    notFound: job.notFound,
    failed: job.failed,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt,
    items: job.items,
  };
}

function prune(): void {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (job.status === 'done' && now - job.createdAt > JOB_TTL_MS) jobs.delete(id);
  }
  while (jobs.size > MAX_JOBS) {
    const oldest = [...jobs.entries()].sort((left, right) => left[1].createdAt - right[1].createdAt)[0];
    if (!oldest) break;
    jobs.delete(oldest[0]);
  }
}

/** Jobs are scoped to the user who started them. */
export function getImageJob(id: string, userId: number): ImageJobView | null {
  const job = jobs.get(id);
  if (!job || job.userId !== userId) return null;
  return view(job);
}

export function startImageJob(input: { userId: number; deckId: number | null; cards: JobCard[] }, options: { expanded?: boolean; system?: boolean } = {}): ImageJobView {
  prune();
  const items: ImageJobItem[] = input.cards.map(card => ({ cardId: card.id, front: card.front, status: 'pending' }));
  const job: InternalJob = {
    id: randomUUID(),
    userId: input.userId,
    deckId: input.deckId,
    status: 'running',
    total: items.length,
    processed: 0,
    succeeded: 0,
    notFound: 0,
    failed: 0,
    createdAt: Date.now(),
    items,
    cards: new Map(input.cards.map(card => [card.id, card])),
    expanded: Boolean(options.expanded),
  };
  jobs.set(job.id, job);
  if (input.cards.length) {
    const placeholders = input.cards.map(() => '?').join(',');
    // 'pending' keeps the retry worker from duplicating an in-flight job. A user
    // initiated job is a fresh attempt, so it resets the retry counters.
    const reset = options.system ? '' : ', image_retry_count = 0, image_retry_at = NULL';
    void pool.execute(`UPDATE cards SET image_status = 'pending'${reset} WHERE id IN (${placeholders})`, input.cards.map(card => card.id)).catch(() => undefined);
  }
  void run(job);
  return view(job);
}

async function run(job: InternalJob): Promise<void> {
  // Different senses of the same English word must not share an image.
  const urlOwners = new Map<string, string>();
  for (const item of job.items) {
    const card = job.cards.get(item.cardId);
    item.status = 'searching';
    try {
      let suggestion = card ? await suggestImageForCard(card, { expanded: job.expanded }) : null;
      item.query = suggestion?.query ?? undefined;
      if (suggestion?.reason === 'provider-error') {
        item.status = 'error';
        item.message = suggestion.error ?? 'Dịch vụ ảnh tạm thời không khả dụng.';
        job.failed += 1;
        await pool.execute("UPDATE cards SET image_status = CASE WHEN image_url IS NULL THEN 'error' ELSE image_status END, image_retry_at = CASE WHEN image_url IS NULL THEN UTC_TIMESTAMP() ELSE image_retry_at END WHERE id = ?", [item.cardId]).catch(() => undefined);
      } else if (!card || !suggestion?.candidate) {
        await pool.execute("UPDATE cards SET image_status = CASE WHEN image_url IS NULL THEN 'none' ELSE image_status END, image_retry_at = CASE WHEN image_url IS NULL THEN UTC_TIMESTAMP() ELSE image_retry_at END WHERE id = ?", [item.cardId]);
        item.status = 'not_found';
        job.notFound += 1;
      } else {
        let candidate: RankedCandidate | null = suggestion.candidate;
        const owner = urlOwners.get(candidate.url);
        if (owner && owner !== suggestion.sense.senseKey) {
          const excluded = new Set([...urlOwners.entries()].filter(([, senseKey]) => senseKey !== suggestion!.sense.senseKey).map(([url]) => url));
          const retry = await suggestImageForCard(card, { excludeUrls: excluded, expanded: job.expanded });
          if (retry.candidate) {
            suggestion = retry;
            candidate = retry.candidate;
            item.query = retry.query ?? item.query;
          } else {
            candidate = null;
          }
        }
        if (!candidate) {
          await pool.execute("UPDATE cards SET image_status = CASE WHEN image_url IS NULL THEN 'none' ELSE image_status END, image_retry_at = CASE WHEN image_url IS NULL THEN UTC_TIMESTAMP() ELSE image_retry_at END WHERE id = ?", [item.cardId]);
          item.status = 'not_found';
          job.notFound += 1;
        } else {
          await setCardImage(item.cardId, candidate, false, suggestion?.query ?? candidate.query ?? null);
          urlOwners.set(candidate.url, suggestion?.sense.senseKey ?? '');
          item.status = 'ready';
          job.succeeded += 1;
        }
      }
    } catch (error) {
      item.status = 'error';
      item.message = error instanceof Error ? error.message : 'Không thể tìm ảnh.';
      job.failed += 1;
      await pool.execute("UPDATE cards SET image_status = CASE WHEN image_url IS NULL THEN 'error' ELSE image_status END, image_retry_at = CASE WHEN image_url IS NULL THEN UTC_TIMESTAMP() ELSE image_retry_at END WHERE id = ?", [item.cardId]).catch(() => undefined);
    } finally {
      job.processed += 1;
    }
    if (REQUEST_DELAY_MS > 0) await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY_MS));
  }
  job.status = 'done';
  job.finishedAt = Date.now();
}
