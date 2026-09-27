/**
 * Course-identity data mapping (production bug: screens showed "PCM" /
 * "Computer with Maths" where the student's course/branch belonged).
 *
 * ROOT CAUSE, proved against the live Chennai profile: VTOP's profile page has
 * no academic-branch row. Its "Programme" row holds the study LEVEL (literally
 * "UG") and its "Branch / Group Studied" row holds the Class-XII subject group
 * ("PCM"). Both profile parsers matched the branch field with /^branch/i, so
 * the +2 group won, and adapters.toUiProfile then fell back to `program` — so a
 * level or a school-stream could be printed wherever the UI claimed a branch.
 *
 * These tests pin the mapping, not the strings:
 *   - the +2 group can never be read as a branch;
 *   - a branch/programme only comes from a row that actually states it;
 *   - registered course titles survive every adapter untouched, so no
 *     programme/stream/school value can replace course metadata — including a
 *     stale cache written before the parser fix.
 */

import { describe, it, expect } from 'vitest';
import {
  toUiProfile,
  toUiAttendance,
  toUiTimetable,
  toUiMarks,
  toUiExams,
} from '../adapters';
import {
  StudentProfile as VtopProfile,
  AttendanceRecord,
  CourseMarksRecord,
  ExamRecord,
  TimetableSlot,
  TransportInfo,
} from '../types';
import { parseStudentProfileHtml } from '../parsers/profile';
import { profileRealHtml } from '../__fixtures__';
import { parseProfileHtml } from '../../../../supabase/functions/vtop-gateway/parsers';

/** VTOP's own profile shape for a Chennai student: level + +2 group + school. */
const liveProfile: VtopProfile = {
  registrationNo: '25BEE0000',
  name: 'Student',
  program: 'UG',
  branch: '',
  groupStudied: 'PCM',
  school: 'Centre for e-Automation Technologies',
  semester: '',
  cgpa: 0,
  proctorName: '',
  proctorEmail: '',
  proctorMobile: '',
};

/** The programme/branch pair VTOP states on the transport registration record. */
const transport: TransportInfo = {
  hasRegistration: true,
  registerNumber: '25BEE0000',
  name: 'Student',
  programme: 'B.Tech.',
  branch: 'Electrical and Electronics Engineering',
  routeSelected: 'AMINJIKARAI',
  fpReference: '',
  paymentStatus: 'Paid',
  busRouteId: '42',
  qrCode: '',
  rows: [],
};

/** Registered courses as VTOP's attendance/marks/exam/timetable pages name them. */
const attendanceRows: AttendanceRecord[] = [
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
  {
    courseCode: 'BAEEE103L',
    courseTitle: 'Analog Electronics Laboratory',
    courseType: 'ELA',
    slot: 'L41',
    facultyName: 'Dr. A. Shunmugavalli',
    attended: 10,
    totalHeld: 12,
    percentage: 83.3,
    category: 'Lab',
    lastUpdated: '2026-09-10',
  },
];

