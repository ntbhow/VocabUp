import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BarChart3, BookPlus, CalendarDays, Check, ChevronDown, Download, FileText, Flame, Layers, Library, Repeat2, RotateCcw, Settings2, Sparkles, Table2, Target, TrendingUp, X } from 'lucide-react';
import { statsApi, type LearningAnalysis, type RangeKey, type StatsBucket, type StatsPreferences } from './api';
import { StatCard } from './components';

const RANGE_OPTIONS: Array<{ value: RangeKey; label: string }> = [
  { value: 'today', label: 'Hôm nay' }, { value: 'yesterday', label: 'Hôm qua' },
  { value: '7d', label: '7 ngày gần nhất' }, { value: '30d', label: '30 ngày gần nhất' },
  { value: '90d', label: '90 ngày gần nhất' }, { value: '365d', label: '365 ngày gần nhất' },
  { value: 'week', label: 'Tuần này' }, { value: 'month', label: 'Tháng này' }, { value: 'year', label: 'Năm nay' },
  { value: 'custom', label: 'Tùy chỉnh khoảng ngày' },
];

const CARD_KEYS = ['newCount', 'reviewCount', 'learnedTotal', 'decksLearned', 'completionRate', 'currentStreak', 'avgNewPerDay', 'avgReviewsPerDay'] as const;
type CardKey = typeof CARD_KEYS[number];

const CARD_DEFS: Record<CardKey, { label: string; caption: string; tint: string; icon: ReactNode; value: (a: LearningAnalysis) => number; suffix?: string }> = {
  newCount: { label: 'TỪ MỚI', caption: 'Trong khoảng đã chọn', tint: 'violet', icon: <BookPlus size={17} />, value: a => a.summary.newCount },
  reviewCount: { label: 'LƯỢT ÔN', caption: 'Trong khoảng đã chọn', tint: 'orange', icon: <Repeat2 size={17} />, value: a => a.summary.reviewCount },
  learnedTotal: { label: 'TỪ ĐÃ HỌC', caption: 'Tổng cộng', tint: 'pink', icon: <Library size={17} />, value: a => a.summary.learnedTotal },
  decksLearned: { label: 'DECK ĐÃ HỌC', caption: 'Có ít nhất 1 từ', tint: 'green', icon: <Layers size={17} />, value: a => a.summary.decksLearned },
  completionRate: { label: 'HOÀN THÀNH', caption: 'Từ đã học / tổng từ', tint: 'violet', icon: <Target size={17} />, value: a => a.summary.completionRate, suffix: '%' },
  currentStreak: { label: 'CHUỖI NGÀY', caption: 'Học liên tiếp', tint: 'orange', icon: <Flame size={17} />, value: a => a.habits.currentStreak },
  avgNewPerDay: { label: 'TB TỪ MỚI/NGÀY', caption: 'Trong khoảng đã chọn', tint: 'pink', icon: <TrendingUp size={17} />, value: a => a.summary.avgNewPerDay },
  avgReviewsPerDay: { label: 'TB ÔN/NGÀY', caption: 'Trong khoảng đã chọn', tint: 'green', icon: <BarChart3 size={17} />, value: a => a.summary.avgReviewsPerDay },
};

const SECTIONS = [
  { key: 'overview', label: 'Thẻ thống kê' }, { key: 'chart', label: 'Biểu đồ hoạt động' },
  { key: 'heatmap', label: 'Lịch hoạt động' }, { key: 'habits', label: 'Thói quen học tập' },
  { key: 'decks', label: 'Bảng deck' },
] as const;

const DEFAULT_PREFERENCES: StatsPreferences = {
  range: '30d', decks: [], cards: [...CARD_KEYS], order: [...CARD_KEYS],
  chart: 'bar', series: { new: true, review: true }, bucket: 'day', compare: true, view: 'detailed', hidden: [],
};

const fmt = (value: number): string => Number.isInteger(value) ? value.toLocaleString('vi-VN') : value.toLocaleString('vi-VN', { maximumFractionDigits: 1 });

function move<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(Math.max(0, Math.min(next.length, to)), 0, item);
  return next;
}

