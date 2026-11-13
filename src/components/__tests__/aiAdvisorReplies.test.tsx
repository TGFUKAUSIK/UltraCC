/**
 * The AI advisor's replies and the questions it offers to ask.
 *
 * Three things were wrong on the one screen in UltraCC that answers in prose:
 *
 * 1. The answers were printed as source. The system instruction asks for
 *    "concise bullet points, bold emphasis", Gemini obliges, and the bubble
 *    rendered the markdown verbatim — a student read "**Grade bands (VIT's
 *    absolute scale…)**" with the asterisks still on it and got a list as one
 *    run-on line of dashes.
 * 2. The starter questions were four fixed strings naming Discrete Math, Data
 *    Structures and DBMS — courses most students are not registered for.
 *    Tapping one handed the model a question about a course that was not in the
 *    context it had just been given.
 * 3. The "what the AI can see" chips printed stubs: "CGPA: —" beside "CGPA: 8.40"
 *    depending on whether VTOP had posted the figure, and "OD: 6h" — the same
 *    number the dashboard had to relabel "OD hours used", because six hours used
 *    read as six hours left.
 *
 * These mount the real component with records it must reason from, and read the
 * rendered text.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AiAdvisorView, RichReply } from '../AiAdvisorView';
import type { AssessmentScore, AttendanceRecord, CourseMarks, ExamSchedule, StudentProfile, TimetableSlot } from '../../types';
import type { OdSummary } from '../../lib/vtop/types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const student: StudentProfile = {
  name: 'Aarav R', regNo: '25BEE0000',
  branch: 'Electrical and Electronics Engineering', program: 'UG',
  school: 'School of Electrical and Electronics Engineering', groupStudied: 'PCM',
  semester: 5, cgpa: 8.4, totalCreditsCompleted: 60, totalCreditsRequired: 200,
  proctorName: 'Dr. R. Ramanathan', proctorContact: '', proctorAvailable: true,
  hostelBlock: '', roomNo: '', dayScholar: true,
};

/** Attendance percentages are VTOP's own cell, in tenths (900 = 90.00%). */
function attendedRecord(over: Partial<AttendanceRecord> = {}): AttendanceRecord {
  return {
    courseCode: 'CSE2001', courseTitle: 'Data Structures', type: 'ETH', slot: 'C1',
    facultyName: 'Dr. A. Kumar', attended: 18, totalHeld: 20, percentage: 900,
    lastUpdated: '', venue: 'SJT 402', ...over,
  };
}

/** The tighter of the two recorded courses — the one a bunk question is about. */
const tightCourse: AttendanceRecord = attendedRecord({
  courseCode: 'MAT2001', courseTitle: 'Linear Algebra', slot: 'B1', attended: 14, totalHeld: 20, percentage: 700,
});

function exam(over: Partial<ExamSchedule> = {}): ExamSchedule {
  return {
    id: 'e1', courseCode: 'CSE2002', courseTitle: 'Database Systems', examType: 'CAT 1',
    slot: 'A1', venue: 'SJT 402', seatNo: 'A12', time: '09:00', date: '2026-10-20',
    syllabusTopics: [], topicsCompleted: 0, studyPriority: 'Medium', ...over,
  };
}

const evaluated = (scored: number): AssessmentScore => ({ scored, max: 20, weightage: 15, status: 'Evaluated' });
/** A declared row VTOP has not graded — never a scored zero. */
const pending = (): AssessmentScore => ({ scored: 0, max: 100, weightage: 40, status: 'Pending' });

function marks(over: Partial<CourseMarks> = {}): CourseMarks {
  return {
    courseCode: 'CSE2005', courseTitle: 'Operating Systems',
    cat1: evaluated(18), cat2: pending(), da1: pending(), da2: pending(), da3: pending(), quiz: pending(),
    fat: { max: 100, weightage: 40, status: 'Pending' },
    totalScoredSoFar: 18, currentEstimatedGrade: 'A',
    ...over,
  };
}

let host: HTMLElement;
let root: Root | null = null;

function render(node: ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
}

function mountAdvisor(over: Partial<Parameters<typeof AiAdvisorView>[0]> = {}) {
  render(createElement(AiAdvisorView, {
    student,
    attendance: [attendedRecord(), tightCourse],
    timetable: [] as TimetableSlot[],
    marks: [marks()],
    exams: [exam(), exam({ id: 'e2', courseCode: 'CSE2006', courseTitle: 'Operating Systems', examType: 'CAT 2', date: '2026-11-02' })],
    grades: null,
    gradeHistory: null,
    semesterGrades: null,
    od: null,
    semesterLabel: 'Fall Semester 2026-27',
    ...over,
  }));
}

const text = () => host.textContent ?? '';

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host?.remove();
  // The component reads the CGPA privacy toggle and the saved key from storage.
  window.localStorage.clear();
});

