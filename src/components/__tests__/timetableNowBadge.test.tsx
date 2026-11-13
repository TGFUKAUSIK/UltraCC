/**
 * The "Now" badge against VTOP's class times (production bug: the weekly list
 * decided what was running from its own A1–F2 table that placed every letter
 * back-to-back from 08:00 — B1 at 09:00, C1 at 10:00 — while VTOP Chennai's
 * grid rotates letters per weekday and files theory with its tutorial in one
 * cell. So at 10:20 on a Friday it badged C1, a class that had already ended at
 * 09:45, and left the running TA1 period plain; a lab block ("L55+L56") could
 * never light at all, because no single-letter code matches a combined slot.)
 *
 * These mount the real screen at a fixed clock and assert which row a student
 * sees marked as running, so the badge can only ever come from the times
 * printed in the same row.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AcademicsView } from '../AcademicsView';
import { toUiAttendance, toUiTimetable } from '../../lib/vtop/adapters';
import { AttendanceRecord, TimetableSlot as VtopTimetableSlot } from '../../lib/vtop/types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Friday 2 October 2026, on the weekday grid VTOP actually serves. */
const fridayRows: VtopTimetableSlot[] = [
  { id: 'f1', slot: 'E1', courseCode: 'MAT2001', courseTitle: 'Applied Mathematics', courseType: 'ETH', facultyName: 'Dr. A', venue: 'SJT 101', building: '', startTime: '08:00', endTime: '08:50', day: 'Friday' },
  { id: 'f2', slot: 'C1', courseCode: 'ECE1002', courseTitle: 'Digital Systems', courseType: 'ETH', facultyName: 'Dr. B', venue: 'AB3 107', building: '', startTime: '08:55', endTime: '09:45', day: 'Friday' },
  { id: 'f3', slot: 'TA1', courseCode: 'CSE2001', courseTitle: 'Data Structures', courseType: 'ETH', facultyName: 'Dr. C', venue: 'SJT 204', building: '', startTime: '09:50', endTime: '10:40', day: 'Friday' },
  { id: 'f4', slot: 'TF1', courseCode: 'EEE1001', courseTitle: 'Electrical Fundamentals', courseType: 'ETH', facultyName: 'Dr. D', venue: 'AB1 205', building: '', startTime: '10:45', endTime: '11:35', day: 'Friday' },
  { id: 'f5', slot: 'L55+L56', courseCode: 'BCSE305L', courseTitle: 'Data Structures Lab', courseType: 'ELTH', facultyName: 'Dr. E', venue: 'AB3 214', building: '', startTime: '14:00', endTime: '15:40', day: 'Friday' },
];

const attendance: AttendanceRecord[] = [
  // VTOP-layer row (what the parser serves), so `category` here is VTOP's own
  // Theory/Lab label — not the Safe/Critical verdict the UI model stopped storing.
  { courseCode: 'CSE2001', courseTitle: 'Data Structures', courseType: 'ETH', slot: 'TA1', facultyName: 'Dr. C', attended: 20, totalHeld: 25, percentage: 80, category: 'Theory', lastUpdated: '2026-09-30' },
];

let host: HTMLElement;
let root: Root | null = null;

function teardown() {
  if (root) act(() => root!.unmount());
  root = null;
  host?.remove();
}

/** Mount the weekly tab with the wall clock held at the given Friday time. */
function mountAt(hour: number, minute: number, rows = fridayRows) {
  teardown();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 2, hour, minute));
  host = document.createElement('div');
  document.body.appendChild(host);
  const node: ReactElement = createElement(AcademicsView, {
    attendance: toUiAttendance(attendance, rows),
    timetable: toUiTimetable(rows),
    od: null,
  });
  root = createRoot(host);
  act(() => root.render(node));
}

afterEach(() => {
  teardown();
  vi.useRealTimers();
});

/** The timetable rows currently carrying the "Now" badge. */
function runningRows(): HTMLButtonElement[] {
  return Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
    .filter((b) => (b.textContent || '').includes('Now'));
}

/** The row that lists the given VTOP course code. */
function rowFor(courseCode: string): HTMLButtonElement | undefined {
  return Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
    .find((b) => (b.textContent || '').includes(courseCode));
}

describe('the running class', () => {
  it('badges the period whose VTOP times span the clock', () => {
    mountAt(10, 20);
    const marked = runningRows();
    expect(marked).toHaveLength(1);
    expect(marked[0].textContent).toContain('CSE2001');
    expect(marked[0].textContent).toContain('09:50');
  });

  it('leaves a class that already finished unbadged, even when its letter is due by the old table', () => {
    mountAt(10, 20);
    // C1 met 08:55–09:45 today; the table AcademicsView used to trust placed
    // C1 at 10:00, so it called this finished class the running one.
    const c1 = rowFor('ECE1002');
    expect(c1).toBeTruthy();
    expect(c1!.textContent).not.toContain('Now');
  });

  it('badges a two-period lab while it is running', () => {
    mountAt(14, 20);
    const lab = rowFor('BCSE305L');
    expect(lab).toBeTruthy();
    expect(lab!.textContent).toContain('Now');
  });

  it('badges nothing in the five-minute break between periods', () => {
    mountAt(10, 42);
    expect(runningRows()).toHaveLength(0);
  });

  it('badges nothing before the first period or after the last', () => {
    mountAt(7, 30);
    expect(runningRows()).toHaveLength(0);
    mountAt(19, 5);
    expect(runningRows()).toHaveLength(0);
  });
});

describe('a class whose time VTOP left blank', () => {
  it('stays unshaded instead of being called finished', () => {
    const rows = fridayRows.map((r) => (r.id === 'f4' ? { ...r, endTime: '' } : r));
    mountAt(10, 20, rows);
    const later = rowFor('EEE1001');
    expect(later).toBeTruthy();
    expect(later!.className).not.toContain('is-past');
  });

  it('shades a period whose end minute really has passed today', () => {
    mountAt(10, 20);
    const finished = rowFor('MAT2001');
    expect(finished).toBeTruthy();
    // A finished period is de-emphasised by the rail's own `is-past` class
    // (`.uc-tt-slot.is-past { opacity: .5 }`), which replaced the Tailwind
    // `opacity-60` utility when the board language layer took over.
    expect(finished!.className).toContain('is-past');
  });
});

describe('slot times stay owned by the VTOP row and the campus grid', () => {
  it('no component carries its own slot-code-to-minute table', () => {
    const dir = join(process.cwd(), 'src', 'components');
    const table = /\['[A-L][1-9]'\s?,\s?\d{3}\s?,\s?\d{3}\]/;
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.tsx'))) {
      const source = readFileSync(join(dir, file), 'utf8');
      expect(source, `${file} decides what is running from a hardcoded slot table`).not.toMatch(table);
    }
  });
});
