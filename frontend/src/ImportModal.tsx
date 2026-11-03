import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCheck, Image as ImageIcon, Search, Sparkles, X } from 'lucide-react';
import { formatFileSize, imageApi, type ImageCandidate, type ImageConfig, type ImagePick, type ImageSuggestion, type ImportPreview, type ImportPreviewCard, type UploadLimits } from './api';

type Props = {
  preview: ImportPreview;
  deckName: string;
  imageConfig: ImageConfig | null;
  busy: boolean;
  fileInfo?: { name: string; size: number; kind: 'CSV' | 'APKG' } | null;
  limits?: UploadLimits | null;
  onCommit: (imageIndexes: number[], picks: ImagePick[]) => void;
  onCancel: () => void;
};

const PAGE_SIZE = 50;

/**
 * Import confirmation with semantic image suggestions.
 *
 * Each visible word shows its English term, the Vietnamese meaning used to resolve
 * the sense, and the best matching provider image (resolved from the meaning and
 * example, not the bare headword). The user can preview, change, or deselect the
 * image per card; the chosen image is applied on commit, while cards without a
 * chosen image are left to the background job (which uses the same confidence gate).
 */
export function ImportModal({ preview, deckName, imageConfig, busy, fileInfo, limits, onCommit, onCancel }: Props) {
  const eligible = useMemo(() => preview.cards.filter(card => !card.hasImage), [preview.cards]);
  const [selected, setSelected] = useState<Set<number>>(() => new Set(eligible.map(card => card.index)));
  const [query, setQuery] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [page, setPage] = useState(0);
  const [suggestions, setSuggestions] = useState<Record<number, ImageSuggestion>>({});
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [picks, setPicks] = useState<Record<number, { query: string; candidate: ImageCandidate }>>({});
  const [previewImage, setPreviewImage] = useState<ImageCandidate | null>(null);
  const [picker, setPicker] = useState<{ index: number; query: string; candidates: ImageCandidate[]; busy: boolean; error: string } | null>(null);
  const headerRef = useRef<HTMLInputElement | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return preview.cards.filter(card => {
      if (onlyMissing && card.hasImage) return false;
      if (!needle) return true;
      return card.front.toLowerCase().includes(needle) || card.meaning.toLowerCase().includes(needle);
    });
  }, [preview.cards, query, onlyMissing]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);
  const visibleEligible = visible.filter(card => !card.hasImage);
  const allVisibleSelected = visibleEligible.length > 0 && visibleEligible.every(card => selected.has(card.index));
  const someVisibleSelected = visibleEligible.some(card => selected.has(card.index));
  const configured = Boolean(imageConfig?.configured);

  useEffect(() => {
    if (headerRef.current) headerRef.current.indeterminate = someVisibleSelected && !allVisibleSelected;
  }, [someVisibleSelected, allVisibleSelected]);
  useEffect(() => { setPage(0); }, [query, onlyMissing]);

  // Fetch suggestions for the current page only; the provider cache makes repeat
  // pages cheap, and cards the user never reviews are handled by the job.
  useEffect(() => {
    if (!configured) return;
    const targets = visible.filter(card => !card.hasImage && !suggestions[card.index]);
    if (!targets.length) return;
    let cancelled = false;
    setSuggestBusy(true);
    imageApi.suggest(targets.map(card => ({ front: card.front, back: card.back ?? '', translation: card.translation ?? '', example: card.example ?? null })))
      .then(result => {
        if (cancelled) return;
        setSuggestions(current => {
          const next = { ...current };
          result.suggestions.forEach(suggestion => {
            const card = targets[suggestion.index];
            if (card) next[card.index] = suggestion;
          });
          return next;
        });
      })
      .catch(() => { /* the job will retry; the import itself must not fail */ })
      .finally(() => { if (!cancelled) setSuggestBusy(false); });
    return () => { cancelled = true; };
    // The visible page identity is enough; suggestions are filled incrementally.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured, currentPage, query, onlyMissing, preview.token]);

  const toggle = (card: ImportPreviewCard) => {
    if (card.hasImage) return;
    setSelected(current => {
      const next = new Set(current);
      if (next.has(card.index)) next.delete(card.index); else next.add(card.index);
      return next;
    });
  };
  const toggleVisible = () => {
    setSelected(current => {
      const next = new Set(current);
      if (allVisibleSelected) visibleEligible.forEach(card => next.delete(card.index));
      else visibleEligible.forEach(card => next.add(card.index));
      return next;
    });
  };
  const selectAll = () => setSelected(new Set(eligible.map(card => card.index)));
  const clearAll = () => setSelected(new Set());

  const selectedCount = selected.size;

  const effectiveImage = (card: ImportPreviewCard): { candidate: ImageCandidate; query: string } | null => {
    const pick = picks[card.index];
    if (pick) return pick;
    const suggestion = suggestions[card.index];
    return suggestion?.candidate && suggestion.query ? { candidate: suggestion.candidate, query: suggestion.query } : null;
  };

  async function searchCandidates(index: number, term: string) {
    setPicker(current => current && current.index === index ? { ...current, query: term, busy: true, error: '' } : current);
    try {
      const result = await imageApi.draftCandidates(term);
      setPicker(current => current && current.index === index ? { ...current, candidates: result.candidates, busy: false } : current);
    } catch (error) {
      setPicker(current => current && current.index === index ? { ...current, busy: false, error: (error as Error).message } : current);
    }
  }

  function openPicker(card: ImportPreviewCard) {
    const suggestion = suggestions[card.index];
    const current = picks[card.index];
    const term = current?.query ?? suggestion?.query ?? card.front;
    setPicker({ index: card.index, query: term, candidates: [], busy: true, error: '' });
    void searchCandidates(card.index, term);
  }

  function choose(candidate: ImageCandidate) {
    if (!picker) return;
    setPicks(current => ({ ...current, [picker.index]: { query: picker.query, candidate } }));
    setPicker(null);
  }

  function commit(imageIndexes: number[], picksOut: ImagePick[]) {
    onCommit(imageIndexes, picksOut);
  }

  function buildCommit() {
    const indexes: number[] = [];
    const picksOut: ImagePick[] = [];
    for (const card of preview.cards) {
      if (!selected.has(card.index) || card.hasImage) continue;
      indexes.push(card.index);
      const effective = effectiveImage(card);
      if (effective) picksOut.push({ index: card.index, query: effective.query, url: effective.candidate.url });
    }
    commit(indexes, picksOut);
  }

  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onCancel(); }}>
      <section className="modal import-modal" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <div className="modal-head">
          <div>
            <div className="eyebrow"><span className="eyebrow-dot" /> NHẬP BỘ THẺ · {deckName.toUpperCase().slice(0, 48)}</div>
            <h2 id="import-title">Bạn có muốn tự động tìm kiếm hình ảnh cho các từ vựng trong bộ thẻ này không?</h2>
            <p className="muted">Ảnh được tìm theo <strong>nghĩa tiếng Việt và ngữ cảnh câu ví dụ</strong>, không chỉ theo từ tiếng Anh. Bạn có thể xem trước, đổi ảnh hoặc bỏ chọn từng từ.</p>
            {fileInfo && <p className="import-file">Tệp: <strong>{fileInfo.name}</strong> · {formatFileSize(fileInfo.size)} · {fileInfo.kind} tối đa {fileInfo.kind === 'APKG' ? limits?.apkgMaxMB ?? 200 : limits?.csvMaxMB ?? 50} MB</p>}
            {preview.skipped > 0 && <p className="muted import-skipped">Bỏ qua {preview.skipped} ghi chú không có nội dung văn bản.</p>}
          </div>
          <button className="icon-button" onClick={onCancel} disabled={busy} aria-label="Hủy nhập"><X size={19} /></button>
        </div>
        <div className="import-stats">
          <div><strong>{preview.total}</strong><span>Tổng số từ</span></div>
          <div><strong>{preview.existingWithImage}</strong><span>Đã có ảnh</span></div>
          <div><strong>{preview.withoutImage}</strong><span>Chưa có ảnh</span></div>
          <div className="selected"><strong>{selectedCount}</strong><span>Đang chọn tìm ảnh</span></div>
        </div>
        <div className="import-controls">
          <div className="search-box"><Search size={15} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Tìm từ hoặc nghĩa…" /></div>
          <label className="checkbox-row import-filter"><input type="checkbox" checked={onlyMissing} onChange={e => setOnlyMissing(e.target.checked)} /> <span>Chỉ từ chưa có ảnh</span></label>
          <div className="import-quick">
            <button type="button" className="button secondary" onClick={selectAll} disabled={busy || !eligible.length}><CheckCheck size={15} /> Chọn tất cả</button>
            <button type="button" className="button secondary" onClick={clearAll} disabled={busy || !selectedCount}>Bỏ chọn tất cả</button>
          </div>
        </div>
        {configured && <p className="import-suggest-note">{suggestBusy ? 'Đang tìm ảnh đề xuất cho trang này…' : 'Ảnh đề xuất dựa trên nghĩa tiếng Việt, câu ví dụ và loại từ.'}</p>}
        {!configured && (
          <div className="image-guide import-guide">
            <strong>Chưa cấu hình dịch vụ ảnh</strong>
            <p>Thêm <code>PIXABAY_API_KEY</code> hoặc <code>UNSPLASH_ACCESS_KEY</code> vào <code>backend/.env</code> rồi khởi động lại máy chủ. Bạn vẫn có thể nhập bộ thẻ bình thường.</p>
          </div>
        )}
        <div className="import-table">
          <div className="import-row import-head">
            <label className="import-check"><input ref={headerRef} type="checkbox" checked={allVisibleSelected} onChange={toggleVisible} disabled={busy || !visibleEligible.length} aria-label="Chọn tất cả từ đang hiển thị" /></label>
            <span>TỪ VỰNG</span><span>NGHĨA</span><span>ẢNH</span><span>TRẠNG THÁI</span>
          </div>
          <div className="import-list">
            {visible.map(card => {
              const effective = effectiveImage(card);
              const suggestion = suggestions[card.index];
              return (
                <div className={`import-row ${selected.has(card.index) && !card.hasImage ? 'selected' : ''}`} key={card.index}>
                  <label className="import-check"><input type="checkbox" checked={selected.has(card.index) && !card.hasImage} onChange={() => toggle(card)} disabled={busy || card.hasImage} aria-label={`Chọn ${card.front}`} /></label>
                  <div className="import-word-cell">
                    <span className="import-word">{card.front}</span>
                    <span className="import-word-meaning">{card.meaning}</span>
                  </div>
                  <span className="import-meaning">{card.meaning}</span>
                  <div className="import-image">
                    {effective ? (
                      <button type="button" className="import-thumb" onClick={() => setPreviewImage(effective.candidate)} title={suggestion?.query ? `Từ khóa: ${suggestion.query}` : 'Xem ảnh'}>
                        <img src={effective.candidate.thumbnailUrl} alt={`Ảnh đề xuất cho ${card.front}`} loading="lazy" decoding="async" />
                      </button>
                    ) : (
                      <span className={`import-thumb ${suggestBusy && !suggestion ? 'loading' : 'empty'}`}>{suggestBusy && !suggestion ? '' : 'Chưa có'}</span>
                    )}
                    {!card.hasImage && <button type="button" className="import-change" onClick={() => openPicker(card)}>Tìm ảnh khác</button>}
                  </div>
                  <span className={`import-status ${card.hasImage ? 'has' : 'missing'}`}><ImageIcon size={13} />{card.hasImage ? 'Đã có ảnh' : suggestion?.reason === 'low-confidence' ? 'Cần xem lại' : 'Chưa có ảnh'}</span>
                </div>
              );
            })}
            {!visible.length && <p className="muted import-empty">Không có từ phù hợp với bộ lọc.</p>}
          </div>
        </div>
        {picker && (() => {
          const card = preview.cards.find(item => item.index === picker.index);
          return (
            <div className="image-picker import-picker">
              <div className="image-picker-head">
                <div><strong>{card?.front}</strong><span className="import-picker-meaning">{card?.meaning}</span></div>
                <button type="button" className="icon-button tiny" onClick={() => setPicker(null)} aria-label="Đóng chọn ảnh"><X size={16} /></button>
              </div>
              <div className="image-picker-search">
                <input value={picker.query} onChange={e => setPicker(current => current ? { ...current, query: e.target.value } : current)} placeholder="Từ khóa tiếng Anh…" maxLength={120} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void searchCandidates(picker.index, picker.query); } }} />
                <button type="button" className="button secondary" onClick={() => void searchCandidates(picker.index, picker.query)} disabled={picker.busy}>{picker.busy ? 'Đang tìm…' : 'Tìm'}</button>
              </div>
              <p className="image-footnote">Gợi ý từ khóa: <code>{picks[picker.index]?.query ?? suggestions[picker.index]?.query ?? '—'}</code>. Ưu tiên ảnh thể hiện đúng nghĩa tiếng Việt.</p>
              {picker.error && <p className="error-box">{picker.error}</p>}
              {picker.busy ? <div className="image-grid-loading"><span className="spinner" /></div> : picker.candidates.length ? (
                <div className="image-grid">
                  {picker.candidates.map(candidate => (
                    <button type="button" key={candidate.url} className="image-option" onClick={() => choose(candidate)} title={candidate.author ? `Ảnh: ${candidate.author}` : 'Chọn ảnh'}>
                      <img src={candidate.thumbnailUrl} alt="" loading="lazy" decoding="async" />
                    </button>
                  ))}
                </div>
              ) : <p className="muted image-empty">Không có kết quả. Thử từ khóa khác.</p>}
              {picks[picker.index] && <button type="button" className="text-button" onClick={() => { setPicks(current => { const next = { ...current }; delete next[picker.index]; return next; }); setPicker(null); }}>Dùng lại ảnh đề xuất</button>}
            </div>
          );
        })()}
        {filtered.length > PAGE_SIZE && (
          <div className="import-pagination">
            <button type="button" className="button secondary" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={currentPage === 0}>Trước</button>
            <span>Trang {currentPage + 1} / {pageCount} · {filtered.length} từ</span>
            <button type="button" className="button secondary" onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))} disabled={currentPage >= pageCount - 1}>Sau</button>
          </div>
        )}
        <div className="modal-actions import-actions">
          <button type="button" className="button secondary" onClick={onCancel} disabled={busy}>Hủy</button>
          <button type="button" className="button secondary" onClick={() => commit([], [])} disabled={busy}>Chỉ import</button>
          <button type="button" className="button primary" onClick={buildCommit} disabled={busy || !selectedCount || !configured} title={!configured ? 'Chưa cấu hình API key' : undefined}><Sparkles size={16} /> {busy ? 'Đang xử lý…' : `Import và tạo ảnh (${selectedCount})`}</button>
        </div>
        {previewImage && (
          <div className="image-preview" role="dialog" aria-modal="true" onClick={() => setPreviewImage(null)}>
            <div className="image-preview-card" onClick={event => event.stopPropagation()}>
              <img src={previewImage.url} alt="" />
              <div className="image-preview-meta">
                <span>{previewImage.author ?? 'Ảnh minh họa'}</span>
                {previewImage.sourceUrl && <a href={previewImage.sourceUrl} target="_blank" rel="noreferrer noopener">Nguồn ảnh</a>}
                <button type="button" className="icon-button tiny" onClick={() => setPreviewImage(null)} aria-label="Đóng ảnh"><X size={16} /></button>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
