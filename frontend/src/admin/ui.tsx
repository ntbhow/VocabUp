import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import type { AdminRole, AdminStatus, RangeDays } from './adminApi';

export const ToastContext = createContext<(message: string, kind?: 'success' | 'error') => void>(() => undefined);
export function useToast(): (message: string, kind?: 'success' | 'error') => void {
  return useContext(ToastContext);
}

export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function useLoader<T>(load: () => Promise<T>, deps: unknown[]): { data: T | null; error: string; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    // Only surface the skeleton when loading is not effectively instant, so a
    // fast response never flashes a loading placeholder.
    const timer = window.setTimeout(() => { if (alive) setLoading(true); }, 160);
    load()
      .then(result => { if (alive) { setData(result); setError(''); } })
      .catch((cause: unknown) => { if (alive) setError((cause as Error).message); })
      .finally(() => { if (alive) { window.clearTimeout(timer); setLoading(false); } });
    return () => { alive = false; window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, loading, reload: () => setTick(value => value + 1) };
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('vi-VN').format(value);
}
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}
export function timeAgo(value: string | null | undefined): string {
  if (!value) return 'Chưa hoạt động';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Chưa hoạt động';
  const minutes = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return 'Vừa xong';
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} ngày trước`;
  return formatDate(value);
}

const ACTIVITY_LABELS: Record<string, string> = {
  'auth.register': 'Đăng ký tài khoản',
  'auth.login': 'Đăng nhập',
  'auth.logout': 'Đăng xuất',
  'deck.create': 'Tạo bộ từ',
  'deck.update': 'Cập nhật bộ từ',
  'deck.delete': 'Xóa bộ từ',
  'card.create': 'Tạo từ vựng',
  'card.update': 'Cập nhật từ vựng',
  'card.delete': 'Xóa từ vựng',
  'study.review': 'Ôn tập từ vựng',
  'admin.user.lock': 'Khóa tài khoản',
  'admin.user.unlock': 'Mở khóa tài khoản',
  'admin.user.role': 'Đổi vai trò tài khoản',
  'admin.user.delete': 'Xóa tài khoản',
  'admin.deck.delete': 'Xóa bộ thẻ',
  'admin.password.change': 'Đổi mật khẩu quản trị',
};
export function activityLabel(action: string): string {
  return ACTIVITY_LABELS[action] ?? action;
}

export function AdminStat({ label, value, hint, icon, tone = 'violet' }: { label: string; value: number; hint?: string; icon?: ReactNode; tone?: string }) {
  return (
    <div className="admin-stat">
      {icon && <span className={`admin-stat-icon ${tone}`}>{icon}</span>}
      <span className="admin-stat-label">{label}</span>
      <strong className="admin-stat-value">{formatNumber(value)}</strong>
      {hint && <small className="admin-stat-hint">{hint}</small>}
    </div>
  );
}

export function Panel({ title, subtitle, actions, children, className = '' }: { title?: string; subtitle?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`admin-panel ${className}`}>
      {(title || actions) && (
        <div className="admin-panel-head">
          <div>{title && <h3>{title}</h3>}{subtitle && <p>{subtitle}</p>}</div>
          {actions && <div className="admin-panel-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Badge({ children, tone }: { children: ReactNode; tone: string }) {
  return <span className={`admin-badge ${tone}`}>{children}</span>;
}
export function RoleBadge({ role }: { role: AdminRole }) {
  return <Badge tone={role === 'admin' ? 'role-admin' : 'role-user'}>{role === 'admin' ? 'Quản trị' : 'Người dùng'}</Badge>;
}
export function StatusBadge({ status }: { status: AdminStatus }) {
  return <Badge tone={status === 'active' ? 'status-active' : 'status-locked'}>{status === 'active' ? 'Hoạt động' : 'Bị khóa'}</Badge>;
}

export function EmptyState({ title, description, icon }: { title: string; description?: string; icon?: ReactNode }) {
  return (
    <div className="admin-empty">
      <div className="admin-empty-icon">{icon ?? '✦'}</div>
      <strong>{title}</strong>
      {description && <p>{description}</p>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="admin-error" role="alert">
      <AlertTriangle size={18} />
      <div><strong>Không thể tải dữ liệu</strong><p>{message}</p></div>
      {onRetry && <button className="button secondary" onClick={onRetry}><RotateCcw size={14} /> Thử lại</button>}
    </div>
  );
}

export function LoadingBlock({ rows = 4 }: { rows?: number }) {
  return (
    <div className="admin-loading" aria-label="Đang tải dữ liệu">
      {Array.from({ length: rows }).map((_, index) => (
        <div className="admin-loading-row" key={index}><span className="skel" style={{ width: `${60 + (index % 3) * 9}%` }} /></div>
      ))}
    </div>
  );
}

export function Pagination({ total, limit, offset, onChange }: { total: number; limit: number; offset: number; onChange: (offset: number) => void }) {
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(total, offset + limit);
  return (
    <div className="admin-pagination">
      <span>{from}–{to} trong {formatNumber(total)}</span>
      <div className="admin-pagination-actions">
        <button className="icon-button" disabled={offset <= 0} onClick={() => onChange(Math.max(0, offset - limit))} aria-label="Trang trước"><ChevronLeft size={16} /></button>
        <span>Trang {page} / {pages}</span>
        <button className="icon-button" disabled={offset + limit >= total} onClick={() => onChange(offset + limit)} aria-label="Trang sau"><ChevronRight size={16} /></button>
      </div>
    </div>
  );
}

export function RangeSelector({ value, onChange }: { value: RangeDays; onChange: (value: RangeDays) => void }) {
  const options: Array<{ value: RangeDays; label: string }> = [
    { value: 7, label: '7 ngày' },
    { value: 30, label: '30 ngày' },
    { value: 90, label: '90 ngày' },
    { value: 365, label: '1 năm' },
  ];
  return (
    <div className="admin-range" role="group" aria-label="Khoảng thời gian">
      {options.map(option => (
        <button key={option.value} type="button" className={value === option.value ? 'selected' : ''} onClick={() => onChange(option.value)}>{option.label}</button>
      ))}
    </div>
  );
}

export { ConfirmDialog } from '../components';
