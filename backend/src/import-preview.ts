import { randomUUID } from 'node:crypto';

export interface PreviewCard {
  front: string;
  back: string;
  pronunciation: string;
  translation: string;
  example: string | null;
  intervalDays: number;
  repetitions: number;
  easeFactor: number;
  dueAt: string | null;
}

export interface StoredPreview {
  userId: number;
  deckId: number;
  format: 'csv' | 'apkg';
  cards: PreviewCard[];
  skipped: number;
  applyDailyLimit: boolean;
  createdAt: number;
}

const previews = new Map<string, StoredPreview>();
const TTL_MS = 10 * 60 * 1000;
const MAX_PREVIEWS = 20;

function prune(now: number): void {
  for (const [token, preview] of previews) {
    if (now - preview.createdAt > TTL_MS) previews.delete(token);
  }
  while (previews.size > MAX_PREVIEWS) {
    const oldest = [...previews.entries()].sort((left, right) => left[1].createdAt - right[1].createdAt)[0];
    if (!oldest) break;
    previews.delete(oldest[0]);
  }
}

/**
 * Stores a parsed import in memory for the two-phase preview/commit flow.
 * The token is random and scoped to the owner + deck; commit consumes it once.
 */
export function storePreview(input: Omit<StoredPreview, 'createdAt'>): string {
  prune(Date.now());
  const token = randomUUID();
  previews.set(token, { ...input, createdAt: Date.now() });
  return token;
}

export function takePreview(token: string, userId: number, deckId: number): StoredPreview | null {
  const now = Date.now();
  prune(now);
  const preview = previews.get(token);
  if (!preview) return null;
  if (preview.userId !== userId || preview.deckId !== deckId) return null;
  previews.delete(token);
  if (now - preview.createdAt > TTL_MS) return null;
  return preview;
}
