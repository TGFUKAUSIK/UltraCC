/**
 * A chip the app can link to.
 *
 * The dashboard printed "OD hours used: 6 of 40 this semester" under a button
 * labelled "View profile" that opened the profile — a page of names and a
 * proctor, while the number the student had just read stayed one screen away.
 * The OD tracker lives on an Academics chip that only ever existed in a click,
 * so nothing outside that page could point at it.
 *
 * The chips now take part in the URL the way tabs already did (`?subtab=`): a
 * surface can send a student to the one screen that answers its own line, and a
 * refresh or a link pasted into a group chat keeps them on the chip they chose.
 * A value that is not one of the three chips is ignored — a wrong link should
 * open the page's default view, not a blank screen.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

const od: OdSummary = {
  available: true,
  limitHours: 40,
  totalOdHours: 6,
  perCourse: [
    { courseCode: 'CSE2009', courseName: 'Data Structures', slot: 'A1', odHours: 2, onDutyCount: 2, present: 20, absent: 1, total: 23, dates: [] },
  ],
};

let root: Root | null = null;
let host: HTMLElement | null = null;

function mount(node: ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
}

const text = () => host?.textContent ?? '';

/** Put the address bar where the app would have put it, before the page mounts. */
function setUrl(search: string) {
  act(() => window.history.replaceState({}, '', `${window.location.pathname}${search}`));
}

const query = () => new URL(window.location.href).searchParams;

function buttonByText(label: string): HTMLButtonElement | undefined {
  return Array.from(host?.querySelectorAll('button') ?? [])
    .find((b) => (b.textContent ?? '').trim() === label);
}

beforeEach(() => setUrl(''));

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  host?.remove();
  host = null;
  setUrl('');
});

describe('Academics opens on the chip the link names', () => {
  const academics = createElement(AcademicsView, { attendance, timetable, od });

  it('shows the OD tracker with no click at all', () => {
    setUrl('?tab=academics&subtab=od');
    mount(academics);
    expect(text()).toContain('On-Duty Tracker');
    // The weekly list is behind the chip, not on screen as well.
    expect(text()).not.toContain('OD Calculator');
  });

  it('shows the predictor when the link names that chip', () => {
    setUrl('?tab=academics&subtab=predictor');
    mount(academics);
    expect(text()).toContain('Attendance Predictor');
  });

  it('falls back to the weekly view for a chip that does not exist', () => {
    setUrl('?tab=academics&subtab=marks');
    mount(academics);
    expect(text()).not.toContain('On-Duty Tracker');
    expect(text()).not.toContain('Attendance Predictor');
    expect(text()).toContain('OD Calculator');
    // And the bad parameter is corrected rather than left in the address bar.
    expect(query().get('subtab')).toBeNull();
  });

  it('keeps the chosen chip in the address bar, and drops the default one', () => {
    mount(academics);
    expect(query().get('subtab')).toBeNull();
    act(() => buttonByText('OD')!.click());
    expect(query().get('subtab')).toBe('od');
    act(() => buttonByText('Predictor')!.click());
    expect(query().get('subtab')).toBe('predictor');
    act(() => buttonByText('Weekly')!.click());
    expect(query().get('subtab')).toBeNull();
  });
});

describe('the dashboard sends each line to the screen that answers it', () => {
  /** Mount the dashboard while recording every navigation it asks for. */
  function mountDashboard() {
    const calls: [string, string | undefined][] = [];
    mount(createElement(MeridianDashboard, {
      student, attendance, timetable, exams: [], assignments: [], od,
      onNavigateTab: (tab: string, subtab?: string) => { calls.push([tab, subtab]); },
    }));
    return calls;
  }

  it('opens the OD tracker from the OD figure', () => {
    const calls = mountDashboard();
    expect(text()).toContain('OD hours used: 6 of 40 this semester');
    const tracker = buttonByText('OD tracker');
    expect(tracker, 'the button under the OD line').not.toBeUndefined();
    act(() => tracker!.click());
    expect(calls).toEqual([['academics', 'od']]);
  });

  it('offers the tracker even when the hours are missing', () => {
    const calls: [string, string | undefined][] = [];
    mount(createElement(MeridianDashboard, {
      student, attendance, timetable, exams: [], assignments: [], od: null,
      onNavigateTab: (tab: string, subtab?: string) => { calls.push([tab, subtab]); },
    }));
    expect(text()).toContain('OD information not available');
    act(() => buttonByText('OD tracker')!.click());
    // The tracker says which sync is missing; the profile page never did.
    expect(calls).toEqual([['academics', 'od']]);
  });

  it('still routes to the profile from the profile button', () => {
    const calls = mountDashboard();
    act(() => buttonByText('Profile')!.click());
    expect(calls).toEqual([['my-info', undefined]]);
  });

  it('no longer sends a sync-empty panel to the profile', () => {
    mountDashboard();
    // The buttons that stay on the dashboard must each name its own subject.
    const labels = Array.from(host?.querySelectorAll('button') ?? [])
      .map((b) => (b.textContent ?? '').trim());
    expect(labels.filter((l) => l === 'View profile' || l === 'Open profile')).toEqual([]);
  });
});
