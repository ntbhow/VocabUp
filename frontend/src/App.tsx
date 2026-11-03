import { StudyCard } from './StudyCard';
import { AccountMenu, Avatar, ProfilePage } from './Account';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { BookOpen, BookPlus, CalendarClock, ChartNoAxesColumn, FileChartColumn, ChevronLeft, ChevronRight, CloudUpload, Flame, GraduationCap, ImagePlus, Layers, Library, LogOut, Menu, Plus, Repeat2, RotateCcw, Search, ShieldCheck, Sparkles, Star, Trash2, Upload, Volume2, X } from 'lucide-react';
import { API, CARDS_PAGE_SIZE, colors, formatFileSize, formatTodayLabel, imageApi, learningApi, msUntilNextStudyDay, request, reviewChoices, speak, studyDateKey, type Card, type CardPage, type Deck, type ImageConfig, type ImageFields, type ImageJob, type ImagePick, type ImportPreview, type LearningDeckRow, type LearningStats, type Stats, type UploadLimits, type User } from './api';
import { ConfirmDialog, DeckGrid, StatCard } from './components';
import { CardImagePanel } from './CardImagePanel';
import { ImportModal } from './ImportModal';
import { ImageJobPanel } from './ImageJobPanel';
import { StatisticsPage } from './StatisticsPage';

const IMAGE_PROVIDER_LABELS: Record<string, string> = { pixabay: 'Pixabay', unsplash: 'Unsplash', pexels: 'Pexels', wikimedia: 'Wikimedia Commons', openverse: 'Openverse', flickr: 'Flickr' };

