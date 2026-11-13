/**
 * eventSchedule.ts — how an Event Hub listing is dated, bucketed and ordered.
 *
 * Event Hub publishes dates as ISO strings, but not for every listing, and it
 * leaves finished events on the board. Deciding which tab an event belongs to
 * therefore has three jobs a plain date comparison gets wrong: a listing whose
 * date already passed must not lead "Upcoming", a listing with no date at all
 * must not be invented into today, and the Past tab reads newest-first because
 * a student scanning it wants what just happened, not the oldest entry.
 *
 * This is the whole rule, kept out of the view so it can be tested against
 * fixed days instead of the clock.
 */

import type { HubEvent } from '../lib/edgeFetch';
import { localDateIso, localTodayIso } from './localDate';
import { isRealCalendarDate } from './examUtils';

export type EventTab = 'today' | 'tomorrow' | 'week' | 'upcoming' | 'past';

export const EVENT_TABS: { id: EventTab; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'tomorrow', label: 'Tomorrow' },
  { id: 'week', label: 'This Week' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'past', label: 'Past' },
];

/** The only date shape Event Hub's own listings and the calendar export use. */
export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The date a listing can be trusted with: Event Hub's ISO shape, *and* a day that
 * month actually had. "2026-02-30" has the shape and no day — sorting it,
 * bucketing it or printing its weekday would all quietly move the event onto
 * March 2nd, so it answers as the missing dates do: null.
 */
export function isEventDate(date: string | undefined | null): string | null {
  const iso = (date || '').trim();
  if (!ISO_DATE_RE.test(iso)) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return isRealCalendarDate(y, m, d) ? iso : null;
}

/** "Wed" for a listing's date, or '' when there is no such day to name. */
export function eventWeekday(date: string | undefined | null): string {
  const iso = isEventDate(date);
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return Number.isNaN(dt.getTime()) ? '' : dt.toLocaleDateString('en-US', { weekday: 'short' });
}

/**
 * "30 Sep 2026" for a listing's date. A cell that is not a real day is printed
 * exactly as Event Hub wrote it — the app does not repair somebody else's date
 * onto a different day — and an empty cell says so.
 */
export function eventDateLabel(date: string | undefined | null): string {
  const iso = isEventDate(date);
  if (iso) {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    if (!Number.isNaN(dt.getTime())) {
      return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    }
  }
  return (date || '').trim() || 'Date unavailable';
}

/** An "Event date within a week" horizon: today + `days`, as an ISO string.
 *  Only ever given a day the device itself produced (`localTodayIso`), which is
 *  real by construction — a listing's own date goes through `isEventDate`. */
export function addIsoDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return localDateIso(new Date(y, m - 1, d + days));
}

/**
 * "Free", "0" or an empty cell → a free option. Event Hub prints "Free"
 * verbatim, and an unfilled price cell is a free listing, not an unknown one.
 */
export function isFreePrice(price?: string | null): boolean {
  const p = (price || '').trim().toLowerCase().replace(/[₹,\s]/g, '');
  return p === '' || p === 'free' || p === '0' || p === '0.0';
}

/**
 * Which tab one listing belongs to, relative to `todayIso` (pass a fixed day to
 * test it). Anything before today is Past — but only when the date is a real
 * ISO day; a malformed cell proves nothing about when the event was.
 */
export function bucketEventDate(date: string | undefined, todayIso: string = localTodayIso()): EventTab {
  const iso = isEventDate(date);
  if (!iso) return 'upcoming';
  const tomorrowIso = addIsoDays(todayIso, 1);
  const horizonIso = addIsoDays(todayIso, 7);
  if (iso < todayIso) return 'past';
  if (iso === todayIso) return 'today';
  if (iso === tomorrowIso) return 'tomorrow';
  if (iso <= horizonIso) return 'week';
  return 'upcoming';
}

/** ISO date, with undated listings sorted after every dated one. */
function datedFirst(a: HubEvent, b: HubEvent): number {
  return (a.date || '9999-12-31').localeCompare(b.date || '9999-12-31') || a.title.localeCompare(b.title);
}

/**
 * Every listing placed in its tab and ordered: soonest first everywhere, newest
 * first under Past, undated last. The view sorts once per sync rather than
 * letting the hub's own arrival order decide what a student sees first.
 */
export function sortEventsIntoTabs(
  events: HubEvent[],
  todayIso: string = localTodayIso(),
): Record<EventTab, HubEvent[]> {
  const out: Record<EventTab, HubEvent[]> = { today: [], tomorrow: [], week: [], upcoming: [], past: [] };
  for (const ev of events) out[bucketEventDate(ev.date, todayIso)].push(ev);
  out.past.sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.title.localeCompare(b.title));
  for (const tab of ['today', 'tomorrow', 'week', 'upcoming'] as EventTab[]) out[tab].sort(datedFirst);
  return out;
}
