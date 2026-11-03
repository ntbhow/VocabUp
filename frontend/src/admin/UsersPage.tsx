import { useState } from 'react';
import { Eye, Lock, Search, ShieldCheck, ShieldOff, Trash2, Unlock } from 'lucide-react';
import { adminApi, type UsersPage as UsersPageData } from './adminApi';
import { ConfirmDialog, EmptyState, ErrorState, LoadingBlock, Pagination, RoleBadge, StatusBadge, formatDate, formatNumber, timeAgo, useDebouncedValue, useLoader, useToast } from './ui';
import { navigate } from './router';

type PendingAction = { title: string; message: string; confirmLabel: string; danger: boolean; run: () => Promise<unknown> };

export function UsersPage() {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [role, setRole] = useState<'all' | 'user' | 'admin'>('all');
  const [status, setStatus] = useState<'all' | 'active' | 'locked'>('all');
  const [sort, setSort] = useState<'created' | 'lastActive' | 'name'>('created');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [offset, setOffset] = useState(0);
  const limit = 20;

  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const page = useLoader<UsersPageData>(
    () => adminApi.users({ search: debouncedSearch, role, status, sort, order, limit, offset }),
    [debouncedSearch, role, status, sort, order, offset],
  );

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

  const users = page.data?.users ?? [];

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <div className="eyebrow"><span className="eyebrow-dot" /> QUẢN LÝ TÀI KHOẢN</div>
          <h1>Người dùng</h1>
          <p className="muted">Tìm kiếm, lọc, khóa/mở khóa, phân quyền và quản lý tài khoản.</p>
        </div>
      </div>

      <div className="admin-toolbar">
        <div className="admin-search"><Search size={15} /><input value={search} onChange={event => { setSearch(event.target.value); setOffset(0); }} placeholder="Tìm theo tên, email hoặc ID…" /></div>
        <select value={role} onChange={event => filterChanged(setRole, event.target.value as typeof role)} aria-label="Lọc theo vai trò">
          <option value="all">Tất cả vai trò</option>
          <option value="user">Người dùng</option>
          <option value="admin">Quản trị</option>
        </select>
        <select value={status} onChange={event => filterChanged(setStatus, event.target.value as typeof status)} aria-label="Lọc theo trạng thái">
          <option value="all">Tất cả trạng thái</option>
          <option value="active">Hoạt động</option>
          <option value="locked">Bị khóa</option>
        </select>
        <select value={sort} onChange={event => filterChanged(setSort, event.target.value as typeof sort)} aria-label="Sắp xếp theo">
          <option value="created">Ngày đăng ký</option>
          <option value="lastActive">Hoạt động gần nhất</option>
          <option value="name">Tên</option>
        </select>
        <button className="button secondary" onClick={() => filterChanged(setOrder, order === 'desc' ? 'asc' : 'desc')}>{order === 'desc' ? 'Giảm dần' : 'Tăng dần'}</button>
      </div>

      {page.loading && !page.data ? <LoadingBlock rows={8} /> : page.error && !page.data ? <ErrorState message={page.error} onRetry={page.reload} /> : (
        <>
          {users.length ? (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>ID</th><th>Người dùng</th><th>Vai trò</th><th>Trạng thái</th><th>Đăng ký</th>
                    <th className="admin-num">Bộ thẻ</th><th className="admin-num">Từ vựng</th><th>Hoạt động gần nhất</th><th aria-label="Thao tác" />
                  </tr>
                </thead>
                <tbody>
                  {users.map(user => (
                    <tr key={user.id}>
                      <td className="admin-mono">#{user.id}</td>
                      <td><div className="admin-user-cell"><strong>{user.name}</strong><small>{user.email}</small></div></td>
                      <td><RoleBadge role={user.role} /></td>
                      <td><StatusBadge status={user.status} /></td>
                      <td>{formatDate(user.createdAt)}</td>
                      <td className="admin-num">{formatNumber(user.deckCount)}</td>
                      <td className="admin-num">{formatNumber(user.cardCount)}</td>
                      <td>{timeAgo(user.lastActiveAt)}</td>
                      <td>
                        <div className="admin-row-actions">
                          <button className="icon-button tiny" title="Xem chi tiết" aria-label={`Xem ${user.name}`} onClick={() => navigate(`/admin/users/${user.id}`)}><Eye size={15} /></button>
                          {user.status === 'active' ? (
                            <button className="icon-button tiny" title="Khóa tài khoản" aria-label={`Khóa ${user.name}`} onClick={() => setPending({ title: 'Khóa tài khoản', message: `Khóa tài khoản “${user.name}”? Người dùng sẽ bị đăng xuất khỏi mọi phiên ngay lập tức.`, confirmLabel: 'Khóa', danger: true, run: () => adminApi.setUserStatus(user.id, 'locked') })}><Lock size={15} /></button>
                          ) : (
                            <button className="icon-button tiny" title="Mở khóa tài khoản" aria-label={`Mở khóa ${user.name}`} onClick={() => setPending({ title: 'Mở khóa tài khoản', message: `Mở khóa tài khoản “${user.name}”?`, confirmLabel: 'Mở khóa', danger: false, run: () => adminApi.setUserStatus(user.id, 'active') })}><Unlock size={15} /></button>
                          )}
                          {user.role === 'user' ? (
                            <button className="icon-button tiny" title="Cấp quyền quản trị" aria-label={`Cấp quyền admin cho ${user.name}`} onClick={() => setPending({ title: 'Cấp quyền quản trị', message: `Cấp quyền quản trị viên cho “${user.name}”? Người này sẽ truy cập được toàn bộ dữ liệu quản trị.`, confirmLabel: 'Cấp quyền', danger: false, run: () => adminApi.setUserRole(user.id, 'admin') })}><ShieldCheck size={15} /></button>
                          ) : (
                            <button className="icon-button tiny" title="Thu hồi quyền quản trị" aria-label={`Thu hồi quyền admin của ${user.name}`} onClick={() => setPending({ title: 'Thu hồi quyền quản trị', message: `Thu hồi quyền quản trị viên của “${user.name}”?`, confirmLabel: 'Thu hồi', danger: true, run: () => adminApi.setUserRole(user.id, 'user') })}><ShieldOff size={15} /></button>
                          )}
                          <button className="icon-button tiny danger" title="Xóa tài khoản" aria-label={`Xóa ${user.name}`} onClick={() => setPending({ title: 'Xóa tài khoản', message: `Xóa vĩnh viễn tài khoản “${user.name}” cùng toàn bộ bộ thẻ và lịch sử học? Hành động không thể hoàn tác.`, confirmLabel: 'Xóa vĩnh viễn', danger: true, run: () => adminApi.deleteUser(user.id) })}><Trash2 size={15} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="Không tìm thấy tài khoản" description="Thử thay đổi từ khóa hoặc bộ lọc." />
          )}
          {page.data && <Pagination total={page.data.total} limit={limit} offset={offset} onChange={setOffset} />}
        </>
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
