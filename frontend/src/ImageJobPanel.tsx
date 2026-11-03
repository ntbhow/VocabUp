import { Check, X } from 'lucide-react';
import type { ImageJob, ImageJobItem } from './api';

type Props = {
  job: ImageJob;
  minimized: boolean;
  onMinimize: () => void;
  onRestore: () => void;
  onClose: () => void;
};

const STATUS_LABEL: Record<ImageJobItem['status'], string> = {
  pending: 'Chờ xử lý',
  searching: 'Đang tìm',
  ready: 'Thành công',
  not_found: 'Không tìm thấy',
  error: 'Lỗi',
};

/** Background image-generation progress, minimisable while the user keeps working. */
export function ImageJobPanel({ job, minimized, onMinimize, onRestore, onClose }: Props) {
  const progress = job.total ? Math.round((job.processed / job.total) * 100) : 0;
  const done = job.status === 'done';

  if (minimized) {
    return (
      <button type="button" className={`image-job-chip ${done ? 'done' : 'running'}`} onClick={onRestore} aria-label="Mở tiến trình tạo ảnh">
        <span className="job-chip-mark">{done ? <Check size={14} /> : <span className="spinner tiny" />}</span>
        <span>{done ? `Đã tạo ảnh ${job.succeeded}/${job.total}` : `Đang tạo ảnh ${job.processed}/${job.total}`}</span>
        <b>{progress}%</b>
      </button>
    );
  }

  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) { if (done) onClose(); else onMinimize(); } }}>
      <section className="modal image-job-modal" role="dialog" aria-modal="true" aria-labelledby="image-job-title">
        <div className="modal-head">
          <div>
            <div className="eyebrow"><span className="eyebrow-dot" /> HÌNH ẢNH MINH HỌA</div>
            <h2 id="image-job-title">{done ? 'Đã hoàn tất tìm ảnh' : 'Đang tạo ảnh minh họa'}</h2>
            <p className="muted">{done ? `Đã xử lý ${job.processed}/${job.total} từ.` : `${job.processed}/${job.total} từ đã xử lý. Bạn có thể thu nhỏ và tiếp tục sử dụng ứng dụng.`}</p>
          </div>
          <button className="icon-button" onClick={done ? onClose : onMinimize} aria-label={done ? 'Đóng tiến trình' : 'Thu nhỏ tiến trình'}><X size={19} /></button>
        </div>
        <div className="job-progress-head"><strong>{progress}%</strong><span>{job.succeeded} tìm thấy · {Math.max(0, job.total - job.processed)} đang xử lý · {job.notFound} không tìm thấy · {job.failed} lỗi</span></div>
        <div className="job-track"><i style={{ width: `${progress}%` }} className={done ? 'complete' : ''} /></div>
        <div className="job-list" aria-live="polite">
          {job.items.filter(item => item.status !== 'pending').slice(-200).map(item => (
            <div className="job-item" key={item.cardId} title={item.query ? `Từ khóa: ${item.query}` : undefined}>
              <span className="job-word">{item.front}</span>
              <span className={`job-status ${item.status}`}>{STATUS_LABEL[item.status]}</span>
            </div>
          ))}
          {!job.items.some(item => item.status !== 'pending') && <p className="muted job-empty">Đang chuẩn bị tìm ảnh…</p>}
        </div>
        <div className="modal-actions">
          {done ? <button type="button" className="button primary" onClick={onClose}>Đóng</button> : <button type="button" className="button secondary" onClick={onMinimize}>Thu nhỏ</button>}
        </div>
      </section>
    </div>
  );
}
