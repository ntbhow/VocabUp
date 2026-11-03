import { useState } from 'react';
import { Activity, BarChart3, BookOpen, CalendarClock, Repeat, TrendingUp, UserCheck, Users } from 'lucide-react';
import { adminApi, type RangeDays, type StatisticsData } from './adminApi';
import { AdminStat, EmptyState, ErrorState, LoadingBlock, Panel, RangeSelector, formatNumber, useLoader } from './ui';
import { BarChart, LineChart } from './charts';

export function StatisticsPage() {
  const [range, setRange] = useState<RangeDays>(30);
  const statistics = useLoader<StatisticsData>(() => adminApi.statistics(range), [range]);

  if (statistics.loading && !statistics.data) return <LoadingBlock rows={8} />;
  if (statistics.error && !statistics.data) return <ErrorState message={statistics.error} onRetry={statistics.reload} />;
  const data = statistics.data;
  if (!data) return null;

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <div className="eyebrow"><span className="eyebrow-dot" /> PHÂN TÍCH CHUYÊN SÂU</div>
          <h1>Thống kê</h1>
          <p className="muted">Tăng trưởng, mức độ quay lại và hiệu quả học tập trong {range} ngày.</p>
        </div>
        <div className="admin-page-actions"><RangeSelector value={range} onChange={setRange} /></div>
      </div>

      <div className="admin-stat-grid">
        <AdminStat label="Người học trong kỳ" value={data.users.recentLearners} icon={<Users size={17} />} tone="violet" />
        <AdminStat label="Người quay lại" value={data.users.returningUsers} icon={<Repeat size={17} />} tone="green" hint={`${data.users.returnRate}% người học trong kỳ`} />
        <AdminStat label="Tổng lượt ôn" value={data.study.totalReviewsInRange} icon={<Activity size={17} />} tone="orange" />
        <AdminStat label="Ngày có hoạt động" value={data.study.activeDays} icon={<CalendarClock size={17} />} tone="blue" hint={`${data.study.avgReviewsPerActiveDay} lượt/ngày`} />
        <AdminStat label="Lượt ôn / người" value={data.study.avgReviewsPerLearner} icon={<BarChart3 size={17} />} tone="violet" hint="Trung bình trong kỳ" />
      </div>

      <div className="admin-charts-grid">
        <Panel title="Tăng trưởng người dùng" subtitle="Tài khoản đăng ký mới theo ngày">
          <LineChart data={data.users.registrations} ariaLabel="Tăng trưởng người dùng" />
        </Panel>
        <Panel title="Lượt ôn tập" subtitle="Số lượt học theo ngày">
          <BarChart data={data.study.reviews} color="#f39b6d" ariaLabel="Lượt ôn tập theo ngày" />
        </Panel>
        <Panel title="Thẻ được tạo" subtitle="Số từ vựng mới theo ngày">
          <LineChart data={data.study.cardsCreated} color="#48b99b" ariaLabel="Thẻ được tạo theo ngày" />
        </Panel>
      </div>

      <div className="admin-two-col">
        <Panel title="Top 10 người dùng tích cực" subtitle="Theo số lượt ôn trong kỳ">
          {data.topUsers.length ? (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>#</th><th>Người dùng</th><th className="admin-num">Lượt ôn</th></tr></thead>
                <tbody>
                  {data.topUsers.map((user, index) => (
                    <tr key={user.id}>
                      <td className="admin-mono">{index + 1}</td>
                      <td><div className="admin-user-cell"><strong>{user.name}</strong><small>{user.email}</small></div></td>
                      <td className="admin-num">{formatNumber(user.reviewCount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyState title="Chưa có dữ liệu" description="Chưa có lượt ôn tập trong khoảng thời gian này." icon={<Users size={20} />} />}
        </Panel>
        <Panel title="Top 10 bộ thẻ được dùng" subtitle="Theo số lượt ôn trong kỳ">
          {data.topDecks.length ? (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>#</th><th>Bộ thẻ</th><th>Chủ sở hữu</th><th className="admin-num">Lượt ôn</th></tr></thead>
                <tbody>
                  {data.topDecks.map((deck, index) => (
                    <tr key={deck.id}>
                      <td className="admin-mono">{index + 1}</td>
                      <td>{deck.name}</td>
                      <td className="admin-muted">{deck.ownerEmail}</td>
                      <td className="admin-num">{formatNumber(deck.reviewCount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyState title="Chưa có dữ liệu" description="Chưa có lượt ôn tập trong khoảng thời gian này." icon={<BookOpen size={20} />} />}
        </Panel>
      </div>

      <Panel title="Thời gian học trung bình" subtitle="Chỉ số này cần dữ liệu thời lượng phiên học">
        {data.study.avgStudyTimeMinutes === null ? (
          <div className="admin-note-block">
            <TrendingUp size={18} />
            <div><strong>Chưa đủ dữ liệu để tính</strong><p>Hệ thống hiện chưa ghi nhận thời lượng từng phiên học, nên không thể tính thời gian học trung bình một cách chính xác. Chỉ số sẽ khả dụng khi có dữ liệu phiên học.</p></div>
          </div>
        ) : (
          <p className="muted"><UserCheck size={15} /> Thời gian học trung bình: {data.study.avgStudyTimeMinutes} phút/phiên.</p>
        )}
      </Panel>
    </div>
  );
}
