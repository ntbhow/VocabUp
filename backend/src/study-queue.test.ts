import { describe, expect, it } from 'vitest';
import { buildStudyQueue, remainingNewQuota } from './study-queue.js';

describe('new-card quota and study queue', () => {
  it('subtracts new cards already studied today from the deck limit', () => {
    expect(remainingNewQuota(20, 8)).toBe(12);
    expect(remainingNewQuota(20, 20)).toBe(0);
    expect(remainingNewQuota(20, 25)).toBe(0);
  });

  it('keeps every due review and appends only the allowed new cards', () => {
    const reviews = Array.from({ length: 100 }, (_, i) => ({ id: `r${i}`, dueAt: `2020-01-${String((i % 28) + 1).padStart(2, '0')} 00:00:00` }));
    const newCards = Array.from({ length: 20 }, (_, i) => ({ id: `n${i}`, dueAt: '2026-10-16 00:00:00' }));
    const queue = buildStudyQueue(reviews, newCards);
    expect(queue).toHaveLength(120);
    expect(queue.slice(0, 100).every(card => card.id.startsWith('r'))).toBe(true);
    expect(queue.slice(100).every(card => card.id.startsWith('n'))).toBe(true);
  });

  it('still returns all due reviews when no new cards remain in the daily quota', () => {
    const reviews = Array.from({ length: 100 }, (_, i) => ({ id: `r${i}`, dueAt: '2020-01-01 00:00:00' }));
    expect(buildStudyQueue(reviews, [])).toHaveLength(100);
  });
});
