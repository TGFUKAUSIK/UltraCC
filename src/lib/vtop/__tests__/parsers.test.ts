import { describe, it, expect } from 'vitest';
import {
  loginPageHtml,
  attendanceHtml,
  attendanceReorderedHtml,
  attendanceMalformedHtml,
  timetableHtml,
  timetableGridHtml,
  timetableMalformedHtml,
  marksHtml,
  marksMalformedHtml,
  examsHtml,
  examsMalformedHtml,
  semestersHtml,
  semestersMissingHtml,
  assignmentsHtml,
  assignmentsMissingHtml,
  profileHtml,
  profileMalformedHtml,
  attendanceRealHtml,
  timetableRealHtml,
  timetableRealTwoSlotLabHtml,
  marksRealHtml,
  examsRealHtml,
  profileRealHtml,
} from '../__fixtures__';
import { parseAttendanceHtml } from '../parsers/attendance';
import { attendancePercentLabel } from '../../../utils/attendanceBands';
import { parseTimetableHtml } from '../parsers/timetable';
import { parseMarksHtml, parseExamsHtml } from '../parsers/marks';
import { parseSemestersHtml, parseAssignmentsHtml } from '../parsers/semestersAndAssignments';
import { parseStudentProfileHtml } from '../parsers/profile';

describe('parseAttendanceHtml', () => {
  it('parses a valid attendance table (header-driven)', () => {
    const rows = parseAttendanceHtml(attendanceHtml);
    expect(rows).toHaveLength(4);
    const first = rows[0];
    expect(first.courseCode).toBe('CSE2001');
    expect(first.courseTitle).toBe('Data Structures and Algorithms');
    expect(first.courseType).toBe('ETH');
    expect(first.slot).toBe('A1 + TA1');
    expect(first.attended).toBe(28);
    expect(first.totalHeld).toBe(32);
    expect(first.percentage).toBeCloseTo(87.5, 1);
    // Lab detection via course type
    expect(rows[2].category).toBe('Lab');
    expect(rows[0].category).toBe('Theory');
    // Footer "Overall" row is skipped
    expect(rows.every((r) => r.courseCode !== 'Overall')).toBe(true);
  });

  it('maps columns from the header even when re-ordered, recomputing missing percentages', () => {
    const rows = parseAttendanceHtml(attendanceReorderedHtml);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ courseCode: 'CSE2008', attended: 27, totalHeld: 30, percentage: 90 });
    // Missing percentage is recomputed: 25/30 = 83.3
    expect(rows[1].percentage).toBeCloseTo(83.3, 1);
  });

  it('recomputes a missing percentage in the same tenths VTOP itself shows', () => {
    // 2/3 is the case that used to split: VTOP writes "66.66" in that cell and
    // the app prints "66.6", but when the cell was absent the parser rounded the
    // recomputed figure to 66.7 and stored THAT. The cached record, the summary
    // cards and the debar filter then quoted a number VTOP never wrote, and the
    // same course read 66.6 or 66.7 depending on whether a column parsed.
    const html = `<!doctype html><html><body><table class="table">
      <thead><tr><th>Course Code</th><th>Course Title</th><th>Course Type</th><th>Slot</th><th>Attended</th><th>Total</th><th>Percentage</th></tr></thead>
      <tbody>
        <tr><td>CSE3001</td><td>Compiler Design</td><td>ETH</td><td>A1</td><td>2</td><td>3</td><td></td></tr>
        <tr><td>CSE3002</td><td>Computer Networks</td><td>ETH</td><td>B1</td><td>2</td><td>3</td><td>66.66%</td></tr>
      </tbody>
    </table></body></html>`;
    const rows = parseAttendanceHtml(html);
    expect(rows).toHaveLength(2);
    // The recomputed row lands on the tenth the label would print for VTOP's own
    // figure — 66.6, not 66.7.
    expect(rows[0].percentage).toBe(66.6);
    // VTOP's number is still the authority when it answers, decimals and all.
    expect(rows[1].percentage).toBe(66.66);
    expect(attendancePercentLabel(rows[0].percentage)).toBe(attendancePercentLabel(rows[1].percentage));
  });

  it('returns [] with structural mismatch for malformed HTML', () => {
    const outcome = parseAttendanceHtml(attendanceMalformedHtml, true);
    expect(outcome.data).toEqual([]);
    expect(outcome.structuralMismatch).toBe(true);
    expect(outcome.warnings.length).toBeGreaterThan(0);
  });

  it('reports session expiry when a login page is returned', () => {
    const outcome = parseAttendanceHtml(loginPageHtml, true);
    expect(outcome.data).toEqual([]);
    expect(outcome.structuralMismatch).toBe(true);
    expect(outcome.warnings.some((w) => w.code === 'session-expired')).toBe(true);
  });

  it('skips rows with unparseable numbers instead of fabricating them', () => {
    const html = `<!doctype html><html><body>
      <table><thead><tr><th>Course Code</th><th>Course Title</th><th>Slot</th><th>Attended</th><th>Total</th><th>Percentage</th></tr></thead>
      <tbody>
        <tr><td>CSE2001</td><td>DSA</td><td>A1</td><td>--</td><td>32</td><td>0%</td></tr>
        <tr><td>CSE2004</td><td>DBMS</td><td>B1</td><td>23</td><td>30</td><td>76.6%</td></tr>
      </tbody></table></body></html>`;
    const rows = parseAttendanceHtml(html);
    expect(rows).toHaveLength(1);
    expect(rows[0].courseCode).toBe('CSE2004');
  });
});

