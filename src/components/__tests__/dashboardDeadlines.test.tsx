/**
 * Dashboard deadline list — the panel used to print assignments in whatever
 * order VTOP returned them, grouped by course, with a grey date on every row.
 * A submission that was already a week late therefore sat behind next month's
 * quiz and looked like the least urgent thing on the page.
 *
 * These mount the real panel and assert what the student reads: the nearest
 * deadline is the first row, a past date says so in words, and the count names
 * how many are late.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MeridianDashboard } from '../MeridianDashboard';
import type { AssignmentTask, StudentProfile } from '../../types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const student: StudentProfile = {
  name: 'Aarav R', regNo: '25BEE0000',
  branch: 'Electrical and Electronics Engineering',
  // VTOP's "Programme" row is the study level, not a degree name.
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

/** VTOP publishes assignment due dates as DD-MM-YYYY. */
function shift(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
}

function task(id: string, courseCode: string, title: string, dueDate: string): AssignmentTask {
  return { id, courseCode, courseTitle: title, title, dueDate, dueTime: '', status: 'Pending', weightage: '—', description: '' };
}

// Deliberately out of date order, the way VTOP returns them course by course.
const assignments: AssignmentTask[] = [
  task('a1', 'CSE2009', 'Calculus quiz', shift(18)),
  task('a2', 'BAEEE103', 'Lab record submission', shift(-6)),
  task('a3', 'MAT2001', 'Assignment 2', shift(0)),
  task('a4', 'ENG1001', 'Communication essay', shift(1)),
];

let host: HTMLElement;
let root: Root | null = null;

function mount(node: ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host?.remove();
});

const dash = () => createElement(MeridianDashboard, {
  student, attendance: [], timetable: [], exams: [], assignments, od: null, onNavigateTab: () => {},
});

function rows(): HTMLElement[] {
  return Array.from(host.querySelectorAll<HTMLElement>('[aria-label="Due next"] .uc-strip-item'));
}

/** The count line under the due strip: how many are pending, how many late. */
function dueCount(): string {
  return host.querySelector<HTMLElement>('[aria-label="Due next"] .uc-plate-foot .uc-num')?.textContent || '';
}

describe('dashboard assignments panel', () => {
  it('puts the nearest deadline first', () => {
    mount(dash());
    expect(rows().map((row) => row.querySelector('strong')?.textContent?.trim()))
      .toEqual(['Lab record submission', 'Assignment 2', 'Communication essay', 'Calculus quiz']);
  });

  it('says out loud when a deadline has already passed', () => {
    mount(dash());
    const late = rows()[0];
    expect(late.className).toContain('is-late');
    expect(late.querySelector('.uc-strip-when')?.textContent).toContain('Late');
  });

  it('names today and tomorrow instead of leaving the student to count dates', () => {
    mount(dash());
    expect(rows()[1].querySelector('.uc-strip-when')?.textContent).toBe('Today');
    expect(rows()[1].className).toContain('is-urgent');
    expect(rows()[2].querySelector('.uc-strip-when')?.textContent).toBe('Tomorrow');
  });

  it('counts the late ones beside the strip', () => {
    mount(dash());
    expect(dueCount()).toBe('4 pending · 1 late');
  });

  it('still lists the work when nothing is late', () => {
    mount(createElement(MeridianDashboard, {
      student, attendance: [], timetable: [], exams: [],
      assignments: [task('b1', 'CSE2009', 'Tutorial sheet 4', shift(9))],
      od: null, onNavigateTab: () => {},
    }));
    expect(dueCount()).toBe('1 pending');
    expect(rows()[0].querySelector('.uc-strip-when')!.textContent).not.toMatch(/Late|Today|Tomorrow/);
  });
});

describe('dashboard counts read in the right number', () => {
  // A first-semester student with one registered class otherwise reads
  // "1 courses", which is the kind of line that makes a portal feel
  // machine-made.
  const course = (courseCode: string, courseTitle: string) => ({
    courseCode, courseTitle, type: 'ETH', slot: 'B2', facultyName: 'Dr. A. Shunmugavalli',
    attended: 24, totalHeld: 30, percentage: 80, lastUpdated: '2026-09-10', venue: 'SJT 204',
  });

  const oneCourse = createElement(MeridianDashboard, {
    student,
    attendance: [course('BAEEE103', 'Analog Electronics')],
    timetable: [{ id: 'Monday-B2-BAEEE103-1', courseCode: 'BAEEE103', courseTitle: 'Analog Electronics', slot: 'B2', facultyName: 'Dr. A. Shunmugavalli', venue: 'SJT 204', building: 'SJT', roomNo: 'SJT 204', day: 'Monday', startTime: '09:00', endTime: '09:50', isLab: false }],
    exams: [], assignments: [], od: null, onNavigateTab: () => {},
  });

  const twoCourses = createElement(MeridianDashboard, {
    student,
    attendance: [course('BAEEE103', 'Analog Electronics'), course('CSE2009', 'Calculus')],
    timetable: [], exams: [], assignments: [], od: null, onNavigateTab: () => {},
  });

  const courseFoot = () => host.querySelector<HTMLElement>('[aria-label="Current courses"] .uc-plate-foot')?.textContent || '';

  it('says one course, not one courses', () => {
    mount(oneCourse);
    expect(courseFoot()).toContain('1 course');
    expect(courseFoot()).not.toMatch(/\b1 courses\b/);
  });

  it('says two courses, not two course', () => {
    mount(twoCourses);
    expect(courseFoot()).toContain('2 courses');
    expect(courseFoot()).not.toMatch(/\b2 course\b/);
  });
});
