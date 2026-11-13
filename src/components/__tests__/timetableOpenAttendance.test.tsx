/**
 * A class on the timetable is the way into its own record.
 *
 * A student looking at Tuesday's 9 AM slot wants that subject's attendance, not
 * the weekly list they would then have to search for it again. Both boards — the
 * desktop week grid and the phone day rail — open the course's class-by-class
 * record in the Academics drill-down, and the room chip inside a rail row keeps
 * its own job of pointing at the map rather than swallowing the row's tap.
 *
 * The rail row cannot be a <button>: it already contains the room chip, and a
 * button cannot nest in a button. So the row itself is the pointer target and a
 * labelled control in its footer is the keyboard's route to the same place.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { TimetableSlot } from '../../types';
import { TimetableView } from '../TimetableView';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const slot = (overrides: Partial<TimetableSlot> = {}): TimetableSlot => ({
  id: overrides.id ?? 'mon-a1',
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

function render(opened: string[], mapped: string[], timetable: TimetableSlot[] = [slot()]) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(createElement(TimetableView, {
      timetable,
      attendance: [],
      onNavigateMap: (building: string) => { mapped.push(building); },
      onOpenCourse: (code: string) => { opened.push(code); },
    }));
  });
}

/**
 * A touch the rail can read. React copies `touches`/`changedTouches` straight off
 * the native event, so both are defined on a plain Event rather than waiting on a
 * platform TouchEvent the DOM shim may not build.
 */
function touch(type: string, x: number, y: number): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const point = { clientX: x, clientY: y };
  Object.defineProperty(event, 'touches', { value: type === 'touchend' ? [] : [point] });
  Object.defineProperty(event, 'changedTouches', { value: [point] });
  return event;
}

/** Pick a weekday tab, so the test does not depend on the day it runs. */
function selectDay(short: string) {
  const tab = Array.from(container?.querySelectorAll('button[role="tab"]') ?? [])
    .find((button) => button.textContent?.trim().toUpperCase().startsWith(short));
  expect(tab, `the ${short} day tab`).toBeTruthy();
  act(() => { (tab as HTMLButtonElement).click(); });
}

/** The day rail's own row for the class (the phone board). */
function railRow(): HTMLElement {
  const row = container?.querySelector('.timetable-mobile-panel .uc-tt-slot');
  expect(row, 'the rail row for the class').toBeTruthy();
  return row as HTMLElement;
}

/** The week grid's own cell for the class (the desktop board). */
function weekCell(): HTMLElement {
  const cell = container?.querySelector('.timetable-week-panel .uc-wk-cell');
  expect(cell, 'the week cell for the class').toBeTruthy();
  return cell as HTMLElement;
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
});

describe('a class on the timetable opens its own attendance record', () => {
  it('opens the course from a tap anywhere on the phone rail row', () => {
    const opened: string[] = [];
    render(opened, []);
    selectDay('MON');
    act(() => { railRow().click(); });
    expect(opened).toEqual(['CSE1001']);
  });

  it('opens the course from the desktop week cell', () => {
    const opened: string[] = [];
    render(opened, []);
    selectDay('MON');
    act(() => { weekCell().click(); });
    expect(opened).toEqual(['CSE1001']);
  });

  it('gives the keyboard the same route through the rail’s own control', () => {
    const opened: string[] = [];
    render(opened, []);
    selectDay('MON');
    const control = Array.from(railRow().querySelectorAll('button'))
      .find((button) => (button.textContent ?? '').includes('Daily attendance'));
    expect(control, 'the labelled control for the keyboard').toBeTruthy();
    act(() => { control!.click(); });
    expect(opened).toEqual(['CSE1001']);
  });

  it('keeps the room chip pointing at the map, not at the record', () => {
    const opened: string[] = [];
    const mapped: string[] = [];
    render(opened, mapped);
    selectDay('MON');
    const room = railRow().querySelector('.timetable-map-link') as HTMLButtonElement | null;
    expect(room, 'the room chip').toBeTruthy();
    act(() => { room!.click(); });
    expect(mapped).toEqual(['SJT-301']);
    // The row's own handler must not also fire from the chip's tap.
    expect(opened).toEqual([]);
  });

  it('advertises no action when the app wires none', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(createElement(TimetableView, { timetable: [slot()], attendance: [], onNavigateMap: () => {} }));
    });
    selectDay('MON');
    expect(container.querySelector('.uc-wk-cell.is-openable')).toBeNull();
    expect(container.querySelector('.uc-tt-slot.is-openable')).toBeNull();
  });

  it('does not read the click a day-swipe leaves behind as a tap on a row', () => {
    const opened: string[] = [];
    // Two days, so the swipe lands on a board that still has a row to misread.
    render(opened, [], [
      slot(),
      slot({ id: 'tue-b1', day: 'Tuesday', courseCode: 'EEE1001', slot: 'B1' }),
    ]);
    selectDay('MON');
    const rail = container!.querySelector('.uc-tt-rail') as HTMLElement;
    act(() => {
      rail.dispatchEvent(touch('touchstart', 300, 120));
      rail.dispatchEvent(touch('touchend', 120, 124));
    });
    // The swipe moved the rail to Tuesday; the finger-up click it leaves behind
    // must not open Tuesday's first class.
    const landed = container!.querySelector('.timetable-mobile-panel .uc-tt-slot') as HTMLElement | null;
    expect(landed, 'the row the swipe landed on').toBeTruthy();
    act(() => { landed!.click(); });
    expect(opened).toEqual([]);
  });

  it('still opens on a tap that follows no swipe', () => {
    const opened: string[] = [];
    render(opened, [], [
      slot(),
      slot({ id: 'tue-b1', day: 'Tuesday', courseCode: 'EEE1001', slot: 'B1' }),
    ]);
    selectDay('MON');
    act(() => { railRow().click(); });
    expect(opened).toEqual(['CSE1001']);
  });
});
