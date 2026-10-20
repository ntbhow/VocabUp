export interface ReviewSchedule {
  intervalDays: number;
  intervalMinutes: number;
  repetitions: number;
  easeFactor: number;
}

/** Four learning steps that grow from short retries into longer review intervals. */
export function scheduleReview(rating: number, repetitions: number, intervalDays: number, easeFactor: number): ReviewSchedule {
  if (!Number.isInteger(rating) || rating < 0 || rating > 3) throw new RangeError('Rating must be between 0 and 3.');

  const ease = Math.max(1.3, easeFactor + (0.1 - (3 - rating) * (0.08 + (3 - rating) * 0.02)));
  if (rating === 0) return { intervalDays: 0, intervalMinutes: 1, repetitions: 0, easeFactor: ease };

  const nextRepetitions = repetitions + 1;
  let intervalMinutes: number;
  if (repetitions === 0) {
    intervalMinutes = [1, 5, 10, 4 * 24 * 60][rating]!;
  } else if (repetitions < 3) {
    intervalMinutes = [1, 10, 24 * 60, 2 * 24 * 60][rating]!;
  } else {
    const days = [2, 4, 7, 10, 14, 21, 30, 45, 60];
    const step = Math.min(days.length - 1, Math.max(0, repetitions - 3));
    intervalMinutes = [1, days[step]!, days[Math.min(step + 1, days.length - 1)]!, days[Math.min(step + 2, days.length - 1)]!][rating]! * 24 * 60;
  }

  return { intervalDays: intervalMinutes / (24 * 60), intervalMinutes, repetitions: nextRepetitions, easeFactor: ease };
}
