export type UserRole = 'user' | 'admin';
export type UserStatus = 'active' | 'locked';
export type User = { id: number; name: string; email: string; role: UserRole; status?: UserStatus; createdAt?: string; bio?: string; avatarUrl?: string | null };
export type Deck = { id: number; name: string; description: string; color: string; dailyNewLimit: number; isPublic?: boolean; isFavorite?: boolean; cardCount: number; dueCount: number };
export type Card = {
  id: number; deckId: number; front: string; back: string; pronunciation?: string; translation?: string; example?: string | null;
  intervalDays: number; repetitions: number; easeFactor?: number; dueAt?: string;
  imageUrl?: string | null; imageThumbnailUrl?: string | null; imageSource?: string | null; imageAuthor?: string | null;
  imageSourceUrl?: string | null; imageLicense?: string | null; imageLicenseUrl?: string | null; imageQuery?: string | null;
  imageStatus?: 'none' | 'pending' | 'ready' | 'error' | null; imageIsManual?: boolean | number; imageIsFallback?: boolean | number; imageUpdatedAt?: string | null;
};
export type Stats = {
  deckCount: number; cardCount: number; dueCount: number;
  reviewedToday: number; newToday: number; learnedCount: number; matureCount: number;
  new7?: number; new30?: number; new365?: number;
  reviewsToday?: number; reviews7?: number; reviews30?: number; reviews365?: number;
  decksLearned?: number;
  retentionRate: number | null; retentionSample: number;
  streak: number; last7Days: Array<{ day: string; count: number }>;
  studyDate: string; timeZone: string;
};
export type PeriodCounts = { newCount: number; reviewCount: number };
export type LearningDeckRow = {
  deckId: number; name: string; totalCards: number; learned: number; progress: number;
  today: PeriodCounts; last7: PeriodCounts; last30: PeriodCounts; last365: PeriodCounts; reviewsTotal: number;
};
export type LearningStats = {
  timeZone: string; studyDate: string; generatedAt: string;
  today: PeriodCounts; last7: PeriodCounts; last30: PeriodCounts; last365: PeriodCounts;
  learnedTotal: number; reviewsTotal: number; decksLearned: number;
  decks: LearningDeckRow[];
  activity: {
    days: Array<{ day: string; newCount: number; reviewCount: number }>;
    months: Array<{ month: string; newCount: number; reviewCount: number }>;
  };
};
export type CardPage = { cards: Card[]; total: number };

export type ImageFields = Pick<Card, 'imageUrl' | 'imageThumbnailUrl' | 'imageSource' | 'imageAuthor' | 'imageSourceUrl' | 'imageLicense' | 'imageLicenseUrl' | 'imageQuery' | 'imageStatus' | 'imageIsManual' | 'imageIsFallback' | 'imageUpdatedAt'>;
export type ImageProviderName = 'pixabay' | 'unsplash' | 'pexels' | 'wikimedia' | 'openverse' | 'flickr';
export type ImageConfig = { configured: boolean; provider: ImageProviderName | null; providers?: ImageProviderName[] };
export type ImageCandidate = { url: string; thumbnailUrl: string; author: string | null; sourceUrl: string | null; width: number; height: number; score?: number; provider?: string; query?: string; license?: string | null; licenseUrl?: string | null };
export type ImageJobItem = { cardId: number; front: string; status: 'pending' | 'searching' | 'ready' | 'not_found' | 'error'; message?: string; query?: string };
export type ImageJob = { id: string; deckId: number | null; status: 'running' | 'done'; total: number; processed: number; succeeded: number; notFound: number; failed: number; createdAt: number; finishedAt?: number; items: ImageJobItem[] };
export type ImportPreviewCard = { index: number; front: string; meaning: string; back?: string; translation?: string; example?: string | null; hasImage: boolean; existingCardId: number | null };
export type ImportPreview = { token: string; total: number; skipped: number; existingWithImage: number; withoutImage: number; cards: ImportPreviewCard[] };
export type ImportCommitResult = { imported: number; skipped: number; jobId: string | null; imageTotal: number; imageSkipped: number; imageApplied?: number; imageWarning?: string };
export type UploadLimits = { apkgMaxMB: number; csvMaxMB: number; imageMaxMB: number };
export type ImageSuggestion = {
  index: number;
  query: string | null;
  meaningVi: string;
  meaningEn: string;
  partOfSpeech: string;
  confidence: number;
  source: string;
  reason: 'ok' | 'low-confidence' | 'no-match' | 'provider-error';
  candidate: ImageCandidate | null;
  error?: string;
};
export type ImagePick = { index: number; query: string; url: string };

export const API = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';

