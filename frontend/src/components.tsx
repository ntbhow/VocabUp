import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, Check, ChevronRight, ImagePlus, MoreHorizontal, Pencil, Plus, Sparkles, Star, Trash2, Upload, X } from 'lucide-react';
import type { Deck } from './api';

export function StatCard({ label, value, icon, tint, caption, suffix }: { label: string; value: number; icon: ReactNode; tint: string; caption: string; suffix?: string }) {
  return (
    <div className="stat-card">
      <div className={`stat-icon ${tint}`}>{icon}</div>
      <span className="stat-label">{label}</span>
      <strong>{suffix === '—' ? '—' : value.toLocaleString('vi-VN')}{suffix && suffix !== '—' ? suffix : ''}</strong>
      <small>{caption}</small>
    </div>
  );
}

export function HighlightExample({ text, term }: { text: string; term: string }) {
  if (!term.trim()) return <>{text}</>;
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
  return <>{parts.map((part, index) => (index % 2 === 1 ? <mark key={index}>{part}</mark> : part))}</>;
}

type DeckGridProps = {
  decks: Deck[];
  onOpen: (d: Deck) => void;
  onStudy: (d: Deck) => void;
  onCreate: () => void;
  onDelete?: (d: Deck) => void;
  onDeleteImmediately?: (d: Deck) => void;
  onEdit?: (d: Deck) => void;
  onSetDailyNewLimit?: (deckId: number, limit: number) => void;
  onLibrary?: (d: Deck) => void;
  onImport?: (d: Deck, file: File) => void;
  onToggleFavorite?: (d: Deck) => void;
  favoriteBusy?: Record<number, boolean>;
  onImages?: (d: Deck) => void;
};

