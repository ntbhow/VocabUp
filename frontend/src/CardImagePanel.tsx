import { useState } from 'react';
import { Image as ImageIcon, RefreshCw, Search, Trash2, Upload, X } from 'lucide-react';
import { imageApi, type Card, type ImageCandidate, type ImageConfig, type ImageFields } from './api';

type Props = {
  card: Card;
  config: ImageConfig | null;
  imageMaxMB: number;
  onUpdated: (fields: ImageFields) => void;
  onNotify: (message: string) => void;
};

const SOURCE_LABELS: Record<string, string> = { pixabay: 'Pixabay', unsplash: 'Unsplash', pexels: 'Pexels', wikimedia: 'Wikimedia Commons', openverse: 'Openverse', flickr: 'Flickr', upload: 'Tải lên', illustration: 'VocabUp' };

/** Image management inside the vocabulary detail (edit) modal. */
export function CardImagePanel({ card, config, imageMaxMB, onUpdated, onNotify }: Props) {
  const [busy, setBusy] = useState<'auto' | 'upload' | 'delete' | 'select' | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState(card.front);
  const [resultQuery, setResultQuery] = useState(card.front);
  const [candidates, setCandidates] = useState<ImageCandidate[]>([]);
  const [pickerBusy, setPickerBusy] = useState(false);
  const [imageError, setImageError] = useState(false);
  const configured = Boolean(config?.configured);

  const applyFields = (fields: ImageFields) => { setImageError(false); onUpdated(fields); };

  async function autoFind() {
    if (!configured || busy) return;
    setBusy('auto');
    try {
      const result = await imageApi.auto(card.id);
      applyFields(result);
      onNotify(result.found ? 'Đã cập nhật ảnh minh họa.' : 'Không tìm thấy ảnh phù hợp cho từ này.');
    } catch (error) {
      onNotify((error as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function search(term?: string) {
    if (!configured) return;
    const typed = (term ?? '').trim();
    setPickerOpen(true);
    setPickerBusy(true);
    try {
      // With no typed keyword the server resolves the card's actual sense from the
      // Vietnamese meaning and example instead of searching the bare headword.
      const result = await imageApi.candidates(card.id, typed || undefined);
      setCandidates(result.candidates);
      const resolved = result.query ?? typed;
      if (resolved) { setQuery(resolved); setResultQuery(resolved); }
      if (!result.candidates.length) onNotify('Không tìm thấy ảnh phù hợp. Thử từ khóa khác.');
    } catch (error) {
      onNotify((error as Error).message);
    } finally {
      setPickerBusy(false);
    }
  }

  async function choose(candidate: ImageCandidate) {
    if (busy) return;
    setBusy('select');
    try {
      const result = await imageApi.select(card.id, resultQuery, candidate.url);
      applyFields(result);
      setPickerOpen(false);
      onNotify('Đã chọn ảnh minh họa.');
    } catch (error) {
      onNotify((error as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function upload(file: File) {
    if (busy) return;
    if (file.size > imageMaxMB * 1024 * 1024) { onNotify(`Ảnh vượt quá giới hạn ${imageMaxMB} MB.`); return; }
    setBusy('upload');
    try {
      const result = await imageApi.upload(card.id, file);
      applyFields(result);
      onNotify('Đã tải ảnh minh họa lên.');
    } catch (error) {
      onNotify((error as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function removeImage() {
    if (busy) return;
    setBusy('delete');
    try {
      applyFields(await imageApi.remove(card.id));
      onNotify('Đã xóa ảnh minh họa.');
    } catch (error) {
      onNotify((error as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="image-panel">
      <div className="image-panel-head">
        <div className="eyebrow"><span className="eyebrow-dot" /> HÌNH ẢNH MINH HỌA</div>
        <p className="muted">Hình ảnh giúp bạn liên tưởng và ghi nhớ từ nhanh hơn.</p>
      </div>
      <div className="image-panel-body">
        <div className={`image-frame ${card.imageUrl ? 'has-image' : ''}`} title={card.imageQuery ? `Từ khóa tìm ảnh: ${card.imageQuery}` : undefined}>
          {card.imageUrl && !imageError ? (
            <img src={card.imageUrl} alt={`Minh họa cho ${card.front}`} loading="lazy" decoding="async" onError={() => setImageError(true)} />
          ) : (
            <div className="image-placeholder"><ImageIcon size={22} /><span>{card.imageUrl ? 'Không tải được ảnh' : 'Chưa có ảnh minh họa'}</span></div>
          )}
          {busy && <div className="image-loading"><span className="spinner" /></div>}
        </div>
        <div className="image-side">
          <div className="image-meta">
            {card.imageSource && <span className="image-source">Nguồn: {SOURCE_LABELS[card.imageSource] ?? card.imageSource}</span>}
            {card.imageSourceUrl
              ? <a href={card.imageSourceUrl} target="_blank" rel="noreferrer noopener">{card.imageAuthor ? `Ảnh: ${card.imageAuthor}` : 'Xem nguồn ảnh'}</a>
              : card.imageAuthor ? <span>Ảnh: {card.imageAuthor}</span> : null}
            {card.imageLicense && (
              <span className="image-license">Giấy phép: {card.imageLicenseUrl
                ? <a href={card.imageLicenseUrl} target="_blank" rel="noreferrer noopener">{card.imageLicense}</a>
                : card.imageLicense}</span>
            )}
            {Boolean(card.imageIsFallback) && <span className="image-license">Ảnh minh họa tạm thời</span>}
          </div>
          {config === null ? (
            <p className="muted image-status">Đang kiểm tra dịch vụ ảnh…</p>
          ) : !configured ? (
            <div className="image-guide">
              <strong>Chưa cấu hình dịch vụ ảnh</strong>
              <p>Thêm <code>PIXABAY_API_KEY</code>, <code>UNSPLASH_ACCESS_KEY</code> hoặc <code>PEXELS_API_KEY</code> vào <code>backend/.env</code> rồi khởi động lại máy chủ để bật tìm ảnh tự động. Bạn vẫn có thể tải ảnh lên thủ công.</p>
            </div>
          ) : (
            <div className="image-actions">
              <button type="button" className="button secondary" onClick={() => void autoFind()} disabled={Boolean(busy)}><RefreshCw size={15} /> {busy === 'auto' ? 'Đang tìm…' : 'Tự động tìm ảnh'}</button>
              <button type="button" className="button secondary" onClick={() => void search()} disabled={Boolean(busy)}><Search size={15} /> {card.imageUrl ? 'Thay đổi ảnh' : 'Chọn ảnh khác'}</button>
            </div>
          )}
          <div className="image-actions">
            <label className="button secondary upload-button"><Upload size={15} /> Tải ảnh lên<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={Boolean(busy)} onChange={e => { const file = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (file) void upload(file); }} /></label>
            {card.imageUrl && <button type="button" className="button secondary danger" onClick={() => void removeImage()} disabled={Boolean(busy)}><Trash2 size={15} /> Xóa ảnh</button>}
          </div>
          <p className="image-footnote">Ảnh tối đa {imageMaxMB} MB. Ảnh đã chọn thủ công sẽ được giữ nguyên khi chạy lại tìm ảnh tự động.</p>
        </div>
      </div>
      {pickerOpen && (
        <div className="image-picker">
          <div className="image-picker-head"><strong>Chọn ảnh khác</strong><button type="button" className="icon-button tiny" onClick={() => setPickerOpen(false)} aria-label="Đóng chọn ảnh"><X size={16} /></button></div>
          <div className="image-picker-search">
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Từ khóa tìm ảnh…" maxLength={80} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void search(query); } }} />
            <button type="button" className="button secondary" onClick={() => void search(query)} disabled={pickerBusy}>{pickerBusy ? 'Đang tìm…' : 'Tìm'}</button>
          </div>
          {pickerBusy ? <div className="image-grid-loading"><span className="spinner" /></div> : candidates.length ? (
            <div className="image-grid">
              {candidates.map(candidate => (
                <button type="button" key={candidate.url} className="image-option" onClick={() => void choose(candidate)} disabled={Boolean(busy)} title={candidate.author ? `Ảnh: ${candidate.author}` : 'Chọn ảnh'}>
                  <img src={candidate.thumbnailUrl} alt="" loading="lazy" decoding="async" />
                </button>
              ))}
            </div>
          ) : <p className="muted image-empty">Không có kết quả. Thử từ khóa khác.</p>}
          <p className="image-footnote">Ảnh từ {config?.provider === 'unsplash' ? 'Unsplash' : 'Pixabay'}. Ưu tiên ảnh sát nghĩa; bạn có thể chọn ảnh khác hoặc tải lên.</p>
        </div>
      )}
    </div>
  );
}
