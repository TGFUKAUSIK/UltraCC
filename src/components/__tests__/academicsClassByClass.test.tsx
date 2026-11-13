/**
 * The class-by-class drill-down, rendered, with the student's own cache.
 *
 * VTOP only marks Present / Absent / On Duty on the per-class attendance-detail
 * page, which the gateway returns as `dates` on each OD per-course entry. A
 * cache written before that field existed carries no `dates` on any course —
 * so the screen has two very different empties to tell apart:
 *   - the history was never downloaded (refresh), and
 *   - a course genuinely has no sessions recorded yet.
 * Printing the second when the first is true is a fact VTOP never gave.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AcademicsView } from '../AcademicsView';
import { AttendanceRecord } from '../../types';
import type { OdEntry, OdSummary } from '../../lib/vtop/types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const attendance: AttendanceRecord[] = [
  { courseCode: 'CSE1001', courseTitle: 'Programming Fundamentals', type: 'ETH', slot: 'A1', facultyName: 'Dr. A', attended: 20, totalHeld: 24, percentage: 83.3, lastUpdated: '2026-09-01', venue: 'SJT' },
];

/** A cache from before the gateway served `dates`: every entry lacks the field. */
const legacyOd = {
  available: true,
  limitHours: 40,
  totalOdHours: 0,
  perCourse: [{
    courseCode: 'CSE1001', courseName: 'Programming Fundamentals', slot: 'A1',
    odHours: 0, onDutyCount: 0, present: 20, absent: 4, total: 24,
  } as unknown as OdEntry],
} satisfies OdSummary;

/** A cache from the current gateway, carrying VTOP's own date rows. */
const loadedOd: OdSummary = {
  available: true,
  limitHours: 40,
  totalOdHours: 2,
  perCourse: [{
    courseCode: 'CSE1001', courseName: 'Programming Fundamentals', slot: 'A1',
    odHours: 2, onDutyCount: 1, present: 1, absent: 0, total: 2,
    dates: [
      { date: '01-AUG-2026', timing: '09:00-09:50', status: 'Present' },
      { date: '04-AUG-2026', timing: '09:00-09:50', status: 'On Duty' },
    ],
  }],
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function openDrillDown(od: OdSummary) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(createElement(AcademicsView, { attendance, timetable: [], od })));
  const course = container.querySelector('.uc-course') as HTMLButtonElement | null;
  expect(course, 'a course card to open').not.toBeNull();
  act(() => { course!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  // The subpage, not the weekly list.
  expect(container.textContent, 'the course drill-down opens').toContain('Back to weekly view');
}

function classByClass(): string {
  const plate = Array.from(container?.querySelectorAll('section') ?? [])
    .find((s) => s.textContent?.includes('Class-by-class attendance'));
  return plate?.textContent ?? '';
}

/** The class-by-class rows, in the order they print, as their date labels. */
function classDates(): string[] {
  const plate = Array.from(container?.querySelectorAll('section') ?? [])
    .find((s) => s.textContent?.includes('Class-by-class attendance'));
  return Array.from(plate?.querySelectorAll('.uc-acad-log-body strong') ?? [])
    .map((node) => node.textContent ?? '');
}

/** Put the address bar where the Timetable would have put it, then mount. */
function openFromUrl(search: string) {
  act(() => window.history.replaceState({}, '', `${window.location.pathname}${search}`));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(createElement(AcademicsView, { attendance, timetable: [], od: loadedOd })));
}

beforeEach(() => act(() => window.history.replaceState({}, '', window.location.pathname)));

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  container?.remove();
  container = null;
  act(() => window.history.replaceState({}, '', window.location.pathname));
});

describe('the class-by-class drill-down', () => {
  it('says the history has not been downloaded when the cache predates `dates`', () => {
    openDrillDown(legacyOd);
    const text = classByClass();
    expect(text).toContain('Attendance history has not been downloaded yet');
    expect(text).toContain('refresh to load it from VTOP');
    expect(text).toContain('Not downloaded yet');
    // The lie it used to print: a verdict VTOP never gave.
    expect(text).not.toContain('No sessions recorded');
  });

  it('prints each class with VTOP’s own Present / On Duty status once loaded', () => {
    openDrillDown(loadedOd);
    const text = classByClass();
    expect(text).toContain('Present');
    expect(text).toContain('On Duty');
    // VTOP's timing cell is printed verbatim, and its date renders as a label.
    expect(text).toContain('09:00-09:50');
    expect(text).toContain('Aug');
    expect(text).not.toContain('not been downloaded');
  });

  it('lists the most recent class first', () => {
    openDrillDown(loadedOd);
    // The fixture's two sessions are 01-Aug and 04-Aug; the newer one leads, so
    // a student reads how the latest class went before scrolling the term.
    expect(classDates()[0]).toContain('4 Aug');
    expect(classDates()[1]).toContain('1 Aug');
  });

  it('says the record is newest-first in the plate note', () => {
    openDrillDown(loadedOd);
    expect(classByClass()).toContain('newest first');
  });
});

describe('the Timetable’s way into a course record', () => {
  it('opens the drill-down for the course the link names, with no click', () => {
    openFromUrl('?tab=academics&course=CSE1001');
    expect(container?.textContent).toContain('Back to weekly view');
    expect(classByClass()).toContain('Present');
  });

  it('resolves a lab-suffixed timetable code to the same course record', () => {
    openFromUrl('?tab=academics&course=CSE1001L');
    expect(container?.textContent).toContain('Back to weekly view');
  });

  it('drops a code that matches no course, from the screen and the address bar alike', () => {
    openFromUrl('?tab=academics&course=NOPE9999');
    expect(container?.textContent).not.toContain('Back to weekly view');
    expect(new URL(window.location.href).searchParams.get('course')).toBeNull();
  });

  it('keeps the resolved code in the address bar, so a refresh reopens it', () => {
    openFromUrl('?tab=academics&course=cse1001');
    expect(new URL(window.location.href).searchParams.get('course')).toBe('CSE1001');
  });
});
