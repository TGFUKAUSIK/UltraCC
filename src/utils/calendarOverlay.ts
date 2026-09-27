/**
 * calendarOverlay.ts — campus-event overlay for the academic calendar.
 *
 * Authority rule: VTOP's academic calendar (day orders, holidays, exam
 * windows) is never modified. Campus events from the Event Hub are merged
 * as an additional overlay layer with their own category so students can
 * distinguish official academic dates from campus/club happenings.
 */

export interface CalendarEventLike {
  eid: string;
  title: string;
  type: string;
  date: string;
  location: string;
}

export type EventCategory = 'campus' | 'club';

/** Classify an Event Hub record: club-run events vs general campus events. */
export function classifyEvent(event: CalendarEventLike): EventCategory {
  const haystack = `${event.type} ${event.title}`.toLowerCase();
  if (/club|chapter|team|society|chapter/.test(haystack)) return 'club';
  return 'campus';
}

/** "2026-09-14", "14-09-2026" or "Sep 14, 2026" → ISO date, or null. */
export function eventDateKey(raw: string): string | null {
  if (!raw) return null;
  const iso = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = raw.trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    // Format from LOCAL components — toISOString would shift the calendar
    // day for date-only strings parsed in a positive-UTC-offset timezone.
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return null;
}

export interface OverlayEntry {
  category: EventCategory;
  label: string;
  event: CalendarEventLike;
}

/**
 * Group events by ISO date for the calendar grid. Unparseable dates are
 * skipped honestly (never guessed onto the wrong day).
 */
export function buildEventOverlay(events: CalendarEventLike[]): Map<string, OverlayEntry[]> {
  const map = new Map<string, OverlayEntry[]>();
  for (const event of events) {
    const dateKey = eventDateKey(event.date);
    if (!dateKey) continue;
    const entry: OverlayEntry = { category: classifyEvent(event), label: event.title, event };
    const list = map.get(dateKey);
    if (list) list.push(entry);
    else map.set(dateKey, [entry]);
  }
  return map;
}

/** Categories currently present in the overlay — for filter chips. */
export function presentCategories(overlay: Map<string, OverlayEntry[]>): EventCategory[] {
  const set = new Set<EventCategory>();
  for (const entries of overlay.values()) {
    for (const entry of entries) set.add(entry.category);
  }
  return Array.from(set).sort();
}

export type CalendarCategoryFilter = 'all' | 'academic' | EventCategory;

/** Should a detail of the given type survive the current filter? */
export function categoryMatches(detailType: string, filter: CalendarCategoryFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'academic') {
    return !['campus', 'club'].includes(detailType);
  }
  return detailType === filter;
}