function delta(current: number, previous: number): { diff: number; pct: number | null; up: boolean } {
  const diff = current - previous;
  return { diff, pct: previous > 0 ? Math.round((diff / previous) * 1000) / 10 : null, up: diff > 0 };
}

export function StatisticsPage({ onOpenDeck }: { onOpenDeck: (deckId: number) => void }) {
  const [prefs, setPrefs] = useState<StatsPreferences>(DEFAULT_PREFERENCES);
  const [analysis, setAnalysis] = useState<LearningAnalysis | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [customize, setCustomize] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [deckMenu, setDeckMenu] = useState(false);
  const [deckSearch, setDeckSearch] = useState('');
  const [deckSort, setDeckSort] = useState<'name' | 'new' | 'reviews' | 'progress' | 'activity'>('new');
  const [hover, setHover] = useState<number | null>(null);
  const [dayDetail, setDayDetail] = useState<{ day: string; newCount: number; reviewCount: number } | null>(null);
  const ready = useRef(false);
  const saveTimer = useRef<number | null>(null);

  const loadAnalysis = useCallback(async (current: StatsPreferences, fromKey?: string, toKey?: string) => {
    setBusy(true); setError('');
    try {
      setAnalysis(await statsApi.analysis({
        range: current.range,
        from: current.range === 'custom' ? fromKey : undefined,
        to: current.range === 'custom' ? toKey : undefined,
        decks: current.decks,
        bucket: current.bucket,
      }));
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const saved = await statsApi.preferences();
        setPrefs(saved);
        await loadAnalysis(saved, from || undefined, to || undefined);
      } catch {
        await loadAnalysis(DEFAULT_PREFERENCES);
      } finally { ready.current = true; }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ready.current) return;
    void loadAnalysis(prefs, from || undefined, to || undefined);
    // The custom date inputs only participate when the range is custom.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.range, prefs.decks, prefs.bucket]);

  useEffect(() => {
    if (!ready.current) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => { void statsApi.savePreferences(prefs).catch(() => undefined); }, 400);
    return () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); };
  }, [prefs]);

  const update = (partial: Partial<StatsPreferences>) => setPrefs(current => ({ ...current, ...partial }));

  const visibleCards = useMemo(() => prefs.order.filter(key => prefs.cards.includes(key)), [prefs.order, prefs.cards]);
  const hidden = (key: string) => prefs.hidden.includes(key);

  const applyCustom = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
      setError('Khoảng ngày không hợp lệ. Chọn ngày bắt đầu trước hoặc bằng ngày kết thúc.'); return;
    }
    update({ range: 'custom' });
    void loadAnalysis({ ...prefs, range: 'custom' }, from, to);
  };

  const resetLayout = () => {
    setPrefs(DEFAULT_PREFERENCES);
    void statsApi.savePreferences(DEFAULT_PREFERENCES).catch(() => undefined);
    void loadAnalysis(DEFAULT_PREFERENCES);
  };

  const toggleDeck = (deckId: number) => {
    const next = prefs.decks.includes(deckId) ? prefs.decks.filter(id => id !== deckId) : [...prefs.decks, deckId];
    update({ decks: next });
  };

  const rangeLabel = RANGE_OPTIONS.find(option => option.value === prefs.range)?.label ?? '';
  const isDeckFiltered = prefs.decks.length > 0;

  const exportCsv = () => {
    if (!analysis) return;
    const rows: Array<Array<string | number>> = [
      ['VocabUp — Thống kê học tập'],
      ['Khoảng thời gian', `${rangeLabel} (${analysis.range.from.slice(0, 10)} → ${analysis.range.to.slice(0, 10)})`],
      ['Múi giờ', analysis.timeZone],
      [],
      ['Chỉ số', 'Giá trị'],
      ['Từ mới', analysis.summary.newCount], ['Lượt ôn', analysis.summary.reviewCount],
      ['Tổng từ đã học', analysis.summary.learnedTotal], ['Deck đã học', analysis.summary.decksLearned],
      ['Tỷ lệ hoàn thành (%)', analysis.summary.completionRate],
      ['Chuỗi hiện tại', analysis.habits.currentStreak], ['Chuỗi dài nhất', analysis.habits.longestStreak],
      ['Tổng ngày học', analysis.habits.studyDays],
      [],
      ['Thời điểm', 'Từ mới', 'Lượt ôn'],
      ...analysis.series.map(point => [point.bucket, point.newCount, point.reviewCount]),
      [],
      ['Deck', 'Tổng từ', 'Đã học', 'Tiến độ (%)', 'Từ mới', 'Lượt ôn'],
      ...analysis.decks.map(deck => [deck.name, deck.totalCards, deck.learned, deck.progress, deck.newCount, deck.reviewCount]),
    ];
    const csv = rows.map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `vocabup-stats-${analysis.range.key}-${analysis.range.from.slice(0, 10)}.csv`; link.click();
    URL.revokeObjectURL(url);
  };

  const chartPoints = analysis?.series ?? [];
  const previousPoints = analysis?.compare?.series ?? [];
  const maxValue = Math.max(1, ...chartPoints.map(p => Math.max(p.newCount, p.reviewCount)), ...previousPoints.map(p => Math.max(p.newCount, p.reviewCount)));
  const chartLabel = (bucket: string) => prefs.bucket === 'month' ? bucket.slice(5) : bucket.slice(5).replace('-', '/');
  const visibleSeries = { new: prefs.series.new, review: prefs.series.review };

  const deckRows = useMemo(() => {
    const needle = deckSearch.trim().toLowerCase();
    return (analysis?.decks ?? [])
      .filter(deck => !needle || deck.name.toLowerCase().includes(needle))
      .sort((a, b) => {
        if (deckSort === 'name') return a.name.localeCompare(b.name, 'vi');
        if (deckSort === 'reviews') return b.reviewCount - a.reviewCount;
        if (deckSort === 'progress') return b.progress - a.progress;
        if (deckSort === 'activity') return String(b.lastActivityAt ?? '').localeCompare(String(a.lastActivityAt ?? ''));
        return b.newCount - a.newCount;
      });
  }, [analysis?.decks, deckSearch, deckSort]);

  const comparePair = analysis && prefs.decks.length === 2
    ? analysis.decks.filter(deck => prefs.decks.includes(deck.deckId))
    : null;
  const compareDelta = analysis?.compare ? delta(analysis.summary.newCount, analysis.compare.summary.newCount) : null;
  const reviewDelta = analysis?.compare ? delta(analysis.summary.reviewCount, analysis.compare.summary.reviewCount) : null;

  const heatmapDays = analysis?.heatmap ?? [];
  const heatmapMax = Math.max(1, ...heatmapDays.map(day => day.newCount + day.reviewCount));
  const heatmapLevel = (value: number) => value === 0 ? 0 : value <= heatmapMax * 0.25 ? 1 : value <= heatmapMax * 0.5 ? 2 : value <= heatmapMax * 0.75 ? 3 : 4;
  const firstHeatmapWeekday = heatmapDays[0] ? new Date(`${heatmapDays[0].day}T12:00:00+07:00`).getUTCDay() : 0;

  return (
    <div className="stats-page">
      <div className="stats-head">
        <div>
          <div className="eyebrow"><span className="eyebrow-dot" /> PHÂN TÍCH HỌC TẬP</div>
          <h1>Thống kê học tập</h1>
          <p className="muted">Dữ liệu thật từ lịch sử ôn tập · múi giờ {analysis?.timeZone ?? 'Asia/Ho_Chi_Minh'}</p>
        </div>
        <div className="stats-actions">
          <button type="button" className="button secondary" onClick={exportCsv} disabled={!analysis}><Download size={15} /> CSV</button>
          <button type="button" className="button secondary" onClick={() => window.print()} disabled={!analysis}><FileText size={15} /> PDF</button>
          <button type="button" className={`button secondary ${customize ? 'active' : ''}`} onClick={() => setCustomize(value => !value)}><Settings2 size={15} /> Tùy chỉnh</button>
        </div>
      </div>

      <div className="stats-toolbar">
        <label className="stats-range"><span>Khoảng thời gian</span>
          <select value={prefs.range} onChange={e => update({ range: e.target.value as RangeKey })}>
            {RANGE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        {prefs.range === 'custom' && (
          <div className="stats-custom-range">
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} aria-label="Ngày bắt đầu" />
            <span>→</span>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} aria-label="Ngày kết thúc" />
            <button type="button" className="button primary" onClick={applyCustom}><Check size={14} /> Áp dụng</button>
          </div>
        )}
        <div className="stats-deck-filter">
          <button type="button" className="button secondary" onClick={() => setDeckMenu(value => !value)} aria-expanded={deckMenu}>
            <Layers size={15} /> {isDeckFiltered ? `${prefs.decks.length} deck` : 'Tất cả deck'} <ChevronDown size={14} />
          </button>
          {deckMenu && (
            <div className="stats-deck-menu">
              <div className="stats-deck-menu-head">
                <button type="button" className="text-button" onClick={() => update({ decks: [] })}>Tất cả deck</button>
                <button type="button" className="text-button" onClick={() => update({ decks: (analysis?.decks ?? []).map(deck => deck.deckId) })}>Chọn tất cả</button>
              </div>
              <input value={deckSearch} onChange={e => setDeckSearch(e.target.value)} placeholder="Tìm deck…" />
              <div className="stats-deck-menu-list">
                {(analysis?.decks ?? []).filter(deck => deck.name.toLowerCase().includes(deckSearch.trim().toLowerCase())).map(deck => (
                  <label key={deck.deckId} className="checkbox-row">
                    <input type="checkbox" checked={prefs.decks.includes(deck.deckId)} onChange={() => toggleDeck(deck.deckId)} />
                    <span>{deck.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
        <span className="stats-range-caption">{analysis ? `${analysis.range.label} · ${analysis.range.days} ngày` : 'Đang tải…'}</span>
      </div>

      {customize && (
        <div className="stats-customize">
          <div className="stats-customize-head"><strong>Tùy chỉnh thống kê</strong><button type="button" className="text-button" onClick={resetLayout}><RotateCcw size={14} /> Khôi phục mặc định</button></div>
          <div className="stats-customize-grid">
            <div>
              <p className="muted">Thẻ thống kê</p>
              {prefs.order.map((key, index) => {
                const def = CARD_DEFS[key as CardKey];
                if (!def) return null;
                return (
                  <div className="stats-card-toggle" key={key}>
                    <label className="checkbox-row"><input type="checkbox" checked={prefs.cards.includes(key)} onChange={e => update({ cards: e.target.checked ? [...new Set([...prefs.cards, key])] : prefs.cards.filter(item => item !== key) })} /><span>{def.label}</span></label>
                    <span className="stats-order-buttons">
                      <button type="button" onClick={() => update({ order: move(prefs.order, index, index - 1) })} disabled={index === 0} aria-label="Lên">↑</button>
                      <button type="button" onClick={() => update({ order: move(prefs.order, index, index + 1) })} disabled={index === prefs.order.length - 1} aria-label="Xuống">↓</button>
                    </span>
                  </div>
                );
              })}
            </div>
            <div>
              <p className="muted">Biểu đồ</p>
              <div className="stats-segmented">
                {(['bar', 'line', 'area'] as const).map(chart => <button key={chart} type="button" className={prefs.chart === chart ? 'active' : ''} onClick={() => update({ chart })}>{chart === 'bar' ? 'Cột' : chart === 'line' ? 'Đường' : 'Khu vực'}</button>)}
              </div>
              <div className="stats-segmented">
                {(['day', 'week', 'month'] as StatsBucket[]).map(bucket => <button key={bucket} type="button" className={prefs.bucket === bucket ? 'active' : ''} onClick={() => update({ bucket })}>{bucket === 'day' ? 'Ngày' : bucket === 'week' ? 'Tuần' : 'Tháng'}</button>)}
              </div>
              <label className="checkbox-row"><input type="checkbox" checked={prefs.series.new} onChange={e => update({ series: { ...prefs.series, new: e.target.checked } })} /><span>Từ mới</span></label>
              <label className="checkbox-row"><input type="checkbox" checked={prefs.series.review} onChange={e => update({ series: { ...prefs.series, review: e.target.checked } })} /><span>Lượt ôn</span></label>
              <label className="checkbox-row"><input type="checkbox" checked={prefs.compare} onChange={e => update({ compare: e.target.checked })} /><span>So sánh kỳ trước</span></label>
            </div>
            <div>
              <p className="muted">Khu vực hiển thị</p>
              {SECTIONS.map(section => <label key={section.key} className="checkbox-row"><input type="checkbox" checked={!hidden(section.key)} onChange={e => update({ hidden: e.target.checked ? prefs.hidden.filter(item => item !== section.key) : [...prefs.hidden, section.key] })} /><span>{section.label}</span></label>)}
              <p className="muted">Chế độ xem</p>
              <div className="stats-segmented">
                <button type="button" className={prefs.view === 'compact' ? 'active' : ''} onClick={() => update({ view: 'compact' })}>Gọn</button>
                <button type="button" className={prefs.view === 'detailed' ? 'active' : ''} onClick={() => update({ view: 'detailed' })}>Chi tiết</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {error && <p className="form-error">{error}</p>}

      {busy && !analysis ? (
        <div className="stats-skeleton">{Array.from({ length: 4 }).map((_, i) => <span key={i} className="skel" />)}</div>
      ) : !analysis ? (
        <p className="muted">Không tải được thống kê. Thử lại sau.</p>
      ) : (
        <>
          {!hidden('overview') && (
            <div className={`stats-grid wide ${prefs.view === 'compact' ? 'compact' : ''}`}>
              {visibleCards.map(key => {
                const def = CARD_DEFS[key as CardKey];
                if (!def) return null;
                return <StatCard key={key} label={def.label} value={def.value(analysis)} suffix={def.suffix} icon={def.icon} tint={def.tint} caption={def.caption} />;
              })}
            </div>
          )}

          {!hidden('chart') && (
            <section className="stats-chart-card">
              <div className="section-heading">
                <div><h3>Biểu đồ hoạt động</h3><p>Từ mới và lượt ôn theo {prefs.bucket === 'day' ? 'ngày' : prefs.bucket === 'week' ? 'tuần' : 'tháng'}.</p></div>
                <div className="chart-legend">
                  {visibleSeries.new && <span><i className="dot new" /> Từ mới</span>}
                  {visibleSeries.review && <span><i className="dot review" /> Lượt ôn</span>}
                  {prefs.compare && <span><i className="dot previous" /> Kỳ trước (từ mới)</span>}
                </div>
              </div>
              {chartPoints.length === 0 ? <p className="muted">Chưa có hoạt động trong khoảng này.</p> : (
                <div className="stats-chart-wrap">
                  <svg className="chart-svg" viewBox="0 0 800 240" role="img" aria-label="Biểu đồ hoạt động học tập">
                    {[0, 0.25, 0.5, 0.75, 1].map(ratio => <line key={ratio} x1="40" x2="790" y1={20 + ratio * 180} y2={20 + ratio * 180} className="chart-grid-line" />)}
                    {chartPoints.map((point, index) => {
                      const step = chartPoints.length > 1 ? 750 / (chartPoints.length - 1) : 750;
                      const x = 40 + index * step;
                      const barWidth = Math.max(3, Math.min(18, step * 0.32));
                      const newH = (point.newCount / maxValue) * 180;
                      const reviewH = (point.reviewCount / maxValue) * 180;
                      const showLabel = chartPoints.length <= 14 || index % Math.ceil(chartPoints.length / 8) === 0;
                      return (
                        <g key={point.bucket} onMouseEnter={() => setHover(index)} onMouseLeave={() => setHover(null)}>
                          <rect x={x - step / 2} y={20} width={Math.max(step, 8)} height={190} fill="transparent" />
                          {prefs.chart === 'bar' && (
                            <>
                              {visibleSeries.new && <rect x={x - barWidth} y={200 - newH} width={barWidth} height={Math.max(1, newH)} className="chart-bar new" rx="2" />}
                              {visibleSeries.review && <rect x={x + 1} y={200 - reviewH} width={barWidth} height={Math.max(1, reviewH)} className="chart-bar review" rx="2" />}
                            </>
                          )}
                          {showLabel && <text x={x} y={228} textAnchor="middle" className="chart-axis-label">{chartLabel(point.bucket)}</text>}
                        </g>
                      );
                    })}
                    {prefs.chart !== 'bar' && chartPoints.length > 0 && (() => {
                      const step = chartPoints.length > 1 ? 750 / (chartPoints.length - 1) : 750;
                      const newPoints = chartPoints.map((point, index) => `${40 + index * step},${200 - (point.newCount / maxValue) * 180}`).join(' ');
                      const reviewPoints = chartPoints.map((point, index) => `${40 + index * step},${200 - (point.reviewCount / maxValue) * 180}`).join(' ');
                      const areaPoints = (points: string) => `40,200 ${points.replace(/ /g, ' L')} ${40 + (chartPoints.length - 1) * step},200 Z`;
                      return (
                        <>
                          {prefs.chart === 'area' && visibleSeries.new && <path d={areaPoints(newPoints)} className="chart-area new" />}
                          {prefs.chart === 'area' && visibleSeries.review && <path d={areaPoints(reviewPoints)} className="chart-area review" />}
                          {visibleSeries.new && <polyline points={newPoints} className="chart-line new" fill="none" />}
                          {visibleSeries.review && <polyline points={reviewPoints} className="chart-line review" fill="none" />}
                        </>
                      );
                    })()}
                    {prefs.compare && previousPoints.length > 0 && prefs.chart !== 'bar' && (() => {
                      const step = previousPoints.length > 1 ? 750 / (previousPoints.length - 1) : 750;
                      const points = previousPoints.map((point, index) => `${40 + index * step},${200 - (point.newCount / maxValue) * 180}`).join(' ');
                      return <polyline points={points} className="chart-line previous" fill="none" />;
                    })()}
                  </svg>
                  {hover !== null && chartPoints[hover] && (
                    <div className="chart-tooltip" style={{ left: `${Math.min(88, Math.max(4, (hover / Math.max(1, chartPoints.length - 1)) * 92))}%` }}>
                      <strong>{chartPoints[hover]!.bucket}</strong>
                      <span>Từ mới: {chartPoints[hover]!.newCount}</span>
                      <span>Lượt ôn: {chartPoints[hover]!.reviewCount}</span>
                      {prefs.compare && previousPoints[hover] && <span>Kỳ trước: {previousPoints[hover]!.newCount} từ mới</span>}
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {!hidden('heatmap') && (
            <section className="stats-heatmap">
              <div className="section-heading"><div><h3>Lịch hoạt động 365 ngày</h3><p>Mỗi ô là một ngày; nhấn để xem chi tiết ngày đó.</p></div><div className="heatmap-legend"><span>Ít</span>{[0, 1, 2, 3, 4].map(level => <i key={level} className={`heatmap-cell level-${level}`} />)}<span>Nhiều</span></div></div>
              <div className="heatmap-wrap">
                <div className="heatmap-months">
                  {heatmapDays.flatMap((day, index) => {
                    const date = new Date(`${day.day}T12:00:00+07:00`);
                    if (date.getUTCDate() !== 1 && index !== 0) return [];
                    const column = Math.floor((index + firstHeatmapWeekday) / 7) + 1;
                    // Skip a short first month to keep adjacent labels apart.
                    if (index === 0 && date.getUTCDate() > 14) return [];
                    return <span key={day.day} title={`Tháng ${date.getUTCMonth() + 1}/${date.getUTCFullYear()}`} style={{ gridColumn: column }}>Th {date.getUTCMonth() + 1}</span>;
                  })}
                </div>
                <div className="heatmap-grid">
                  <div className="heatmap-weekdays"><span>CN</span><span>T2</span><span>T3</span><span>T4</span><span>T5</span><span>T6</span><span>T7</span></div>
                  <div className="heatmap-cells">
                    {Array.from({ length: firstHeatmapWeekday }).map((_, index) => <i key={`blank-${index}`} className="heatmap-cell blank" />)}
                    {heatmapDays.map(day => {
                      const total = day.newCount + day.reviewCount;
                      return <button type="button" key={day.day} className={`heatmap-cell level-${heatmapLevel(total)}`} title={`${day.day}: ${day.newCount} từ mới · ${day.reviewCount} lượt ôn · ${total} hoạt động`} onClick={() => setDayDetail(day)} aria-label={`${day.day}: ${total} hoạt động`} />;
                    })}
                  </div>
                </div>
              </div>
            </section>
          )}

          {!hidden('habits') && (
            <section className="stats-habits">
              <div className="section-heading"><div><h3>Thói quen học tập</h3><p>Tính theo ngày địa phương UTC+7.</p></div></div>
              <div className="habits-grid">
                <div className="habit-card"><Flame size={16} /><strong>{analysis.habits.currentStreak}</strong><span>Chuỗi hiện tại</span></div>
                <div className="habit-card"><Flame size={16} /><strong>{analysis.habits.longestStreak}</strong><span>Chuỗi dài nhất</span></div>
                <div className="habit-card"><CalendarDays size={16} /><strong>{analysis.habits.studyDays}</strong><span>Tổng ngày đã học</span></div>
                <div className="habit-card"><Sparkles size={16} /><strong>{analysis.habits.bestDay ? analysis.habits.bestDay.total : '—'}</strong><span>Ngày tích cực nhất{analysis.habits.bestDay ? ` · ${analysis.habits.bestDay.day}` : ''}</span></div>
                <div className="habit-card"><TrendingUp size={16} /><strong>{fmt(analysis.habits.avgNewPerDay)}</strong><span>TB từ mới/ngày</span></div>
                <div className="habit-card"><Repeat2 size={16} /><strong>{fmt(analysis.habits.avgReviewsPerDay)}</strong><span>TB lượt ôn/ngày</span></div>
                <div className="habit-card"><BarChart3 size={16} /><strong>{analysis.habits.bestHour ? `${analysis.habits.bestHour.hour}:00` : '—'}</strong><span>Khung giờ thường học</span></div>
                <div className="habit-card"><Table2 size={16} /><strong>{analysis.habits.bestDay ? analysis.habits.bestDay.total : '—'}</strong><span>Hoạt động ngày cao nhất</span></div>
              </div>
            </section>
          )}

          <section className="stats-compare">
            <div className="section-heading"><div><h3>So sánh</h3><p>{comparePair ? 'Deck A với deck B trong khoảng đã chọn.' : 'Khoảng đã chọn với kỳ trước.'}</p></div></div>
            {comparePair && comparePair.length === 2 ? (
              <div className="compare-grid">
                {comparePair.map(deck => (
                  <div className="compare-card" key={deck.deckId}>
                    <strong>{deck.name}</strong>
                    <span>{deck.newCount} từ mới · {deck.reviewCount} lượt ôn</span>
                    <span>{deck.learned}/{deck.totalCards} từ · {deck.progress}%</span>
                  </div>
                ))}
                <p className="compare-comment">{comparePair[0]!.newCount === 0 && comparePair[1]!.newCount === 0 ? 'Chưa đủ dữ liệu để so sánh hai deck trong khoảng này.' : `${comparePair[0]!.newCount >= comparePair[1]!.newCount ? comparePair[0]!.name : comparePair[1]!.name} đang học nhiều từ mới hơn trong khoảng này.`}</p>
              </div>
            ) : analysis.compare ? (
              <div className="compare-grid">
                <div className="compare-card"><span className="muted">Kỳ này</span><strong>{analysis.summary.newCount}</strong><span>từ mới · {analysis.summary.reviewCount} lượt ôn</span></div>
                <div className="compare-card"><span className="muted">Kỳ trước</span><strong>{analysis.compare.summary.newCount}</strong><span>từ mới · {analysis.compare.summary.reviewCount} lượt ôn</span></div>
                <div className="compare-card">
                  <span className="muted">Thay đổi từ mới</span>
                  <strong className={compareDelta?.up ? 'up' : compareDelta && compareDelta.diff < 0 ? 'down' : ''}>{compareDelta ? `${compareDelta.diff > 0 ? '+' : ''}${compareDelta.diff}` : '—'} {compareDelta?.pct !== null && compareDelta?.pct !== undefined ? `(${compareDelta.pct > 0 ? '+' : ''}${compareDelta.pct}%)` : ''}</strong>
                  <span className="muted">Lượt ôn: {reviewDelta ? `${reviewDelta.diff > 0 ? '+' : ''}${reviewDelta.diff}` : '—'}</span>
                </div>
                <p className="compare-comment">
                  {!compareDelta || !reviewDelta ? 'Chưa đủ dữ liệu để kết luận.' : analysis.summary.newCount + analysis.summary.reviewCount === 0 && analysis.compare.summary.newCount + analysis.compare.summary.reviewCount === 0
                    ? 'Chưa có hoạt động trong cả hai kỳ.'
                    : compareDelta.diff === 0 && reviewDelta.diff === 0
                      ? 'Hoạt động của bạn giữ nguyên so với kỳ trước.'
                      : compareDelta.up
                        ? `Bạn học nhiều hơn ${Math.abs(compareDelta.diff)} từ mới so với kỳ trước.`
                        : compareDelta.diff < 0
                          ? `Bạn học ít hơn ${Math.abs(compareDelta.diff)} từ mới so với kỳ trước.`
                          : 'Số từ mới không đổi; lượt ôn đã thay đổi.'}
                </p>
              </div>
            ) : null}
          </section>

          {!hidden('decks') && (
            <section className="stats-decks">
              <div className="section-heading">
                <div><h3>Thống kê theo deck</h3><p>Nhấn vào một deck để mở chi tiết.</p></div>
                <div className="stats-deck-controls">
                  <input value={deckSearch} onChange={e => setDeckSearch(e.target.value)} placeholder="Lọc theo tên…" />
                  <select value={deckSort} onChange={e => setDeckSort(e.target.value as typeof deckSort)} aria-label="Sắp xếp deck">
                    <option value="new">Nhiều từ mới</option><option value="reviews">Nhiều lượt ôn</option>
                    <option value="progress">Tiến độ cao</option><option value="activity">Hoạt động gần nhất</option><option value="name">Tên deck</option>
                  </select>
                </div>
              </div>
              {deckRows.length === 0 ? <p className="muted">Chưa có deck phù hợp.</p> : (
                <div className="stats-table">
                  <div className="stats-table-row head"><span>Deck</span><span>Từ</span><span>Từ mới</span><span>Lượt ôn</span><span>Tiến độ</span><span>Gần nhất</span></div>
                  {deckRows.map(deck => (
                    <button type="button" className="stats-table-row" key={deck.deckId} onClick={() => onOpenDeck(deck.deckId)}>
                      <span className="stats-table-name">{deck.name}<small>{deck.learned}/{deck.totalCards} từ</small></span>
                      <span>{deck.totalCards}</span><span>{deck.newCount}</span><span>{deck.reviewCount}</span>
                      <span><i className="progress-mini"><i style={{ width: `${deck.progress}%` }} /></i>{deck.progress}%</span>
                      <span>{deck.lastActivityAt ? new Date(deck.lastActivityAt).toLocaleDateString('vi-VN') : '—'}</span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}

      {dayDetail && (
        <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setDayDetail(null); }}>
          <section className="modal day-modal" role="dialog" aria-modal="true" aria-labelledby="day-title">
            <div className="modal-head"><div><div className="eyebrow"><span className="eyebrow-dot" /> CHI TIẾT NGÀY</div><h2 id="day-title">{dayDetail.day}</h2></div><button className="icon-button" onClick={() => setDayDetail(null)} aria-label="Đóng"><X size={19} /></button></div>
            <div className="habits-grid">
              <div className="habit-card"><strong>{dayDetail.newCount}</strong><span>Từ mới</span></div>
              <div className="habit-card"><strong>{dayDetail.reviewCount}</strong><span>Lượt ôn</span></div>
              <div className="habit-card"><strong>{dayDetail.newCount + dayDetail.reviewCount}</strong><span>Tổng hoạt động</span></div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
