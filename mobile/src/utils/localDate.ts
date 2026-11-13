/**
 * `Date#toISOString()` is UTC. For IST students that window from midnight to
 * 05:29 reports *yesterday*, which made today's exam and today's classes look
 * already past. Every "what is today" comparison uses these helpers instead.
 */
export function localDateIso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function localTodayIso(now: Date = new Date()): string {
  return localDateIso(now);
}