const timetableSlots: TimetableSlot[] = [
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

/** VTOP always emits every component; unevaluated ones arrive as zeroed rows. */
const pending = (title: string): CourseMarksRecord['cat1'] => ({
  title, maxMarks: 0, scored: 0, weightageMax: 0, weightageScored: 0, status: 'Pending',
});

const marksRows: CourseMarksRecord[] = [
  {
    courseCode: 'BAEEE103',
    courseTitle: 'Analog Electronics',
    cat1: { title: 'CAT 1', maxMarks: 50, scored: 41, weightageMax: 15, weightageScored: 12.3, status: 'Evaluated' },
    cat2: pending('CAT 2'),
    da1: pending('DA 1'),
    da2: pending('DA 2'),
    da3: pending('DA 3'),
    quiz: pending('Quiz'),
    totalInternalWeightScored: 12.3,
    currentEstimatedGrade: 'B',
  },
];

const examRows: ExamRecord[] = [
  {
    id: 'exam-1-BAEEE103-CAT 2',
    slot: 'B2',
    courseCode: 'BAEEE103',
    courseTitle: 'Analog Electronics',
    examType: 'CAT 2',
    date: '2026-09-30',
    time: '09:00 AM - 10:30 AM',
    venue: 'SJT 402',
    seatNo: '',
    syllabusTopics: [],
  },
];

describe('profile mapping: the +2 group is never a branch', () => {
  it('client parser keeps "Branch / Group Studied" out of `branch`', () => {
    const parsed = parseStudentProfileHtml(profileRealHtml);
    expect(parsed.groupStudied).toBe('PCM');
    expect(parsed.branch).toBe('');
    // VTOP's "Programme" row is the level; the parser used to default a missing
    // one to a fabricated 'B.Tech'.
    expect(parsed.program).toBe('UG');
  });

  it('gateway parser keeps them apart too (the browser only ever sees its output)', () => {
    const parsed = parseProfileHtml(profileRealHtml);
    expect(parsed.groupStudied).toBe('PCM');
    expect(parsed.branch).toBe('');
  });

  it('reads "Computer with Maths", VTOP\'s other +2 label, as the group and not the branch', () => {
    const html = profileRealHtml.replace('<td>PCM</td>', '<td>Computer with Maths</td>');
    const parsed = parseStudentProfileHtml(html);
    expect(parsed.groupStudied).toBe('Computer with Maths');
    expect(parsed.branch).toBe('');
  });

  it('a real Branch row still maps to the branch, alongside the group', () => {
    const html = profileRealHtml.replace(
      '<tr><td>School</td>',
      '<tr><td>Branch</td><td>Electrical and Electronics Engineering</td></tr><tr><td>School</td>',
    );
    const parsed = parseStudentProfileHtml(html);
    expect(parsed.branch).toBe('Electrical and Electronics Engineering');
    expect(parsed.groupStudied).toBe('PCM');
  });

  it('UI view-model exposes each value under its own field', () => {
    const ui = toUiProfile(liveProfile);
    expect(ui).toMatchObject({
      program: 'UG',
      branch: '',
      groupStudied: 'PCM',
      // VTOP's "School" row names a research centre, not a VIT school, and no
      // branch is known here — so the honest answer is nothing at all.
      school: '',
    });
    expect(ui.branch).not.toMatch(/pcm/i);
    expect(ui.school).not.toContain('Centre');
  });

  it('the level/programme never substitutes for a branch', () => {
    // Old adapter line: `branch: p.branch || p.program || '—'` — with the level
    // ("UG") as the fallback, the branch card read as a degree name.
    const ui = toUiProfile({ ...liveProfile, program: 'PG' });
    expect(ui.branch).toBe('');
    expect(ui.branch).not.toBe('PG');
  });

  it('takes the registered programme/branch from VTOP\'s own record when the profile omits them', () => {
    const ui = toUiProfile(liveProfile, null, transport);
    expect(ui.branch).toBe('Electrical and Electronics Engineering');
    expect(ui.program).toBe('B.Tech.');
    expect(ui.groupStudied).toBe('PCM');
    // With a real branch in hand the centre row is replaced by the school VIT
    // actually has this student in.
    expect(ui.school).toBe('SELECT');
  });

  it('relabels a stale cache that stored the +2 group as the branch', () => {
    // A cache written before this fix holds branch: 'PCM' and no groupStudied.
    const stale: VtopProfile = { ...liveProfile, branch: 'PCM', groupStudied: undefined };
    const ui = toUiProfile(stale);
    expect(ui.branch).toBe('');
    expect(ui.groupStudied).toBe('PCM');
  });

  it('drops a +2 group from the transport branch as well rather than showing it', () => {
    const ui = toUiProfile(liveProfile, null, { ...transport, branch: 'PCM' });
    expect(ui.branch).toBe('');
  });

  it('never invents a branch when VTOP states one nowhere', () => {
    const silent: VtopProfile = { ...liveProfile, program: '', groupStudied: '' };
    const ui = toUiProfile(silent, null, { ...transport, branch: '', programme: '' });
    expect(ui.branch).toBe('');
    expect(ui.program).toBe('');
    // Nor a school: the centre row is not one, and with no branch there is
    // nothing to derive the real school from.
    expect(ui.school).toBe('');
    expect(ui.school).not.toContain('Centre');
  });
});

describe('course metadata cannot be overwritten by stream/programme values', () => {
  it('registered titles stay the displayed titles through every course adapter', () => {
    expect(toUiAttendance(attendanceRows, timetableSlots).map((r) => r.courseTitle)).toEqual([
      'Analog Electronics',
      'Analog Electronics Laboratory',
    ]);
    expect(toUiTimetable(timetableSlots)[0].courseTitle).toBe('Analog Electronics');
    expect(toUiMarks(marksRows)[0].courseTitle).toBe('Analog Electronics');
    expect(toUiExams(examRows)[0].courseTitle).toBe('Analog Electronics');
  });

  it('course rows carry no profile value at all — stream, level or school', () => {
    // The adapters are given only VTOP course rows, so this is structural: no
    // programme/school/group value can reach a course label, now or later.
    const rows = [
      ...toUiAttendance(attendanceRows, timetableSlots),
      ...toUiTimetable(timetableSlots),
      ...toUiMarks(marksRows),
      ...toUiExams(examRows),
    ];
    const text = JSON.stringify(rows);
    // Quoted forms for the short values: "UG" appears inside ordinary words.
    for (const value of ['"PCM"', '"Computer with Maths"', '"UG"', '"Centre for e-Automation Technologies"']) {
      expect(text, `course rows leaked the profile value ${value}`).not.toContain(value);
    }
  });

  it('a code-prefixed VTOP title displays as the registered title, with the code kept separately', () => {
    // VTOP sometimes sends "BAEEE103 Analog Electronics". The adapter splits it
    // into code + title for display — it never drops or replaces the course.
    const rows = toUiAttendance([{ ...attendanceRows[0], courseTitle: 'BAEEE103 Analog Electronics' }]);
    expect(rows[0].courseCode).toBe('BAEEE103');
    expect(rows[0].courseTitle).toBe('Analog Electronics');
  });

  it('a course VTOP sent without a title falls back to its code, never to a programme or stream value', () => {
    const rows = toUiAttendance([{ ...attendanceRows[0], courseTitle: '' }]);
    expect(rows[0].courseTitle).toBe('BAEEE103');
    expect(rows[0].courseTitle).not.toMatch(/pcm/i);
  });
});