describe('parseTimetableHtml', () => {
  it('parses per-day row-list tables and derives times from the FFCS slot map', () => {
    const slots = parseTimetableHtml(timetableHtml);
    expect(slots).toHaveLength(5);
    const monday = slots.find((s) => s.courseCode === 'CSE2001');
    expect(monday).toMatchObject({ day: 'Monday', slot: 'A1', startTime: '08:00', endTime: '08:50', venue: 'SJT 204' });
    const tuesday = slots.find((s) => s.courseCode === 'CSE2008');
    expect(tuesday).toMatchObject({ day: 'Tuesday', slot: 'B1', startTime: '08:00', endTime: '08:50' });
    const lab = slots.find((s) => s.courseCode === 'CSE2001L');
    expect(lab?.slot).toBe('L31 + L32');
  });

  it('parses the grid shape (slots × days) with multi-line cells', () => {
    const slots = parseTimetableHtml(timetableGridHtml);
    expect(slots).toHaveLength(2);
    const cse2001 = slots.find((s) => s.courseCode === 'CSE2001');
    expect(cse2001?.day).toBe('Monday');
    expect(cse2001?.venue).toBe('SJT 204');
    const cse2008 = slots.find((s) => s.courseCode === 'CSE2008');
    expect(cse2008?.day).toBe('Tuesday');
  });

  it('returns [] with structural mismatch for unrecognized HTML', () => {
    const outcome = parseTimetableHtml(timetableMalformedHtml, true);
    expect(outcome.data).toEqual([]);
    expect(outcome.structuralMismatch).toBe(true);
  });

  it('reports session expiry for login pages', () => {
    const outcome = parseTimetableHtml(loginPageHtml, true);
    expect(outcome.data).toEqual([]);
    expect(outcome.warnings.some((w) => w.code === 'session-expired')).toBe(true);
  });
});

