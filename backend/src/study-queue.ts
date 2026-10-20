export function remainingNewQuota(dailyLimit: number, studiedToday: number): number {
  return Math.max(0, dailyLimit - studiedToday);
}

export function buildStudyQueue<T extends { dueAt: unknown }>(reviewCards: T[], newCards: T[]): T[] {
  const byDueAt = (a: T, b: T) => new Date(String(a.dueAt)).getTime() - new Date(String(b.dueAt)).getTime();
  reviewCards.sort(byDueAt);
  newCards.sort(byDueAt);
  return [...reviewCards, ...newCards];
}