describe('a reply is typeset, not printed as source', () => {
  const reply = (source: string) => {
    render(createElement(RichReply, { text: source }));
    return host;
  };

  it('carries bold runs into ink and leaves no asterisk behind', () => {
    reply('**Grade bands** are absolute, not relative.');
    expect(host.textContent).toBe('Grade bands are absolute, not relative.');
    expect(host.querySelector('strong')?.textContent).toBe('Grade bands');
  });

  it('lays a bullet run out as a list instead of one line of dashes', () => {
    reply('Two things matter:\n- Lab internals\n- The FAT paper');
    expect(host.querySelectorAll('ul.uc-msg-list > li').length).toBe(2);
    expect(host.querySelector('.uc-msg-list > li')?.textContent).toBe('Lab internals');
    // The marker itself is CSS; it must not survive in the text.
    expect(host.textContent).not.toContain('- Lab');
  });

  it('numbers a numbered run', () => {
    reply('1. Read the syllabus\n2. Solve two past papers');
    expect(host.querySelectorAll('ol.uc-msg-list > li').length).toBe(2);
    expect(host.querySelector('ol.uc-msg-list > li')?.textContent).toBe('Read the syllabus');
  });

  it('sets inline code without its backticks', () => {
    reply('You need `40%` of the FAT paper to pass.');
    const code = host.querySelector('code.uc-msg-code');
    expect(code?.textContent).toBe('40%');
    expect(host.textContent).toBe('You need 40% of the FAT paper to pass.');
  });

  it('drops a heading marker rather than printing it', () => {
    reply('### Grade bands\nFAT counts for 40.');
    expect(host.textContent).not.toContain('#');
    expect(host.textContent).toContain('Grade bands');
  });

  it('keeps anything that is not markdown as text, never as markup', () => {
    const raw = '<img src=x onerror="alert(1)"> and <b>bold</b>';
    reply(raw);
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('b')).toBeNull();
    expect(host.textContent).toBe(raw);
  });
});

describe('the starter questions name the records on screen', () => {
  it('asks about the course the student is actually short on', () => {
    mountAdvisor();
    expect(text()).toContain('Can I safely bunk Linear Algebra (B1) this week?');
  });

  it('asks about the nearest exam VTOP has dated', () => {
    mountAdvisor();
    expect(text()).toContain('Build me a study plan for Database Systems CAT 1.');
  });

  it('asks for a FAT target only in a course that has been graded', () => {
    mountAdvisor();
    expect(text()).toContain('What FAT score do I need in CSE2005 to hold my grade?');
  });

  it('never offers a canned course the student is not taking', () => {
    mountAdvisor();
    // Verbatim from the four fixed strings: two courses this student has no row
    // for, and the slot the canned question invented.
    for (const canned of ['Discrete Math', 'DBMS', 'C1 slot']) {
      expect(text(), `the canned prompt named ${canned}`).not.toContain(canned);
    }
  });

  it('offers a starter chip as a send, not a sparkle', () => {
    mountAdvisor();
    const chips = [...host.querySelectorAll('.uc-ask')];
    expect(chips.length).toBeGreaterThan(0);
    for (const chip of chips) {
      expect(chip.querySelector('.lucide-sparkles')).toBeNull();
      expect(chip.querySelector('.lucide-send')).not.toBeNull();
    }
  });

  it('offers only the generic question when no record has synced', () => {
    mountAdvisor({ attendance: [], exams: [], marks: [] });
    expect(text()).toContain('Summarize my highest academic risks this week.');
    expect(text()).not.toContain('Can I safely bunk');
    // …and the plate says what the advisor actually has, instead of counting zeros.
    expect(text()).toContain('The AI can see your profile only');
  });
});

describe('the data chips are the records, not placeholders', () => {
  it('prints the shared CGPA label and the hours actually used', () => {
    mountAdvisor({
      student: { ...student, cgpa: 8.4 },
      od: { available: true, limitHours: 40, totalOdHours: 6, perCourse: [] } as OdSummary,
    });
    expect(text()).toContain('CGPA:');
    expect(text()).toContain('8.40');
    expect(text()).toContain('OD hours used:');
    expect(text()).toContain('6h of 40h');
  });

  it('drops the chip instead of printing a stub for a figure VTOP never posted', () => {
    mountAdvisor({
      student: { ...student, cgpa: null },
      attendance: [attendedRecord()],
      exams: [],
      marks: [],
    });
    expect(text()).not.toContain('CGPA:');
    expect(text()).not.toContain('OD hours used:');
    // The counts that do exist are still named.
    expect(text()).toContain('Attendance:');
  });

  it('does not print a count of zero for a record that never synced', () => {
    mountAdvisor({ timetable: [], exams: [] });
    expect(text()).not.toContain('Exams:');
    expect(text()).not.toContain('Timetable:');
  });
});