describe('parseMarksHtml', () => {
  it('parses CAT/DA/Quiz marks from the legacy flat layout', () => {
    const records = parseMarksHtml(marksHtml);
    expect(records).toHaveLength(2);
    const cse2001 = records.find((r) => r.courseCode === 'CSE2001')!;
    expect(cse2001.cat1).toMatchObject({ scored: 42.5, maxMarks: 50, status: 'Evaluated' });
    // This layout has no Weightage % column, so the weight is UNDECLARED rather
    // than the old assumed VIT split (15/15/5/5/10). The header's "(50)" is the
    // marks out of, not the share of the course, and guessing it was what made
    // every projection on this page wrong. Weighted arithmetic is covered
    // against a page that does declare weights in marksWeights.test.ts.
    expect(cse2001.cat1.weightageMax).toBe(0);
    expect(cse2001.cat1.weightageScored).toBe(0);
    expect(cse2001.totalInternalWeightScored).toBe(0);
  });

  it('treats AB as a Pending component', () => {
    const records = parseMarksHtml(marksHtml);
    const cse2004 = records.find((r) => r.courseCode === 'CSE2004')!;
    expect(cse2004.cat2.status).toBe('Pending');
    expect(cse2004.cat2.weightageScored).toBe(0);
  });

  it('does not turn an entirely pending marks row into a low-grade warning', () => {
    const html = `<html><body><table class="customTable">
      <tr><td>1</td><td>1001</td><td>BCSE4001</td><td>Pending Course</td><td>ETH</td><td>REG</td><td>Dr. X</td><td>A1</td><td>Theory</td></tr>
      <tr><td colspan="9"><table class="customTable-level1">
        <tr><th>S.No</th><th>Title</th><th>Max</th><th>Wt%</th><th>Status</th><th>Scored</th><th>Wt Mark</th></tr>
        <tr><td>1</td><td>Continuous Assessment Test - I</td><td>50</td><td>15</td><td>Pending</td><td></td><td></td></tr>
        <tr><td>2</td><td>Final Assessment Test</td><td>100</td><td>50</td><td>Pending</td><td></td><td></td></tr>
      </table></td></tr></table></body></html>`;
    const record = parseMarksHtml(html)[0];
    expect(record.currentEstimatedGrade).toBe('Internal marks not available');
    expect(record.currentEstimatedGrade).not.toContain('Below C');
  });

  it('returns [] with structural mismatch for malformed HTML', () => {
    const outcome = parseMarksHtml(marksMalformedHtml, true);
    expect(outcome.data).toEqual([]);
    expect(outcome.structuralMismatch).toBe(true);
  });

  it('maps the FULL-WORD titles the live Chennai portal serves', () => {
    // Real titles from the live portal: "Continuous Assessment Test - I",
    // "Assignment - II", "Final Assessment Test" — no "CAT"/"DA"/"FAT" literals.
    const inner = [
      ['1', 'Assignment - I', '5', '2.5', 'Evaluated', '4', '2'],
      ['2', 'Continuous Assessment Test - I', '50', '15', 'Evaluated', '42', '12.6'],
      ['3', 'Continuous Assessment Test - II', '50', '15', 'AB', 'AB', ''],
      ['4', 'Quiz - I', '10', '10', 'Evaluated', '8', '8'],
      ['5', 'Final Assessment Test', '100', '50', 'Pending', '', ''],
    ];
    const html = `<html><body><table class="customTable">` +
      `<tr><td>1</td><td>1001</td><td>BAEEE102</td><td>Circuit Theory</td><td>ETH</td><td>REG</td><td>Dr. X</td><td>A1</td><td>Theory</td></tr>` +
      `<tr><td colspan="9"><table class="customTable-level1"><tr><th>S.No</th><th>Title</th><th>Max</th><th>Wt%</th><th>Status</th><th>Scored</th><th>Wt Mark</th></tr>` +
      inner.map((c) => `<tr><td>${c.join('</td><td>')}</td></tr>`).join('') +
      `</table></td></tr></table></body></html>`;
    const records = parseMarksHtml(html);
    expect(records).toHaveLength(1);
    const r = records[0];
    expect(r.cat1).toMatchObject({ maxMarks: 50, scored: 42, status: 'Evaluated' });
    expect(r.cat2).toMatchObject({ scored: 0, status: 'Pending' }); // AB
    expect(r.da1).toMatchObject({ maxMarks: 5, scored: 4, status: 'Evaluated' });
    expect(r.quiz).toMatchObject({ maxMarks: 10, scored: 8, status: 'Evaluated' });
    expect(r.fat).toMatchObject({ maxMarks: 100, scored: 0, status: 'Pending' });
  });

  it('maps all THREE digital assignments to their own slots, however titled', () => {
    // VIT publishes DA - 1/2/3 as separate rows at their own weightage. A third
    // row that mapped to nothing silently dropped a declared 10% from the
    // course total (and from the grade predictor + simulator). Titles vary:
    // "DA - 3", "Digital Assignment - 3", "Assignment - III" all mean DA 3.
    const rowsFor = (titles: string[][]) =>
      `<table class="customTable-level1"><tr><th>S.No</th><th>Title</th><th>Max</th><th>Wt%</th><th>Status</th><th>Scored</th><th>Wt Mark</th></tr>` +
      titles.map((c) => `<tr><td>${c.join('</td><td>')}</td></tr>`).join('') + '</table>';
    const html = `<html><body><table class="customTable">` +
      `<tr><td>1</td><td>1001</td><td>BCSE101</td><td>Programming</td><td>ETH</td><td>REG</td><td>Dr. Z</td><td>A1</td><td>Theory</td></tr>` +
      `<tr><td colspan="9">${rowsFor([
        ['1', 'DA - 1', '10', '10', 'Evaluated', '8', '8'],
        ['2', 'DA - 2', '10', '10', 'Evaluated', '7', '7'],
        ['3', 'DA - 3', '10', '10', 'Evaluated', '6', '6'],
      ])}</td></tr>` +
      `</table></body></html>`;
    const [r] = parseMarksHtml(html);
    expect(r.da1).toMatchObject({ maxMarks: 10, scored: 8, weightageMax: 10, status: 'Evaluated' });
    expect(r.da2).toMatchObject({ maxMarks: 10, scored: 7, weightageMax: 10, status: 'Evaluated' });
    expect(r.da3).toMatchObject({ maxMarks: 10, scored: 6, weightageMax: 10, status: 'Evaluated' });

    // "Digital Assignment - 3" and "Assignment - III" are the same slot too.
    const alt = `<html><body><table class="customTable">` +
      `<tr><td>1</td><td>1001</td><td>BCSE102</td><td>Algorithms</td><td>ETH</td><td>REG</td><td>Dr. Z</td><td>A1</td><td>Theory</td></tr>` +
      `<tr><td colspan="9">${rowsFor([
        ['1', 'Digital Assignment - 3', '10', '10', 'Evaluated', '9', '9'],
      ])}</td></tr>` +
      `</table></body></html>`;
    expect(parseMarksHtml(alt)[0].da3).toMatchObject({ scored: 9, status: 'Evaluated' });

    const roman = `<html><body><table class="customTable">` +
      `<tr><td>1</td><td>1001</td><td>BCSE103</td><td>Networks</td><td>ETH</td><td>REG</td><td>Dr. Z</td><td>A1</td><td>Theory</td></tr>` +
      `<tr><td colspan="9">${rowsFor([
        ['1', 'Assignment - III', '10', '10', 'Evaluated', '9', '9'],
      ])}</td></tr>` +
      `</table></body></html>`;
    expect(parseMarksHtml(roman)[0].da3).toMatchObject({ scored: 9, status: 'Evaluated' });
  });

  it('merges theory + lab assessment tables for the same course into ONE row', () => {
    const tableFor = (assessments: string[][]) =>
      `<table class="customTable-level1"><tr><th>S.No</th><th>Title</th><th>Max</th><th>Wt%</th><th>Status</th><th>Scored</th><th>Wt Mark</th></tr>` +
      assessments.map((c) => `<tr><td>${c.join('</td><td>')}</td></tr>`).join('') + '</table>';
    const html = `<html><body><table class="customTable">` +
      `<tr><td>1</td><td>1001</td><td>BAEEE204</td><td>EMFT</td><td>ETH</td><td>REG</td><td>Dr. Y</td><td>D1</td><td>Theory</td></tr>` +
      `<tr><td colspan="9">${tableFor([
        ['1', 'Assignment - I', '5', '2.5', 'Evaluated', '4', '2'],
        ['2', 'Continuous Assessment Test - I', '50', '15', 'Evaluated', '42', '12.6'],
      ])}</td></tr>` +
      `<tr><td>2</td><td>1002</td><td>BAEEE204</td><td>EMFT Lab</td><td>ELA</td><td>REG</td><td>Dr. Y</td><td>D1</td><td>Lab</td></tr>` +
      `<tr><td colspan="9">${tableFor([
        ['1', 'Assessment - 1', '2', '1', 'Evaluated', '2', '1'],
        ['2', 'Quiz - I', '10', '10', 'Evaluated', '7', '7'],
      ])}</td></tr>` +
      `</table></body></html>`;
    const records = parseMarksHtml(html);
    expect(records).toHaveLength(1); // merged, not duplicated
    const r = records[0];
    expect(r.courseCode).toBe('BAEEE204');
    expect(r.cat1).toMatchObject({ scored: 42, status: 'Evaluated' });
    expect(r.da1).toMatchObject({ scored: 4, status: 'Evaluated' });
    expect(r.quiz).toMatchObject({ scored: 7, status: 'Evaluated' });
  });

  it('maps a soft-skill "Assessment - N" row onto DA 1 and totals its weightage mark', () => {
    // BASTS101 (soft skill / ETHNUS) publishes "Assessment - 1" next to a
    // "Continuous Assessment Test - I" (max 30). The Assessment row is the
    // soft-skill digital assignment: it must land in DA 1 (not vanish into
    // extraComponents), and VTOP's own total is 15 + 14 = 29 weightage marks.
    const html = `<html><body><table class="customTable">` +
      `<tr><td>3</td><td>CH2026270100062</td><td>BASTS101</td><td>Qualitative and Quantitative Skills Practice I</td><td>Soft Skill</td><td>ACE</td><td>ETHNUS (APT)</td><td>B1+TB1</td><td>SBC01</td></tr>` +
      `<tr><td colspan="9"><table class="customTable-level1">` +
      `<tr><th>Sl.No.</th><th>Mark Title</th><th>Max. Mark</th><th>Weightage %</th><th>Status</th><th>Scored Mark</th><th>Weightage Mark</th><th>Class Average</th><th>Mark Posted Strength</th><th>Remark</th></tr>` +
      `<tr><td>1</td><td>Assessment - 1</td><td>15</td><td>15</td><td>Present</td><td>15.0</td><td>15</td><td></td><td></td><td></td></tr>` +
      `<tr><td>2</td><td>Continuous Assessment Test - I</td><td>30</td><td>15</td><td>Present</td><td>28.0</td><td>14</td><td></td><td></td><td></td></tr>` +
      `</table></td></tr>` +
      `</table></body></html>`;
    const [r] = parseMarksHtml(html);
    expect(r.courseCode).toBe('BASTS101');
    expect(r.cat1).toMatchObject({ maxMarks: 30, scored: 28, weightageMax: 15, status: 'Evaluated' });
    expect(r.da1).toMatchObject({
      title: 'Assessment - 1', maxMarks: 15, scored: 15, weightageMax: 15, status: 'Evaluated',
    });
    expect(r.extraComponents).toHaveLength(0);
    // 14 (CAT) + 15 (Assessment as DA 1) — nothing dropped.
    expect(r.totalInternalWeightScored).toBe(29);
  });

  it('keeps a lab "Assessment - N" row out of the DA slots (it is an experiment)', () => {
    // A lab half names its continuous-assessment rows "Assessment - N" too, but
    // there they are experiment marks, not digital assignments. The theory half's
    // "Assignment - I" owns DA 1; the lab's "Assessment - 1" must stay unmapped.
    const tableFor = (assessments: string[][]) =>
      `<table class="customTable-level1"><tr><th>S.No</th><th>Title</th><th>Max</th><th>Wt%</th><th>Status</th><th>Scored</th><th>Wt Mark</th></tr>` +
      assessments.map((c) => `<tr><td>${c.join('</td><td>')}</td></tr>`).join('') + '</table>';
    const html = `<html><body><table class="customTable">` +
      `<tr><td>1</td><td>1001</td><td>BAEEE204</td><td>EMFT</td><td>ETH</td><td>REG</td><td>Dr. Y</td><td>D1</td><td>Theory</td></tr>` +
      `<tr><td colspan="9">${tableFor([
        ['1', 'Assignment - I', '5', '2.5', 'Evaluated', '4', '2'],
      ])}</td></tr>` +
      `<tr><td>2</td><td>1002</td><td>BAEEE204</td><td>EMFT Lab</td><td>ELA</td><td>REG</td><td>Dr. Y</td><td>L31</td><td>Lab</td></tr>` +
      `<tr><td colspan="9">${tableFor([
        ['1', 'Assessment - 1', '2', '1', 'Evaluated', '2', '1'],
      ])}</td></tr>` +
      `</table></body></html>`;
    const [r] = parseMarksHtml(html);
    expect(r.da1).toMatchObject({ title: 'Assignment - I', scored: 4 });
    expect(r.extraComponents!.map((c) => c.title)).toContain('Assessment - 1');
  });
});

