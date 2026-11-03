import { useState } from 'react';
import { ArrowLeft, BookOpen, Clock, Layers, Lock, ShieldCheck, ShieldOff, Sparkles, Trash2, Unlock } from 'lucide-react';
import { adminApi, type UserDetail } from './adminApi';
import { ConfirmDialog, EmptyState, ErrorState, LoadingBlock, Panel, RoleBadge, StatusBadge, activityLabel, formatDate, formatDateTime, formatNumber, timeAgo, useLoader, useToast } from './ui';
import { navigate } from './router';

type PendingAction = { title: string; message: string; confirmLabel: string; danger: boolean; run: () => Promise<unknown> };

export function UserDetailPage({ userId }: { userId: number }) {
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const detail = useLoader<UserDetail>(() => adminApi.user(userId), [userId]);

  async function runPending() {
    if (!pending) return;
    setBusy(true);
    try {
      await pending.run();
      toast('Thao tác thành công.', 'success');
      setPending(null);
      detail.reload();
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  if (detail.loading && !detail.data) return <LoadingBlock rows={8} />;
  if (detail.error && !detail.data) {
    return (
      <div className="admin-page">
        <button className="text-button" onClick={() => navigate('/admin/users')}><ArrowLeft size={15} /> Danh sách người dùng</button>
        <ErrorState message={detail.error} onRetry={detail.reload} />
      </div>
    );
  }
  const data = detail.data;
  if (!data) return null;
  const { user, stats } = data;

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <button className="text-button" onClick={() => navigate('/admin/users')}><ArrowLeft size={15} /> Danh sách người dùng</button>
          <h1>{user.name}</h1>
          <p className="muted">{user.email}</p>
        </div>
        <div className="admin-page-actions">
          {user.status === 'active' ? (
            <button className="button secondary" onClick={() => setPending({ title: 'Khóa tài khoản', message: `Khóa tài khoản “${user.name}”? Người dùng sẽ bị đăng xuất khỏi mọi phiên ngay lập tức.`, confirmLabel: 'Khóa', danger: true, run: () => adminApi.setUserStatus(user.id, 'locked') })}><Lock size={15} /> Khóa tài khoản</button>
          ) : (
            <button className="button secondary" onClick={() => setPending({ title: 'Mở khóa tài khoản', message: `Mở khóa tài khoản “${user.name}”?`, confirmLabel: 'Mở khóa', danger: false, run: () => adminApi.setUserStatus(user.id, 'active') })}><Unlock size={15} /> Mở khóa</button>
          )}
          {user.role === 'user' ? (
            <button className="button secondary" onClick={() => setPending({ title: 'Cấp quyền quản trị', message: `Cấp quyền quản trị viên cho “${user.name}”?`, confirmLabel: 'Cấp quyền', danger: false, run: () => adminApi.setUserRole(user.id, 'admin') })}><ShieldCheck size={15} /> Cấp quyền admin</button>
          ) : (
            <button className="button secondary" onClick={() => setPending({ title: 'Thu hồi quyền quản trị', message: `Thu hồi quyền quản trị viên của “${user.name}”?`, confirmLabel: 'Thu hồi', danger: true, run: () => adminApi.setUserRole(user.id, 'user') })}><ShieldOff size={15} /> Thu hồi admin</button>
          )}
          <button className="button danger" onClick={() => setPending({ title: 'Xóa tài khoản', message: `Xóa vĩnh viễn tài khoản “${user.name}” cùng toàn bộ bộ thẻ và lịch sử học? Hành động không thể hoàn tác.`, confirmLabel: 'Xóa vĩnh viễn', danger: true, run: async () => { await adminApi.deleteUser(user.id); navigate('/admin/users'); } })}><Trash2 size={15} /> Xóa tài khoản</button>
        </div>
      </div>

      <div className="admin-detail-grid">
        <Panel title="Thông tin tài khoản" subtitle="Không bao giờ hiển thị mật khẩu hay token">
          <dl className="admin-defs">
            <div><dt>ID</dt><dd className="admin-mono">#{user.id}</dd></div>
            <div><dt>Email</dt><dd>{user.email}</dd></div>
            <div><dt>Vai trò</dt><dd><RoleBadge role={user.role} /></dd></div>
            <div><dt>Trạng thái</dt><dd><StatusBadge status={user.status} /></dd></div>
            <div><dt>Ngày tạo</dt><dd>{formatDateTime(user.createdAt)}</dd></div>
            <div><dt>Hoạt động gần nhất</dt><dd>{user.lastActiveAt ? `${timeAgo(user.lastActiveAt)} (${formatDateTime(user.lastActiveAt)})` : 'Chưa hoạt động'}</dd></div>
          </dl>
        </Panel>
        <Panel title="Mức độ hoạt động" subtitle="Dữ liệu học tập gắn với tài khoản">
          <div className="admin-mini-stats">
            <div><BookOpen size={16} /><strong>{formatNumber(stats.deckCount)}</strong><span>bộ thẻ</span></div>
            <div><Layers size={16} /><strong>{formatNumber(stats.cardCount)}</strong><span>từ vựng</span></div>
            <div><Sparkles size={16} /><strong>{formatNumber(stats.reviewCount)}</strong><span>lượt ôn</span></div>
            <div><Clock size={16} /><strong>{formatNumber(stats.reviewedCards)}</strong><span>thẻ đã ôn</span></div>
          </div>
          <p className="admin-note">Lần ôn gần nhất: {stats.lastReviewAt ? formatDateTime(stats.lastReviewAt) : 'Chưa có'}</p>
        </Panel>
      </div>

      <Panel title="Bộ thẻ của tài khoản" subtitle={`${data.decks.length} bộ thẻ`}>
        {data.decks.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>ID</th><th>Tên bộ thẻ</th><th className="admin-num">Từ vựng</th><th>Hiển thị</th><th>Ngày tạo</th><th aria-label="Thao tác" /></tr></thead>
              <tbody>
                {data.decks.map(deck => (
                  <tr key={deck.id}>
                    <td className="admin-mono">#{deck.id}</td>
                    <td>{deck.name}</td>
                    <td className="admin-num">{formatNumber(deck.cardCount)}</td>
                    <td>{Number(deck.isPublic) === 1 ? 'Công khai' : 'Riêng tư'}</td>
                    <td>{formatDate(deck.createdAt)}</td>
                    <td><button className="text-button" onClick={() => navigate('/admin/decks')}>Xem</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState title="Chưa có bộ thẻ" description="Tài khoản này chưa tạo bộ thẻ nào." />}
      </Panel>

      <Panel title="Hoạt động gần đây" subtitle="20 thao tác mới nhất của tài khoản">
        {data.recentActivity.length ? (
          <ul className="admin-activity-list">
            {data.recentActivity.map(log => (
              <li key={log.id}>
                <span className={`admin-activity-dot ${String(log.action).startsWith('admin.') ? 'admin' : ''}`} />
                <div className="admin-activity-copy">
                  <strong>{activityLabel(log.action)}</strong>
                  <small>{formatDateTime(log.createdAt)} · {log.ipAddress ?? 'không rõ IP'}</small>
                </div>
                <span className="admin-activity-target">{log.targetType ? `${log.targetType} #${log.targetId ?? '—'}` : '—'}</span>
              </li>
            ))}
          </ul>
        ) : <EmptyState title="Chưa có hoạt động" description="Các thao tác của tài khoản sẽ xuất hiện tại đây." />}
      </Panel>

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
