export interface ReviewSchedule {
  intervalDays: number;
  repetitions: number;
  easeFactor: number;
}

/** Applies a four-button SM-2 style review and returns the next card schedule. */
export function scheduleReview(rating: number, repetitions: number, intervalDays: number, easeFactor: number): ReviewSchedule {
  if (!Number.isInteger(rating) || rating < 0 || rating > 3) throw new RangeError('Rating must be between 0 and 3.');
  const ease = Math.max(1.3, easeFactor + (0.1 - (3 - rating) * (0.08 + (3 - rating) * 0.02)));
  const nextRepetitions = rating === 0 ? 0 : repetitions + 1;
  const nextInterval = rating === 0 ? 0 : nextRepetitions === 1 ? 1 : nextRepetitions === 2 ? 6 : Math.max(1, Math.round(intervalDays * ease));
  return { intervalDays: nextInterval, repetitions: nextRepetitions, easeFactor: ease };
}
