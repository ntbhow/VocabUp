import { AccountMenu } from '../Account';
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { BarChart3, BookOpen, ClipboardList, GraduationCap, LayoutDashboard, Menu, Settings, ShieldAlert, ShieldCheck, Users, X } from 'lucide-react';
import { request } from '../api';
import { adminApi, type AdminMe } from './adminApi';
import { ToastContext } from './ui';
import { navigate, usePathname } from './router';
import { DashboardPage } from './DashboardPage';
import { UsersPage } from './UsersPage';
import { UserDetailPage } from './UserDetailPage';
import { DecksPage } from './DecksPage';
import { StatisticsPage } from './StatisticsPage';
import { ActivityPage } from './ActivityPage';
import { SettingsPage } from './SettingsPage';
import './admin.css';

type Gate = 'loading' | 'ready' | 'unauthenticated' | 'forbidden' | 'error';

const NAV_ITEMS = [
  { label: 'Tổng quan', path: '/admin', icon: <LayoutDashboard size={18} /> },
  { label: 'Người dùng', path: '/admin/users', icon: <Users size={18} /> },
  { label: 'Bộ thẻ', path: '/admin/decks', icon: <BookOpen size={18} /> },
  { label: 'Thống kê', path: '/admin/statistics', icon: <BarChart3 size={18} /> },
  { label: 'Nhật ký', path: '/admin/activity', icon: <ClipboardList size={18} /> },
  { label: 'Cài đặt', path: '/admin/settings', icon: <Settings size={18} /> },
];

function GateScreen({ icon, title, message, action }: { icon: ReactNode; title: string; message: string; action?: ReactNode }) {
  return (
    <main className="admin-gate">
      <div className="admin-gate-card">
        <div className="admin-gate-icon">{icon}</div>
        <h1>{title}</h1>
        <p>{message}</p>
        {action}
      </div>
    </main>
  );
}

