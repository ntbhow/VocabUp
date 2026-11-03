import type { CSSProperties } from 'react';
import type { SeriesPoint } from './adminApi';

const W = 640;
const H = 220;
const PAD = { left: 40, right: 16, top: 16, bottom: 30 };

function shortDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return `${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function labelIndices(length: number, count = 6): number[] {
  if (length <= count) return Array.from({ length }, (_, index) => index);
  const step = Math.ceil(length / count);
  const indices: number[] = [];
  for (let index = 0; index < length; index += step) indices.push(index);
  if (indices[indices.length - 1] !== length - 1) indices.push(length - 1);
  return indices;
}

export function LineChart({ data, color = '#7768f2', ariaLabel = 'Biểu đồ đường' }: { data: SeriesPoint[]; color?: string; ariaLabel?: string }) {
  if (!data.length) return <div className="admin-chart-empty">Chưa có dữ liệu</div>;
  const max = Math.max(1, ...data.map(point => point.count));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (index: number) => PAD.left + (data.length === 1 ? innerW / 2 : (index / (data.length - 1)) * innerW);
  const y = (value: number) => PAD.top + (1 - value / max) * innerH;
  const line = data.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(point.count).toFixed(1)}`).join(' ');
  const area = `${line} L${x(data.length - 1).toFixed(1)},${(PAD.top + innerH).toFixed(1)} L${x(0).toFixed(1)},${(PAD.top + innerH).toFixed(1)} Z`;
  const gridValues = [0, 0.25, 0.5, 0.75, 1].map(fraction => Math.round(max * fraction));
  const labels = labelIndices(data.length);
  // Re-key the SVG when the range changes so the draw-in animation replays.
  const svgKey = `${data.length}:${data[0]?.date ?? ''}`;

  return (
    <div className="admin-chart">
      <svg key={svgKey} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel}>
        {gridValues.map(value => <line key={`grid-${value}`} x1={PAD.left} x2={W - PAD.right} y1={y(value)} y2={y(value)} className="admin-chart-grid" />)}
        {gridValues.map(value => <text key={`axis-${value}`} x={PAD.left - 7} y={y(value) + 3} className="admin-chart-axis" textAnchor="end">{value}</text>)}
        <path d={area} fill={color} opacity="0.12" className="chart-area" />
        <path d={line} fill="none" stroke={color} strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" pathLength={1} strokeDasharray="1" strokeDashoffset="1" className="chart-line" />
        {data.map((point, index) => (
          <circle key={point.date} cx={x(index)} cy={y(point.count)} r="2.6" fill={color} className="chart-dot">
            <title>{`${shortDate(point.date)}: ${point.count}`}</title>
          </circle>
        ))}
        {labels.map(index => <text key={`label-${index}`} x={x(index)} y={H - 8} className="admin-chart-axis" textAnchor="middle">{shortDate(data[index]!.date)}</text>)}
      </svg>
    </div>
  );
}

export function BarChart({ data, color = '#7768f2', ariaLabel = 'Biểu đồ cột' }: { data: SeriesPoint[]; color?: string; ariaLabel?: string }) {
  if (!data.length) return <div className="admin-chart-empty">Chưa có dữ liệu</div>;
  const max = Math.max(1, ...data.map(point => point.count));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const slot = innerW / data.length;
  const barWidth = Math.max(2, Math.min(26, slot * 0.62));
  const labels = labelIndices(data.length);
  const svgKey = `${data.length}:${data[0]?.date ?? ''}`;

  return (
    <div className="admin-chart">
      <svg key={svgKey} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel}>
        {[0, 0.5, 1].map(fraction => <line key={`grid-${fraction}`} x1={PAD.left} x2={W - PAD.right} y1={PAD.top + (1 - fraction) * innerH} y2={PAD.top + (1 - fraction) * innerH} className="admin-chart-grid" />)}
        {data.map((point, index) => {
          const height = (point.count / max) * innerH;
          const barX = PAD.left + index * slot + (slot - barWidth) / 2;
          const barY = PAD.top + innerH - height;
          return (
            <rect key={point.date} x={barX} y={barY} width={barWidth} height={Math.max(point.count > 0 ? height : 0, point.count > 0 ? 2 : 0)} rx="3" fill={color} opacity="0.88" className="chart-bar">
              <title>{`${shortDate(point.date)}: ${point.count}`}</title>
            </rect>
          );
        })}
        {labels.map(index => <text key={`label-${index}`} x={PAD.left + index * slot + slot / 2} y={H - 8} className="admin-chart-axis" textAnchor="middle">{shortDate(data[index]!.date)}</text>)}
      </svg>
    </div>
  );
}

export function DonutChart({ slices, size = 168 }: { slices: Array<{ label: string; value: number; color: string }>; size?: number }) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  let cursor = 0;
  const arcs = slices.map(slice => {
    const length = total > 0 ? (slice.value / total) * circumference : 0;
    const arc = { ...slice, length, offset: cursor };
    cursor += length;
    return arc;
  });
  const svgKey = slices.map(slice => `${slice.label}:${slice.value}`).join('|');

  return (
    <div className="admin-donut">
      <svg key={svgKey} viewBox="0 0 140 140" width={size} height={size} role="img" aria-label="Phân bố trạng thái tài khoản">
        <circle cx="70" cy="70" r={radius} fill="none" stroke="#f0eff5" strokeWidth="16" />
        {arcs.map(arc => (
          <circle
            key={arc.label}
            cx="70" cy="70" r={radius} fill="none"
            stroke={arc.color} strokeWidth="16"
            strokeDasharray={`${arc.length} ${circumference - arc.length}`}
            strokeDashoffset={-arc.offset}
            transform="rotate(-90 70 70)"
            className="chart-arc"
            style={{ ['--arc-offset' as string]: String(-arc.offset) } as CSSProperties}
          />
        ))}
        <text x="70" y="66" textAnchor="middle" className="admin-donut-total">{total}</text>
        <text x="70" y="82" textAnchor="middle" className="admin-donut-caption">tài khoản</text>
      </svg>
      <ul className="admin-donut-legend">
        {slices.map(slice => (
          <li key={slice.label}><i style={{ background: slice.color }} />{slice.label}<b>{slice.value}</b></li>
        ))}
      </ul>
    </div>
  );
}
