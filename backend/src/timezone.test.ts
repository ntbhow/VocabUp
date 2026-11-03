import { describe, expect, it } from 'vitest';
import { msUntilNextStudyDay, shiftDateKey, studyDateKey, toDateKey } from './timezone.js';

describe('study day boundary (Asia/Ho_Chi_Minh)', () => {
  it('rolls the day over at midnight Vietnam time, seven hours ahead of UTC', () => {
    // 16:59 UTC is still the same calendar day in Vietnam.
    expect(studyDateKey(new Date('2026-11-03T16:59:59Z'))).toBe('2026-11-03');
    // 17:00 UTC is exactly 00:00 the next day in Vietnam.
    expect(studyDateKey(new Date('2026-11-03T17:00:00Z'))).toBe('2026-11-04');
    expect(studyDateKey(new Date('2026-11-03T17:00:01Z'))).toBe('2026-11-04');
  });

  it('shifts date keys by whole days without a time zone', () => {
    expect(shiftDateKey('2026-11-03', -6)).toBe('2026-10-28');
    expect(shiftDateKey('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDateKey('2024-03-01', -1)).toBe('2024-02-29');
    expect(shiftDateKey('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('reports the delay until the next Vietnam midnight', () => {
    const now = new Date('2026-11-03T16:30:00Z');
    expect(msUntilNextStudyDay(now)).toBe(30 * 60 * 1000);
    expect(msUntilNextStudyDay(new Date('2026-11-03T17:00:00Z'))).toBe(24 * 60 * 60 * 1000);
  });

  it('keeps DATE columns in the zone the database reported them', () => {
    expect(toDateKey(new Date(2026, 10, 3, 0, 0, 0))).toBe('2026-11-03');
    expect(toDateKey('2026-11-03')).toBe('2026-11-03');
    expect(toDateKey('2026-11-03T00:00:00.000Z')).toBe('2026-11-03');
  });
});