export default function AdminApp() {
  const [gate, setGate] = useState<Gate>('loading');
  const [error, setError] = useState('');
  const [me, setMe] = useState<AdminMe | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [toast, setToast] = useState<{ message: string; kind: 'success' | 'error' } | null>(null);
  const pathname = usePathname();

  const notify = useCallback((message: string, kind: 'success' | 'error' = 'success') => {
    setToast({ message, kind });
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  const loadMe = useCallback(() => {
    setGate('loading');
    adminApi.me()
      .then(profile => {
        if (profile.role !== 'admin') { setGate('forbidden'); return; }
        setMe(profile);
        void request<AdminMe>('/users/me', 'session').then(setMe).catch(() => {});
        setGate('ready');
      })
      .catch((cause: unknown) => {
        const status = (cause as Error & { status?: number }).status;
        if (status === 401) setGate('unauthenticated');
        else if (status === 403) setGate('forbidden');
        else { setError((cause as Error).message); setGate('error'); }
      });
  }, []);

  useEffect(() => { loadMe(); }, [loadMe]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
    setMobileNav(false);
  }, [pathname]);

  async function signOut() {
    try { await request<void>('/auth/logout', 'session', { method: 'POST' }); } catch { /* ignore */ }
    window.location.assign('/login');
  }

  if (gate === 'loading') {
    return <main className="admin-gate"><span className="spinner" /><p className="admin-gate-hint">Đang kiểm tra quyền truy cập…</p></main>;
  }
  if (gate === 'unauthenticated') {
    return <GateScreen icon={<ShieldAlert size={26} />} title="Cần đăng nhập" message="Trang quản trị yêu cầu tài khoản quản trị. Hãy đăng nhập rồi mở lại /admin." action={<a className="button primary" href="/login">Đến trang đăng nhập</a>} />;
  }
  if (gate === 'forbidden') {
    return <GateScreen icon={<ShieldAlert size={26} />} title="Không có quyền truy cập" message="Tài khoản của bạn không có quyền quản trị. Mọi API quản trị đều bị từ chối ở phía máy chủ." action={<a className="button primary" href="/dashboard">Về trang học</a>} />;
  }
  if (gate === 'error' || !me) {
    return <GateScreen icon={<ShieldAlert size={26} />} title="Không thể tải trang quản trị" message={error || 'Đã xảy ra lỗi không xác định.'} action={<button className="button primary" onClick={loadMe}>Thử lại</button>} />;
  }

  const userMatch = pathname.match(/^\/admin\/users\/([1-9]\d*)$/);
  let page: ReactNode;
  let activeLabel = 'Tổng quan';
  if (pathname === '/admin' || pathname === '/admin/') page = <DashboardPage navigate={navigate} />;
  else if (pathname === '/admin/users') { page = <UsersPage />; activeLabel = 'Người dùng'; }
  else if (userMatch) { page = <UserDetailPage userId={Number(userMatch[1])} />; activeLabel = 'Chi tiết người dùng'; }
  else if (pathname === '/admin/decks') { page = <DecksPage />; activeLabel = 'Bộ thẻ'; }
  else if (pathname === '/admin/statistics') { page = <StatisticsPage />; activeLabel = 'Thống kê'; }
  else if (pathname === '/admin/activity') { page = <ActivityPage />; activeLabel = 'Nhật ký'; }
  else if (pathname === '/admin/settings') { page = <SettingsPage />; activeLabel = 'Cài đặt'; }
  else {
    page = (
      <div className="admin-page">
        <div className="admin-gate-card inline">
          <h1>Không tìm thấy trang</h1>
          <p>Đường dẫn quản trị không tồn tại.</p>
          <a className="button primary" href="/admin">Về tổng quan</a>
        </div>
      </div>
    );
    activeLabel = 'Không tìm thấy';
  }

  const isActive = (path: string) => path === '/admin' ? pathname === '/admin' || pathname === '/admin/' : pathname === path || pathname.startsWith(`${path}/`);

  return (
    <ToastContext.Provider value={notify}>
      <div className="admin-shell">
        <aside className={`admin-sidebar ${mobileNav ? 'open' : ''}`}>
          <div className="admin-brand">
            <span className="admin-brand-mark"><GraduationCap size={20} /></span>
            <div><strong>VocabUp</strong><small>Quản trị hệ thống</small></div>
          </div>
          <nav className="admin-nav" aria-label="Điều hướng quản trị">
            {NAV_ITEMS.map(item => (
              <button key={item.path} className={`admin-nav-link ${isActive(item.path) ? 'selected' : ''}`} onClick={() => navigate(item.path)}>
                {item.icon}<span>{item.label}</span>
              </button>
            ))}
          </nav>
          <div className="admin-sidebar-foot">
            <button className="admin-nav-link subtle" onClick={() => window.location.assign('/dashboard')}><BookOpen size={18} /><span>Về trang học</span></button>
          </div>
        </aside>
        {mobileNav && <button className="admin-scrim" onClick={() => setMobileNav(false)} aria-label="Đóng menu" />}

        <div className="admin-main">
          <header className="admin-topbar">
            <button className="icon-button admin-mobile-menu" onClick={() => setMobileNav(true)} aria-label="Mở menu"><Menu size={20} /></button>
            <div className="admin-crumb"><ShieldCheck size={14} /> Quản trị <span>/</span> {activeLabel}</div>
            <div className="admin-top-actions">
              <AccountMenu user={me} onSignOut={() => void signOut()} />
            </div>
          </header>
          <main className="admin-content">{page}</main>
        </div>

        {toast && (
          <div key={`${toast.kind}:${toast.message}`} className={`admin-toast ${toast.kind}`} role="status">
            <span>{toast.kind === 'success' ? '✓' : '!'}</span>{toast.message}
            <button onClick={() => setToast(null)} aria-label="Đóng thông báo"><X size={14} /></button>
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

