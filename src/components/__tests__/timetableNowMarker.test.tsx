/**
 * The NOW marker in the day rail, rendered.
 *
 * The rail is a fixed-height list of sessions in time order, not a proportional
 * timeline, so "now" cannot be drawn at a real y-offset. What it can be is a
 * divider: everything above the line has finished, everything below it has not.
 * These tests pin that rule — where the line falls, that it falls at the foot
 * once the day is over, and that a day that is not today has no line at all,
 * because no other day has a present to mark.
 *
 * The clock is frozen to a Wednesday morning so the assertions do not depend on
 * the day the suite happens to run.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { TimetableSlot } from '../../types';
import { TimetableView } from '../TimetableView';

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
  day: 'Wednesday',
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

/** The rail's children in DOM order, tagged by what they are, so position is checkable. */
function railOrder(): string[] {
  return Array.from(container?.querySelectorAll('.uc-tt-rail > *') ?? []).map((node) => {
    if (node.classList.contains('uc-tt-now')) return 'now';
    if (node.classList.contains('uc-tt-slot')) return 'slot';
    if (node.classList.contains('uc-tt-break')) return 'break';
    return 'other';
  });
}

/** How many sessions sit above the marker, and how many below it. */
function slotsAroundMarker(): { before: number; after: number } {
  const children = Array.from(container?.querySelectorAll('.uc-tt-rail > *') ?? []);
  const at = children.findIndex((node) => node.classList.contains('uc-tt-now'));
  const slots = (nodes: Element[]) => nodes.filter((node) => node.classList.contains('uc-tt-slot')).length;
  return { before: slots(children.slice(0, at)), after: slots(children.slice(at + 1)) };
}

function selectDay(short: string) {
  const tab = Array.from(container?.querySelectorAll('button[role="tab"]') ?? [])
    .find((button) => button.textContent?.trim().toUpperCase().startsWith(short));
  expect(tab, `the ${short} day tab`).toBeTruthy();
  act(() => { (tab as HTMLButtonElement).click(); });
}

beforeEach(() => {
  vi.useFakeTimers();
  // Wednesday, 07 Oct 2026, 10:00 local.
  vi.setSystemTime(new Date('2026-10-07T10:00:00'));
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  vi.useRealTimers();
});

describe('the present, drawn in the day rail', () => {
  it('falls between the class that is over and the one that is still to come', () => {
    render([
      slot({ id: 'wed-morning', startTime: '08:00', endTime: '08:50' }),
      slot({ id: 'wed-midday', startTime: '12:00', endTime: '12:50' }),
    ]);

    // The finished 08:00 session is above the line; the 12:00 one is below it.
    expect(slotsAroundMarker()).toEqual({ before: 1, after: 1 });
    expect(railOrder()).toEqual(['slot', 'break', 'now', 'slot']);

    const marker = container?.querySelector('.uc-tt-now');
    expect(marker?.getAttribute('role')).toBe('separator');
    expect(marker?.textContent).toContain('Now');
    expect(marker?.textContent).toContain('10:00 AM');
  });

  it('sits at the foot of the day once every class has finished', () => {
    vi.setSystemTime(new Date('2026-10-07T20:00:00'));
    render([
      slot({ id: 'wed-morning', startTime: '08:00', endTime: '08:50' }),
      slot({ id: 'wed-midday', startTime: '12:00', endTime: '12:50' }),
    ]);

    const order = railOrder();
    expect(order[order.length - 1]).toBe('now');
    expect(order.filter((name) => name === 'slot')).toHaveLength(2);
    expect(slotsAroundMarker()).toEqual({ before: 2, after: 0 });
  });

  it('marks no other day, because no other day has a present', () => {
    render([
      slot({ id: 'wed-morning', startTime: '08:00', endTime: '08:50' }),
      slot({ id: 'wed-midday', startTime: '12:00', endTime: '12:50' }),
      slot({ id: 'thu-morning', day: 'Thursday', startTime: '09:00', endTime: '09:50' }),
    ]);
    selectDay('THU');

    expect(container?.querySelectorAll('.uc-tt-now').length).toBe(0);
    expect(railOrder().filter((name) => name === 'slot')).toHaveLength(1);
  });
});