export default function App() {
  const initialPath = window.location.pathname;
  const [token, setToken] = useState<string | null>(['/login', '/register'].includes(initialPath) ? null : 'session');
  const [user, setUser] = useState<User | null>(null);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>(initialPath === '/register' ? 'register' : 'login');
  const [authBusy, setAuthBusy] = useState(false);
  const [error, setError] = useState('');
  const [decks, setDecks] = useState<Deck[]>([]);
  const [stats, setStats] = useState<Stats>({ deckCount: 0, cardCount: 0, dueCount: 0, reviewedToday: 0, newToday: 0, learnedCount: 0, matureCount: 0, retentionRate: null, retentionSample: 0, streak: 0, last7Days: [], studyDate: '', timeZone: 'Asia/Ho_Chi_Minh' });
  const [learning, setLearning] = useState<LearningStats | null>(null);
  const [learningBusy, setLearningBusy] = useState(false);
  const [learningError, setLearningError] = useState('');
  const [deckStats, setDeckStats] = useState<LearningDeckRow | null>(null);
  const [activityRange, setActivityRange] = useState<7 | 30 | 12>(12);
  const [deckSort, setDeckSort] = useState<'new' | 'reviews' | 'progress'>('new');
  const [activeDeck, setActiveDeck] = useState<number | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [cardsTotal, setCardsTotal] = useState(0);
  const [cardsOffset, setCardsOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [cardsLoading, setCardsLoading] = useState(false);

  const initialTab: 'home' | 'decks' | 'study' | 'stats' | 'user' = initialPath === '/user' ? 'user' : initialPath === '/statistics' || initialPath === '/statics' ? 'stats' : initialPath === '/study' || initialPath.includes('/study') ? 'study' : initialPath.startsWith('/decks') ? 'decks' : 'home';
  const [tab, setTabRaw] = useState<'home' | 'decks' | 'study' | 'stats' | 'user'>(initialTab);
  const [search, setSearch] = useState('');

  const [modal, setModal] = useState<'deck' | 'card' | null>(null);
  const [editingCard, setEditingCard] = useState<Card | null>(null);
  const [editingDeck, setEditingDeck] = useState<Deck | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmState, setConfirmState] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);

  const [deckName, setDeckName] = useState('');
  const [deckDesc, setDeckDesc] = useState('');
  const [deckColor, setDeckColor] = useState(colors[0]!);
  const [deckPublic, setDeckPublic] = useState(false);
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [pronunciation, setPronunciation] = useState('');
  const [translation, setTranslation] = useState('');
  const [example, setExample] = useState('');

  const [dueCards, setDueCards] = useState<Card[]>([]);
  const [studyTotal, setStudyTotal] = useState(0);
  const [studyCard, setStudyCard] = useState<Card | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [toast, setToast] = useState('');
  const [favoritePending, setFavoritePending] = useState<Record<number, boolean>>({});
  const [imageConfig, setImageConfig] = useState<ImageConfig | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importDeck, setImportDeck] = useState<Deck | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importFile, setImportFile] = useState<{ name: string; size: number; kind: 'CSV' | 'APKG' } | null>(null);
  const [importProgress, setImportProgress] = useState(0);
  const [importUploading, setImportUploading] = useState(false);
  const [uploadLimits, setUploadLimits] = useState<UploadLimits | null>(null);
  const [imageJob, setImageJob] = useState<ImageJob | null>(null);
  const [jobMinimized, setJobMinimized] = useState(false);
  const toastTimer = useRef<number | null>(null);
  const modalTriggerRef = useRef<HTMLElement | null>(null);
  const rememberTrigger = () => { modalTriggerRef.current = document.activeElement as HTMLElement | null; };

  useEffect(() => {
    if (modal || settingsOpen) return;
    const trigger = modalTriggerRef.current;
    modalTriggerRef.current = null;
    if (trigger && document.contains(trigger)) trigger.focus?.();
  }, [modal, settingsOpen]);

  useEffect(() => () => { if (toastTimer.current) window.clearTimeout(toastTimer.current); }, []);

  const setTab = (next: 'home' | 'decks' | 'study' | 'stats' | 'user') => {
    setTabRaw(next);
    const path = next === 'home' ? '/dashboard' : next === 'decks' ? '/decks' : next === 'study' ? (activeDeck ? `/decks/${activeDeck}/study` : '/study') : '/statics';
    if (window.location.pathname !== path) window.history.pushState({}, '', path);
  };

  const notify = (message: string) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => { setToast(''); toastTimer.current = null; }, 2600);
  };

  const refresh = useCallback(async (t: string) => {
    try {
      const [me, d, s, images, limits] = await Promise.all([request<User>('/me', t), request<Deck[]>('/decks', t), request<Stats>('/stats', t), request<ImageConfig>('/images/status', t).catch(() => ({ configured: false, provider: null } as ImageConfig)), request<UploadLimits>('/upload/limits', t).catch(() => null)]);
      setUser(current => ({ ...current, ...me })); void request<User>('/users/me', t).then(setUser).catch(() => {}); setDecks(d); setStats(s); setImageConfig(images); setUploadLimits(limits); setDataLoaded(true);
    } catch (e) {
      setError((e as Error).message); setDataLoaded(true);
      if ((e as Error).message.includes('đăng nhập')) { setToken(null); setDecks([]); setActiveDeck(null); window.history.replaceState({}, '', '/login'); }
    }
  }, []);

  const loadLearning = useCallback(async () => {
    setLearningBusy(true); setLearningError('');
    try { setLearning(await learningApi.overview()); }
    catch (e) { setLearningError((e as Error).message); }
    finally { setLearningBusy(false); }
  }, []);
  const loadDeckStats = useCallback(async (deckId: number) => {
    try { setDeckStats(await learningApi.deck(deckId)); }
    catch { setDeckStats(null); }
  }, []);
  useEffect(() => { if (token && tab === 'stats') void loadLearning(); }, [token, tab, loadLearning]);
  useEffect(() => {
    if (!token) return;
    if (tab === 'decks' && activeDeck) void loadDeckStats(activeDeck);
    else setDeckStats(null);
  }, [token, tab, activeDeck, loadDeckStats]);

  useEffect(() => { if (token) { void refresh(token); } else setUser(null); }, [token, refresh]);

  async function loadCards(deckId: number, searchTerm: string, offset: number, reset: boolean) {
    if (!token) return;
    setCardsLoading(true);
    try {
      const page = await request<CardPage>(`/decks/${deckId}/cards?search=${encodeURIComponent(searchTerm)}&limit=${CARDS_PAGE_SIZE}&offset=${offset}`, token);
      if (reset) setCards(page.cards); else setCards(prev => [...prev, ...page.cards]);
      setCardsTotal(page.total);
      setCardsOffset(offset + page.cards.length);
      setHasMore(offset + page.cards.length < page.total);
    } catch (e) { setError((e as Error).message); }
    finally { setCardsLoading(false); }
  }

  useEffect(() => {
    if (!token || !activeDeck) return;
    setCards([]); setCardsOffset(0); setHasMore(false); setCardsLoading(true);
    const t = window.setTimeout(() => {
      void loadCards(activeDeck, search, 0, true);
    }, 250);
    return () => window.clearTimeout(t);
  }, [token, activeDeck, search]);

  const activeJobId = imageJob?.id;
  const activeJobStatus = imageJob?.status;
  useEffect(() => {
    if (!token || !activeJobId || activeJobStatus === 'done') return;
    const timer = window.setInterval(() => {
      void imageApi.job(activeJobId).then(next => {
        setImageJob(next);
        if (next.status !== 'done') return;
        notify(next.failed ? `Đã tạo ảnh ${next.succeeded}/${next.total}. ${next.failed} từ gặp lỗi.` : `Đã tạo ảnh cho ${next.succeeded}/${next.total} từ.`);
        if (activeDeck) void loadCards(activeDeck, search, 0, true);
        void refresh(token);
      }).catch(() => { /* polling is best-effort; the job keeps running server-side */ });
    }, 900);
    return () => window.clearInterval(timer);
  }, [token, activeJobId, activeJobStatus, activeDeck, search, refresh]);

  function loadMore() {
    if (!activeDeck) return;
    void loadCards(activeDeck, search, cardsOffset, false);
  }

  useEffect(() => {
    const onPop = () => {
      const path = window.location.pathname;
      setTabRaw(path === '/user' ? 'user' : path === '/statistics' || path === '/statics' ? 'stats' : path === '/study' || path.endsWith('/study') ? 'study' : path.startsWith('/decks') ? 'decks' : 'home');
      const match = path.match(/^\/decks\/([1-9]\d*)(?:\/(?:cards|study))?$/);
      setActiveDeck(match ? Number(match[1]) : null);
      if (path === '/register') setAuthMode('register'); else if (path === '/login' || path === '/') setAuthMode('login');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    const match = window.location.pathname.match(/^\/decks\/([1-9]\d*)(?:\/(?:cards|study))?$/);
    if (match) {
      const id = Number(match[1]);
      if (Number.isSafeInteger(id) && id > 0 && decks.some(deck => deck.id === id)) setActiveDeck(id);
    }
  }, [decks]);

  useEffect(() => {
    if (activeDeck && tab === 'decks' && !/^\/decks\/[1-9]\d*\/cards$/.test(window.location.pathname)) window.history.replaceState({}, '', `/decks/${activeDeck}/cards`);
  }, [activeDeck, tab]);

  const selectedDeck = decks.find(d => d.id === activeDeck) ?? null;
  const favoriteDecks = decks.filter(deck => deck.isFavorite);

  async function submitAuth(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError(''); setAuthBusy(true);
    const fd = new FormData(e.currentTarget);
    const payload = { email: String(fd.get('email')), password: String(fd.get('password')), ...(authMode === 'register' ? { name: String(fd.get('name')) } : {}) };
    try {
      const result = await request<{ user: User }>(`/auth/${authMode}`, null, { method: 'POST', body: JSON.stringify(payload) });
      if (result.user.role === 'admin') { window.location.assign('/admin'); return; }
      setToken('session'); setUser(result.user);
      window.history.pushState({}, '', '/dashboard');
    } catch (err) { setError((err as Error).message); }
    finally { setAuthBusy(false); }
  }

  async function signOut() {
    setSettingsOpen(false);
    if (token) await request<void>('/auth/logout', token, { method: 'POST' }).catch(() => {});
    setAuthMode('login');
    setToken(null); setUser(null); setDecks([]); setCards([]); setActiveDeck(null);
    setTabRaw('home'); window.history.replaceState({}, '', '/login');
  }

  function openCreateDeck() { rememberTrigger(); setEditingDeck(null); setDeckName(''); setDeckDesc(''); setDeckColor(colors[decks.length % colors.length]!); setDeckPublic(false); setModal('deck'); }
  function openEditDeck(deck: Deck) { rememberTrigger(); setEditingDeck(deck); setDeckName(deck.name); setDeckDesc(deck.description); setDeckColor(deck.color); setDeckPublic(Boolean(deck.isPublic)); setModal('deck'); }

  async function saveDeck(e: FormEvent) {
    e.preventDefault(); if (!token) return;
    try {
      if (editingDeck) {
        await request(`/decks/${editingDeck.id}`, token, { method: 'PATCH', body: JSON.stringify({ name: deckName, description: deckDesc, color: deckColor, isPublic: deckPublic }) });
        setDecks(decks.map(d => d.id === editingDeck.id ? { ...d, name: deckName, description: deckDesc, color: deckColor, isPublic: deckPublic } : d));
        notify('Đã cập nhật bộ từ.');
      } else {
        const d = await request<Deck>('/decks', token, { method: 'POST', body: JSON.stringify({ name: deckName, description: deckDesc, color: deckColor, isPublic: deckPublic }) });
        setDecks([d, ...decks]); setActiveDeck(d.id); setTab('decks');
        notify('Đã tạo bộ từ mới.');
      }
      setModal(null); setEditingDeck(null); setDeckName(''); setDeckDesc(''); setDeckColor(colors[0]!); setDeckPublic(false);
      void refresh(token);
    } catch (e) { setError((e as Error).message); }
  }

  function openNewCard() { rememberTrigger(); setEditingCard(null); setFront(''); setBack(''); setPronunciation(''); setTranslation(''); setExample(''); setModal('card'); }
  function openEditCard(c: Card) { rememberTrigger(); setEditingCard(c); setFront(c.front); setBack(c.back); setPronunciation(c.pronunciation ?? ''); setTranslation(c.translation ?? ''); setExample(c.example ?? ''); setModal('card'); }

  async function saveCard(e: FormEvent) {
    e.preventDefault(); if (!token || !activeDeck) return;
    const body = JSON.stringify({ front, back, pronunciation, translation, example: example || null });
    try {
      if (editingCard) { await request(`/cards/${editingCard.id}`, token, { method: 'PATCH', body }); notify('Đã cập nhật từ.'); }
      else { await request<Card>(`/decks/${activeDeck}/cards`, token, { method: 'POST', body }); notify('Đã thêm từ mới.'); }
      setModal(null); setEditingCard(null); setFront(''); setBack(''); setPronunciation(''); setTranslation(''); setExample('');
      void loadCards(activeDeck, search, 0, true);
      void refresh(token);
    } catch (e) { setError((e as Error).message); }
  }

  function deleteCard(card: Card) {
    setConfirmState({
      title: 'Xóa thẻ',
      message: `Xóa thẻ “${card.front}” khỏi bộ từ này?`,
      onConfirm: () => {
        if (!token) return;
        void (async () => {
          try {
            await request(`/cards/${card.id}`, token, { method: 'DELETE' });
            setCards(prev => prev.filter(c => c.id !== card.id));
            setCardsTotal(t => Math.max(0, t - 1));
            setCardsOffset(o => Math.max(0, o - 1));
            notify('Đã xóa thẻ.'); void refresh(token);
          } catch (e) { setError((e as Error).message); }
        })();
      },
    });
  }

  function deleteDeck(deck: Deck) {
    setConfirmState({ title: 'Xóa bộ từ', message: `Xóa bộ “${deck.name}” và toàn bộ từ bên trong?`, onConfirm: () => void removeDeck(deck) });
  }

  async function removeDeck(deck: Deck) {
    if (!token) return;
    try {
      await request(`/decks/${deck.id}`, token, { method: 'DELETE' });
      setDecks(current => current.filter(d => d.id !== deck.id));
      if (activeDeck === deck.id) { setActiveDeck(null); setCards([]); }
      void refresh(token); notify('Đã xóa bộ từ.');
    } catch (e) { setError((e as Error).message); }
  }

  async function setDeckDailyNewLimit(deckId: number, limit: number) {
    if (!token) return;
    try {
      await request(`/decks/${deckId}`, token, { method: 'PATCH', body: JSON.stringify({ dailyNewLimit: limit }) });
      setDecks(current => current.map(deck => deck.id === deckId ? { ...deck, dailyNewLimit: limit } : deck));
      notify('Đã cập nhật giới hạn từ mới mỗi ngày.');
    } catch (e) { setError((e as Error).message); }
  }

  function applyCardImage(cardId: number, fields: ImageFields) {
    setCards(current => current.map(card => card.id === cardId ? { ...card, ...fields } : card));
    setEditingCard(current => current && current.id === cardId ? { ...current, ...fields } : current);
  }

  function applyFavorite(deckId: number, isFavorite: boolean) {
    setDecks(current => current.map(deck => deck.id === deckId ? { ...deck, isFavorite } : deck));
  }

  async function toggleFavorite(deck: Deck) {
    if (!token || favoritePending[deck.id]) return;
    const next = !deck.isFavorite;
    // Optimistically flip the star and keep the sidebar in sync; roll back on failure.
    setFavoritePending(current => ({ ...current, [deck.id]: true }));
    applyFavorite(deck.id, next);
    try {
      await request(`/decks/${deck.id}/favorite`, token, { method: next ? 'POST' : 'DELETE' });
      notify(next ? 'Đã thêm vào bộ từ yêu thích' : 'Đã xóa khỏi bộ từ yêu thích');
    } catch (e) {
      applyFavorite(deck.id, !next);
      setError((e as Error).message);
    } finally {
      setFavoritePending(current => { const nextPending = { ...current }; delete nextPending[deck.id]; return nextPending; });
    }
  }

  async function startStudy(deckId?: number) {
    if (!token) return;
    try {
      const result = await request<Card[]>(`/study/due${deckId ? `?deckId=${deckId}` : ''}`, token);
      const due = deckId ? result.filter(card => Number(card.deckId) === deckId) : result;
      setDueCards(due); setStudyTotal(due.length); setStudyCard(due[0] ?? null); setRevealed(false);
      if (deckId) setActiveDeck(deckId);
      setTabRaw('study');
      const studyPath = deckId ? `/decks/${deckId}/study` : '/study';
      if (window.location.pathname !== studyPath) window.history.pushState({}, '', studyPath);
      if (!due.length) notify(deckId ? 'Bạn đã ôn hết các từ đến hạn của bộ này!' : 'Bạn đã ôn hết các từ đến hạn!');
    } catch (e) { setError((e as Error).message); }
  }

  function openDeckLibrary(deck: Deck) {
    setActiveDeck(deck.id); setTabRaw('decks');
    const path = `/decks/${deck.id}/cards`;
    if (window.location.pathname !== path) window.history.pushState({}, '', path);
  }

  useEffect(() => { if (token && activeDeck && window.location.pathname === `/decks/${activeDeck}/study`) void startStudy(activeDeck); }, [token, activeDeck]);
  useEffect(() => { if (token && tab === 'study' && window.location.pathname === '/study') void startStudy(); }, [token, tab]);

  /**
   * Day rollover at 00:00 Vietnam time. A timer fires at midnight; focus,
   * visibility and a one-minute heartbeat catch the cases where the timer was
   * delayed (sleeping laptop, throttled background tab). On a new day the
   * stats and deck counts reload, and an open study session is rebuilt so the
   * fresh new-card allowance and newly due reviews appear without a reload.
   */
  const studyDayRef = useRef(studyDateKey());
  const rolloverRef = useRef<() => void>(() => undefined);
  rolloverRef.current = () => {
    if (!token) return;
    const today = studyDateKey();
    if (today === studyDayRef.current) return;
    studyDayRef.current = today;
    void refresh(token);
    // Only rebuild the queue when it is not mid-card, so an answer is never lost.
    if (tab === 'study' && !revealed) void startStudy(activeDeck && window.location.pathname === `/decks/${activeDeck}/study` ? activeDeck : undefined);
    notify('Đã sang ngày học mới — giới hạn từ mới đã được làm mới.');
  };
  useEffect(() => {
    if (!token) return;
    let midnightTimer = 0;
    const check = () => rolloverRef.current();
    const arm = () => {
      window.clearTimeout(midnightTimer);
      midnightTimer = window.setTimeout(() => { check(); arm(); }, msUntilNextStudyDay() + 500);
    };
    const onVisible = () => { if (document.visibilityState === 'visible') { check(); arm(); } };
    arm();
    const heartbeat = window.setInterval(check, 60_000);
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(midnightTimer);
      window.clearInterval(heartbeat);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [token]);

  async function review(rating: number) {
    if (!token || !studyCard) return;
    try {
      const schedule = await request<{ intervalMinutes: number; repetitions: number }>(`/study/${studyCard.id}/review`, token, { method: 'POST', body: JSON.stringify({ rating }) });
      const rest = dueCards.slice(1);
      if (schedule.intervalMinutes < 1440) {
        rest.push({ ...studyCard, repetitions: schedule.repetitions, intervalDays: Math.floor(schedule.intervalMinutes / 1440) });
        setStudyTotal(total => total + 1);
      }
      setDueCards(rest); setStudyCard(rest[0] ?? null); setRevealed(false);
      void refresh(token);
      if (tab === 'stats') void loadLearning();
      if (tab === 'decks' && activeDeck) void loadDeckStats(activeDeck);
    } catch (e) { setError((e as Error).message); }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (modal || settingsOpen || confirmState || importPreview || (imageJob && !jobMinimized)) {
        if (e.key === 'Escape') {
          if (importPreview) { if (!importBusy) { setImportPreview(null); setImportDeck(null); } }
          else if (imageJob && !jobMinimized) { if (imageJob.status === 'done') setImageJob(null); else setJobMinimized(true); }
          else { setModal(null); setSettingsOpen(false); setConfirmState(null); }
        }
        return;
      }
      if (tab !== 'study' || !studyCard) return;
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName)) return;
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setRevealed(r => !r); }
      else if (revealed && ['1', '2', '3', '4'].includes(e.key)) { e.preventDefault(); void review(Number(e.key) - 1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  async function importCsv(e: FormEvent<HTMLInputElement>) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (file && selectedDeck) await startImportPreview(selectedDeck, file);
  }

  async function startImportPreview(deck: Deck, file: File) {
    if (!token) return;
    const isApkg = file.name.toLowerCase().endsWith('.apkg');
    const kind = isApkg ? 'APKG' : 'CSV';
    const maxMB = isApkg ? (uploadLimits?.apkgMaxMB ?? 200) : (uploadLimits?.csvMaxMB ?? 50);
    // Pre-check before touching the network so an oversized file gives an exact message.
    if (file.size > maxMB * 1024 * 1024) {
      setError(`File ${kind} “${file.name}” (${formatFileSize(file.size)}) vượt quá giới hạn ${maxMB} MB.`);
      return;
    }
    setImportFile({ name: file.name, size: file.size, kind });
    setImportBusy(true); setImportUploading(true); setError(''); setImportProgress(0);
    try {
      const preview = isApkg
        ? await imageApi.previewApkg(deck.id, file, fraction => setImportProgress(fraction))
        : await imageApi.previewCsv(deck.id, file, fraction => setImportProgress(fraction));
      setImportDeck(deck);
      setImportPreview(preview);
    } catch (err) { setError((err as Error).message); }
    finally { setImportBusy(false); setImportUploading(false); setImportProgress(0); }
  }

  async function commitImport(imageIndexes: number[], picks: ImagePick[] = []) {
    if (!token || !importPreview || !importDeck || importBusy) return;
    const deck = importDeck;
    setImportBusy(true);
    try {
      const result = await imageApi.commit(deck.id, importPreview.token, imageIndexes, picks);
      setImportPreview(null);
      setImportDeck(null);
      setActiveDeck(deck.id);
      setTabRaw('decks');
      if (window.location.pathname !== `/decks/${deck.id}/cards`) window.history.replaceState({}, '', `/decks/${deck.id}/cards`);
      const importedMessage = `Đã nhập ${result.imported} từ${result.skipped ? `, bỏ qua ${result.skipped}` : ''}.`;
      const applied = result.imageApplied ?? 0;
      if (result.jobId) {
        const job = await imageApi.job(result.jobId);
        setImageJob(job); setJobMinimized(false);
        notify(`${importedMessage}${applied ? ` Đã gắn ${applied} ảnh,` : ''} Đang tìm ảnh cho ${result.imageTotal} từ…`);
      } else if (result.imageWarning === 'not-configured') {
        notify(`${importedMessage} Chưa cấu hình API key nên chưa tạo ảnh.`);
      } else if (applied) {
        notify(`${importedMessage} Đã gắn ảnh cho ${applied} từ.`);
      } else {
        notify(importedMessage);
      }
      if (activeDeck === deck.id) void loadCards(deck.id, search, 0, true);
      void refresh(token);
    } catch (err) { setError((err as Error).message); }
    finally { setImportBusy(false); }
  }

  async function exportCsv() {
    if (!token || !activeDeck) return;
    try {
      const response = await fetch(`${API}/decks/${activeDeck}/export.csv`, { credentials: 'include' });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? 'Không thể xuất file.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const disposition = response.headers.get('Content-Disposition') ?? '';
      const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] ?? `vocabup-deck-${activeDeck}.csv`;
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      notify('Đã xuất CSV.');
    } catch (e) { setError((e as Error).message); }
  }

  const routeDeckId = window.location.pathname.match(/^\/decks\/([1-9]\d*)(?:\/(?:cards|study))?$/)?.[1];
  const knownRoute = ['/', '/login', '/register', '/dashboard', '/study', '/decks', '/statistics', '/statics', '/user', '/404'].includes(window.location.pathname) || Boolean(routeDeckId);
  if (!knownRoute || (routeDeckId && dataLoaded && user && !decks.some(deck => deck.id === Number(routeDeckId)))) {
    return (
      <main className="auth-shell">
        <section className="auth-panel">
          <div className="auth-form-wrap">
            <h1>Không tìm thấy trang</h1>
            <p className="muted">Đường dẫn có thể đã thay đổi hoặc bộ từ không tồn tại.</p>
            <a className="button primary" href="/dashboard">Về tổng quan</a>
          </div>
        </section>
      </main>
    );
  }

  if (token && !dataLoaded) {
    return (
      <main className="auth-shell">
        <div className="loading-screen">
          <span className="spinner" />
          <p>Đang tải không gian học tập…</p>
        </div>
      </main>
    );
  }

  if (!token || !user) {
    return (
      <main className="auth-shell">
        <section className="auth-art">
          <div className="brand"><span className="brand-mark"><GraduationCap size={23} /></span> vocab<span>up</span></div>
          <div className="auth-copy">
            <div className="eyebrow light"><Sparkles size={14} /> TỪ VỰNG MỖI NGÀY</div>
            <h1>Mỗi từ mới,<br /> một cánh cửa<br /> <em>mở ra.</em></h1>
            <p>Học ngoại ngữ theo cách của bạn. Những phiên ôn ngắn, đều đặn sẽ tạo nên khác biệt lớn.</p>
            <div className="orbit">
              <div className="orbit-center"><BookOpen size={32} /></div>
              <span className="orbit-word w1">serendipity</span>
              <span className="orbit-word w2">nỗ lực</span>
              <span className="orbit-word w3">bonjour</span>
              <span className="orbit-word w4">curiosity</span>
            </div>
          </div>
          <div className="auth-foot">Học một chút. Tiến bộ mỗi ngày. <span>✦</span></div>
        </section>
        <section className="auth-panel">
          <div className="auth-form-wrap">
            <div className="eyebrow"><span className="eyebrow-dot" /> KHÔNG GIAN HỌC TẬP CỦA BẠN</div>
            <h2>{authMode === 'login' ? 'Chào mừng trở lại' : 'Bắt đầu hành trình'}</h2>
            <p className="muted">{authMode === 'login' ? 'Đăng nhập để tiếp tục học nhé.' : 'Tạo tài khoản miễn phí chỉ trong vài giây.'}</p>
            <form className="form-stack" onSubmit={submitAuth}>
              {authMode === 'register' && <label>Họ và tên<input name="name" placeholder="Ví dụ: Minh Anh" required minLength={1} maxLength={100} /></label>}
              <label>Email<input name="email" type="email" placeholder="ban@email.com" required autoComplete="email" /></label>
              <label>Mật khẩu<input name="password" type="password" placeholder="Ít nhất 8 ký tự" required minLength={authMode === 'register' ? 8 : 1} autoComplete={authMode === 'register' ? 'new-password' : 'current-password'} /></label>
              {error && <div className="error-box">{error}</div>}
              <button className="button primary full" disabled={authBusy}>{authBusy ? 'Đang xử lý…' : authMode === 'login' ? 'Đăng nhập' : 'Tạo tài khoản'} <ChevronRight size={17} /></button>
            </form>
            <div className="switch-auth">{authMode === 'login' ? 'Chưa có tài khoản?' : 'Đã có tài khoản?'} <button onClick={() => { const mode = authMode === 'login' ? 'register' : 'login'; setAuthMode(mode); setError(''); window.history.pushState({}, '', `/${mode}`); }}>{authMode === 'login' ? 'Đăng ký' : 'Đăng nhập'}</button></div>
            <div className="auth-note"><ShieldCheck size={15} /> Dữ liệu học tập được lưu riêng trong tài khoản của bạn.</div>
          </div>
          <div className="auth-mobile-brand">✦ VocabUp · Học từ vựng mỗi ngày</div>
        </section>
      </main>
    );
  }

  const navItems = [
    { id: 'home' as const, label: 'Tổng quan', icon: <ChartNoAxesColumn size={18} /> },
    { id: 'decks' as const, label: 'Bộ từ của tôi', icon: <BookOpen size={18} /> },
    { id: 'study' as const, label: 'Ôn tập', icon: <Sparkles size={18} />, badge: stats.dueCount },
    { id: 'stats' as const, label: 'Thống kê', icon: <FileChartColumn size={18} /> },
  ];
  const firstName = user.name.split(' ')[0];

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? 'mobile-open' : ''}`}>
        <div className="brand"><span className="brand-mark"><GraduationCap size={22} /></span> vocab<span>up</span></div>
        <div className="side-label">MENU</div>
        <nav>
          {navItems.map(n => (
            <button key={n.id} className={`nav-link ${tab === n.id ? 'selected' : ''}`} onClick={() => { setMobileNav(false); if (n.id === 'study') { void startStudy(); return; } if (n.id === 'decks') { setActiveDeck(null); setCards([]); } setTab(n.id); }}>
              {n.icon}<span>{n.label}</span>{n.badge ? <b className="nav-badge">{n.badge}</b> : null}
            </button>
          ))}
          {user.role === 'admin' && <button className="nav-link admin-entry" onClick={() => window.location.assign('/admin')}><ShieldCheck size={18} /><span>Trang quản trị</span></button>}
        </nav>
        <div className="side-divider" />
        <div className="side-label side-label-row">BỘ TỪ GẦN ĐÂY <button className="icon-button tiny" onClick={openCreateDeck} aria-label="Tạo bộ từ"><Plus size={15} /></button></div>
        <div className="sidebar-decks">
          {decks.slice(0, 5).map(d => (
            <button key={d.id} className="deck-shortcut" onClick={() => { setMobileNav(false); void startStudy(d.id); }}><i style={{ background: d.color }} />{d.name}<span>{d.cardCount}</span></button>
          ))}
          {!decks.length && <div className="empty-sidebar">Chưa có bộ từ nào.</div>}
        </div>
        <div className="side-label side-label-row"><span className="side-label-title">BỘ TỪ YÊU THÍCH <Star size={11} fill="currentColor" className="side-favorite-star" /></span></div>
        <div className="sidebar-favorites">
          {favoriteDecks.length ? favoriteDecks.map(d => (
            <button key={d.id} className="deck-shortcut" onClick={() => { setMobileNav(false); void startStudy(d.id); }}>
              <i className="favorite-dot" style={{ background: d.color }} />{d.name}<span>{d.cardCount}</span>
            </button>
          )) : <div className="empty-sidebar">Chưa có bộ từ yêu thích</div>}
        </div>
        <div className="side-spacer" />
        <button className="profile" onClick={() => window.location.assign('/user')}><Avatar user={user} /><div className="profile-copy"><strong>{user.name}</strong><span>{user.email}</span></div><LogOut size={16} className="logout" /></button>
      </aside>
      {mobileNav && <button className="mobile-scrim" onClick={() => setMobileNav(false)} aria-label="Đóng menu" />}
      <main className="main-area">
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => setMobileNav(true)} aria-label="Mở menu"><Menu size={20} /></button>
          <div className="crumb">Không gian học tập <ChevronRight size={14} /><span>{tab === 'user' ? 'Hồ sơ cá nhân' : tab === 'home' ? 'Tổng quan' : tab === 'decks' ? 'Bộ từ' : tab === 'study' ? (selectedDeck?.name ?? 'Ôn tập') : 'Thống kê'}</span></div>
          <div className="top-actions">
            <span className="today-pill"><span /> Học một chút hôm nay</span>
            <AccountMenu user={user} onSignOut={() => void signOut()} />
          </div>
        </header>
        <div className="page-content">
          <div className="page-anim" key={`${tab}:${activeDeck ?? 0}`}>

          {tab === 'user' && <ProfilePage user={user} onUpdate={setUser} onSettings={() => setSettingsOpen(true)} />}
          {tab === 'home' && (
            <>
              <div className="welcome-row">
                <div>
                  <div className="eyebrow"><span className="eyebrow-dot" /> {formatTodayLabel()}</div>
                  <h1>Chào {firstName} <span className="wave">✦</span></h1>
                  <p className="muted">Một chút tiến bộ hôm nay sẽ tạo nên điều tuyệt vời.</p>
                </div>
                <button className="button primary" onClick={openCreateDeck}><Plus size={17} /> Tạo bộ từ</button>
              </div>
              <div className="hero-card">
                <div className="hero-copy">
                  <div className="hero-meta">

                    {stats.streak > 0 && <span className="hero-streak"><Flame size={13} /> Chuỗi {stats.streak} ngày</span>}
                    <span className="hero-due"><RotateCcw size={13} /><strong>{stats.dueCount}</strong> Từ đến hạn</span>
                  </div>
                  <h2>Sẵn sàng làm mới<br />trí nhớ của bạn?</h2>

                  <button className="button hero-button" onClick={() => void startStudy()}><Sparkles size={16} /> Bắt đầu ôn tập <ChevronRight size={16} /></button>
                </div>
                <div className="hero-art">
                  <div className="hero-sun" />
                  <div className="hero-card-float float-back"><span>remember</span><small>/ rɪˈmembər /</small></div>
                  <div className="hero-card-float float-front"><span>記憶</span><small>trí nhớ · ký ức</small></div>
                  <div className="hero-spark s1">✳</div>
                  <div className="hero-spark s2">✦</div>
                  <div className="hero-plant">✺</div>
                </div>

              </div>
              <div className="section-heading"><div><h3>Tiến độ của bạn</h3><p>Những bước nhỏ dẫn đến thành quả lớn.</p></div><button className="text-button" onClick={() => setTab('stats')}>Xem thống kê <ChevronRight size={15} /></button></div>
              <div className="stats-grid">
                <StatCard label="BỘ TỪ" value={stats.deckCount} icon={<Library size={17} />} tint="violet" caption="Bộ từ đang học" />
                <StatCard label="TỪ VỰNG" value={stats.cardCount} icon={<Layers size={17} />} tint="orange" caption="Từ trong thư viện" />
                <StatCard label="ĐẾN HẠN" value={stats.dueCount} icon={<RotateCcw size={17} />} tint="pink" caption="Sẵn sàng ôn tập" />
                <StatCard label="HÔM NAY" value={stats.reviewedToday} icon={<CalendarClock size={17} />} tint="green" caption="Lượt ôn hôm nay" />
              </div>
              <div className="section-heading deck-heading"><div><h3>Bộ từ của bạn</h3><p>Mở một bộ từ để tiếp tục khám phá.</p></div><button className="text-button" onClick={() => setTab('decks')}>Tất cả bộ từ <ChevronRight size={15} /></button></div>
              <DeckGrid decks={decks.slice(0, 3)} onOpen={d => void startStudy(d.id)} onStudy={d => void startStudy(d.id)} onToggleFavorite={toggleFavorite} favoriteBusy={favoritePending} onImages={undefined} onCreate={openCreateDeck} onDelete={deleteDeck} onEdit={openEditDeck} onSetDailyNewLimit={setDeckDailyNewLimit} onLibrary={openDeckLibrary} onImport={(deck, file) => void startImportPreview(deck, file)} />
            </>
          )}

          {tab === 'decks' && (
            <>
              <div className="welcome-row">
                <div>
                  <div className="eyebrow"><span className="eyebrow-dot" /> THƯ VIỆN CỦA BẠN</div>
                  <h1>{selectedDeck ? selectedDeck.name : 'Bộ từ của tôi'}</h1>
                  <p className="muted">{selectedDeck?.description || 'Tập hợp những từ bạn muốn ghi nhớ.'}</p>
                </div>
                <button className="button primary" onClick={openCreateDeck}><Plus size={17} /> Tạo bộ từ</button>
              </div>
              {selectedDeck ? (
                <>
                  <div className="deck-toolbar">
                    <button className="text-button" onClick={() => setActiveDeck(null)}><ChevronLeft size={16} /> Tất cả bộ từ</button>
                    <div className="toolbar-actions">
                      <label className="button secondary upload-button" title={`CSV tối đa ${uploadLimits?.csvMaxMB ?? 50} MB · APKG tối đa ${uploadLimits?.apkgMaxMB ?? 200} MB`}><Upload size={16} /> Nhập CSV / APKG<input type="file" accept=".csv,.apkg,text/csv,application/octet-stream" onChange={importCsv} /></label>
                      <button className="button secondary" onClick={() => void exportCsv()}><CloudUpload size={16} /> Xuất CSV</button>
                      <button className="button secondary" onClick={() => openEditDeck(selectedDeck)}><Plus size={15} /> Sửa bộ từ</button>
                      <button className="button secondary delete-deck-button" onClick={() => deleteDeck(selectedDeck)}><Trash2 size={15} /> Xóa bộ thẻ</button>
                      <button className="button primary" onClick={openNewCard}><Plus size={16} /> Thêm từ</button>
                    </div>
                  </div>
                  <section className="deck-learning">
                    <div className="section-heading"><div><h3>Thống kê học tập của bộ từ này</h3><p>Chỉ tính các từ thuộc bộ {selectedDeck.name}.</p></div></div>
                    {deckStats ? (
                      <>
                        <div className="stats-grid wide">
                          <StatCard label="TỪ MỚI HÔM NAY" value={deckStats.today.newCount} icon={<BookPlus size={17} />} tint="violet" caption="Trong bộ này" />
                          <StatCard label="7 NGÀY QUA" value={deckStats.last7.newCount} icon={<CalendarClock size={17} />} tint="orange" caption="Trong bộ này" />
                          <StatCard label="30 NGÀY QUA" value={deckStats.last30.newCount} icon={<CalendarClock size={17} />} tint="pink" caption="Trong bộ này" />
                          <StatCard label="365 NGÀY QUA" value={deckStats.last365.newCount} icon={<CalendarClock size={17} />} tint="green" caption="Trong bộ này" />
                        </div>
                        <div className="learning-review-row">
                          <span className="learning-review-title"><Repeat2 size={14} /> Ôn từ cũ: <b>{deckStats.reviewsTotal}</b></span>
                          <span className="learning-pill"><b>{deckStats.learned}</b><small>từ đã học</small></span>
                          <span className="learning-pill"><b>{deckStats.totalCards}</b><small>tổng số từ</small></span>
                          <span className="learning-pill"><b>{deckStats.progress}%</b><small>tiến độ</small></span>
                        </div>
                      </>
                    ) : <div className="learning-skeleton"><span className="skel" /><span className="skel" /><span className="skel" /><span className="skel" /></div>}
                  </section>
                  <div className="card-list-head"><strong>{cardsTotal} từ</strong><div className="search-box"><Search size={15} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Tìm từ vựng…" /></div></div>
                  {cardsLoading && !cards.length ? (
                    <div className="vocab-table">
                      {Array.from({ length: 6 }).map((_, i) => (
                        <div className="vocab-row skeleton-row" key={i}><span className="skel" style={{ width: '38%' }} /><span className="skel" style={{ width: '52%' }} /><span className="skel" style={{ width: '18%' }} /><span /></div>
                      ))}
                    </div>
                  ) : (
                    <div className="vocab-table">
                      <div className="vocab-row vocab-header"><span>TỪ VỰNG</span><span>NGHĨA</span><span>TIẾP THEO</span><span /></div>
                      {cards.map(c => (
                        <div className="vocab-row" key={c.id}>
                          <div className="vocab-term">
                            <div className="vocab-term-head">
                              <img className="vocab-thumb" src={c.imageThumbnailUrl || c.imageUrl || undefined} alt="" loading="lazy" decoding="async" onError={e => { e.currentTarget.style.display = 'none'; }} />
                              <strong>{c.front}</strong>
                              <button type="button" className="speak-button tiny" title="Phát âm" aria-label={`Phát âm ${c.front}`} onClick={() => speak(c.front)}><Volume2 size={14} /></button>
                            </div>
                            {c.pronunciation && <small>{c.pronunciation}</small>}
                          </div>
                          <span className="vocab-meaning"><b>{c.translation || c.back}</b>{c.translation && c.back && <small><i>English</i> {c.back}</small>}</span>
                          <span className="due-cell">{c.intervalDays ? `${c.intervalDays} ngày` : 'Chưa ôn'}</span>
                          <div className="row-actions">
                            <button className="icon-button tiny" title="Sửa" onClick={() => openEditCard(c)}>✎</button>
                            <button className="icon-button tiny danger" title="Xóa thẻ" aria-label={`Xóa thẻ ${c.front}`} onClick={() => deleteCard(c)}><Trash2 size={15} /></button>
                          </div>
                        </div>
                      ))}
                      {!cards.length && (
                        <div className="empty-state">
                          <div>✦</div>
                          <strong>{search ? 'Không tìm thấy từ phù hợp.' : 'Bộ từ này còn trống'}</strong>
                          <p>{search ? 'Thử từ khóa khác nhé.' : 'Thêm từ đầu tiên hoặc nhập từ tệp CSV.'}</p>
                          {!search && <button className="button primary" onClick={openNewCard}><Plus size={16} /> Thêm từ đầu tiên</button>}
                        </div>
                      )}
                    </div>
                  )}
                  {hasMore && (
                    <div className="load-more-wrap">
                      <button className="button secondary" onClick={loadMore} disabled={cardsLoading}>{cardsLoading ? 'Đang tải…' : `Tải thêm (còn ${cardsTotal - cards.length} từ)`}</button>
                    </div>
                  )}
                </>
              ) : (
                <DeckGrid decks={decks} onOpen={d => void startStudy(d.id)} onStudy={d => void startStudy(d.id)} onToggleFavorite={toggleFavorite} favoriteBusy={favoritePending} onImages={undefined} onCreate={openCreateDeck} onDelete={deleteDeck} onDeleteImmediately={deleteDeck} onEdit={openEditDeck} onSetDailyNewLimit={setDeckDailyNewLimit} onLibrary={openDeckLibrary} onImport={(deck, file) => void startImportPreview(deck, file)} />
              )}
            </>
          )}

          {tab === 'study' && (
            <>
              <div className="welcome-row">
                <div>
                  <div className="eyebrow"><span className="eyebrow-dot" /> ÔN TẬP THÔNG MINH</div>
                  <h1>{selectedDeck ? selectedDeck.name : "Thời gian ôn tập"}</h1>
                  <p className="muted">{selectedDeck ? "Phiên ôn tập của bộ từ này." : "Nhớ lại chủ động giúp từ vựng ở lại lâu hơn."}</p>
                </div>
                <div className="study-head-actions">
                  {selectedDeck && <button className="button secondary study-library-button" onClick={() => openDeckLibrary(selectedDeck)}><BookOpen size={15} /> Thư viện từ</button>}
                  <div className="study-counter"><Sparkles size={15} /> {studyCard ? `${dueCards.length} từ còn lại` : 'Đã hoàn thành'}</div>
                </div>
              </div>
              {studyCard ? (
                <div className="study-layout">
                  <div className="study-progress">
                    <span>TIẾN ĐỘ PHIÊN HỌC</span>
                    <div className="progress-track"><i style={{ width: `${Math.max(8, ((studyTotal - dueCards.length) / Math.max(1, studyTotal)) * 100)}%` }} /></div>
                    <span>{Math.max(0, studyTotal - dueCards.length)} / {studyTotal}</span>
                  </div>
                  <StudyCard key={studyCard.id} card={studyCard} revealed={revealed} onFlip={() => setRevealed(value => !value)} />
                  {revealed && (
                    <div className="rating-row">
                      <div className="rating-label">Chọn thời điểm ôn lại</div>
                      <div className="rating-buttons">
                        {reviewChoices(studyCard.repetitions).map((choice, index) => (
                          <button key={choice.label} onClick={() => void review(index)}>
                            <span>{['Again', 'Hard', 'Good', 'Easy'][index]}</span>
                            <small>{index === 0 ? 'Đưa xuống cuối hàng đợi' : 'Ôn lại sau'}</small>
                            <b>{choice.label}</b>
                          </button>
                        ))}
                      </div>
                      <div className="kbd-hint">Phím tắt: <kbd>Space</kbd> lật thẻ · <kbd>1</kbd>–<kbd>4</kbd> chấm điểm</div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="complete-card">
                  <div className="complete-icon">✦</div>
                  <h2>Tuyệt vời, {firstName}!</h2>
                  <p>Bạn đã hoàn thành các từ đến hạn. Một bước tiến nhỏ đáng tự hào.</p>
                  <div className="complete-stat"><strong>{stats.reviewedToday}</strong><span>từ đã ôn hôm nay</span></div>
                  <button className="button primary" onClick={() => setTab('home')}>Về tổng quan <ChevronRight size={16} /></button>
                </div>
              )}
            </>
          )}

          {tab === 'stats' && (
            <StatisticsPage onOpenDeck={id => { const target = decks.find(d => d.id === id); if (target) openDeckLibrary(target); }} />
          )}
          {false && tab === 'stats' && (
            <>
              <div className="welcome-row">
                <div>
                  <div className="eyebrow"><span className="eyebrow-dot" /> CÁI NHÌN TỔNG QUAN</div>
                  <h1>Thống kê học tập</h1>
                  <p className="muted">Mỗi ngày bạn đang tiến xa hơn một chút.</p>
                </div>
              </div>
              <div className="stats-grid wide">
                <StatCard label="TỪ MỚI HÔM NAY" value={stats.newToday} icon={<BookPlus size={17} />} tint="violet" caption="Hoàn thành lần học đầu" />
                <StatCard label="TỪ MỚI 7 NGÀY" value={stats.new7 ?? 0} icon={<CalendarClock size={17} />} tint="orange" caption="7 ngày gần nhất" />
                <StatCard label="TỪ MỚI 30 NGÀY" value={stats.new30 ?? 0} icon={<CalendarClock size={17} />} tint="pink" caption="30 ngày gần nhất" />
                <StatCard label="TỪ MỚI 365 NGÀY" value={stats.new365 ?? 0} icon={<CalendarClock size={17} />} tint="green" caption="365 ngày gần nhất" />
              </div>
              <div className="stats-grid wide">
                <StatCard label="ÔN TẬP HÔM NAY" value={stats.reviewsToday ?? 0} icon={<Repeat2 size={17} />} tint="violet" caption="Lượt ôn từ cũ hôm nay" />
                <StatCard label="ÔN 7 NGÀY" value={stats.reviews7 ?? 0} icon={<Repeat2 size={17} />} tint="orange" caption="Lượt ôn 7 ngày" />
                <StatCard label="ÔN 30 NGÀY" value={stats.reviews30 ?? 0} icon={<Repeat2 size={17} />} tint="pink" caption="Lượt ôn 30 ngày" />
                <StatCard label="ÔN 365 NGÀY" value={stats.reviews365 ?? 0} icon={<Repeat2 size={17} />} tint="green" caption="Lượt ôn 365 ngày" />
              </div>
              <section className="goal-row">
                <div className="goal-card">
                  <div className="goal-icon"><BookPlus size={18} /></div>
                  <div><strong>{stats.learnedCount.toLocaleString('vi-VN')} từ đã từng học</strong><span>{stats.decksLearned ?? 0} deck đã tham gia học</span></div>
                </div>
                <div className="goal-card">
                  <div className="goal-icon"><Flame size={18} /></div>
                  <div><strong>{stats.streak} ngày liên tiếp</strong><span>Tỷ lệ ghi nhớ {stats.retentionRate === null ? '—' : `${stats.retentionRate}%`}</span></div>
                </div>
              </section>
              <section className="activity-panel">
                <div className="section-heading">
                  <div><h3>Hoạt động học tập</h3><p>Từ mới và lượt ôn theo thời gian.</p></div>
                  <div className="activity-toggle">
                    {([7, 30, 12] as const).map(range => <button key={range} type="button" className={activityRange === range ? 'active' : ''} onClick={() => setActivityRange(range)}>{range === 12 ? '12 tháng' : `${range} ngày`}</button>)}
                  </div>
                </div>
                {learningBusy && !learning ? <div className="learning-skeleton"><span className="skel" /><span className="skel" /><span className="skel" /><span className="skel" /></div> : learningError ? <p className="form-error">{learningError}</p> : (
                  (() => {
                    const points = activityRange === 12 ? (learning?.activity.months ?? []) : (learning?.activity.days ?? []).slice(-activityRange);
                    const max = Math.max(1, ...points.map(point => Math.max(point.newCount, point.reviewCount)));
                    return (
                      <div className="activity-chart">
                        {points.map(point => {
                          const key = 'day' in point ? point.day : point.month;
                          const label = 'day' in point ? new Date(`${point.day}T12:00:00+07:00`).getUTCDate() : point.month.slice(5);
                          return (
                            <div className="activity-col" key={key}>
                              <div className="activity-bars">
                                <i className="activity-bar new" style={{ height: `${Math.max(3, (point.newCount / max) * 130)}px` }} title={`${point.newCount} từ mới`} />
                                <i className="activity-bar review" style={{ height: `${Math.max(3, (point.reviewCount / max) * 130)}px` }} title={`${point.reviewCount} lượt ôn`} />
                              </div>
                              <small>{label}</small>
                            </div>
                          );
                        })}
                        <div className="activity-legend"><span><i className="dot new" /> Từ mới</span><span><i className="dot review" /> Lượt ôn</span></div>
                      </div>
                    );
                  })()
                )}
              </section>
              <section className="deck-stats">
                <div className="section-heading">
                  <div><h3>Thống kê theo bộ từ</h3><p>Nhấn vào một bộ để xem chi tiết.</p></div>
                  <select value={deckSort} onChange={e => setDeckSort(e.target.value as 'new' | 'reviews' | 'progress')} aria-label="Sắp xếp bộ từ">
                    <option value="new">Từ mới nhiều nhất</option>
                    <option value="reviews">Lượt ôn nhiều nhất</option>
                    <option value="progress">Tiến độ cao nhất</option>
                  </select>
                </div>
                {!learning?.decks.length ? <p className="muted">Chưa có lịch sử học. Hoàn thành một lượt học để bắt đầu thống kê.</p> : (
                  <div className="deck-stats-table">
                    {[...(learning?.decks ?? [])].sort((a, b) => deckSort === 'reviews' ? b.reviewsTotal - a.reviewsTotal : deckSort === 'progress' ? b.progress - a.progress : (b.today.newCount + b.last7.newCount) - (a.today.newCount + a.last7.newCount)).map(deck => (
                      <button type="button" className="deck-stats-row" key={deck.deckId} onClick={() => { const target = decks.find(d => d.id === deck.deckId); if (target) openDeckLibrary(target); }}>
                        <span className="deck-stats-name"><strong>{deck.name}</strong><small>{deck.totalCards} từ · đã học {deck.learned}</small></span>
                        <span className="deck-stats-cell"><small>Hôm nay</small><b>{deck.today.newCount}</b></span>
                        <span className="deck-stats-cell"><small>7 ngày</small><b>{deck.last7.newCount}</b></span>
                        <span className="deck-stats-cell"><small>30 ngày</small><b>{deck.last30.newCount}</b></span>
                        <span className="deck-stats-cell"><small>365 ngày</small><b>{deck.last365.newCount}</b></span>
                        <span className="deck-stats-cell"><small>Lượt ôn</small><b>{deck.reviewsTotal}</b></span>
                        <span className="deck-stats-progress"><i style={{ width: `${deck.progress}%` }} /><small>{deck.progress}%</small></span>
                      </button>
                    ))}
                  </div>
                )}
              </section>
              <section className="insight-card">
                <div className="insight-icon"><Sparkles size={18} /></div>
                <div><strong>Giữ vững nhịp học của bạn</strong><p>Ôn một vài từ mỗi ngày giúp xây dựng thói quen bền vững.</p></div>
                <button className="button secondary" onClick={() => void startStudy()}>Ôn ngay <ChevronRight size={15} /></button>
              </section>
            </>
          )}
          </div>
        </div>
      </main>

      {settingsOpen && (
        <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setSettingsOpen(false); }}>
          <section className="modal settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <div className="modal-head">
              <div><div className="eyebrow"><span className="eyebrow-dot" /> TÀI KHOẢN</div><h2 id="settings-title">Cài đặt</h2></div>
              <button autoFocus className="icon-button" onClick={() => setSettingsOpen(false)} aria-label="Đóng cài đặt"><X size={19} /></button>
            </div>
            <div className="settings-summary"><Avatar user={user} /><div><strong>{user.name}</strong><span>{user.email}</span></div></div>
            <p className="muted">Phiên đăng nhập được bảo vệ bằng cookie HttpOnly. Bạn có thể đăng xuất khỏi thiết bị này tại đây.</p>
            <div className="settings-image">
              <div className="section-heading"><div><h3>Hình ảnh minh họa</h3><p>{imageConfig?.configured ? `Đang dùng ${(imageConfig.providers?.length ? imageConfig.providers : imageConfig.provider ? [imageConfig.provider] : []).map(provider => IMAGE_PROVIDER_LABELS[provider] ?? provider).join(', ')}.` : 'Chưa cấu hình dịch vụ ảnh.'}</p></div></div>
              {!imageConfig?.configured && (
                <div className="image-guide"><strong>Hướng dẫn cấu hình</strong><p>Thêm <code>PIXABAY_API_KEY</code> (pixabay.com/api/docs) hoặc <code>UNSPLASH_ACCESS_KEY</code> (unsplash.com/developers) vào <code>backend/.env</code>, rồi khởi động lại máy chủ. API key chỉ được đọc ở backend và không gửi xuống trình duyệt.</p></div>
              )}
            </div>
            <div className="modal-actions"><button className="button secondary" onClick={() => setSettingsOpen(false)}>Đóng</button><button className="button secondary" onClick={signOut}><LogOut size={15} /> Đăng xuất</button></div>
          </section>
        </div>
      )}

      {modal && (
        <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setModal(null); }}>
          <section className="modal">
            <div className="modal-head">
              <div><div className="eyebrow"><span className="eyebrow-dot" /> {modal === 'deck' ? 'THƯ VIỆN' : 'THẺ TỪ VỰNG'}</div><h2>{modal === 'deck' ? (editingDeck ? 'Chỉnh sửa bộ từ' : 'Tạo bộ từ mới') : editingCard ? 'Chỉnh sửa từ' : 'Thêm từ mới'}</h2></div>
              <button className="icon-button" onClick={() => setModal(null)} aria-label="Đóng"><X size={19} /></button>
            </div>
            <form className="form-stack" onSubmit={modal === 'deck' ? saveDeck : saveCard}>
              {modal === 'deck' ? (
                <>
                  <label>Tên bộ từ<input autoFocus value={deckName} onChange={e => setDeckName(e.target.value)} placeholder="Ví dụ: English for work" required maxLength={120} /></label>
                  <label>Mô tả <span className="optional">(không bắt buộc)</span><textarea value={deckDesc} onChange={e => setDeckDesc(e.target.value)} placeholder="Chủ đề hoặc mục tiêu học tập…" rows={3} /></label>
                  <label className="checkbox-row"><input type="checkbox" checked={deckPublic} onChange={e => setDeckPublic(e.target.checked)} /> <span>Công khai bộ từ</span></label>
                  <div className="color-picks"><span>MÀU SẮC</span>{colors.map(c => <i key={c} role="button" tabIndex={0} aria-label={`Chọn màu ${c}`} className={deckColor === c ? 'selected' : ''} style={{ background: c }} onClick={() => setDeckColor(c)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDeckColor(c); } }} />)}</div>
                </>
              ) : (
                <>
                  <label>Từ / cụm từ<input autoFocus value={front} onChange={e => setFront(e.target.value)} placeholder="Ví dụ: serendipity" required maxLength={500} /></label>
                  <label>Nghĩa tiếng Anh / giải thích<textarea value={back} onChange={e => setBack(e.target.value)} placeholder="Tình cờ tìm thấy điều thú vị…" required rows={3} /></label>
                  <label>Phiên âm <span className="optional">(không bắt buộc)</span><input value={pronunciation} onChange={e => setPronunciation(e.target.value)} placeholder="/ˌsɛrənˈdɪpɪti/" maxLength={500} /></label>
                  <label>Nghĩa tiếng Việt <span className="optional">(không bắt buộc)</span><textarea value={translation} onChange={e => setTranslation(e.target.value)} placeholder="Sự tình cờ may mắn" rows={2} /></label>
                  <label>Câu ví dụ <span className="optional">(không bắt buộc)</span><textarea value={example} onChange={e => setExample(e.target.value)} placeholder="We met by pure serendipity." rows={2} /></label>
                  {editingCard ? (
                    <CardImagePanel card={editingCard} config={imageConfig} imageMaxMB={uploadLimits?.imageMaxMB ?? 5} onUpdated={fields => applyCardImage(editingCard.id, fields)} onNotify={notify} />
                  ) : imageConfig?.configured ? (
                    <p className="image-hint"><ImagePlus size={15} /> Ảnh minh họa sẽ được tự động tìm sau khi bạn lưu từ (nếu tìm thấy).</p>
                  ) : (
                    <div className="image-guide compact"><strong>Chưa cấu hình dịch vụ ảnh</strong><p>Thêm <code>PIXABAY_API_KEY</code>, <code>UNSPLASH_ACCESS_KEY</code> hoặc <code>PEXELS_API_KEY</code> vào <code>backend/.env</code>. Từ vẫn được tạo bình thường.</p></div>
                  )}
                </>
              )}
              <div className="modal-actions"><button type="button" className="button secondary" onClick={() => setModal(null)}>Hủy</button><button className="button primary"><Plus size={16} />{modal === 'deck' ? (editingDeck ? 'Lưu thay đổi' : 'Tạo bộ từ') : editingCard ? 'Lưu thay đổi' : 'Thêm từ'}</button></div>
            </form>
          </section>
        </div>
      )}

      {importFile && importUploading && (
        <div className="modal-backdrop">
          <section className="modal upload-modal" role="dialog" aria-modal="true" aria-labelledby="upload-title">
            <div className="modal-head">
              <div>
                <div className="eyebrow"><span className="eyebrow-dot" /> ĐANG TẢI FILE</div>
                <h2 id="upload-title">{importFile.name}</h2>
                <p className="muted">{formatFileSize(importFile.size)} · {importFile.kind} tối đa {importFile.kind === 'APKG' ? uploadLimits?.apkgMaxMB ?? 200 : uploadLimits?.csvMaxMB ?? 50} MB</p>
              </div>
            </div>
            <div className="upload-progress-head"><strong>{Math.round(importProgress * 100)}%</strong><span>{importProgress >= 1 ? 'Đang xử lý trên máy chủ…' : 'Đang tải lên…'}</span></div>
            <div className="upload-track"><i style={{ width: `${Math.max(4, importProgress * 100)}%` }} /></div>
            <p className="muted upload-note">File được xử lý riêng tư trên máy chủ. Vui lòng không đóng trang trong khi tải.</p>
          </section>
        </div>
      )}

      {importPreview && importDeck && (
        <ImportModal preview={importPreview} deckName={importDeck.name} imageConfig={imageConfig} busy={importBusy} fileInfo={importFile} limits={uploadLimits} onCommit={(indexes, picks) => void commitImport(indexes, picks)} onCancel={() => { if (!importBusy) { setImportPreview(null); setImportDeck(null); setImportFile(null); } }} />
      )}

      {imageJob && (
        <ImageJobPanel job={imageJob} minimized={jobMinimized} onMinimize={() => setJobMinimized(true)} onRestore={() => setJobMinimized(false)} onClose={() => { setImageJob(null); setJobMinimized(false); }} />
      )}

      <ConfirmDialog
        open={Boolean(confirmState)}
        title={confirmState?.title ?? ''}
        message={confirmState?.message ?? ''}
        confirmLabel="Xóa"
        danger
        onConfirm={() => { if (confirmState) { const run = confirmState.onConfirm; setConfirmState(null); run(); } }}
        onCancel={() => setConfirmState(null)}
      />

      {error && token && <div className="toast error-toast" role="alert" key={error}><span>{error}</span><button onClick={() => setError('')}><X size={16} /></button></div>}
      {toast && <div className="toast" key={toast}><span>✦</span>{toast}</div>}
    </div>
  );
}
