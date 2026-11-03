/**
 * The single day boundary for the whole app: midnight in Vietnam.
 *
 * Study days, daily new-card limits, streaks and the activity chart are all
 * counted in this zone, never in UTC or the database server's zone. Because the
 * zone is fixed, the same instant always maps to the same day no matter where
 * the API process, the database or the browser happens to run.
 */
export const STUDY_TIME_ZONE = 'Asia/Ho_Chi_Minh';

/** Vietnam has no daylight saving, so the offset is constant year-round. */
export const STUDY_ZONE_OFFSET = '+07:00';

const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: STUDY_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Calendar date (`YYYY-MM-DD`) the instant falls on in the study zone. */
export function studyDateKey(instant: Date = new Date()): string {
  return dayFormatter.format(instant);
}

/** Adds whole days to a `YYYY-MM-DD` key without involving any time zone. */
export function shiftDateKey(key: string, days: number): string {
  const [year, month, day] = key.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The UTC instant at which a study day (`YYYY-MM-DD`) begins, i.e. 00:00 in Vietnam. */
export function studyDayStart(key: string): Date {
  return new Date(`${key}T00:00:00${STUDY_ZONE_OFFSET}`);
}

/** Milliseconds until the next midnight in the study zone (at least one second). */
export function msUntilNextStudyDay(now: Date = new Date()): number {
  const key = studyDateKey(now);
  const nextMidnight = studyDayStart(shiftDateKey(key, 1));
  return Math.max(1000, nextMidnight.getTime() - now.getTime());
}

/**
 * Normalises whatever MySQL hands back for a DATE/DATETIME column into a
 * `YYYY-MM-DD` key. mysql2 returns DATE columns as JS Dates interpreted in the
 * process zone, so the raw value is never sliced directly.
 */
export function toDateKey(value: string | Date): string {
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return String(value).slice(0, 10);
}

/** Today's study-zone day as a SQL string expression (`YYYY-MM-DD`). */
export const SQL_TODAY = `DATE_FORMAT(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '${STUDY_ZONE_OFFSET}'), '%Y-%m-%d')`;

/** (`YYYY-MM-DD` string) of a stored
 * timestamp column. The pool pins every session to UTC (see db.ts), so the
 * stored value is converted from a known zone rather than the server default.
 */
export function sqlStudyDay(column: string): string {
  return `DATE_FORMAT(CONVERT_TZ(${column}, '+00:00', '${STUDY_ZONE_OFFSET}'), '%Y-%m-%d')`;
}