describe('parseExamsHtml', () => {
  it('parses exam rows and normalizes dates and exam types', () => {
    const exams = parseExamsHtml(examsHtml);
    expect(exams).toHaveLength(3);
    expect(exams[0]).toMatchObject({ courseCode: 'CSE2001', examType: 'CAT 1', date: '2026-08-18', venue: 'SJT 402' });
    expect(exams[1].date).toBe('2026-08-19');
    expect(exams[2]).toMatchObject({ examType: 'FAT', date: '2026-09-21' });
  });

  it('returns [] for malformed HTML', () => {
    expect(parseExamsHtml(examsMalformedHtml)).toEqual([]);
  });
});

describe('parseSemestersHtml', () => {
  it('parses semester options and marks the selected one as current', () => {
    const sems = parseSemestersHtml(semestersHtml);
    expect(sems).toHaveLength(3);
    expect(sems[0]).toMatchObject({ id: 'CH2025261', name: 'Winter Semester 2025-26', isCurrent: true });
    expect(sems[1].isCurrent).toBe(false);
  });

  it('returns [] (never fabricated) when the select is missing', () => {
    const outcome = parseSemestersHtml(semestersMissingHtml, true);
    expect(outcome.data).toEqual([]);
    expect(outcome.warnings.some((w) => w.code === 'no-semester-select')).toBe(true);
  });
});

