/**
 * The OD figure says what it counts.
 *
 * `totalOdHours` is how many class-hours the student has *used* on duty this
 * semester, out of a 40-hour cap VIT publishes and the gateway attaches. The
 * dashboard printed the same number under the words "OD balance", so a student
 * with 6 hours used read a page that told them 6 hours remained — the opposite
 * of the truth, and the number that decides whether asking for another OD is
 * safe. A second copy of the rule sat in the client: `limitHours ?? 40`, which
 * meant a response with no cap still printed a confident denominator.
 *
 * Both surfaces now name the quantity, show the cap only when one arrived, and
 * derive "left" from the two numbers on screen rather than reusing "balance" for
 * hours spent.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AcademicsView } from '../AcademicsView';
import { MeridianDashboard } from '../MeridianDashboard';
import type { AttendanceRecord, StudentProfile, TimetableSlot } from '../../types';
import type { OdSummary } from '../../lib/vtop/types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const student: StudentProfile = {
  name: 'Aarav R', regNo: '25BEE0000',
  branch: 'Electrical and Electronics Engineering',
  program: 'UG',
  school: 'School of Electrical and Electronics Engineering',
  groupStudied: 'PCM',
  semester: 5,
  cgpa: 8.4,
  totalCreditsCompleted: 60,
  totalCreditsRequired: 200,
  proctorName: 'Dr. R. Ramanathan',
  proctorContact: '',
  proctorAvailable: true,
  hostelBlock: '',
  roomNo: '',
  dayScholar: true,
};

const attendance: AttendanceRecord[] = [];
const timetable: TimetableSlot[] = [];

/** Six of forty used — the case that used to read as "6 hours left". */
function odWithCap(): OdSummary {
  return {
    available: true,
    limitHours: 40,
    totalOdHours: 6,
    perCourse: [
      { courseCode: 'CSE2009', courseName: 'Data Structures', slot: 'A1', odHours: 2, onDutyCount: 2, present: 20, absent: 1, total: 23, dates: [] },
      { courseCode: 'MAT2001', courseName: 'Linear Algebra', slot: 'B2', odHours: 4, onDutyCount: 2, present: 18, absent: 0, total: 20, dates: [] },
    ],
  };
}

/** A response that carried no cap: the app has no number to offer as one. */
function odWithoutCap(): OdSummary {
  return { ...odWithCap(), limitHours: null };
}

let root: Root | null = null;
let host: HTMLElement | null = null;

function mount(node: ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
}

const text = () => host?.textContent ?? '';

/** The Academics "OD" tab chip — the attendance filter row carries the same
 *  label, and those are the ones with `aria-pressed`. */
function openOdTab() {
  const chip = Array.from(host?.querySelectorAll('button') ?? [])
    .find((b) => (b.textContent ?? '').trim() === 'OD' && !b.hasAttribute('aria-pressed'));
  expect(chip, 'the OD tab chip').not.toBeUndefined();
  act(() => chip!.click());
}

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  host?.remove();
  host = null;
  // The Academics chip writes `?subtab=` into the address bar, exactly as the
  // app writes `?tab=`. In the real app leaving Academics clears it; here the
  // page is mounted on its own, so each case starts from a clean URL.
  act(() => window.history.replaceState({}, '', '/'));
});

describe('the dashboard OD line', () => {
  it('counts hours used and shows the cap it is measured against', () => {
    mount(createElement(MeridianDashboard, {
      student, attendance, timetable, exams: [], assignments: [], od: odWithCap(), onNavigateTab: () => {},
    }));
    expect(text()).toContain('OD hours used: 6 of 40 this semester');
  });

  it('offers no denominator when no response carried one', () => {
    mount(createElement(MeridianDashboard, {
      student, attendance, timetable, exams: [], assignments: [], od: odWithoutCap(), onNavigateTab: () => {},
    }));
    expect(text()).toContain('OD hours used: 6');
    expect(text()).not.toContain('of 40');
  });

  it('never calls hours spent a balance', () => {
    mount(createElement(MeridianDashboard, {
      student, attendance, timetable, exams: [], assignments: [], od: odWithCap(), onNavigateTab: () => {},
    }));
    expect(text().toLowerCase()).not.toContain('balance');
  });
});

describe('the Academics OD tracker', () => {
  it('labels the figure, the cap, and the arithmetic between them', () => {
    mount(createElement(AcademicsView, { attendance, timetable, od: odWithCap() }));
    openOdTab();
    expect(text()).toContain('OD hours used');
    expect(text()).toContain('Hours left of 40');
    expect(text()).toContain('34');
    expect(text()).toContain('OD sessions');
  });

  it('shows no remaining figure it cannot derive', () => {
    mount(createElement(AcademicsView, { attendance, timetable, od: odWithoutCap() }));
    openOdTab();
    expect(text()).toContain('OD hours used');
    expect(text()).not.toContain('Hours left');
    expect(text()).not.toContain('of a 40h semester cap');
  });

  it('says used, not balance, wherever the OD entry point appears', () => {
    mount(createElement(AcademicsView, { attendance, timetable, od: odWithCap() }));
    // The entry card on the weekly tab quotes the same figures as the tracker.
    expect(text()).toContain('On-duty hours used · 6h of a 40h semester cap');
    openOdTab();
    expect(text().toLowerCase()).not.toContain('balance');
  });
});