export function DeckGrid({ decks, onOpen, onStudy, onCreate, onDelete, onDeleteImmediately, onEdit, onSetDailyNewLimit, onLibrary, onImport, onToggleFavorite, favoriteBusy, onImages }: DeckGridProps) {
  const [openMenu, setOpenMenu] = useState<number | null>(null);
  const [limitDrafts, setLimitDrafts] = useState<Record<number, string>>({});
  const menuAnchorRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (openMenu === null || !menuAnchorRef.current || !menuRef.current) return;
    const updatePosition = () => {
      const anchor = menuAnchorRef.current?.getBoundingClientRect();
      const menu = menuRef.current?.getBoundingClientRect();
      if (!anchor || !menu) return;
      const gap = 8, edge = 12;
      const left = Math.max(edge, Math.min(anchor.right - menu.width, window.innerWidth - menu.width - edge));
      const below = window.innerHeight - anchor.bottom - gap;
      const above = anchor.top - gap;
      const top = below >= menu.height || below >= above ? anchor.bottom + gap : Math.max(edge, anchor.top - menu.height - gap);
      setMenuPosition({ top, left });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => { window.removeEventListener('resize', updatePosition); window.removeEventListener('scroll', updatePosition, true); };
  }, [openMenu]);

  if (!decks.length) {
    return (
      <div className="empty-state deck-empty">
        <div>✦</div>
        <strong>Bắt đầu với bộ từ đầu tiên</strong>
        <p>Nhóm từ vựng theo chủ đề để việc học dễ dàng hơn.</p>
        <button className="button primary" onClick={onCreate}><Plus size={16} /> Tạo bộ từ</button>
      </div>
    );
  }

  const hasMenu = Boolean(onDelete || onSetDailyNewLimit || onLibrary || onEdit || onImages);

  return (
    <>
      <div className="deck-grid">
        {decks.map(d => (
          <article
            className="deck-card deck-card-clickable"
            key={d.id}
            style={{ '--deck-color': d.color } as CSSProperties}
            tabIndex={0}
            aria-label={`Ôn tập các từ đến hạn trong bộ ${d.name}`}
            onClick={e => { if (!(e.target as HTMLElement).closest('button,label,input')) onOpen(d); }}
            onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpen(d); } }}
          >
            <div className="deck-card-top">
              <div className="deck-icon"><BookOpen size={19} /></div>
              <div className="deck-card-actions">
                {onToggleFavorite && (
                  <button
                    type="button"
                    className={`deck-favorite ${d.isFavorite ? 'active' : ''}`}
                    title={d.isFavorite ? 'Bỏ yêu thích' : 'Thêm vào yêu thích'}
                    aria-label={d.isFavorite ? `Bỏ yêu thích bộ ${d.name}` : `Thêm bộ ${d.name} vào yêu thích`}
                    aria-pressed={Boolean(d.isFavorite)}
                    disabled={Boolean(favoriteBusy?.[d.id])}
                    onClick={e => { e.preventDefault(); e.stopPropagation(); onToggleFavorite(d); }}
                  >
                    <Star size={16} fill={d.isFavorite ? 'currentColor' : 'none'} />
                  </button>
                )}
                {onDeleteImmediately && (
                  <button type="button" className="deck-quick-delete" title={`Xóa bộ ${d.name}`} aria-label={`Xóa bộ ${d.name}`} onClick={e => { e.preventDefault(); e.stopPropagation(); void onDeleteImmediately(d); }}>
                    <Trash2 size={16} />
                  </button>
                )}
                {hasMenu && (
                  <button
                    type="button"
                    className="deck-more"
                    ref={openMenu === d.id ? menuAnchorRef : undefined}
                    onClick={e => { const next = openMenu === d.id ? null : d.id; if (next) menuAnchorRef.current = e.currentTarget; setOpenMenu(next); if (next) setLimitDrafts(current => ({ ...current, [d.id]: String(d.dailyNewLimit) })); }}
                    aria-label={`Tùy chọn bộ ${d.name}`}
                    aria-expanded={openMenu === d.id}
                  >
                    <MoreHorizontal size={18} />
                  </button>
                )}
              </div>
            </div>
            <button className="deck-name" onClick={() => onOpen(d)} title={`Ôn tập bộ ${d.name}`}>{d.name}</button>
            <p>{d.description || 'Bộ từ vựng của bạn'}</p>
            <div className="deck-card-meta">
              <span><BookOpen size={14} />{d.cardCount} từ</span>
              <span><Sparkles size={14} />{d.dueCount} đến hạn</span>
            </div>
            <div className="deck-card-bottom">
              <div className="mini-progress"><i style={{ width: d.cardCount ? `${Math.min(100, Math.max(14, (d.cardCount - d.dueCount) / d.cardCount * 100))}%` : '0%' }} /></div>
              {onImport && (
                <label className="deck-import" title={`Nhập CSV hoặc APKG vào ${d.name}`} aria-label={`Nhập file CSV hoặc APKG vào ${d.name}`}>
                  <Upload size={16} />
                  <input type="file" accept=".csv,.apkg,text/csv,application/octet-stream" onChange={e => { const file = e.currentTarget.files?.[0]; if (file) onImport(d, file); e.currentTarget.value = ''; }} />
                </label>
              )}
              <button className="deck-study" onClick={() => onStudy(d)} aria-label={`Ôn ${d.name}`}><ChevronRight size={17} /></button>
            </div>
          </article>
        ))}
        <button className="add-deck-card" onClick={onCreate}><span><Plus size={20} /></span><strong>Tạo bộ từ mới</strong><small>Bắt đầu một chủ đề mới</small></button>
      </div>

      {openMenu !== null && createPortal(
        <div className="deck-menu" ref={menuRef} role="menu" style={{ position: 'fixed', top: menuPosition.top, left: menuPosition.left, visibility: menuPosition.top === 0 ? 'hidden' : 'visible' }}>
          {(() => {
            const d = decks.find(deck => deck.id === openMenu);
            if (!d) return null;
            return (
              <>
                {onSetDailyNewLimit && (
                  <form className="deck-limit-form" onSubmit={e => { e.preventDefault(); const limit = Number(limitDrafts[d.id] ?? d.dailyNewLimit); if (Number.isInteger(limit) && limit >= 0 && limit <= 500) onSetDailyNewLimit(d.id, limit); setOpenMenu(null); }}>
                    <label>Giới hạn từ mới
                      <input type="number" min={0} max={500} step={1} required value={limitDrafts[d.id] ?? d.dailyNewLimit} onChange={e => setLimitDrafts(current => ({ ...current, [d.id]: e.target.value }))} />
                    </label>
                    <small>Thẻ ôn lại không bị giới hạn · 0 = tắt từ mới</small>
                    <button type="submit" className="deck-limit-save"><Check size={14} /> Lưu giới hạn</button>
                  </form>
                )}
                {onImages && <button type="button" role="menuitem" className="deck-menu-library" onClick={() => { setOpenMenu(null); onImages(d); }}><ImagePlus size={14} /> Tìm ảnh minh họa</button>}
                {onEdit && <button type="button" role="menuitem" className="deck-menu-library" onClick={() => { setOpenMenu(null); onEdit(d); }}><Pencil size={14} /> Sửa bộ từ</button>}
                {onLibrary && <button type="button" role="menuitem" className="deck-menu-library" onClick={() => { setOpenMenu(null); onLibrary(d); }}><BookOpen size={14} /> Thư viện thẻ</button>}
                {onDelete && <button type="button" role="menuitem" className="deck-menu-delete" onClick={() => { setOpenMenu(null); onDelete(d); }}><Trash2 size={14} /> Xóa thẻ</button>}
              </>
            );
          })()}
        </div>,
        document.body,
      )}
    </>
  );
}

