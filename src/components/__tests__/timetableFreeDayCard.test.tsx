/**
 * The timetable's two accounts of the same free hour, rendered.
 *
 * `freeGapLiveOnce.test.ts` proves the threshold is written once in source.
 * These prove what a student sees on the screen that uses it: that the weekly
 * grid's Break row and the "availability" card under it describe the same
 * break, that the card's headline and its chips add up, and that a day VTOP
 * publishes no period table for says it cannot count rather than printing
 * "0 / 0" — which read as a fully-booked day to a student with nothing to do.
 *
 * The fixture's break is 42 minutes on purpose. That is the window where the
 * two surfaces used to disagree: the grid hid anything under 45, the card
 * counted from 40.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { TimetableSlot } from '../../types';
import { TimetableView } from '../TimetableView';
import { MIN_FREE_GAP_MINUTES } from '../../utils/timetableGrid';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const slot = (overrides: Partial<TimetableSlot>): TimetableSlot => ({
  id: overrides.id ?? 'x',
  courseCode: 'CSE1001',
  courseTitle: 'Programming Fundamentals',
  slot: 'A1',
  facultyName: 'Dr. A',
  venue: 'SJT-301',
  building: 'SJT',
  roomNo: '301',
  day: 'Monday',
  startTime: '08:00',
  endTime: '08:50',
  isLab: false,
  ...overrides,
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function render(timetable: TimetableSlot[]) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(createElement(TimetableView, { timetable, attendance: [], onNavigateMap: () => {} }));
  });
}

/** Pick a weekday tab, so the test does not depend on the day it runs. */
function selectDay(short: string) {
  const tab = Array.from(container?.querySelectorAll('button[role="tab"]') ?? [])
    .find((button) => button.textContent?.trim().toUpperCase().startsWith(short));
  expect(tab, `the ${short} day tab`).toBeTruthy();
  act(() => { (tab as HTMLButtonElement).click(); });
}

/** The "Selected day availability" card, as printed text. */
function availabilityCard(): string {
  const card = Array.from(container?.querySelectorAll('.timetable-support-card') ?? [])
    .find((node) => node.textContent?.includes('availability'));
  return card?.textContent ?? '';
}

function breakRows(): string {
  return Array.from(container?.querySelectorAll('tr.timetable-lunch-row') ?? [])
    .map((row) => row.textContent ?? '')
    .join(' | ');
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
});

describe('a break the student can use', () => {
  it('shows the same 42-minute break on the grid and on the card', () => {
    render([
      slot({ id: 'mon-a1', startTime: '08:00', endTime: '08:50' }),
      slot({ id: 'mon-f1', slot: 'F1', startTime: '09:32', endTime: '10:22' }),
    ]);
    selectDay('MON');

    // The grid row between the two time rows…
    expect(breakRows()).toContain('8:50 AM');
    expect(breakRows()).toContain('9:32 AM');
    // …and the card under it, the only place a 42-minute break used to appear.
    expect(availabilityCard()).toContain('8:50 AM – 9:32 AM · 42m');
    expect(availabilityCard()).toContain(`of ${MIN_FREE_GAP_MINUTES}+ min`);
  });

  it('adds up to the same free time it lists', () => {
    render([
      slot({ id: 'mon-a1', startTime: '08:00', endTime: '08:50' }),
      slot({ id: 'mon-f1', slot: 'F1', startTime: '09:32', endTime: '10:22' }),
    ]);
    selectDay('MON');
    // Monday's grid runs 08:00–19:25, so the day is 42 minutes between the two
    // classes plus 543 after the last one.
    expect(availabilityCard()).toContain('585 minutes free in 2 usable gaps');
    expect(Array.from(container?.querySelectorAll('.timetable-free-windows span') ?? [])
      .map((chip) => chip.textContent)).toEqual([
      '8:50 AM – 9:32 AM · 42m',
      '10:22 AM – 7:25 PM · 543m',
    ]);
  });

  it('counts the free time a fully-booked morning leaves', () => {
    render([
      slot({ id: 'sat-a1', day: 'Saturday', startTime: '08:00', endTime: '08:50' }),
      slot({ id: 'mon-a1', day: 'Monday', startTime: '08:00', endTime: '08:50' }),
    ]);
    selectDay('SAT');
    const card = availabilityCard();
    // The headline counts VTOP's theory periods — a lab batch runs inside a
    // theory hour, so it is not a thirteenth period of the day.
    expect(card).toContain('11 / 12 free theory periods');
    expect(card).toContain('635 minutes free in 1 usable gap');
    expect(card).not.toContain('No free window');
  });

  it('says it cannot count free periods on a day with no period table', () => {
    render([
      slot({ id: 'sun-1', day: 'Sunday', startTime: '09:00', endTime: '09:50' }),
      slot({ id: 'sun-2', day: 'Sunday', slot: 'F1', startTime: '11:00', endTime: '11:50' }),
    ]);
    selectDay('SUN');
    const card = availabilityCard();
    expect(card).toContain('Not available');
    expect(card).toContain('Sunday has no FFCS period table');
    expect(card).not.toContain('0 / 0');
    // The break VTOP's own two classes do define is still reported.
    expect(card).toContain('9:50 AM – 11:00 AM · 70m');
  });
});
