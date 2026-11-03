import { useState } from 'react';
import { Activity, BookOpen, CalendarDays, ClipboardList, Flame, Globe, Layers, Lock, ShieldCheck, Sparkles, UserCheck, UserPlus, Users, UserX } from 'lucide-react';
import { adminApi, type DashboardData, type RangeDays } from './adminApi';
import { AdminStat, EmptyState, ErrorState, LoadingBlock, Panel, RangeSelector, activityLabel, formatDateTime, useLoader } from './ui';
import { BarChart, DonutChart, LineChart } from './charts';

export function DashboardPage({ navigate }: { navigate: (path: string) => void }) {
  const [range, setRange] = useState<RangeDays>(30);
  const dashboard = useLoader<DashboardData>(() => adminApi.dashboard(range), [range]);
  const recent = useLoader(() => adminApi.activity({ limit: 6, offset: 0 }), []);

  if (dashboard.loading && !dashboard.data) return <LoadingBlock rows={8} />;
  if (dashboard.error && !dashboard.data) return <ErrorState message={dashboard.error} onRetry={dashboard.reload} />;
  const data = dashboard.data;
  if (!data) return null;

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <div className="eyebrow"><span className="eyebrow-dot" /> TỔNG QUAN HỆ THỐNG</div>
          <h1>Bảng điều khiển</h1>
          <p className="muted">Theo dõi tài khoản, hoạt động học tập và dữ liệu bộ thẻ của toàn nền tảng.</p>
        </div>
        <div className="admin-page-actions">
          <RangeSelector value={range} onChange={setRange} />
          <button className="button secondary" onClick={() => navigate('/admin/activity')}><ClipboardList size={15} /> Nhật ký</button>
        </div>
      </div>

      <div className="admin-section-title"><h2>Tài khoản</h2><p>Tổng {data.accounts.total} tài khoản · {data.accounts.newInRange} đăng ký trong {range} ngày</p></div>
      <div className="admin-stat-grid">
        <AdminStat label="Tổng tài khoản" value={data.accounts.total} icon={<Users size={17} />} tone="violet" />
        <AdminStat label="Đang hoạt động" value={data.accounts.active} icon={<UserCheck size={17} />} tone="green" hint={`${data.accounts.total ? Math.round((data.accounts.active / data.accounts.total) * 100) : 0}% tổng tài khoản`} />
        <AdminStat label="Bị khóa" value={data.accounts.locked} icon={<UserX size={17} />} tone="pink" />
        <AdminStat label="Quản trị viên" value={data.accounts.admins} icon={<ShieldCheck size={17} />} tone="violet" />
        <AdminStat label="Mới hôm nay" value={data.accounts.newToday} icon={<UserPlus size={17} />} tone="orange" />
        <AdminStat label="Mới 7 ngày" value={data.accounts.new7Days} icon={<CalendarDays size={17} />} tone="blue" />
      </div>

      <div className="admin-section-title"><h2>Học tập</h2><p>Hoạt động học được tính theo lượt ôn tập và lần đăng nhập</p></div>
      <div className="admin-stat-grid">
        <AdminStat label="Tổng người đã học" value={data.learning.learnersTotal} icon={<BookOpen size={17} />} tone="violet" />
        <AdminStat label="Đang học (30 ngày)" value={data.learning.learnersActive} icon={<Flame size={17} />} tone="orange" />
        <AdminStat label="DAU (hôm nay)" value={data.learning.dau} icon={<Activity size={17} />} tone="green" />
        <AdminStat label="WAU (7 ngày)" value={data.learning.wau} icon={<Activity size={17} />} tone="green" />
        <AdminStat label="MAU (30 ngày)" value={data.learning.mau} icon={<Activity size={17} />} tone="green" />
        <AdminStat label="Tổng lượt học" value={data.learning.totalReviews} icon={<Sparkles size={17} />} tone="blue" />
        <AdminStat label="Thẻ đã ôn tập" value={data.learning.reviewedCards} icon={<Layers size={17} />} tone="violet" />
      </div>

      <div className="admin-section-title"><h2>Bộ thẻ</h2><p>{data.decks.createdInRange} bộ thẻ mới trong {range} ngày</p></div>
      <div className="admin-stat-grid">
        <AdminStat label="Tổng bộ thẻ" value={data.decks.total} icon={<BookOpen size={17} />} tone="violet" />
        <AdminStat label="Tổng từ vựng" value={data.decks.cards} icon={<Layers size={17} />} tone="orange" />
        <AdminStat label="Công khai" value={data.decks.public} icon={<Globe size={17} />} tone="green" />
        <AdminStat label="Riêng tư" value={data.decks.private} icon={<Lock size={17} />} tone="pink" />
        <AdminStat label="Tạo hôm nay" value={data.decks.createdToday} icon={<CalendarDays size={17} />} tone="blue" />
      </div>

      <div className="admin-charts-grid">
        <Panel title="Đăng ký tài khoản" subtitle="Tài khoản mới theo ngày">
          <LineChart data={data.charts.registrations} ariaLabel="Đăng ký tài khoản theo ngày" />
        </Panel>
        <Panel title="Người dùng hoạt động" subtitle="Người dùng có hoạt động trong ngày">
          <LineChart data={data.charts.activeUsers} color="#48b99b" ariaLabel="Người dùng hoạt động theo ngày" />
        </Panel>
        <Panel title="Lượt ôn tập" subtitle="Số lượt học theo ngày">
          <BarChart data={data.charts.reviews} color="#f39b6d" ariaLabel="Lượt ôn tập theo ngày" />
        </Panel>
        <Panel title="Tăng trưởng bộ thẻ" subtitle="Bộ thẻ tạo mới theo ngày">
          <BarChart data={data.charts.decks} color="#479ad7" ariaLabel="Bộ thẻ tạo mới theo ngày" />
        </Panel>
        <Panel title="Phân bố trạng thái" subtitle="Tài khoản hoạt động và bị khóa">
          <DonutChart slices={[
            { label: 'Hoạt động', value: data.accounts.active, color: '#48b99b' },
            { label: 'Bị khóa', value: data.accounts.locked, color: '#e87392' },
          ]} />
        </Panel>
        <Panel title="Hoạt động gần đây" subtitle="Thao tác mới nhất trên hệ thống" actions={<button className="text-button" onClick={() => navigate('/admin/activity')}>Xem tất cả</button>}>
          {recent.data?.logs?.length ? (
            <ul className="admin-activity-mini">
              {recent.data.logs.map(log => (
                <li key={log.id}>
                  <span className={`admin-activity-dot ${String(log.action).startsWith('admin.') ? 'admin' : ''}`} />
                  <div><strong>{activityLabel(log.action)}</strong><small>{log.actorName ?? log.actorEmail ?? 'Hệ thống'} · {formatDateTime(log.createdAt)}</small></div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Chưa có hoạt động" description="Các thao tác quan trọng sẽ được ghi nhận tại đây." icon={<ClipboardList size={20} />} />
          )}
        </Panel>
      </div>
    </div>
  );
}