/**
 * Shared confirmation dialog with an enter/exit animation, Escape support and
 * focus restoration. It stays mounted for one short beat after `open` turns
 * false so the exit animation can finish before the node is removed.
 */
export function ConfirmDialog({ open, title, message, confirmLabel = 'Xóa', danger = true, busy = false, onConfirm, onCancel }: {
  open: boolean; title: string; message: string; confirmLabel?: string; danger?: boolean; busy?: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const [snapshot, setSnapshot] = useState({ title, message, confirmLabel, danger });
  const previousFocus = useRef<HTMLElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (open) setSnapshot({ title, message, confirmLabel, danger });
  }, [open, title, message, confirmLabel, danger]);

  useEffect(() => {
    if (open) {
      if (!mounted) {
        previousFocus.current = document.activeElement as HTMLElement | null;
        setMounted(true);
      }
      setClosing(false);
      return;
    }
    if (!mounted) return;
    setClosing(true);
    const timer = window.setTimeout(() => { setMounted(false); setClosing(false); }, 160);
    return () => window.clearTimeout(timer);
  }, [open, mounted]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  useEffect(() => {
    if (mounted && !closing) cancelRef.current?.focus();
  }, [mounted, closing]);

  useEffect(() => {
    if (mounted) return;
    const trigger = previousFocus.current;
    previousFocus.current = null;
    if (trigger && document.contains(trigger)) trigger.focus?.();
  }, [mounted]);

  if (!mounted) return null;
  const view = open ? { title, message, confirmLabel, danger } : snapshot;
  return (
    <div className={`modal-backdrop ${closing ? 'closing' : ''}`} onMouseDown={event => { if (event.target === event.currentTarget) onCancel(); }}>
      <section className={`modal confirm-modal ${closing ? 'closing' : ''}`} role="alertdialog" aria-modal="true" aria-label={view.title}>
        <div className="modal-head">
          <div><div className="eyebrow"><span className="eyebrow-dot" /> XÁC NHẬN</div><h2>{view.title}</h2></div>
          <button className="icon-button" onClick={onCancel} aria-label="Đóng"><X size={19} /></button>
        </div>
        <p className="muted">{view.message}</p>
        <div className="modal-actions">
          <button ref={cancelRef} className="button secondary" onClick={onCancel} disabled={busy}>Hủy</button>
          <button className={`button ${view.danger ? 'danger' : 'primary'}`} onClick={onConfirm} disabled={busy}>{busy ? 'Đang xử lý…' : view.confirmLabel}</button>
        </div>
      </section>
    </div>
  );
}
