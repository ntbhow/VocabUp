import { useEffect, useRef, useState } from 'react';
import { BookOpen, Eye, Globe, Lock, Search, Trash2, X } from 'lucide-react';
import { adminApi, type DeckDetail, type DecksPage as DecksPageData } from './adminApi';
import { ConfirmDialog, EmptyState, ErrorState, LoadingBlock, Pagination, formatDate, formatNumber, useDebouncedValue, useLoader, useToast } from './ui';

type PendingAction = { title: string; message: string; confirmLabel: string; danger: boolean; run: () => Promise<void> };

export function DecksPage() {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [ownerId, setOwnerId] = useState('');
  const [visibility, setVisibility] = useState<'all' | 'public' | 'private'>('all');
  const [sort, setSort] = useState<'created' | 'cards' | 'name'>('created');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [offset, setOffset] = useState(0);
  const limit = 20;

  const [selectedDeck, setSelectedDeck] = useState<number | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const [deckDetail, setDeckDetail] = useState<DeckDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detailOffset, setDetailOffset] = useState(0);
  const [detailSearch, setDetailSearch] = useState('');
  const debouncedDetailSearch = useDebouncedValue(detailSearch, 300);

  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const page = useLoader<DecksPageData>(
    () => adminApi.decks({ search: debouncedSearch, ownerId: ownerId || undefined, visibility, sort, order, limit, offset }),
    [debouncedSearch, ownerId, visibility, sort, order, offset],
  );

  useEffect(() => {
    if (!selectedDeck) { setDeckDetail(null); return; }
    let alive = true;
    setDetailLoading(true);
    setDetailError('');
    adminApi.deck(selectedDeck, { search: debouncedDetailSearch, limit: 50, offset: detailOffset })
      .then(detail => { if (alive) setDeckDetail(detail); })
      .catch((error: unknown) => { if (alive) setDetailError((error as Error).message); })
      .finally(() => { if (alive) setDetailLoading(false); });
    return () => { alive = false; };
  }, [selectedDeck, detailOffset, debouncedDetailSearch]);

  useEffect(() => {
    if (selectedDeck) return;
    const trigger = triggerRef.current;
    triggerRef.current = null;
    if (trigger && document.contains(trigger)) trigger.focus?.();
  }, [selectedDeck]);

  function openDeck(id: number) {
    triggerRef.current = document.activeElement as HTMLElement | null;
    setSelectedDeck(id);
    setDetailOffset(0);
    setDetailSearch('');
  }

  async function runPending() {
    if (!pending) return;
    setBusy(true);
    try {
      await pending.run();
      toast('Thao tác thành công.', 'success');
      setPending(null);
      page.reload();
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  function filterChanged<T>(setter: (value: T) => void, value: T) {
    setter(value);
    setOffset(0);
  }

  const decks = page.data?.decks ?? [];

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <div className="eyebrow"><span className="eyebrow-dot" /> QUẢN LÝ NỘI DUNG</div>
          <h1>Bộ thẻ</h1>
          <p className="muted">Theo dõi toàn bộ bộ thẻ, chủ sở hữu và nội dung từ vựng.</p>
        </div>
      </div>

      <div className="admin-toolbar">
        <div className="admin-search"><Search size={15} /><input value={search} onChange={event => { setSearch(event.target.value); setOffset(0); }} placeholder="Tìm theo tên bộ thẻ, chủ sở hữu…" /></div>
        <input className="admin-input" value={ownerId} onChange={event => { setOwnerId(event.target.value.replace(/\D/g, '')); setOffset(0); }} placeholder="ID chủ sở hữu" inputMode="numeric" aria-label="Lọc theo ID chủ sở hữu" />
        <select value={visibility} onChange={event => filterChanged(setVisibility, event.target.value as typeof visibility)} aria-label="Lọc theo hiển thị">
          <option value="all">Tất cả hiển thị</option>
          <option value="public">Công khai</option>
          <option value="private">Riêng tư</option>
        </select>
        <select value={sort} onChange={event => filterChanged(setSort, event.target.value as typeof sort)} aria-label="Sắp xếp theo">
          <option value="created">Ngày tạo</option>
          <option value="cards">Số từ vựng</option>
          <option value="name">Tên</option>
        </select>
        <button className="button secondary" onClick={() => filterChanged(setOrder, order === 'desc' ? 'asc' : 'desc')}>{order === 'desc' ? 'Giảm dần' : 'Tăng dần'}</button>
      </div>

      {page.loading && !page.data ? <LoadingBlock rows={8} /> : page.error && !page.data ? <ErrorState message={page.error} onRetry={page.reload} /> : (
        <>
          {decks.length ? (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr><th>ID</th><th>Tên bộ thẻ</th><th>Chủ sở hữu</th><th className="admin-num">Từ vựng</th><th>Hiển thị</th><th>Ngày tạo</th><th aria-label="Thao tác" /></tr>
                </thead>
                <tbody>
                  {decks.map(deck => (
                    <tr key={deck.id}>
                      <td className="admin-mono">#{deck.id}</td>
                      <td>{deck.name}</td>
                      <td><div className="admin-user-cell"><strong>{deck.ownerName}</strong><small>{deck.ownerEmail}</small></div></td>
                      <td className="admin-num">{formatNumber(deck.cardCount)}</td>
                      <td>{Number(deck.isPublic) === 1 ? <span className="admin-badge status-active"><Globe size={11} /> Công khai</span> : <span className="admin-badge status-locked"><Lock size={11} /> Riêng tư</span>}</td>
                      <td>{formatDate(deck.createdAt)}</td>
                      <td>
                        <div className="admin-row-actions">
                          <button className="icon-button tiny" title="Xem chi tiết" aria-label={`Xem bộ ${deck.name}`} onClick={() => openDeck(deck.id)}><Eye size={15} /></button>
                          <button className="icon-button tiny danger" title="Xóa bộ thẻ" aria-label={`Xóa bộ ${deck.name}`} onClick={() => setPending({ title: 'Xóa bộ thẻ', message: `Xóa vĩnh viễn bộ thẻ “${deck.name}” của ${deck.ownerEmail} cùng toàn bộ ${deck.cardCount} từ vựng? Hành động không thể hoàn tác.`, confirmLabel: 'Xóa vĩnh viễn', danger: true, run: () => adminApi.deleteDeck(deck.id) })}><Trash2 size={15} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyState title="Không tìm thấy bộ thẻ" description="Thử thay đổi từ khóa hoặc bộ lọc." />}
          {page.data && <Pagination total={page.data.total} limit={limit} offset={offset} onChange={setOffset} />}
        </>
      )}

      {selectedDeck && (
        <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setSelectedDeck(null); }}>
          <section className="modal admin-deck-modal" role="dialog" aria-modal="true" aria-label="Chi tiết bộ thẻ">
            <div className="modal-head">
              <div><div className="eyebrow"><span className="eyebrow-dot" /> CHI TIẾT BỘ THẺ</div><h2>{deckDetail?.deck.name ?? 'Đang tải…'}</h2></div>
              <button autoFocus className="icon-button" onClick={() => setSelectedDeck(null)} aria-label="Đóng"><X size={19} /></button>
            </div>
            {detailLoading && !deckDetail ? <LoadingBlock rows={4} /> : detailError && !deckDetail ? <ErrorState message={detailError} /> : deckDetail ? (
              <>
                <dl className="admin-defs compact">
                  <div><dt>ID</dt><dd className="admin-mono">#{deckDetail.deck.id}</dd></div>
                  <div><dt>Chủ sở hữu</dt><dd>{deckDetail.deck.ownerName} · {deckDetail.deck.ownerEmail}</dd></div>
                  <div><dt>Hiển thị</dt><dd>{Number(deckDetail.deck.isPublic) === 1 ? 'Công khai' : 'Riêng tư'}</dd></div>
                  <div><dt>Ngày tạo</dt><dd>{formatDate(deckDetail.deck.createdAt)}</dd></div>
                </dl>
                <div className="admin-deck-modal-toolbar">
                  <div className="admin-search"><Search size={15} /><input value={detailSearch} onChange={event => { setDetailSearch(event.target.value); setDetailOffset(0); }} placeholder="Tìm từ vựng…" /></div>
                  <span className="muted">{formatNumber(deckDetail.totalCards)} từ</span>
                  <button className="button danger" onClick={() => setPending({ title: 'Xóa bộ thẻ', message: `Xóa vĩnh viễn bộ thẻ “${deckDetail.deck.name}” cùng toàn bộ từ vựng? Hành động không thể hoàn tác.`, confirmLabel: 'Xóa vĩnh viễn', danger: true, run: async () => { await adminApi.deleteDeck(deckDetail.deck.id); setSelectedDeck(null); } })}><Trash2 size={15} /> Xóa bộ thẻ</button>
                </div>
                {deckDetail.cards.length ? (
                  <div className="admin-table-wrap admin-deck-cards">
                    <table className="admin-table">
                      <thead><tr><th>Từ vựng</th><th>Nghĩa</th><th>Phiên âm</th><th className="admin-num">Lặp lại</th></tr></thead>
                      <tbody>
                        {deckDetail.cards.map(card => (
                          <tr key={card.id}>
                            <td><strong>{card.front}</strong></td>
                            <td>{card.translation || card.back}</td>
                            <td className="admin-muted">{card.pronunciation || '—'}</td>
                            <td className="admin-num">{card.repetitions}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <EmptyState title="Chưa có từ vựng" description={debouncedDetailSearch ? 'Không có từ phù hợp.' : 'Bộ thẻ này còn trống.'} icon={<BookOpen size={20} />} />}
                <Pagination total={deckDetail.totalCards} limit={deckDetail.limit} offset={detailOffset} onChange={setDetailOffset} />
              </>
            ) : null}
          </section>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(pending)}
        title={pending?.title ?? ''}
        message={pending?.message ?? ''}
        confirmLabel={pending?.confirmLabel}
        danger={pending?.danger}
        busy={busy}
        onConfirm={() => void runPending()}
        onCancel={() => { if (!busy) setPending(null); }}
      />
    </div>
  );
}
