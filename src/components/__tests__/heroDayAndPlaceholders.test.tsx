/**
 * The hero's day label and the placeholder stubs.
 *
 * Two defects lived on the dashboard's most-read card:
 *
 * 1. The hero announced "No classes left today" over a card that was showing a
 *    class — the next-day branch hard-coded that lamp while printing a future
 *    day in the tiny note. The day the card is *about* now leads at the
 *    departure time's own size (`.uc-now-day`), and the lamp names the state.
 * 2. VTOP leaves stubs where it has no data ("R -", "Seat -"), and the old
 *    sentinel `display()` let them through because they contain a letter, so a
 *    student read "R - · 401" as a room. `isReal` / `placeOf` drop them, the
 *    room is not reprinted when the venue already carries it, and an unallotted
 *    seat says so instead of "Seat -".
 *
 * These mount the real dashboard and read the rendered text.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MeridianDashboard } from '../MeridianDashboard';
import type { ExamSchedule, StudentProfile, TimetableSlot } from '../../types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const student: StudentProfile = {
  name: 'Aarav R', regNo: '25BEE0000',
  branch: 'Electrical and Electronics Engineering', program: 'UG',
  school: 'School of Electrical and Electronics Engineering', groupStudied: 'PCM',
  semester: 5, cgpa: 8.4, totalCreditsCompleted: 60, totalCreditsRequired: 200,
  proctorName: 'Dr. R. Ramanathan', proctorContact: '', proctorAvailable: true,
  hostelBlock: '', roomNo: '', dayScholar: true,
};

/** The device clock, which is the clock the dashboard itself reads. */
const dayName = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toLocaleDateString('en-US', { weekday: 'long' }) as TimetableSlot['day'];
};

function slot(over: Partial<TimetableSlot> = {}): TimetableSlot {
  return {
    id: 's1', courseCode: 'CSE2001', courseTitle: 'Data Structures', slot: 'A1',
    facultyName: 'Dr. A. Kumar', venue: 'SJT 402', building: 'SJT', roomNo: '402',
    day: dayName(1), startTime: '08:00', endTime: '08:50', isLab: false, ...over,
  };
}

function exam(over: Partial<ExamSchedule> = {}): ExamSchedule {
  const d = new Date();
  d.setDate(d.getDate() + 2);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    id: 'e1', courseCode: 'CSE2004', courseTitle: 'Database Systems', examType: 'CAT 2',
    slot: 'A1', venue: 'SJT 402', seatNo: 'A12', time: '09:00',
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    syllabusTopics: [], topicsCompleted: 0, studyPriority: 'Medium', ...over,
  };
}

let host: HTMLElement;
let root: Root | null = null;

function mount(props: { timetable?: TimetableSlot[]; exams?: ExamSchedule[] }) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const node: ReactElement = createElement(MeridianDashboard, {
    student, attendance: [], timetable: props.timetable ?? [], exams: props.exams ?? [],
    assignments: [], od: null, onNavigateTab: () => {},
  });
  act(() => root!.render(node));
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host?.remove();
});

const hero = () => host.querySelector<HTMLElement>('[aria-label="Your next class"]')!;
const dayLine = () => hero().querySelector<HTMLElement>('.uc-now-day')?.textContent || '';
const lamp = () => hero().querySelector<HTMLElement>('.uc-lamp')?.textContent || '';
const roomChip = () => hero().querySelector<HTMLElement>('.uc-now-room')?.textContent || '';
const seatChip = () => host.querySelector<HTMLElement>('[aria-label="Next examination"] .uc-seat')?.textContent || '';

describe('the hero names the day it is showing', () => {
  it('leads with "Tomorrow" when the next class is tomorrow', () => {
    mount({ timetable: [slot({ day: dayName(1) })] });
    expect(dayLine()).toBe('Tomorrow');
    // The bug: the lamp claimed there was nothing left over a visible class.
    expect(lamp()).not.toBe('No classes left today');
    expect(hero().textContent).toContain('Data Structures');
  });

  it('names the weekday and date when the class is further out', () => {
    mount({ timetable: [slot({ day: dayName(3) })] });
    expect(dayLine()).toBe(dayName(3));
    expect(lamp()).not.toBe('No classes left today');
  });

  it('still says "No classes left today" only when today actually ran out', () => {
    // A bell earlier than any plausible now, so today is exhausted.
    mount({ timetable: [slot({ day: dayName(0), startTime: '00:01', endTime: '00:02' })] });
    expect(lamp()).toBe('No classes left today');
    expect(dayLine()).toBe('');
  });
});

describe('the hero drops placeholder stubs', () => {
  it('never prints a stub venue, and falls back to the room alone', () => {
    mount({ timetable: [slot({ day: dayName(1), venue: 'R -', roomNo: '401' })] });
    expect(roomChip()).toBe('401');
    expect(hero().textContent).not.toContain('R -');
  });

  it('does not repeat the room when the venue already carries it', () => {
    mount({ timetable: [slot({ day: dayName(1), venue: 'SJT 402', roomNo: '402' })] });
    expect(roomChip()).toBe('SJT 402');
    expect(roomChip()).not.toContain('·');
  });

  it('never prints a trailing dash on the timetable rail', () => {
    mount({ timetable: [slot({ day: dayName(0), startTime: '00:01', endTime: '00:02', venue: 'Room 401 -', roomNo: '401' })] });
    const meta = host.querySelector<HTMLElement>('.uc-rail-main span')?.textContent || '';
    expect(meta).not.toMatch(/-\s*(·|$)/);
  });
});

describe('the seat chip', () => {
  it('says the seat is not allotted rather than printing "Seat -"', () => {
    mount({ exams: [exam({ seatNo: '-' })] });
    expect(seatChip()).toBe('Seat not allotted yet');
    expect(host.textContent).not.toContain('Seat -');
  });

  it('names a real seat', () => {
    mount({ exams: [exam({ seatNo: 'A12' })] });
    expect(seatChip()).toBe('Seat A12');
  });
});
