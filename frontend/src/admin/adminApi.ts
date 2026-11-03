import { request } from '../api';

export type AdminRole = 'user' | 'admin';
export type AdminStatus = 'active' | 'locked';
export type RangeDays = 7 | 30 | 90 | 365;
export type SeriesPoint = { date: string; count: number };

export type AdminMe = { id: number; name: string; email: string; role: AdminRole; status?: AdminStatus; createdAt?: string };

export type DashboardData = {
  range: number;
  accounts: { total: number; active: number; locked: number; admins: number; newToday: number; new7Days: number; newInRange: number };
  learning: { learnersTotal: number; learnersActive: number; dau: number; wau: number; mau: number; totalReviews: number; reviewedCards: number };
  decks: { total: number; cards: number; public: number; private: number; createdToday: number; createdInRange: number };
  charts: {
    registrations: SeriesPoint[];
    activeUsers: SeriesPoint[];
    reviews: SeriesPoint[];
    decks: SeriesPoint[];
    status: Array<{ status: AdminStatus; count: number }>;
  };
};

export type AdminUserRow = {
  id: number; name: string; email: string; role: AdminRole; status: AdminStatus;
  createdAt: string; lastActiveAt: string | null; deckCount: number; cardCount: number;
};
export type UsersPage = { users: AdminUserRow[]; total: number; limit: number; offset: number };

export type ActivityLog = {
  id: number; action: string; targetType: string | null; targetId: number | null;
  ipAddress: string | null; metadata: unknown; createdAt: string;
  actorId: number | null; actorName: string | null; actorEmail: string | null;
};

export type UserDetail = {
  user: { id: number; name: string; email: string; role: AdminRole; status: AdminStatus; createdAt: string; lastActiveAt: string | null };
  stats: { deckCount: number; cardCount: number; reviewCount: number; reviewedCards: number; lastReviewAt: string | null };
  decks: Array<{ id: number; name: string; createdAt: string; isPublic: number; cardCount: number }>;
  recentActivity: ActivityLog[];
};

export type AdminDeckRow = {
  id: number; name: string; ownerId: number; ownerName: string; ownerEmail: string;
  cardCount: number; createdAt: string; isPublic: number;
};
export type DecksPage = { decks: AdminDeckRow[]; total: number; limit: number; offset: number };
export type DeckDetail = {
  deck: {
    id: number; name: string; description: string; color: string; dailyNewLimit: number; isPublic: number;
    createdAt: string; ownerId: number; ownerName: string; ownerEmail: string;
  };
  cards: Array<{ id: number; front: string; back: string; pronunciation: string; translation: string | null; example: string | null; intervalDays: number; repetitions: number; dueAt: string }>;
  totalCards: number; limit: number; offset: number;
};

export type StatisticsData = {
  range: number;
  users: { registrations: SeriesPoint[]; recentLearners: number; returningUsers: number; returnRate: number };
  study: {
    reviews: SeriesPoint[]; cardsCreated: SeriesPoint[]; totalReviewsInRange: number; activeDays: number;
    avgReviewsPerLearner: number; avgReviewsPerActiveDay: number; avgStudyTimeMinutes: number | null;
  };
  topUsers: Array<{ id: number; name: string; email: string; reviewCount: number }>;
  topDecks: Array<{ id: number; name: string; ownerEmail: string; reviewCount: number }>;
};

export type ActivityPage = { logs: ActivityLog[]; total: number; limit: number; offset: number };

export type SettingsData = {
  admin: { id: number; name: string; email: string; role: AdminRole; createdAt: string };
  system: { appName: string; environment: string; database: string; serverTime: string; sessionTtl: string; userCount: number; adminCount: number };
};

export type QueryParams = Record<string, string | number | undefined>;

export function queryString(params: QueryParams): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '' || value === 'all') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export const adminApi = {
  me: () => request<AdminMe>('/me', 'session'),
  dashboard: (range: RangeDays) => request<DashboardData>(`/admin/dashboard?range=${range}`, 'session'),
  users: (params: QueryParams) => request<UsersPage>(`/admin/users${queryString(params)}`, 'session'),
  user: (id: number) => request<UserDetail>(`/admin/users/${id}`, 'session'),
  setUserStatus: (id: number, status: AdminStatus) => request<{ ok: boolean }>(`/admin/users/${id}/status`, 'session', { method: 'PATCH', body: JSON.stringify({ status }) }),
  setUserRole: (id: number, role: AdminRole) => request<{ ok: boolean }>(`/admin/users/${id}/role`, 'session', { method: 'PATCH', body: JSON.stringify({ role }) }),
  deleteUser: (id: number) => request<void>(`/admin/users/${id}`, 'session', { method: 'DELETE' }),
  decks: (params: QueryParams) => request<DecksPage>(`/admin/decks${queryString(params)}`, 'session'),
  deck: (id: number, params: QueryParams = {}) => request<DeckDetail>(`/admin/decks/${id}${queryString(params)}`, 'session'),
  deleteDeck: (id: number) => request<void>(`/admin/decks/${id}`, 'session', { method: 'DELETE' }),
  statistics: (range: RangeDays) => request<StatisticsData>(`/admin/statistics?range=${range}`, 'session'),
  activity: (params: QueryParams) => request<ActivityPage>(`/admin/activity${queryString(params)}`, 'session'),
  settings: () => request<SettingsData>('/admin/settings', 'session'),
  changePassword: (currentPassword: string, newPassword: string) => request<void>('/admin/settings/password', 'session', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }),
};
