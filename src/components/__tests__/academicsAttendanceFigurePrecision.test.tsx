/**
 * The Academics screen shows VTOP's attendance figure, not VTOP's decimals.
 *
 * `attendancePercentLabel` is the one way an attendance percentage becomes text
 * (see `attendanceFigurePrecision.test.ts` for the static half of that promise).
 * The static scan had two blind spots and both were live on this screen: it only
 * read template literals, so a JSX print like `{pct}%` slipped past, and it keyed
 * off the word "percentage", so a figure that had been copied into a shorter
 * local name slipped past again. The day planner was printing VTOP's raw cell —
 * "83.33%" and "66.66%" — next to the summary card above it that said 83.3 and
 * 66.6 for the same courses.
 *
 * So this renders the screen a student actually reads and asks one question of
 * the whole page: does any attendance figure on it carry more than the one
 * decimal the rule allows?
 */

import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AcademicsView } from '../AcademicsView';
import { AttendanceRecord, TimetableSlot } from '../../types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * VTOP writes these two cells itself: 25/30 as "83.33" and 2/3 as "66.66". Both
 * are read by the app as tenths — 83.3 and 66.6 — so a screen that prints the
 * raw cell is printing a figure no rule in the app produced.
 */
const attendance: AttendanceRecord[] = [
  { courseCode: 'CSE1001', courseTitle: 'Programming Fundamentals', type: 'ETH', slot: 'A1', facultyName: 'Dr. A', attended: 25, totalHeld: 30, percentage: 83.33, lastUpdated: '2026-09-01', venue: 'SJT 204' },
  { courseCode: 'CSE3001', courseTitle: 'Compiler Design', type: 'ETH', slot: 'B1', facultyName: 'Dr. B', attended: 2, totalHeld: 3, percentage: 66.66, lastUpdated: '2026-09-01', venue: 'AB1 305' },
];

const timetable: TimetableSlot[] = [
  { id: 'a1', courseCode: 'CSE1001', courseTitle: 'Programming Fundamentals', slot: 'A1', facultyName: 'Dr. A', venue: 'SJT 204', building: 'SJT', roomNo: '204', day: 'Wednesday', startTime: '08:00', endTime: '08:50', isLab: false },
  { id: 'b1', courseCode: 'CSE3001', courseTitle: 'Compiler Design', slot: 'B1', facultyName: 'Dr. B', venue: 'AB1 305', building: 'AB1', roomNo: '305', day: 'Wednesday', startTime: '09:00', endTime: '09:50', isLab: false },
];

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function render() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(createElement(AcademicsView, { attendance, timetable })));
}

/**
 * The planner opens on today's column, which is not a fixed weekday. Click the
 * Wednesday chip so the fixture's classes are the ones on screen whatever day
 * the suite runs.
 */
function selectWednesday() {
  const chips = Array.from(container?.querySelectorAll('button') ?? []);
  const chip = chips.find((b) => /Wed/i.test((b.textContent ?? '').trim().slice(0, 3)));
  expect(chip, `the Wed day chip (chips: ${chips.map((c) => c.textContent?.trim().slice(0, 12)).join(' | ')})`).not.toBeUndefined();
  act(() => chip!.click());
}

function plannerRow(courseCode: string): string {
  // A planner row is the only button that carries the class times as well as the
  // course code; the course list shows counts, not hours.
  const row = Array.from(container?.querySelectorAll('button') ?? [])
    .filter((b) => b.textContent?.includes(courseCode) && /:00/.test(b.textContent ?? ''))
    .pop();
  return row?.textContent ?? '';
}

function openCourse(courseCode: string) {
  const row = Array.from(container?.querySelectorAll('button') ?? [])
    .filter((b) => b.textContent?.includes(courseCode) && /:00/.test(b.textContent ?? ''))
    .pop();
  expect(row, `the planner row for ${courseCode}`).not.toBeUndefined();
  act(() => row!.click());
}

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  container?.remove();
  container = null;
});

describe('the planner prints the tenth, not VTOP\'s decimals', () => {
  it('shows both courses at the precision the rest of the app uses', () => {
    render();
    selectWednesday();
    expect(plannerRow('CSE1001')).toContain('83.3%');
    expect(plannerRow('CSE1001')).not.toContain('83.33');
    expect(plannerRow('CSE3001')).toContain('66.6%');
    expect(plannerRow('CSE3001')).not.toContain('66.66');
  });

  it('leaves no attendance figure on the whole screen with two decimals', () => {
    render();
    selectWednesday();
    const rough = (container?.textContent ?? '').match(/\d+\.\d{2,}%/g) ?? [];
    expect(rough, `figures printed past the tenth: ${rough.join(', ')}`).toEqual([]);
  });

  it('keeps the figure identical between the planner row and the course page it opens', () => {
    render();
    selectWednesday();
    const rowText = plannerRow('CSE3001');
    openCourse('CSE3001');
    // 2/3 is the row where VTOP's own cell and a recomputed one used to differ,
    // and the course page derives it by summing the counts. Both read 66.6.
    expect(container?.textContent).toContain('66.6%');
    expect(container?.textContent).not.toContain('66.66');
    expect(rowText).toContain('66.6%');
  });
});