export const colors = ['#7767f5', '#f39b6d', '#48b99b', '#e87392', '#479ad7'];

export const CARDS_PAGE_SIZE = 100;

export async function request<T>(path: string, _token: string | null, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type')) {
    if (options.body instanceof Blob) headers.set('Content-Type', options.body.type || 'application/octet-stream');
    else if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(`${API}${path}`, { ...options, headers, credentials: 'include' }).catch(() => {
    throw new Error('Không thể kết nối máy chủ.');
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error(body.error ?? 'Không thể kết nối máy chủ.') as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function reviewChoices(repetitions: number): Array<{ label: string; minutes: number }> {
  if (repetitions === 0) return [{ label: '<1m', minutes: 1 }, { label: '<5m', minutes: 5 }, { label: '<10m', minutes: 10 }, { label: '4 ngày', minutes: 5760 }];
  if (repetitions < 3) return [{ label: '<1m', minutes: 1 }, { label: '<10m', minutes: 10 }, { label: '<1 ngày', minutes: 1440 }, { label: '<2 ngày', minutes: 2880 }];
  const days = [2, 4, 7, 10, 14, 21, 30, 45, 60];
  const step = Math.min(days.length - 1, repetitions - 3);
  return [{ label: '<1m', minutes: 1 }, ...[days[step]!, days[Math.min(step + 1, days.length - 1)]!, days[Math.min(step + 2, days.length - 1)]!].map(day => ({ label: `<${day} ngày`, minutes: day * 1440 }))];
}

/** Đọc to một từ bằng Web Speech API (tiếng Anh). Không cần backend. */
export function speak(text: string): void {
  if (!text || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  utterance.rate = 0.9;
  window.speechSynthesis.speak(utterance);
}

/** Trả về thứ tự của ngày hôm nay trong tuần (T2..CN) để chọn ngôn ngữ hiển thị. */
export function formatTodayLabel(): string {
  return new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()).toLocaleUpperCase('vi-VN');
}

/** Calendar day (`YYYY-MM-DD`) an instant falls on in Vietnam, the app's study zone. */
export function studyDateKey(instant: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
}

/** Adds whole days to a `YYYY-MM-DD` key without involving any time zone. */
export function shiftDateKey(key: string, days: number): string {
  const [year, month, day] = key.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** Milliseconds from now until the next midnight in Vietnam (at least one second). */
export function msUntilNextStudyDay(now: Date = new Date()): number {
  const next = new Date(`${shiftDateKey(studyDateKey(now), 1)}T00:00:00+07:00`);
  return Math.max(1000, next.getTime() - now.getTime());
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

/**
 * XHR upload with a real progress bar. fetch() cannot report upload progress, and
 * large APKG files are streamed by the browser rather than read into memory.
 */
export function uploadFile<T>(path: string, file: File, onProgress?: (fraction: number) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API}${path}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Content-Type', file.name.toLowerCase().endsWith('.csv') ? 'text/csv; charset=utf-8' : 'application/octet-stream');
    xhr.timeout = 10 * 60 * 1000;
    xhr.upload.onprogress = event => { if (event.lengthComputable && event.total > 0) onProgress?.(event.loaded / event.total); };
    xhr.onload = () => {
      let body: { error?: string } | null = null;
      try { body = JSON.parse(xhr.responseText) as { error?: string }; } catch { body = null; }
      if (xhr.status >= 200 && xhr.status < 300) { resolve(body as T); return; }
      const message = body?.error ?? (xhr.status === 413 ? 'File vượt quá giới hạn cho phép.' : `Không thể tải file lên (HTTP ${xhr.status}).`);
      const error = new Error(message) as Error & { status?: number };
      error.status = xhr.status;
      reject(error);
    };
    xhr.onerror = () => reject(new Error('Không thể kết nối máy chủ.'));
    xhr.ontimeout = () => reject(new Error('Tải file lên quá lâu. Vui lòng thử lại.'));
    xhr.onabort = () => reject(new Error('Đã hủy tải file.'));
    xhr.send(file);
  });
}

export type RangeKey = 'today' | 'yesterday' | '7d' | '30d' | '90d' | '365d' | 'week' | 'month' | 'year' | 'custom';
export type StatsBucket = 'day' | 'week' | 'month';
export type AnalysisSummary = {
  newCount: number; reviewCount: number; learnedTotal: number; decksLearned: number; totalCards: number;
  completionRate: number; avgNewPerDay: number; avgReviewsPerDay: number; studyMinutes: null;
};
export type AnalysisDeck = {
  deckId: number; name: string; totalCards: number; learned: number; progress: number;
  newCount: number; reviewCount: number; lastActivityAt: string | null;
};
export type AnalysisHabits = {
  currentStreak: number; longestStreak: number; studyDays: number;
  bestDay: { day: string; total: number } | null; bestHour: { hour: number; count: number } | null;
  avgNewPerDay: number; avgReviewsPerDay: number; trend: 'up' | 'down' | 'flat' | 'unknown';
};
export type LearningAnalysis = {
  timeZone: string; generatedAt: string;
  range: { key: RangeKey; label: string; from: string; to: string; days: number };
  compare: { from: string; to: string; summary: AnalysisSummary; series: Array<{ bucket: string; newCount: number; reviewCount: number }> } | null;
  summary: AnalysisSummary;
  series: Array<{ bucket: string; newCount: number; reviewCount: number }>;
  heatmap: Array<{ day: string; newCount: number; reviewCount: number }>;
  habits: AnalysisHabits;
  decks: AnalysisDeck[];
};
export type StatsPreferences = {
  range: RangeKey; decks: number[]; cards: string[]; order: string[];
  chart: 'bar' | 'line' | 'area'; series: { new: boolean; review: boolean };
  bucket: StatsBucket; compare: boolean; view: 'compact' | 'detailed'; hidden: string[];
};

export const statsApi = {
  analysis: (params: { range: RangeKey; from?: string; to?: string; decks: number[]; bucket: StatsBucket }) => {
    const query = new URLSearchParams({ range: params.range, bucket: params.bucket });
    if (params.range === 'custom' && params.from && params.to) { query.set('from', params.from); query.set('to', params.to); }
    if (params.decks.length) query.set('decks', params.decks.join(','));
    return request<LearningAnalysis>(`/stats/analysis?${query.toString()}`, null);
  },
  preferences: () => request<StatsPreferences>('/stats/preferences', null),
  savePreferences: (preferences: StatsPreferences) => request<StatsPreferences>('/stats/preferences', null, { method: 'PUT', body: JSON.stringify(preferences) }),
};

/** Learning statistics shared by the dashboard, /statics and the deck detail. */
export const learningApi = {
  overview: (days = 30, months = 12) => request<LearningStats>(`/stats/learning?days=${days}&months=${months}`, null),
  deck: (deckId: number) => request<LearningDeckRow>(`/decks/${deckId}/stats`, null),
};

/** Client helpers for vocabulary illustrations. All provider keys stay server-side. */
export const imageApi = {
  status: () => request<ImageConfig>('/images/status', null),
  limits: () => request<UploadLimits>('/upload/limits', null),
  suggest: (cards: Array<{ front: string; back?: string; translation?: string; example?: string | null }>) => request<{ suggestions: ImageSuggestion[] }>('/images/suggest', null, { method: 'POST', body: JSON.stringify({ cards }) }),
  draftCandidates: (query: string) => request<{ query: string; provider: string | null; candidates: ImageCandidate[] }>('/images/candidates', null, { method: 'POST', body: JSON.stringify({ query }) }),
  candidates: (cardId: number, query?: string) => request<{ configured: boolean; provider: string | null; query: string | null; sense?: { meaningVi: string; meaningEn: string; partOfSpeech: string; confidence: number; source: string }; candidates: ImageCandidate[] }>(`/cards/${cardId}/image/candidates${query ? `?q=${encodeURIComponent(query)}` : ''}`, null),
  auto: (cardId: number) => request<ImageFields & { found: boolean }>(`/cards/${cardId}/image/auto`, null, { method: 'POST' }),
  select: (cardId: number, query: string, url: string) => request<ImageFields & { found: boolean }>(`/cards/${cardId}/image/select`, null, { method: 'POST', body: JSON.stringify({ query, url }) }),
  upload: (cardId: number, file: File) => request<ImageFields & { found: boolean }>(`/cards/${cardId}/image/upload`, null, { method: 'POST', body: file }),
  remove: (cardId: number) => request<ImageFields>(`/cards/${cardId}/image`, null, { method: 'DELETE' }),
  job: (jobId: string) => request<ImageJob>(`/images/jobs/${jobId}`, null),
  previewCsv: (deckId: number, file: File, onProgress?: (fraction: number) => void) => uploadFile<ImportPreview>(`/decks/${deckId}/import/preview.csv`, file, onProgress),
  previewApkg: (deckId: number, file: File, onProgress?: (fraction: number) => void) => uploadFile<ImportPreview>(`/decks/${deckId}/import/preview.apkg`, file, onProgress),
  commit: (deckId: number, token: string, imageIndexes: number[], picks: ImagePick[] = []) => request<ImportCommitResult>(`/decks/${deckId}/import/commit`, null, { method: 'POST', body: JSON.stringify({ token, imageIndexes, picks }) }),
};
