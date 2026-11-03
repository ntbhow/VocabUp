import { useState } from 'react';
import { Search } from 'lucide-react';
import { adminApi, type ActivityPage as ActivityPageData } from './adminApi';
import { EmptyState, ErrorState, LoadingBlock, Pagination, activityLabel, formatDateTime, timeAgo, useDebouncedValue, useLoader } from './ui';

export function ActivityPage() {
  const [action, setAction] = useState('');
  const debouncedAction = useDebouncedValue(action, 300);
  const [actorId, setActorId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [offset, setOffset] = useState(0);
  const limit = 30;

  const page = useLoader<ActivityPageData>(
    () => adminApi.activity({ action: debouncedAction, actorId: actorId || undefined, from: from || undefined, to: to || undefined, limit, offset }),
    [debouncedAction, actorId, from, to, offset],
  );

  function resetFilters() {
    setAction('');
    setActorId('');
    setFrom('');
    setTo('');
    setOffset(0);
  }

  const logs = page.data?.logs ?? [];

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <div className="eyebrow"><span className="eyebrow-dot" /> NHẬT KÝ HOẠT ĐỘNG</div>
          <h1>Audit log</h1>
          <p className="muted">Ghi nhận đăng nhập, thay đổi dữ liệu và thao tác quản trị. Không lưu mật khẩu hay token.</p>
        </div>
      </div>

      <div className="admin-toolbar">
        <div className="admin-search"><Search size={15} /><input value={action} onChange={event => { setAction(event.target.value); setOffset(0); }} placeholder="Hành động (vd: admin.user, auth.login)…" /></div>
        <input className="admin-input" value={actorId} onChange={event => { setActorId(event.target.value.replace(/\D/g, '')); setOffset(0); }} placeholder="ID người thực hiện" inputMode="numeric" aria-label="Lọc theo ID người thực hiện" />
        <input className="admin-input" type="date" value={from} onChange={event => { setFrom(event.target.value); setOffset(0); }} aria-label="Từ ngày" />
        <input className="admin-input" type="date" value={to} onChange={event => { setTo(event.target.value); setOffset(0); }} aria-label="Đến ngày" />
        <button className="button secondary" onClick={resetFilters}>Xóa bộ lọc</button>
      </div>

      {page.loading && !page.data ? <LoadingBlock rows={8} /> : page.error && !page.data ? <ErrorState message={page.error} onRetry={page.reload} /> : (
        <>
          {logs.length ? (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>Thời gian</th><th>Người thực hiện</th><th>Hành động</th><th>Đối tượng</th><th>IP</th><th>Chi tiết</th></tr></thead>
                <tbody>
                  {logs.map(log => (
                    <tr key={log.id}>
                      <td><div className="admin-user-cell"><strong>{formatDateTime(log.createdAt)}</strong><small>{timeAgo(log.createdAt)}</small></div></td>
                      <td><div className="admin-user-cell"><strong>{log.actorName ?? 'Hệ thống'}</strong><small>{log.actorEmail ?? '—'}</small></div></td>
                      <td><span className="admin-action-chip">{activityLabel(log.action)}<code>{log.action}</code></span></td>
                      <td className="admin-muted">{log.targetType ? `${log.targetType} #${log.targetId ?? '—'}` : '—'}</td>
                      <td className="admin-mono admin-muted">{log.ipAddress ?? '—'}</td>
                      <td>{log.metadata ? <details className="admin-metadata"><summary>JSON</summary><pre>{JSON.stringify(log.metadata, null, 2)}</pre></details> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyState title="Chưa có bản ghi" description="Các hoạt động quan trọng sẽ được ghi nhận tại đây." />}
          {page.data && <Pagination total={page.data.total} limit={limit} offset={offset} onChange={setOffset} />}
        </>
      )}
    </div>
  );
}
