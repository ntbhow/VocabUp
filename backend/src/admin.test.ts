import { describe, expect, it } from 'vitest';
import { dateSeries, escapeLike, mergeSeries, parseEnum, parseLimit, parseOffset, parseRange } from './admin.js';

describe('admin query parsing', () => {
  it('only accepts the four dashboard ranges and defaults to 30 days', () => {
    expect(parseRange('7')).toBe(7);
    expect(parseRange('30')).toBe(30);
    expect(parseRange('90')).toBe(90);
    expect(parseRange('365')).toBe(365);
    expect(parseRange('999')).toBe(30);
    expect(parseRange('7; DROP TABLE users')).toBe(30);
    expect(parseRange(undefined)).toBe(30);
  });

  it('whitelists sort/filter enums instead of trusting query values', () => {
    expect(parseEnum('admin', ['all', 'user', 'admin'] as const, 'all')).toBe('admin');
    expect(parseEnum('root', ['all', 'user', 'admin'] as const, 'all')).toBe('all');
    expect(parseEnum(['locked'], ['all', 'active', 'locked'] as const, 'all')).toBe('locked');
  });

  it('clamps pagination to safe bounds', () => {
    expect(parseLimit('0')).toBe(20);
    expect(parseLimit('5')).toBe(5);
    expect(parseLimit('500', 20, 100)).toBe(100);
    expect(parseLimit('abc')).toBe(20);
    expect(parseOffset('-5')).toBe(0);
    expect(parseOffset('40')).toBe(40);
    expect(parseOffset('abc')).toBe(0);
  });

  it('escapes LIKE wildcards so search terms are matched literally', () => {
    expect(escapeLike('100%_done')).toBe('%100\\%\\_done%');
    expect(escapeLike('a\\b')).toBe('%a\\\\b%');
  });
});

describe('admin chart series', () => {
  it('returns a continuous, ordered series of UTC dates', () => {
    const series = dateSeries(7);
    expect(series).toHaveLength(7);
    expect(series.every(value => /^\d{4}-\d{2}-\d{2}$/.test(value))).toBe(true);
    const first = new Date(`${series[0]}T00:00:00Z`).getTime();
    const last = new Date(`${series[6]}T00:00:00Z`).getTime();
    expect(last - first).toBe(6 * 86_400_000);
  });

  it('fills missing days with zero and keeps known counts', () => {
    const merged = mergeSeries(['2026-01-01', '2026-01-02', '2026-01-03'], [{ day: '2026-01-02', count: 4 }]);
    expect(merged).toEqual([
      { date: '2026-01-01', count: 0 },
      { date: '2026-01-02', count: 4 },
      { date: '2026-01-03', count: 0 },
    ]);
  });

  it('accepts Date instances returned by MySQL', () => {
    const merged = mergeSeries(['2026-01-02'], [{ day: new Date('2026-01-02T00:00:00Z'), count: '3' }]);
    expect(merged).toEqual([{ date: '2026-01-02', count: 3 }]);
  });
});
