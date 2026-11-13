/**
 * Dashboard examinations — the exam plate once computed "what is my next exam"
 * twice: the list filtered on the device's own today and only on the date, the
 * banner above it on the India clock and the published hour. A paper already
 * written that morning therefore stayed as "next" under a banner that had moved
 * on to another exam.
 *
 * These mount the real dashboard and assert the screen answers once: the plate
 * leads with the head of the one list, a finished paper is nowhere on it, and a
 * date VTOP published without a time is still honoured as today's exam.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MeridianDashboard } from '../MeridianDashboard';
import { istClock } from '../../utils/examUtils';
import type { ExamSchedule, StudentProfile } from '../../types';

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

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * A VTOP date + 24h clock time for the instant `minutes` from now, read on the
 * India clock. Built from the live clock so the suite says the same thing at
 * 00:15 IST as it does at 23:45.
 */
function istAt(minutes: number): { date: string; time: string } {
  const c = istClock(Date.now() + minutes * 60000)!;
  return { date: `${c.year}-${pad(c.month + 1)}-${pad(c.day)}`, time: `${pad(c.hour)}:${pad(c.minute)}` };
}

function exam(id: string, code: string, over: Partial<ExamSchedule> = {}): ExamSchedule {
  return {
    id, courseCode: code, courseTitle: `${code} lecture`, examType: 'CAT 2',
    slot: 'A1', venue: 'SJT 402', seatNo: '', time: '', date: '',
    syllabusTopics: [], topicsCompleted: 0, studyPriority: 'Medium', ...over,
  };
}

let host: HTMLElement;
let root: Root | null = null;

function mount(exams: ExamSchedule[]) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const node: ReactElement = createElement(MeridianDashboard, {
    student, attendance: [], timetable: [], exams, assignments: [], od: null, onNavigateTab: () => {},
  });
  act(() => root!.render(node));
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host?.remove();
});

/** The one place the dashboard answers "what is my next exam". */
function examPanel(): HTMLElement {
  const section = host.querySelector<HTMLElement>('[aria-label="Next examination"]');
  expect(section, 'the examination plate is on the dashboard').toBeTruthy();
  return section!;
}

const panelRows = () => Array.from(examPanel().querySelectorAll<HTMLElement>('.uc-row'));
/** The lead: the figure and the course it names. */
const heroWhen = () => examPanel().querySelector<HTMLElement>('.uc-exam-when')?.textContent || '';
const panelNote = () => examPanel().querySelector<HTMLElement>('.uc-note')?.textContent || '';
const panelFoot = () => examPanel().querySelector<HTMLElement>('.uc-plate-foot')?.textContent || '';
const panelEmpty = () => examPanel().querySelector<HTMLElement>('.uc-empty')?.textContent || '';

describe('dashboard gives one answer to "what is my next exam"', () => {
  it('leads the plate with the head of the list', () => {
    mount([
      exam('far', 'MAT2002', { ...istAt(4320) }),
      exam('next', 'CSE2004', { ...istAt(1440) }),
      exam('done', 'EEE1001', { ...istAt(-120) }),
    ]);
    // The nearest paper is the plate's own lead; the others are rows beneath it.
    expect(heroWhen()).toContain('CSE2004');
    expect(heroWhen()).not.toContain('MAT2002');
    const rows = panelRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('MAT2002');
    expect(examPanel().textContent).not.toContain('EEE1001');
  });

  it('drops a paper the student has already written', () => {
    mount([exam('done', 'EEE1001', { ...istAt(-120) }), exam('next', 'CSE2004', { ...istAt(1440) })]);
    const text = examPanel().textContent || '';
    expect(text).toContain('CSE2004');
    expect(text).not.toContain('EEE1001');
  });

  it('still treats a date published without a time as today\'s exam', () => {
    mount([exam('untimed', 'CSE2009', { date: istAt(0).date })]);
    expect(heroWhen()).toContain('CSE2009');
    expect(heroWhen()).toContain('Today');
    expect(panelNote()).toContain('Time not released');
  });

  it('says so when the hour arrives but the paper is over', () => {
    // The same course with a published time two hours ago is no longer ahead.
    mount([exam('written', 'CSE2009', { ...istAt(-120), venue: '' })]);
    expect(examPanel().querySelector('.uc-exam-when')).toBeNull();
    expect(panelEmpty()).toContain('already taken place');
    expect(panelEmpty()).not.toContain('has not published dates');
  });

  it('names what is still to come', () => {
    mount([exam('a', 'CSE2004', { ...istAt(1440) }), exam('b', 'MAT2002', { ...istAt(4320) })]);
    expect(panelFoot()).toBe('2 published dates ahead');
  });

  it('lists three and says how many it left out', () => {
    mount([
      exam('a', 'CSE2004', { ...istAt(1440) }),
      exam('b', 'MAT2002', { ...istAt(2880) }),
      exam('c', 'EEE1001', { ...istAt(4320) }),
      exam('d', 'CSE2009', { ...istAt(5760) }),
    ]);
    // One lead plus two rows: three surfaced of four.
    expect(panelRows()).toHaveLength(2);
    expect(panelFoot()).toContain('Showing the next 3 of 4 published dates');
  });

  it('keeps the dates-not-published message for VTOP\'s undated rows', () => {
    mount([exam('pending', 'CSE2004', { examType: 'CAT 1' })]);
    expect(panelRows()).toHaveLength(0);
    expect(panelEmpty()).toContain('has not published dates');
  });

  it('says nothing is synced only when there are no exam rows at all', () => {
    mount([]);
    expect(panelRows()).toHaveLength(0);
    expect(panelEmpty()).toContain('No examination dates have been published yet.');
    expect(panelEmpty()).not.toContain('has not published dates');
  });

  it('falls back to the slot when VTOP gives no course code', () => {
    mount([exam('nocodes', '', { ...istAt(1440), courseTitle: '', slot: 'F1' })]);
    expect(heroWhen()).toContain('Slot F1');
  });
});
