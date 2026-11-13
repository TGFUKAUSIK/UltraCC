/**
 * eventSchedule tests — the Event Hub tab rule, against a fixed "today".
 *
 * Event Hub leaves finished listings on the board and sometimes serves an event
 * with no usable date. Both used to land in "Upcoming", where soonest-first
 * ordering put a finished event at the top of the tab a student opens to plan
 * their week. Dates are compared as ISO strings, so these run on a pinned day
 * rather than the machine clock.
 *
 * "No usable date" now also covers a cell that has the ISO shape but names a day
 * that month never had: the listing keeps its own text, gets no weekday, and
 * waits in Upcoming instead of being moved onto the next real day.
 */

import { describe, it, expect } from 'vitest';
import type { HubEvent } from '../../lib/edgeFetch';
import {
  EVENT_TABS, ISO_DATE_RE, addIsoDays, bucketEventDate, eventDateLabel, eventWeekday,
  isEventDate, isFreePrice, sortEventsIntoTabs,
} from '../eventSchedule';

const TODAY = '2026-09-30'; // a Wednesday

const event = (eid: string, title: string, date: string, price = 'Free'): HubEvent => ({
  eid, title, date, location: 'SJT', type: 'Workshop', teamSize: '', eligibility: '',
  options: [{ type: 'General', price, eligibility: '' }],
}) as HubEvent;

describe('bucketEventDate', () => {
  it('splits the calendar the way the tabs are labelled', () => {
    expect(bucketEventDate(TODAY, TODAY)).toBe('today');
    expect(bucketEventDate('2026-10-01', TODAY)).toBe('tomorrow');
    expect(bucketEventDate('2026-10-02', TODAY)).toBe('week');
    expect(bucketEventDate('2026-10-07', TODAY)).toBe('week');   // last day inside the horizon
    expect(bucketEventDate('2026-10-08', TODAY)).toBe('upcoming');
    expect(bucketEventDate('2026-09-29', TODAY)).toBe('past');
  });

  it('never files a finished event under Upcoming', () => {
    // The exact bug: an old listing led the tab a student uses to plan ahead.
    expect(bucketEventDate('2025-01-01', TODAY)).toBe('past');
  });

  it('keeps an undated or malformed listing out of Today rather than guessing', () => {
    expect(bucketEventDate('', TODAY)).toBe('upcoming');
    expect(bucketEventDate(undefined, TODAY)).toBe('upcoming');
    expect(bucketEventDate('12 Oct', TODAY)).toBe('upcoming');
    expect(bucketEventDate('30-09-2026', TODAY)).toBe('upcoming');
  });

  it('crosses a month and a year boundary by real days, not string maths', () => {
    expect(addIsoDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(bucketEventDate('2026-10-01', '2026-09-30')).toBe('tomorrow');
    expect(bucketEventDate('2027-01-01', '2026-12-31')).toBe('tomorrow');
  });

  it('files a date that names no day the way it files a missing one', () => {
    // Shaped like an ISO day is not enough: February has 28 of them in 2026.
    expect(bucketEventDate('2026-02-30', TODAY)).toBe('upcoming');
    expect(bucketEventDate('2026-04-31', TODAY)).toBe('upcoming');
    expect(bucketEventDate('2026-13-01', TODAY)).toBe('upcoming');
    // and the day that only looks impossible still gets its proper tab
    expect(bucketEventDate('2028-02-29', '2028-02-29')).toBe('today');
  });
});

describe('the date a listing may be printed with', () => {
  it('accepts only a day its month had', () => {
    expect(isEventDate('2026-09-30')).toBe('2026-09-30');
    expect(isEventDate('2028-02-29')).toBe('2028-02-29');
    expect(isEventDate('2026-02-30')).toBeNull();
    expect(isEventDate('2026-02-29')).toBeNull();
    expect(isEventDate('2026-04-31')).toBeNull();
    expect(isEventDate('30-09-2026')).toBeNull();
    expect(isEventDate('Sep 28, 2026')).toBeNull();
    expect(isEventDate('')).toBeNull();
    expect(isEventDate(undefined)).toBeNull();
  });

  it('names the weekday only for a day that had one', () => {
    expect(eventWeekday('2026-09-30')).toBe('Wed');
    expect(eventWeekday('2026-02-30')).toBe('');
    expect(eventWeekday('')).toBe('');
  });

  it('prints an impossible date as Event Hub wrote it, never as the next day', () => {
    // The exact lie this closes: a "2026-02-30" card used to read "2 Mar 2026".
    // The month abbreviation is locale data, so only its shape is asserted.
    expect(eventDateLabel('2026-09-30')).toMatch(/^30 Sept? 2026$/);
    expect(eventDateLabel('2026-02-30')).toBe('2026-02-30');
    expect(eventDateLabel('Sep 28, 2026')).toBe('Sep 28, 2026');
    expect(eventDateLabel('')).toBe('Date unavailable');
  });
});

describe('sortEventsIntoTabs', () => {
  const events = [
    event('3', 'Hackathon', '2026-10-05'),
    event('1', 'Old Meet', '2026-09-10'),
    event('4', 'Career Fair', '2026-10-05'),
    event('2', 'No Date', ''),
    event('5', 'Yesterday', '2026-09-29'),
    event('6', 'Later', '2026-11-20'),
  ];
  const byTab = sortEventsIntoTabs(events, TODAY);

  it('puts every listing in exactly one tab', () => {
    const total = EVENT_TABS.reduce((n, t) => n + byTab[t.id].length, 0);
    expect(total).toBe(events.length);
  });

  it('orders a tab by date and then by title, so same-day events are stable', () => {
    expect(byTab.week.map((e) => e.title)).toEqual(['Career Fair', 'Hackathon']);
    expect(byTab.upcoming.map((e) => e.title)).toEqual(['Later', 'No Date']);
  });

  it('reads the Past tab newest first', () => {
    expect(byTab.past.map((e) => e.title)).toEqual(['Yesterday', 'Old Meet']);
  });

  it('leaves an empty hub as empty tabs instead of missing keys', () => {
    const empty = sortEventsIntoTabs([], TODAY);
    expect(EVENT_TABS.every((t) => empty[t.id].length === 0)).toBe(true);
  });
});

describe('isFreePrice', () => {
  it('recognises the ways the hub writes "no money involved"', () => {
    for (const price of ['', 'Free', 'FREE', 'free', '0', '0.0', '₹0', '₹ 0']) {
      expect(isFreePrice(price)).toBe(true);
    }
    for (const price of ['₹100', '99', '₹0.5']) {
      expect(isFreePrice(price)).toBe(false);
    }
    expect(isFreePrice(undefined)).toBe(true);
  });
});

it('exports one ISO date rule for the whole hub', () => {
  expect(ISO_DATE_RE.test(TODAY)).toBe(true);
  expect(ISO_DATE_RE.test('2026-9-3')).toBe(false);
});
