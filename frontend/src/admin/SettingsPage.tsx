import { useState, type FormEvent } from 'react';
import { Database, KeyRound, ShieldCheck, Server, Clock } from 'lucide-react';
import { adminApi } from './adminApi';
import { ErrorState, LoadingBlock, Panel, formatDateTime, useLoader, useToast } from './ui';

export function SettingsPage() {
  const settings = useLoader(() => adminApi.settings(), []);
  const toast = useToast();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newPassword.length < 12) { toast('Mật khẩu mới cần ít nhất 12 ký tự.', 'error'); return; }
    if (newPassword !== confirmPassword) { toast('Mật khẩu xác nhận không khớp.', 'error'); return; }
    setBusy(true);
    try {
      await adminApi.changePassword(currentPassword, newPassword);
      toast('Đã đổi mật khẩu quản trị.', 'success');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  if (settings.loading && !settings.data) return <LoadingBlock rows={6} />;
  if (settings.error && !settings.data) return <ErrorState message={settings.error} onRetry={settings.reload} />;
  const data = settings.data;
  if (!data) return null;

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <div className="eyebrow"><span className="eyebrow-dot" /> CẤU HÌNH QUẢN TRỊ</div>
          <h1>Cài đặt</h1>
          <p className="muted">Thông tin tài khoản quản trị và trạng thái hệ thống (chỉ đọc).</p>
        </div>
      </div>

      <div className="admin-detail-grid">
        <Panel title="Tài khoản quản trị" subtitle="Thông tin phiên hiện tại">
          <dl className="admin-defs">
            <div><dt>ID</dt><dd className="admin-mono">#{data.admin.id}</dd></div>
            <div><dt>Họ tên</dt><dd>{data.admin.name}</dd></div>
            <div><dt>Email</dt><dd>{data.admin.email}</dd></div>
            <div><dt>Vai trò</dt><dd><span className="admin-badge role-admin">Quản trị</span></dd></div>
            <div><dt>Ngày tạo</dt><dd>{formatDateTime(data.admin.createdAt)}</dd></div>
          </dl>
        </Panel>
        <Panel title="Hệ thống" subtitle="Trạng thái máy chủ và cơ sở dữ liệu">
          <dl className="admin-defs">
            <div><dt><Server size={13} /> Môi trường</dt><dd>{data.system.environment}</dd></div>
            <div><dt><Database size={13} /> Cơ sở dữ liệu</dt><dd><span className={`admin-badge ${data.system.database === 'ok' ? 'status-active' : 'status-locked'}`}>{data.system.database === 'ok' ? 'Kết nối tốt' : 'Không khả dụng'}</span></dd></div>
            <div><dt><Clock size={13} /> Phiên đăng nhập</dt><dd>{data.system.sessionTtl}</dd></div>
            <div><dt>Giờ máy chủ</dt><dd>{formatDateTime(data.system.serverTime)}</dd></div>
            <div><dt>Tài khoản</dt><dd>{data.system.userCount} người dùng · {data.system.adminCount} quản trị</dd></div>
          </dl>
        </Panel>
      </div>

      <Panel title="Đổi mật khẩu quản trị" subtitle="Tối thiểu 12 ký tự; mật khẩu không bao giờ được ghi vào nhật ký">
        <form className="admin-form" onSubmit={submit}>
          <label>Mật khẩu hiện tại<input type="password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} autoComplete="current-password" required maxLength={72} /></label>
          <label>Mật khẩu mới<input type="password" value={newPassword} onChange={event => setNewPassword(event.target.value)} autoComplete="new-password" required minLength={12} maxLength={72} /></label>
          <label>Xác nhận mật khẩu mới<input type="password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} autoComplete="new-password" required minLength={12} maxLength={72} /></label>
          <div className="admin-form-actions"><button className="button primary" disabled={busy}><KeyRound size={15} /> {busy ? 'Đang cập nhật…' : 'Cập nhật mật khẩu'}</button></div>
        </form>
      </Panel>

      <div className="admin-note-block">
        <ShieldCheck size={18} />
        <div>
          <strong>Nguyên tắc bảo mật</strong>
          <p>Quyền quản trị được kiểm tra lại từ cơ sở dữ liệu trên mọi API. Tài khoản bị khóa sẽ mất quyền truy cập ngay lập tức. Hệ thống không cho phép khóa, hạ quyền hoặc xóa quản trị viên cuối cùng.</p>
        </div>
      </div>
    </div>
  );
}