describe('parseAssignmentsHtml', () => {
  it('parses assignment rows with status mapping', () => {
    const tasks = parseAssignmentsHtml(assignmentsHtml);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toMatchObject({ courseCode: 'CSE2001', status: 'Pending', weightage: 10, dueDate: '2026-08-18' });
    expect(tasks[1].status).toBe('Submitted');
  });

  it('returns [] when the page shape does not match', () => {
    expect(parseAssignmentsHtml(assignmentsMissingHtml)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// REAL-SHAPE fixtures: shapes from the current Chennai portal, as documented by
// the live-tested (MIT) VtopMCP reference. These parsers remain UNVERIFIED
// until an authenticated live pass captures sanitized real HTML.
// ---------------------------------------------------------------------------

describe('parseAttendanceHtml (real shape)', () => {
  it('parses table#getStudentDetails with mapped columns', () => {
    const rows = parseAttendanceHtml(attendanceRealHtml);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      courseCode: 'CSE2001',
      courseTitle: 'Data Structures and Algorithms',
      courseType: 'ETH',
      slot: 'A1+TA1',
      attended: 28,
      totalHeld: 32,
      percentage: 87.5,
    });
    expect(rows[2].category).toBe('Lab');
  });

  it('reports session expiry when VTOP returns a session-expired page', () => {
    const outcome = parseAttendanceHtml(
      '<html><body><div id="sessionExpireCheckForm">Session expired. Please login again.</div></body></html>',
      true
    );
    expect(outcome.structuralMismatch).toBe(true);
    expect(outcome.warnings.some((w) => w.code === 'session-expired')).toBe(true);
  });
});

describe('parseTimetableHtml (real shape)', () => {
  it('merges the positional course list with the Chennai slot map (faculty + real times)', () => {
    const slots = parseTimetableHtml(timetableRealHtml);
    // A1 → Mon 08:00–08:50 + Wed 08:55–09:45; D1 → Mon 09:50–10:40 + Thu 08:00–08:50; L31 → Mon 14:00–14:50
    expect(slots).toHaveLength(5);
    const theory = slots.find((s) => s.courseCode === 'BCSE302L' && s.day === 'Monday')!;
    expect(theory).toMatchObject({
      day: 'Monday',
      slot: 'A1',
      courseTitle: 'Digital Electronics',
      venue: 'AB1 205',
      startTime: '08:00',
      endTime: '08:50',
      courseType: 'ETH',
      facultyName: 'Dr. R. Srinivasan',
    });
    const second = slots.find((s) => s.courseCode === 'BCSE204L')!;
    expect(second).toMatchObject({ slot: 'D1', day: 'Monday', startTime: '09:50', endTime: '10:40', venue: 'AB2 101' });
    const lab = slots.find((s) => s.courseCode === 'BCSE302P')!;
    expect(lab).toMatchObject({ slot: 'L31', startTime: '14:00', endTime: '14:50', venue: 'TT 302', courseType: 'ELA' });
  });

  it('falls back to the course list (no grid) without inventing times', () => {
    const html = `<!doctype html><html><body>
      <div id="studentDetailsList"><table>
        <tr><th>Course</th><th>L T P J C</th><th>Slot</th><th>Faculty</th></tr>
        <tr><td>BMAT101L - Calculus(ETH)</td><td>3 1 0 0 4</td><td>C1+C2-SJT 111</td><td>Dr. N. Kumar</td></tr>
      </table></div>
    </body></html>`;
    const outcome = parseTimetableHtml(html, true);
    // C1 meets Mon 08:00 + Wed 08:55; C2 meets Mon 09:50 + Wed 09:50 → 4 meetings.
    expect(outcome.data).toHaveLength(4);
    expect(outcome.warnings.some((w) => w.code === 'grid-absent')).toBe(true);
    expect(outcome.data[0].courseCode).toBe('BMAT101L');
  });

  it('combines a two-slot lab (L31+L32) into ONE 100-minute session', () => {
    const slots = parseTimetableHtml(timetableRealTwoSlotLabHtml);
    // Theory A1 → 2 meetings (Mon + Wed); lab L31+L32 → 1 combined session (Mon).
    expect(slots).toHaveLength(3);
    const theory = slots.filter((s) => s.courseCode === 'BCSE301L');
    expect(theory).toHaveLength(2);
    for (const t of theory) {
      expect(t.courseType).toBe('ETH');
      expect(t.startTime).toBe(t.day === 'Monday' ? '08:00' : '08:55');
      expect(t.endTime).toBe(t.day === 'Monday' ? '08:50' : '09:45');
    }
    const lab = slots.filter((s) => s.courseCode === 'BCSE302P');
    expect(lab).toHaveLength(1); // ONE combined session, not two classes
    expect(lab[0]).toMatchObject({
      day: 'Monday',
      slot: 'L31+L32',
      courseType: 'ELA',
      startTime: '14:00',
      endTime: '15:40', // 2 consecutive periods combined
      venue: 'TT 302',
    });
  });
});

describe('parseMarksHtml (real shape)', () => {
  it('parses the customTable + customTable-level1 shape (<output> cells), AB -> Pending, FAT captured', () => {
    const records = parseMarksHtml(marksRealHtml);
    expect(records).toHaveLength(2);
    const cse2001 = records.find((r) => r.courseCode === 'CSE2001')!;
    expect(cse2001.courseTitle).toBe('Data Structures and Algorithms');
    expect(cse2001.cat1).toMatchObject({ scored: 42.5, maxMarks: 50, weightageMax: 15, status: 'Evaluated' });
    expect(cse2001.cat1.weightageScored).toBeCloseTo(12.75, 2);
    expect(cse2001.cat2).toMatchObject({ scored: 0, status: 'Pending' });
    expect(cse2001.da1.weightageScored).toBeCloseTo(4.75, 2);
    expect(cse2001.quiz.weightageScored).toBeCloseTo(9, 2);
    expect(cse2001.fat).toMatchObject({ maxMarks: 100, scored: 0, weightageMax: 50, status: 'Pending' });
    const cse2004 = records.find((r) => r.courseCode === 'CSE2004')!;
    expect(cse2004.cat2).toMatchObject({ scored: 44, status: 'Evaluated' });
  });
});

describe('parseExamsHtml (real shape)', () => {
  it('parses the 13-column colspan exam-type schedule (code/title/slot/date/time/venue/seat)', () => {
    const exams = parseExamsHtml(examsRealHtml);
    expect(exams).toHaveLength(3);
    expect(exams[0]).toMatchObject({
      examType: 'CAT 1',
      courseCode: 'CSE2001',
      courseTitle: 'Data Structures and Algorithms',
      slot: 'A1',
      date: '2026-08-18',
      time: '09:15 AM - 10:00 AM - 11:30 AM',
      venue: 'AB1-402',
      seatNo: 'B-12',
    });
    expect(exams[1]).toMatchObject({ slot: 'D1', courseCode: 'CSE2004', venue: 'AB2-310' });
    expect(exams[2]).toMatchObject({ examType: 'FAT', courseCode: 'BCSE302L', date: '2026-09-21', seatNo: 'A-27' });
  });
});

describe('parseStudentProfileHtml (real shape)', () => {
  it('reads regno from the hidden input and pairs label/value cells', () => {
    const outcome = parseStudentProfileHtml(profileRealHtml, true);
    expect(outcome.structuralMismatch).toBe(false);
    expect(outcome.data).toMatchObject({
      registrationNo: '23BCE0000',
      name: 'Aarav R',
      program: 'UG',
      school: 'SCOPE',
    });
    // Regression: VTOP's "Branch / Group Studied" is the Class-XII group, not
    // the academic branch. It must land in `groupStudied` and leave `branch`
    // empty instead of labelling every course screen with "PCM".
    expect(outcome.data.groupStudied).toBe('PCM');
    expect(outcome.data.branch).toBe('');
  });

  it('never invents a degree name when VTOP omits the Programme row', () => {
    // The old parser defaulted `program` to 'B.Tech', which the UI then showed
    // as fact for PG students and for any page VTOP changed.
    const noProgram = profileRealHtml.replace('<tr><td>Programme</td><td>UG</td></tr>', '');
    expect(parseStudentProfileHtml(noProgram).program).toBe('');
  });

  it('reads a genuine Branch row without disturbing the +2 group', () => {
    const html = profileRealHtml.replace(
      '<tr><td>School</td>',
      '<tr><td>Branch</td><td>Electrical and Electronics Engineering</td></tr><tr><td>School</td>',
    );
    const profile = parseStudentProfileHtml(html);
    expect(profile.branch).toBe('Electrical and Electronics Engineering');
    expect(profile.groupStudied).toBe('PCM');
  });

  it('preserves an inline VTOP student photo when the authenticated page embeds one', () => {
    // Real-photo-sized payload: the floor exists to reject UI icons, not labels.
    const pngPayload = 'iVBORw0KGgo' + 'A'.repeat(40_000);
    const html = `${profileRealHtml.replace('</body>', '')}<img id="studentPhoto" alt="Student photo" src="data:image/png;base64,${pngPayload}"></body></html>`;
    expect(parseStudentProfileHtml(html).profilePhotoDataUrl).toBe(`data:image/png;base64,${pngPayload}`);
  });

  it('preserves a bare unlabeled inline photo large enough to be a photo, not a UI icon', () => {
    const bigPhoto = `data:image/jpeg;base64,${'A'.repeat(40_000)}`;
    const html = `${profileRealHtml.replace('</body>', '')}<img src="${bigPhoto}"></body></html>`;
    expect(parseStudentProfileHtml(html).profilePhotoDataUrl).toBe(bigPhoto);
  });

  it('accepts VTOP\'s real "data:null;base64" MIME and normalizes it to a renderable image', () => {
    // A real JPEG starts /9j/ in base64; VTOP mislabels the MIME as null.
    const jpegPayload = '/9j/' + 'A'.repeat(40_000);
    const html = `${profileRealHtml.replace('</body>', '')}<img src="data:null;base64,${jpegPayload}"></body></html>`;
    expect(parseStudentProfileHtml(html).profilePhotoDataUrl).toBe(`data:image/jpeg;base64,${jpegPayload}`);
  });

  it('ignores unrelated images (logos, icons) as photo sources', () => {
    const html = `${profileRealHtml.replace('</body>', '')}<img alt="VIT logo" src="/vtop/assets/img/logo.png"></body></html>`;
    expect(parseStudentProfileHtml(html).profilePhotoDataUrl).toBeUndefined();
  });

  it('never treats an http(s) src as a browser-ready photo (session-scoped fetch is gateway-only)', () => {
    // The client parser only accepts data URIs; URL sources are resolved
    // server-side (vtop-gateway photo.ts) and arrive as data URIs.
    const html = `${profileRealHtml.replace('</body>', '')}<img id="studentPhoto" alt="Student photo" src="/vtop/assets/profile/photo.jpg"></body></html>`;
    expect(parseStudentProfileHtml(html).profilePhotoDataUrl).toBeUndefined();
  });

  it('rejects an oversized inline photo instead of caching it', () => {
    const bigSrc = `data:image/png;base64,${'A'.repeat(2_500_001)}`;
    const html = `${profileRealHtml.replace('</body>', '')}<img id="studentPhoto" alt="Student photo" src="${bigSrc}"></body></html>`;
    expect(parseStudentProfileHtml(html).profilePhotoDataUrl).toBeUndefined();
  });
});

describe('parseStudentProfileHtml', () => {
  it('extracts profile fields and validates the registration number', () => {
    const outcome = parseStudentProfileHtml(profileHtml, true);
    expect(outcome.structuralMismatch).toBe(false);
    expect(outcome.data).toMatchObject({
      registrationNo: '23BCE0000',
      name: 'Aarav',
      branch: 'Computer Science & Engineering',
      cgpa: 8.92,
      proctorName: 'Dr. R. Ramanathan',
    });
    // Regression: proctor contact must come from PROCTOR-prefixed labels only.
    // The student's own Email/Mobile Number block appears first on the page and
    // used to be stored as the proctor's via the generic fallback patterns.
    expect(outcome.data.proctorEmail).toBe('faculty.name@vit.ac.in');
    expect(outcome.data.proctorMobile).toBe('+91 98765 43210');
    expect(outcome.data.proctorEmail).not.toBe('student.name2025@vitstudent.ac.in');
    expect(outcome.data.proctorMobile).not.toBe('9876543210');
  });

  it('flags structural mismatch when no valid reg no exists', () => {
    const outcome = parseStudentProfileHtml(profileMalformedHtml, true);
    expect(outcome.structuralMismatch).toBe(true);
    expect(outcome.warnings.some((w) => w.code === 'no-valid-regno')).toBe(true);
  });

  it('flags session expiry on a login page', () => {
    const outcome = parseStudentProfileHtml(loginPageHtml, true);
    expect(outcome.structuralMismatch).toBe(true);
    expect(outcome.warnings.some((w) => w.code === 'session-expired')).toBe(true);
  });
});

describe('timetable parser tolerates VTOP dash and slot variants', () => {
  const cell = (text: string) => `<td>${text}</td>`;
  const row = (cells: string[]) => `<tr>${cells.join('')}</tr>`;
  const timetableWith = (timeCell: string, slotCell: string, venueCell: string) => `<!doctype html>
  <html><body><table>
    ${row([cell('SLOT'), cell('DAY'), cell('TIME'), cell('SLOT'), cell('COURSE CODE'), cell('COURSE TITLE'), cell('FACULTY'), cell('VENUE')])}
    ${row([cell(slotCell), cell('MON'), cell(timeCell), cell(slotCell), cell('CSE2001'), cell('Data Structures and Algorithms'), cell('Dr. Vasudevan'), cell(venueCell)])}
  </table></body></html>`;

  it('splits an en-dash time range into start and end', () => {
    const slots = parseTimetableHtml(timetableWith('8:00 AM – 8:50 AM', 'A1', 'SJT 204'));
    expect(slots[0]).toMatchObject({ startTime: '08:00', endTime: '08:50' });
  });

  it('splits an em-dash and a plain hyphen time range the same way', () => {
    const em = parseTimetableHtml(timetableWith('8:00 AM — 8:50 AM', 'A1', 'SJT 204'));
    const hyphen = parseTimetableHtml(timetableWith('8:00 AM - 8:50 AM', 'A1', 'SJT 204'));
    expect(em[0]).toMatchObject({ startTime: '08:00', endTime: '08:50' });
    expect(hyphen[0]).toMatchObject({ startTime: '08:00', endTime: '08:50' });
  });

  it('resolves a combined "L31 + L32" lab cell against its first token', () => {
    // No TIME cell: the slot map must still place the class, keyed on L31.
    const slots = parseTimetableHtml(timetableWith('', 'L31 + L32', 'TT 302'));
    expect(slots.length).toBeGreaterThan(0);
    expect(slots[0].slot.replace(/\s/g, '')).toContain('L31');
    expect(slots[0].startTime).toBe('14:00');
    expect(slots[0].endTime).toBe('14:50');
  });

  it('reads a day/slot-only grid whose times use en-dashes', () => {
    const slots = parseTimetableHtml(timetableWith('', 'A1', 'SJT 204'));
    expect(slots[0]).toMatchObject({ startTime: '08:00', endTime: '08:50' });
  });

  it('does not invent SJT as the building for an unmapped venue', () => {
    const slots = parseTimetableHtml(timetableWith('8:00 AM - 8:50 AM', 'A1', 'CCE Seminar Hall'));
    expect(slots[0].building).toBe('');
  });
});

describe('parseExamsHtml — exam type is read, never assumed', () => {
  /** VTOP groups a schedule under one full-width heading per exam section. */
  const grouped = (heading: string) => `<!doctype html>
<html><body>
<table class="table customTable table-bordered">
  <tr class="tableHeader"><th>S.No</th><th>Course Code</th><th>Course Title</th><th>Class Type</th><th>Class Id</th><th>Slot</th><th>Exam Date</th><th>Session</th><th>Reporting Time</th><th>Exam Time</th><th>Venue</th><th>Seat Location</th><th>Seat No</th></tr>
  <tr><td colspan="13">${heading}</td></tr>
  <tr class="tableContent"><td>1</td><td>CSE2001</td><td>Data Structures and Algorithms</td><td>ETH</td><td>CH202627010062</td><td>A1</td><td>18-Aug-2026</td><td>AN</td><td>09:15 AM</td><td>10:00 AM - 11:30 AM</td><td>AB1-402</td><td>AB1</td><td>B-12</td></tr>
</table>
</body></html>`;

  it('reads the types VTOP actually writes', () => {
    expect(parseExamsHtml(grouped('CAT 1'))[0].examType).toBe('CAT 1');
    expect(parseExamsHtml(grouped('CAT-2'))[0].examType).toBe('CAT 2');
    expect(parseExamsHtml(grouped('FAT EXAM'))[0].examType).toBe('FAT');
    expect(parseExamsHtml(grouped('LAB FAT'))[0].examType).toBe('Lab FAT');
  });

  it('says Other for a heading it cannot classify instead of guessing FAT', () => {
    // The old default was 'FAT', which put every unknown section on the final
    // exam filter and made the Exams tab claim a Final Assessment VTOP never
    // announced.
    expect(parseExamsHtml(grouped('Compre Examination'))[0].examType).toBe('Other');
    expect(parseExamsHtml(grouped('Re-Allotment Test'))[0].examType).toBe('Other');
  });
});
