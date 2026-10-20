import { describe, expect, it } from 'vitest';
import { mapAnkiSchedule } from './apkg.js';

describe('mapAnkiSchedule', () => {
  it('keeps unscheduled Anki cards new for the VocabUp daily new-card limit', () => {
    expect(mapAnkiSchedule({ queue: 0, type: 0, due: 14, interval: 0, factor: 0, repetitions: 0 }, 1_700_000_000)).toEqual({
      intervalDays: 0, repetitions: 0, easeFactor: 2.5, dueAt: null,
    });
  });

  it('maps reviewed Anki cards to VocabUp review state and collection-relative due date', () => {
    const createdAt = 1_700_000_000;
    const mapped = mapAnkiSchedule({ queue: 2, type: 2, due: 3, interval: 7, factor: 2500, repetitions: 12 }, createdAt);
    expect(mapped).toEqual({ intervalDays: 7, repetitions: 12, easeFactor: 2.5, dueAt: '2023-11-17 22:13:20' });
  });

  it('keeps Anki learning cards out of the new-card quota', () => {
    const mapped = mapAnkiSchedule({ queue: 1, type: 1, due: 1_700_000_060, interval: 0, factor: 2500, repetitions: 0 }, 1_700_000_000);
    expect(mapped.repetitions).toBeGreaterThan(0);
    expect(mapped.dueAt).toBe('2023-11-14 22:14:20');
  });

  it('does not make suspended or buried Anki cards immediately due', () => {
    const mapped = mapAnkiSchedule({ queue: -1, type: 0, due: 3, interval: 0, factor: 0, repetitions: 0 }, 1_700_000_000);
    expect(mapped.repetitions).toBe(1);
    expect(mapped.dueAt).toBe('9999-01-01 00:00:00');
  });
});
