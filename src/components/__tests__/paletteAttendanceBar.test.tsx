/**
 * ⌘K follows the attendance bar the student set — live.
 *
 * The stored verdict word is gone from `AttendanceRecord`, but that only fixed
 * half of the problem. The command palette builds its index in a `useMemo`
 * inside a modal that mounts once and stays mounted for the whole session, so
 * an index holding `getTargetAttendance()` from before the slider was touched
 * would keep saying "meets your 75%" long after the student moved the bar to
 * 85% — a private copy of the number wearing different clothes.
 *
 * These mount the real modal, move the real bar, and read what search answers.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CommandCenterModal } from '../CommandCenterModal';
import { saveTargetAttendance } from '../../lib/settings';
import type { AttendanceRecord, ExamSchedule, CourseMarks, TimetableSlot } from '../../types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TARGET_KEY = 'ultracc.targetAttendance';

const attendance: AttendanceRecord[] = [{
  courseCode: 'CSE2001',
  courseTitle: 'Data Structures and Algorithms',
  type: 'ETH',
  slot: 'TA1',
  facultyName: 'Dr. Vasudevan',
  attended: 20,
  totalHeld: 24,
  percentage: 83,
  lastUpdated: '2026-09-01',
  venue: 'SJT 204',
}];

const nothing: { exams: ExamSchedule[]; marks: CourseMarks[]; timetable: TimetableSlot[] } = {
  exams: [], marks: [], timetable: [],
};

let host: HTMLElement;
let root: Root | null = null;

function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(createElement(CommandCenterModal, {
    isOpen: true,
    onClose: () => {},
    attendance,
    onNavigateTab: () => {},
    ...nothing,
  } as never)));
  // The palette only lists once there is a query, so type through the real
  // input the way a keyboard does — React tracks the value on the node itself.
  const input = host.querySelector<HTMLInputElement>('input[role="combobox"]')!;
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setValue.call(input, 'cse2001');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** The subtitle ⌘K shows for the attendance row. */
function attendanceRowText(): string {
  const hit = [...host.querySelectorAll('[data-palette-index]')]
    .find((row) => (row.textContent || '').includes('CSE2001 attendance'));
  return hit ? hit.textContent || '' : '';
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host?.remove();
  localStorage.removeItem(TARGET_KEY);
});

describe('the palette bar tracks the slider', () => {
  it('judges a course against the bar saved before it opened', () => {
    saveTargetAttendance(85);
    mount();
    expect(attendanceRowText()).toContain('below your 85%');
  });

  it('re-answers when the bar moves while the modal sits mounted', () => {
    saveTargetAttendance(85);
    mount();
    expect(attendanceRowText()).toContain('below your 85%');
    // Dragging the Academics slider broadcasts; the palette must repaint rather
    // than keep the bar it read at mount.
    act(() => { saveTargetAttendance(75); });
    expect(attendanceRowText()).toContain('meets your 75%');
  });

  it('shows VTOP’s own bar to a student who never set one', () => {
    localStorage.removeItem(TARGET_KEY);
    mount();
    expect(attendanceRowText()).toContain('meets your 75%');
  });
});
