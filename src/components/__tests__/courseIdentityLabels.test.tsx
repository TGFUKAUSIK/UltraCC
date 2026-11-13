/**
 * Rendered course / programme labels (production bug: the portal header and the
 * "Branch" row printed "PCM", VTOP's Class-XII group).
 *
 * These mount the two screens the value reached, feed them the live-shaped VTOP
 * profile through the real adapters, and assert what the student actually reads:
 * the header names the registered programme or school, the profile rows each
 * carry their own value, and the +2 group only ever appears under its own
 * label. Data-level guarantees live in
 * src/lib/vtop/__tests__/courseIdentityMapping.test.ts.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MeridianDashboard } from '../MeridianDashboard';
import { MyInfoView } from '../MyInfoView';
import { toUiProfile, toUiAttendance, toUiTimetable } from '../../lib/vtop/adapters';
import { StudentProfile, AttendanceRecord, TimetableSlot, TransportInfo } from '../../lib/vtop/types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Exactly what VTOP's live Chennai profile page states (see the gateway parser). */
const vtopProfile: StudentProfile = {
  registrationNo: '25BEE0000',
  name: 'Aarav R',
  program: 'UG',
  branch: '',
  groupStudied: 'PCM',
  school: 'Centre for e-Automation Technologies',
  semester: '',
  cgpa: 0,
  proctorName: 'Dr. R. Ramanathan',
  proctorEmail: '',
  proctorMobile: '',
};

const vtopTransport: TransportInfo = {
  hasRegistration: true,
  registerNumber: '25BEE0000',
  name: 'Aarav R',
  programme: 'B.Tech.',
  branch: 'Electrical and Electronics Engineering',
  routeSelected: 'AMINJIKARAI',
  fpReference: '',
  paymentStatus: 'Paid',
  busRouteId: '42',
  qrCode: '',
  rows: [],
};

const vtopAttendance: AttendanceRecord[] = [
  {
    courseCode: 'BAEEE103',
    courseTitle: 'Analog Electronics',
    courseType: 'ETH',
    slot: 'B2',
    facultyName: 'Dr. A. Shunmugavalli',
    attended: 24,
    totalHeld: 30,
    percentage: 80,
    category: 'Theory',
    lastUpdated: '2026-09-10',
  },
];

const vtopTimetable: TimetableSlot[] = [
  {
    id: 'Monday-B2-BAEEE103-1',
    slot: 'B2',
    courseCode: 'BAEEE103',
    courseTitle: 'Analog Electronics',
    courseType: 'ETH',
    facultyName: 'Dr. A. Shunmugavalli',
    venue: 'SJT 204',
    building: 'SJT (Silver Jubilee Tower)',
    startTime: '09:00',
    endTime: '09:50',
    day: 'Monday',
  },
];

const student = toUiProfile(vtopProfile, null, vtopTransport);

let host: HTMLElement;
let root: Root | null = null;

function mount(node: ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(node));
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host?.remove();
});

/** The value element that follows a visible label (both screens use label/value pairs). */
function valueForLabel(container: HTMLElement, label: string): string {
  const nodes = Array.from(container.querySelectorAll<HTMLElement>('dt, p, span, th, td, label'));
  const hit = nodes.find((n) => (n.textContent || '').trim().toLowerCase() === label.toLowerCase());
  const valueEl = hit?.tagName.toLowerCase() === 'dt'
    ? hit.nextElementSibling
    : hit?.parentElement?.querySelector('p:last-child, dd, span:last-child') || hit?.nextElementSibling;
  return (valueEl?.textContent || '').trim();
}

describe('dashboard identity and summary rows', () => {
  const dash = () => createElement(MeridianDashboard, {
    student,
    attendance: toUiAttendance(vtopAttendance, vtopTimetable),
    timetable: toUiTimetable(vtopTimetable),
    exams: [],
    assignments: [],
    od: null,
    onNavigateTab: () => {},
  });

  it('names the registered programme in the header, never the +2 group', () => {
    mount(dash());
    const line = host.querySelector<HTMLElement>('.uc-home-id-main span');
    expect(line).toBeTruthy();
    expect(line!.textContent).toContain('Electrical and Electronics Engineering');
    expect(line!.textContent).not.toMatch(/PCM/i);
  });

  it('gives Programme, Branch and School their own rows with their own values', () => {
    mount(dash());
    const list = host.querySelector<HTMLElement>('.uc-facts');
    expect(list).toBeTruthy();
    expect(valueForLabel(list!, 'Programme')).toBe('B.Tech.');
    expect(valueForLabel(list!, 'Branch')).toBe('Electrical and Electronics Engineering');
    // VTOP's "School" row holds a research centre; the school shown is the one
    // the student's registered branch actually sits in, spelled out — the
    // acronym "SELECT" reads as a placeholder on the student's own record.
    expect(valueForLabel(list!, 'School')).toBe('School of Electrical Engineering');
    expect(list!.textContent).not.toContain('Centre for e-Automation');
    // The acronym itself is a placeholder the screens spell out, so it must not
    // survive anywhere on the summary.
    expect(list!.textContent).not.toMatch(/SELECT/);
    // "PCM" is not a branch, so it must not appear anywhere in the summary.
    expect(list!.textContent).not.toMatch(/PCM/i);
  });

  it('shows the registered course on the course card', () => {
    mount(dash());
    const grid = host.querySelector<HTMLElement>('.uc-courses');
    expect(grid).toBeTruthy();
    expect(grid!.textContent).toContain('BAEEE103');
    expect(grid!.textContent).toContain('Analog Electronics');
    expect(grid!.textContent).not.toMatch(/PCM/i);
  });
});

describe('My Info profile card', () => {
  it('labels the Class-XII group as what it is, and keeps it out of the branch', () => {
    mount(createElement(MyInfoView, { student }));
    const text = host.textContent || '';
    expect(text).toContain('Class XII group');
    expect(valueForLabel(host, 'Class XII group')).toBe('PCM');
    expect(valueForLabel(host, 'Branch')).toBe('Electrical and Electronics Engineering');
    expect(valueForLabel(host, 'Programme')).toBe('B.Tech.');
    expect(valueForLabel(host, 'School')).toBe('School of Electrical Engineering');
    expect(text).not.toMatch(/SELECT/);
  });

  it('reads the branch from VTOP only — the value beside "Branch" is never a +2 group', () => {
    // Without the transport record there is no branch in VTOP at all, so the
    // honest answer is an empty row, not the student's +2 subjects.
    const noTransport = toUiProfile(vtopProfile);
    mount(createElement(MyInfoView, { student: noTransport }));
    expect(valueForLabel(host, 'Branch')).toBe('—');
    expect(valueForLabel(host, 'Class XII group')).toBe('PCM');
    // And with no branch there is nothing to derive the school from, so the
    // research centre VTOP printed in its "School" row stays off the page.
    expect(valueForLabel(host, 'School')).toBe('—');
    expect(host.textContent).not.toContain('Centre for e-Automation');
  });
});
