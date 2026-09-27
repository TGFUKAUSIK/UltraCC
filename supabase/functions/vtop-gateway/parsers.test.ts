/**
 * Gateway parser tests — the strict parsers in parsers.ts (the LIVE parsing
 * path: gateway HTML -> typed data). Run against the same real-shape fixtures
 * as the client DOMParser suite so the two implementations stay in sync.
 *
 * Structural mismatches must THROW ParseError (the gateway answers
 * PARSE_FAILED) instead of silently returning empty/fabricated data; pages
 * that explicitly say "no data" are legitimate empty states -> [].
 */

import { describe, it, expect } from 'vitest';
import {
  cleanCourseTitle,
  ParseError,
  parseAttendanceHtml,
  parseTimetableHtml,
  parseMarksHtml,
  marksDiagnostic,
  parseExamsHtml,
  parseProfileHtml,
  extractProfilePhotoSource,
  parseSemestersHtml,
  parseGradeSummaryHtml,
  parseCgpaCreditsHtml,
  parseProctorHtml,
  parseAttendanceDetailRefs,
  parseAttendanceDetail,
  parseSemesterGradesHtml,
  parseGradeHistoryHtml,
  parseCalendarMonths,
  parseAcademicCalendar,
  parseCurriculumProgressHtml,
  parseArrearSemesters,
  parseArrearHtml,
  parseCircularsHtml,
  specialExamSemesters,
  parseExamTableRows,
  parseRefatCourses,
  parseCompreInfo,
  parseHeadingText,
  parsePaymentsHtml,
  parseCredentialsHtml,
  parseTransportHtml,
  parseSapInfoHtml,
  parsePaymentReceiptsHtml,
  parseEmployeeSearchHtml,
  parseDaClassOptions,
  parseDaAssignmentsHtml,
  parseBankInfoHtml,
  parseBiometricInfoHtml,
  parseProctorMessagesHtml,
  parseLoginHistoryHtml,
  parseClassMessagesHtml,
  parseHodDeanHtml,
  parseWalletHtml,
  parseExtraCurricularHtml,
  isLoginOrExpiredPage,
  normalizeDate,
} from './parsers';
import {
  attendanceRealHtml,
  attendanceReorderedHtml,
  attendanceMalformedHtml,
  timetableRealHtml,
  timetableMalformedHtml,
  marksRealHtml,
  marksFixedContainerHtml,
  marksMalformedHtml,
  examsRealHtml,
  examsChennaiNoCodeHtml,
  examsMalformedHtml,
  profileRealHtml,
  semestersHtml,
  cgpaCreditsHtml,
  proctorHtml,
  semesterGradesHtml,
  gradeHistoryHtml,
  loginPageHtml,
} from '../../../src/lib/vtop/__fixtures__/index';

describe('gateway parseAttendanceHtml', () => {
  it('parses the real #getStudentDetails shape (header-driven)', () => {
    const records = parseAttendanceHtml(attendanceRealHtml);
    expect(records).toHaveLength(3);
    const dsa = records[0];
    expect(dsa).toMatchObject({
      courseCode: 'CSE2001',
      courseTitle: 'Data Structures and Algorithms',
      courseType: 'ETH',
      slot: 'A1+TA1',
      attended: 28,
      totalHeld: 32,
      percentage: 87.5,
      category: 'Theory',
    });
    const lab = records[2];
    expect(lab.courseCode).toBe('CSE2001L');
    expect(lab.category).toBe('Lab');
    expect(lab.courseType).toBe('ELA');
  });

  it('handles reordered columns and a missing percentage (recomputed, never fabricated)', () => {
    const records = parseAttendanceHtml(attendanceReorderedHtml);
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ courseCode: 'CSE2008', attended: 27, totalHeld: 30, percentage: 90 });
    // Percentage cell was "—" -> recomputed 25/30 = 83.3
    expect(records[1]).toMatchObject({ courseCode: 'EEE1001', percentage: 83.3 });
  });

  it('returns [] for explicit no-data pages and login pages', () => {
    expect(parseAttendanceHtml(attendanceMalformedHtml)).toEqual([]); // "No attendance data available..."
    expect(parseAttendanceHtml(loginPageHtml)).toEqual([]);
  });

  it('throws ParseError on an unexpected page structure (never silently empty)', () => {
    expect(() => parseAttendanceHtml(marksRealHtml)).toThrow(ParseError);
  });
});

describe('gateway parseTimetableHtml', () => {
  it('builds the schedule from the course list + Chennai slot map (faculty + title + real times)', () => {
    const slots = parseTimetableHtml(timetableRealHtml);
    // A1 -> Mon 08:00 + Wed 08:55; D1 -> Mon 09:50 + Thu 08:00; L31 -> Mon 14:00
    expect(slots).toHaveLength(5);

    const monTheory = slots[0];
    expect(monTheory).toMatchObject({
      day: 'Monday',
      slot: 'A1',
      courseCode: 'BCSE302L',
      courseTitle: 'Digital Electronics',
      facultyName: 'Dr. R. Srinivasan',
      venue: 'AB1-205',
      startTime: '08:00',
      endTime: '08:50',
      courseType: 'ELA',
      // Credits parsed from the LTPJC column ("2 0 0 0 4" -> 4).
      credits: 4,
    });
    // Lab course carries its own LTPJC credits ("0 0 0 2 1" -> 1).
    expect(slots.find((s) => s.courseCode === 'BCSE302P')).toMatchObject({ credits: 1 });
    // Same course's second weekly meeting (Wed 08:55–09:45).
    const wedTheory = slots.find((s) => s.day === 'Wednesday' && s.courseCode === 'BCSE302L');
    expect(wedTheory).toMatchObject({ startTime: '08:55', endTime: '09:45' });

    const os = slots.find((s) => s.courseCode === 'BCSE204L' && s.day === 'Monday');
    expect(os).toMatchObject({ slot: 'D1', courseTitle: 'Operating Systems', startTime: '09:50', endTime: '10:40' });

    const lab = slots.find((s) => s.courseCode === 'BCSE302P');
    expect(lab).toMatchObject({
      day: 'Monday',
      slot: 'L31',
      courseTitle: 'Digital Electronics Lab',
      courseType: 'ELA',
      startTime: '14:00',
      endTime: '14:50',
      venue: 'TT-302',
      facultyName: 'Dr. R. Srinivasan',
    });
  });

  it('returns [] for no-data / login pages', () => {
    expect(parseTimetableHtml(timetableMalformedHtml)).toEqual([]);
    expect(parseTimetableHtml(loginPageHtml)).toEqual([]);
  });

  it('throws ParseError when no timetable structure exists', () => {
    expect(() => parseTimetableHtml('<html><body><p>unrelated page</p></body></html>')).toThrow(ParseError);
  });
});

describe('gateway parseMarksHtml', () => {
  it('parses the real customTable + customTable-level1 shape (<output> cells); AB -> Pending', () => {
    const records = parseMarksHtml(marksRealHtml);
    expect(records).toHaveLength(2);

    const dsa = records[0];
    expect(dsa.courseCode).toBe('CSE2001');
    expect(dsa.courseTitle).toBe('Data Structures and Algorithms');
    expect(dsa.cat1).toMatchObject({ maxMarks: 50, scored: 42.5, weightageMax: 15, status: 'Evaluated' });
    // AB cell -> Pending, scored 0 — never treated as a real 0
    expect(dsa.cat2).toMatchObject({ maxMarks: 50, scored: 0, status: 'Pending' });
    expect(dsa.da1).toMatchObject({ scored: 9.5, weightageMax: 5 });
    expect(dsa.quiz).toMatchObject({ scored: 9, weightageMax: 10 });
    // FAT captured separately (Pending pre-FAT), never into internals
    expect(dsa.fat).toMatchObject({ maxMarks: 100, scored: 0, weightageMax: 50, status: 'Pending' });
    // 42.5/50*15 + 0 + 9.5/10*5 + 10/10*5 + 9/10*10 = 12.75 + 4.75 + 5 + 9 = 31.5
    expect(dsa.totalInternalWeightScored).toBe(31.5);
    expect(dsa.currentEstimatedGrade).toBe('Grade estimate unavailable');
  });

  it('still parses the legacy #fixedTableContainer nested-table shape', () => {
    const records = parseMarksHtml(marksFixedContainerHtml);
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ courseCode: 'CSE2001', cat1: { scored: 42.5, status: 'Evaluated' } });
  });

  it('does not label an entirely pending course as Below C', () => {
    const html = `<html><body><table class="customTable">
      <tr><td>1</td><td>1001</td><td>BCSE4001</td><td>Pending Course</td><td>ETH</td><td>REG</td><td>Dr. X</td><td>A1</td><td>Theory</td></tr>
      <tr><td colspan="9"><table class="customTable-level1">
        <tr><th>S.No</th><th>Title</th><th>Max</th><th>Wt%</th><th>Status</th><th>Scored</th><th>Wt Mark</th></tr>
        <tr><td>1</td><td>Continuous Assessment Test - I</td><td>50</td><td>15</td><td>Pending</td><td></td><td></td></tr>
      </table></td></tr></table></body></html>`;
    const record = parseMarksHtml(html)[0];
    expect(record.currentEstimatedGrade).toBe('Internal marks not available');
  });

  it('returns [] for "no data found" and login pages', () => {
    expect(parseMarksHtml('<html><body>No data found</body></html>')).toEqual([]);
    expect(parseMarksHtml(loginPageHtml)).toEqual([]);
  });

  it('marksDiagnostic reports the assessment titles VTOP actually served (sanitized)', () => {
    const diag = marksDiagnostic(marksRealHtml);
    expect(diag).toHaveLength(2);
    expect(diag[0].courseCode).toBe('CSE2001');
    expect(diag[0].assessments).toEqual(['CAT 1', 'CAT 2', 'DA 1', 'DA 2', 'Quiz', 'FAT']);
    expect(diag[1].assessments).toEqual(['CAT 1', 'CAT 2']);
  });

  it('throws ParseError on unexpected structure instead of fabricating marks', () => {
    expect(() => parseMarksHtml(marksMalformedHtml)).toThrow(ParseError);
    expect(() => parseMarksHtml('<html><body><p>some other page</p></body></html>')).toThrow(ParseError);
  });

  it('maps the FULL-WORD titles the live Chennai portal serves (no short forms)', () => {
    // Real titles from the live portal's marks diagnostic: "Continuous
    // Assessment Test - I", "Assignment - II", "Final Assessment Test" —
    // none of which contain "CAT", "DA" or "FAT" as literals.
    const inner = [
      ['1', 'Assignment - I', '5', '2.5', 'Evaluated', '4', '2'],
      ['2', 'Assignment - II', '5', '2.5', 'Evaluated', '5', '2.5'],
      ['3', 'Continuous Assessment Test - I', '50', '15', 'Evaluated', '42', '12.6'],
      ['4', 'Continuous Assessment Test - II', '50', '15', 'AB', 'AB', ''],
      ['5', 'Quiz - I', '10', '10', 'Evaluated', '8', '8'],
      ['6', 'Final Assessment Test', '100', '50', 'Pending', '', ''],
    ].map((c) => `<tr><td>${c.join('</td><td>')}</td></tr>`).join('');
    const html = `<html><body><table class="customTable">
      <tr><td>1</td><td>1001</td><td>BAEEE102</td><td>Circuit Theory</td><td>ETH</td><td>REG</td><td>Dr. X</td><td>A1</td><td>Theory</td></tr>
      <tr><td colspan="9"><table class="customTable-level1"><tr><th>S.No</th><th>Title</th><th>Max Mark</th><th>Weightage %</th><th>Status</th><th>Scored Mark</th><th>Weightage Mark</th></tr>${inner}</table></td></tr>
    </table></body></html>`;
    const records = parseMarksHtml(html);
    expect(records).toHaveLength(1);
    const r = records[0];
    expect(r.courseCode).toBe('BAEEE102');
    expect(r.cat1).toMatchObject({ maxMarks: 50, scored: 42, weightageMax: 15, status: 'Evaluated' });
    expect(r.cat2).toMatchObject({ maxMarks: 50, scored: 0, status: 'Pending' }); // AB -> Pending
    expect(r.da1).toMatchObject({ maxMarks: 5, scored: 4, status: 'Evaluated' });
    expect(r.da2).toMatchObject({ maxMarks: 5, scored: 5, status: 'Evaluated' });
    expect(r.quiz).toMatchObject({ maxMarks: 10, scored: 8, status: 'Evaluated' });
    expect(r.fat).toMatchObject({ maxMarks: 100, scored: 0, status: 'Pending' });
  });

  it('merges theory + lab assessment tables for the same course into ONE row', () => {
    const tableFor = (assessments: string[][]) =>
      `<table class="customTable-level1"><tr><th>S.No</th><th>Title</th><th>Max</th><th>Wt%</th><th>Status</th><th>Scored</th><th>Wt Mark</th></tr>` +
      assessments.map((c) => `<tr><td>${c.join('</td><td>')}</td></tr>`).join('') + '</table>';
    const html = `<html><body><table class="customTable">
      <tr><td>1</td><td>1001</td><td>BAEEE204</td><td>EMFT</td><td>ETH</td><td>REG</td><td>Dr. Y</td><td>D1</td><td>Theory</td></tr>
      <tr><td colspan="9">${tableFor([
        ['1', 'Assignment - I', '5', '2.5', 'Evaluated', '4', '2'],
        ['2', 'Continuous Assessment Test - I', '50', '15', 'Evaluated', '42', '12.6'],
        ['3', 'Final Assessment Test', '100', '50', 'Pending', '', ''],
      ])}</td></tr>
      <tr><td>2</td><td>1002</td><td>BAEEE204</td><td>EMFT Lab</td><td>ELA</td><td>REG</td><td>Dr. Y</td><td>D1</td><td>Lab</td></tr>
      <tr><td colspan="9">${tableFor([
        ['1', 'Assessment - 1', '2', '1', 'Evaluated', '2', '1'],
        ['2', 'Quiz - I', '10', '10', 'Evaluated', '7', '7'],
        ['3', 'Final Assessment Test', '100', '50', 'Pending', '', ''],
      ])}</td></tr>
    </table></body></html>`;
    const records = parseMarksHtml(html);
    expect(records).toHaveLength(1); // theory + lab merged, not duplicated
    const r = records[0];
    expect(r.courseCode).toBe('BAEEE204');
    expect(r.cat1).toMatchObject({ scored: 42, status: 'Evaluated' });
    expect(r.da1).toMatchObject({ scored: 4, status: 'Evaluated' });
    expect(r.quiz).toMatchObject({ scored: 7, status: 'Evaluated' });
    expect(r.fat).toBeDefined();
  });

  it('maps soft-skill "Assessment - N" to DA N (theory half) and captures DA 3', () => {
    const inner = [
      ['1', 'Assessment - 1', '5', '2.5', 'Evaluated', '4', '2'],
      ['2', 'Assessment - 2', '5', '2.5', 'Evaluated', '5', '2.5'],
      ['3', 'Assessment - 3', '5', '2.5', 'Evaluated', '3', '1.5'],
      ['4', 'Continuous Assessment Test - I', '50', '15', 'Evaluated', '42', '12.6'],
      ['5', 'Quiz - I', '10', '10', 'Evaluated', '8', '8'],
      ['6', 'Final Assessment Test', '100', '50', 'Pending', '', ''],
    ].map((c) => `<tr><td>${c.join('</td><td>')}</td></tr>`).join('');
    const html = `<html><body><table class="customTable">
      <tr><td>1</td><td>1001</td><td>BASTS101</td><td>Soft Skills</td><td>ETH</td><td>REG</td><td>Dr. X</td><td>A1</td><td>Theory</td></tr>
      <tr><td colspan="9"><table class="customTable-level1"><tr><th>S.No</th><th>Title</th><th>Max Mark</th><th>Weightage %</th><th>Status</th><th>Scored Mark</th><th>Weightage Mark</th></tr>${inner}</table></td></tr>
    </table></body></html>`;
    const r = parseMarksHtml(html)[0];
    expect(r.da1).toMatchObject({ maxMarks: 5, scored: 4, status: 'Evaluated' });
    expect(r.da2).toMatchObject({ maxMarks: 5, scored: 5, status: 'Evaluated' });
    expect(r.da3).toMatchObject({ maxMarks: 5, scored: 3, status: 'Evaluated' });
    // VTOP's own Weightage Mark wins: 2 + 2.5 + 1.5 + 12.6 + 8 = 26.6
    expect(r.totalInternalWeightScored).toBe(26.6);
  });

  it('prefers VTOP\'s own Weightage Mark over scored/max × weightage', () => {
    const inner = [['1', 'CAT 1', '50', '15', 'Evaluated', '40', '10']]
      .map((c) => `<tr><td>${c.join('</td><td>')}</td></tr>`).join('');
    const html = `<html><body><table class="customTable">
      <tr><td>1</td><td>1001</td><td>BCSE2001</td><td>Course</td><td>ETH</td><td>REG</td><td>Dr. X</td><td>A1</td><td>Theory</td></tr>
      <tr><td colspan="9"><table class="customTable-level1"><tr><th>S.No</th><th>Title</th><th>Max Mark</th><th>Weightage %</th><th>Status</th><th>Scored Mark</th><th>Weightage Mark</th></tr>${inner}</table></td></tr>
    </table></body></html>`;
    const r = parseMarksHtml(html)[0];
    // computed 40/50 × 15 = 12; VTOP published 10, which is what counts.
    expect(r.cat1.weightageScored).toBe(10);
    expect(r.totalInternalWeightScored).toBe(10);
  });

  it('keeps a lab "Assessment - N" in extraComponents (not a DA)', () => {
    const inner = [['1', 'Assessment - 1', '2', '1', 'Evaluated', '2', '1']]
      .map((c) => `<tr><td>${c.join('</td><td>')}</td></tr>`).join('');
    const html = `<html><body><table class="customTable">
      <tr><td>1</td><td>1001</td><td>BAEEE204</td><td>EMFT Lab</td><td>ELA</td><td>REG</td><td>Dr. Y</td><td>L31</td><td>Lab</td></tr>
      <tr><td colspan="9"><table class="customTable-level1"><tr><th>S.No</th><th>Title</th><th>Max Mark</th><th>Weightage %</th><th>Status</th><th>Scored Mark</th><th>Weightage Mark</th></tr>${inner}</table></td></tr>
    </table></body></html>`;
    const r = parseMarksHtml(html)[0];
    expect(r.da1.status).toBe('Pending');
    expect(r.da1.maxMarks).toBe(0);
    expect(r.extraComponents).toHaveLength(1);
    expect(r.extraComponents![0]).toMatchObject({ title: 'Assessment - 1', maxMarks: 2, scored: 2, status: 'Evaluated' });
  });
});

describe('gateway cleanCourseTitle', () => {
  it('strips the live-cache artifact shapes VTOP serves (2026-09-13 defect)', () => {
    expect(cleanCourseTitle('- Analog Electronics ( Embedded Theory )')).toBe('Analog Electronics');
    expect(cleanCourseTitle('BAEEE103 - Analog Electronics ( Embedded Theory )', 'BAEEE103')).toBe('Analog Electronics');
    expect(cleanCourseTitle('Analog Electronics')).toBe('Analog Electronics');
    expect(cleanCourseTitle('', 'CSE2001')).toBe('');
  });
});

describe('gateway parseExamsHtml', () => {
  it('parses the real 13-column customTable schedule with course codes + titles', () => {
    const exams = parseExamsHtml(examsRealHtml);
    expect(exams).toHaveLength(3);
    expect(exams[0]).toMatchObject({
      examType: 'CAT 1',
      slot: 'A1',
      courseCode: 'CSE2001',
      courseTitle: 'Data Structures and Algorithms',
      date: '2026-08-18',
      time: '10:00 AM - 11:30 AM',
      venue: 'AB1-402',
      seatNo: 'B-12',
    });
    expect(exams[1]).toMatchObject({ examType: 'CAT 1', slot: 'D1', courseCode: 'CSE2004', date: '2026-08-20' });
    expect(exams[2]).toMatchObject({ examType: 'FAT', slot: 'A1', courseCode: 'BCSE302L', date: '2026-09-21', seatNo: 'A-27' });
  });

  it('never reads the 13-cell tableHeader row as data (no "Slot Slot" mis-parse)', () => {
    const exams = parseExamsHtml(examsRealHtml);
    for (const e of exams) {
      expect(e.courseCode).not.toMatch(/course|slot|seat|date|time/i);
      expect(e.slot).not.toMatch(/slot|date|time|venue|seat/i);
    }
  });

  it('parses the real Chennai no-course-code shape header-driven (VtopMCP live shape)', () => {
    const exams = parseExamsHtml(examsChennaiNoCodeHtml);
    expect(exams).toHaveLength(3);
    expect(exams[0]).toMatchObject({
      examType: 'CAT 1',
      slot: 'A1',
      courseCode: '',
      courseTitle: '',
      date: '2026-08-18',
      time: '10:00 AM - 11:30 AM',
      venue: 'AB1-402',
      seatNo: 'B-12',
    });
    expect(exams[1]).toMatchObject({ examType: 'CAT 1', slot: 'D1', date: '2026-08-20' });
    expect(exams[2]).toMatchObject({ examType: 'FAT', slot: 'A1', date: '2026-09-21', seatNo: 'A-27' });
    // Header text must never leak into a field (the classic mis-parse).
    for (const e of exams) {
      expect(e.date).not.toMatch(/exam|reporting|seat|venue|slot/i);
      expect(e.time).not.toMatch(/reporting/i);
      expect(e.slot).not.toMatch(/slot|date|time|venue|seat/i);
    }
  });

  it('drops shifted/garbage rows instead of fabricating exams', () => {
    // A row whose "date" cell holds a slot value and whose slot cell holds a
    // class id (old mis-parse pattern) must be rejected — no date, no slot.
    const garbage = `<html><body>
      <table class="table customTable table-bordered">
        <tr class="tableHeader"><th>S.No</th><th>Slot</th><th>Exam Date</th><th>Session</th><th>Reporting Time</th><th>Exam Time</th><th>Venue</th><th>Seat Location</th><th>Seat No</th></tr>
        <tr><td colspan="9">CAT 1</td></tr>
        <tr class="tableContent"><td>1</td><td>CH2026270100062</td><td>B1+TB1</td><td>FN2</td><td>09:30 AM</td><td>09:30 AM - 10:30 AM</td><td>AB1-605A</td><td>AB1</td><td>S-4</td></tr>
        <tr class="tableContent"><td>2</td><td>A1</td><td>18-Aug-2026</td><td>AN</td><td>09:15 AM</td><td>10:00 AM - 11:30 AM</td><td>AB1-402</td><td>AB1</td><td>B-12</td></tr>
      </table>
    </body></html>`;
    const exams = parseExamsHtml(garbage);
    // Only the well-formed row survives; the shifted one is dropped.
    expect(exams).toHaveLength(1);
    expect(exams[0]).toMatchObject({ slot: 'A1', date: '2026-08-18' });
  });

  it('returns [] for "not found" / login pages', () => {
    expect(parseExamsHtml('<html><body>No exam schedule found</body></html>')).toEqual([]);
    expect(parseExamsHtml(loginPageHtml)).toEqual([]);
  });

  it('throws ParseError when the schedule table shape is absent', () => {
    expect(() => parseExamsHtml(examsMalformedHtml)).toThrow(ParseError);
  });
});

describe('gateway parseProfileHtml', () => {
  it('reads the hidden regno input and label/value pairs (first-match)', () => {
    const profile = parseProfileHtml(profileRealHtml);
    expect(profile).toMatchObject({
      registrationNo: '23BCE1082',
      name: 'Kausik R',
      program: 'UG',
      school: 'SCOPE',
      email: 'kausik.r2023@vitstudent.ac.in',
      mobile: '9876543210',
    });
    // Regression (verified on the live Chennai profile): the only row whose
    // label BEGINS with "Branch" is "Branch / Group Studied", and its value is
    // the Class-XII group. The old /^branch/i pattern stored "PCM" as the
    // student's academic branch, which every screen then printed as their
    // course. It belongs to `groupStudied`, and `branch` stays empty.
    expect(profile.groupStudied).toBe('PCM');
    expect(profile.branch).toBe('');
    // Regression: proctor contact must come from PROCTOR-prefixed labels only.
    // The student's own Email/Mobile block appears FIRST on the page — the old
    // generic fallback patterns stored the student's address as the proctor's.
    expect(profile.proctorEmail).toBe('r.ramanathan@vit.ac.in');
    expect(profile.proctorMobile).toBe('9445500123');
    expect(profile.proctorEmail).not.toBe('kausik.r2023@vitstudent.ac.in');
    expect(profile.proctorMobile).not.toBe('9876543210');
  });

  it('reads a real Branch row when VTOP states one, and still keeps the +2 group separate', () => {
    const both = profileRealHtml
      .replace('<tr><td>Programme</td><td>UG</td></tr>', '<tr><td>Programme</td><td>UG</td></tr>\n    <tr><td>Branch</td><td>Electrical and Electronics Engineering</td></tr>');
    const profile = parseProfileHtml(both);
    expect(profile.branch).toBe('Electrical and Electronics Engineering');
    expect(profile.groupStudied).toBe('PCM');
  });

  it('extracts the VTOP-labelled student photo source without exposing unrelated images', () => {
    const html = '<input name="regno" value="23BCE1082"><img id="studentPhoto" alt="Student photo" src="/vtop/assets/profile/photo.jpg"><img alt="VIT logo" src="/vtop/assets/img/logo.png">';
    expect(extractProfilePhotoSource(html)).toBe('/vtop/assets/profile/photo.jpg');
  });

  it('accepts a bare unlabeled inline data URI large enough to be a photo (Chennai portal shape)', () => {
    // Real photos are tens of KB of base64; UI icons are far below the floor.
    const bigPhoto = `data:image/jpeg;base64,${'A'.repeat(40_000)}`;
    const html = `<input name="regno" value="23BCE1082"><img src="${bigPhoto}"><img alt="VIT logo" src="/vtop/assets/img/logo.png">`;
    expect(extractProfilePhotoSource(html)).toBe(bigPhoto);
  });

  it('accepts VTOP\'s real "data:null;base64" MIME and normalizes it from magic bytes', () => {
    // A real JPEG starts /9j/ in base64. VTOP mislabels it as data:null.
    const jpegPayload = '/9j/' + 'A'.repeat(40_000);
    const html = `<input name="regno" value="23BCE1082"><img src="data:null;base64,${jpegPayload}">`;
    expect(extractProfilePhotoSource(html)).toBe(`data:image/jpeg;base64,${jpegPayload}`);
  });

  it('still ignores small unlabeled data-URI icons below the photo size floor', () => {
    const tinyIcon = 'data:image/png;base64,AAAA';
    const html = `<input name="regno" value="23BCE1082"><img src="${tinyIcon}">`;
    expect(extractProfilePhotoSource(html)).toBeUndefined();
  });

  it('also accepts the legacy label-pair shape with a plausible regno', () => {
    const legacy = '<table><tr><td>Reg No</td><td>23BCE1082</td></tr><tr><td>Student Name</td><td>Kausik</td></tr></table>';
    const profile = parseProfileHtml(legacy);
    expect(profile.registrationNo).toBe('23BCE1082');
    expect(profile.name).toBe('Kausik');
  });

  it('throws ParseError when no plausible registration number exists', () => {
    expect(() => parseProfileHtml('<html><body><p>no profile here</p></body></html>')).toThrow(ParseError);
    expect(() => parseProfileHtml(loginPageHtml)).toThrow(ParseError);
  });
});

describe('gateway parseSemestersHtml', () => {
  it('parses option values; isCurrent only from the selected attribute', () => {
    const semesters = parseSemestersHtml(semestersHtml);
    expect(semesters).toHaveLength(3);
    expect(semesters[0]).toMatchObject({ id: 'CH2025261', name: 'Winter Semester 2025-26', isCurrent: true });
    // "Winter Semester 2026-27" has no selected attribute — must NOT be marked
    // current by text heuristics (that would pick the wrong term).
    expect(semesters[2]).toMatchObject({ id: 'CH2026271', isCurrent: false });
  });

  it('returns [] when no semester select exists', () => {
    expect(parseSemestersHtml('<html><body><p>No active registration</p></body></html>')).toEqual([]);
  });
});

describe('gateway parseGradeSummaryHtml (CGPA + credits)', () => {
  // Real-shape summary table (corroborated by the live-tested VtopMCP
  // client): header row "Credits Registered | Credits Earned | CGPA | ...".
  const gradeHistoryHtml = `<html><body>
    <table class="customTable">
      <tr><th>Course Code</th><th>Credits</th><th>Grade</th></tr>
      <tr><td>BCSE302L</td><td>4</td><td>S</td></tr>
    </table>
    <table class="customTable">
      <tr>
        <td>Credits Registered</td><td>Credits Earned</td><td>CGPA</td><td>S Grades</td><td>A Grades</td>
      </tr>
      <tr>
        <td>172</td><td>78</td><td>8.92</td><td>24</td><td>10</td>
      </tr>
    </table>
  </body></html>`;

  it('reads CGPA + registered/earned credits from the summary table', () => {
    const g = parseGradeSummaryHtml(gradeHistoryHtml);
    expect(g).toEqual({ cgpa: 8.92, creditsRegistered: 172, creditsEarned: 78 });
  });

  it('keeps null for missing values (never fakes 0)', () => {
    const sparse = gradeHistoryHtml.replace('<td>8.92</td>', '<td>-</td>').replace('<td>172</td>', '<td></td>');
    const g = parseGradeSummaryHtml(sparse);
    expect(g.cgpa).toBeNull();
    expect(g.creditsRegistered).toBeNull();
  });

  it('throws ParseError when no summary table exists', () => {
    expect(() => parseGradeSummaryHtml('<html><table><tr><td>x</td></tr></table></html>')).toThrow(ParseError);
  });

  it('throws ParseError on a login page', () => {
    expect(() => parseGradeSummaryHtml(loginPageHtml)).toThrow(ParseError);
  });
});

describe('gateway parseSemesterGradesHtml (doStudentGradeView)', () => {
  it('parses the GPA row + per-course letter grades from the real table-bordered shape', () => {
    const s = parseSemesterGradesHtml(semesterGradesHtml);
    expect(s.gpa).toBe(8.92);
    expect(s.grades).toHaveLength(3);
    expect(s.grades[0]).toMatchObject({
      courseCode: 'CSE2001',
      courseTitle: 'Data Structures and Algorithms',
      courseType: 'ETH',
      grandTotal: 88,
      grade: 'A',
      courseId: 'CH202526010062',
    });
    expect(s.grades[2]).toMatchObject({ courseCode: 'MAT2002', grandTotal: 91, grade: 'S' });
  });

  it('returns an empty result for an explicit no-data page', () => {
    expect(parseSemesterGradesHtml('<html><body>No data found</body></html>')).toEqual({ gpa: null, grades: [] });
  });

  it('throws ParseError on a login page or unexpected structure', () => {
    expect(() => parseSemesterGradesHtml(loginPageHtml)).toThrow(ParseError);
    expect(() => parseSemesterGradesHtml('<html><body><p>unrelated</p></body></html>')).toThrow(ParseError);
  });
});

describe('gateway parseGradeHistoryHtml (StudentGradeHistory)', () => {
  it('parses CGPA summary + grade-count distribution + effective grades', () => {
    const h = parseGradeHistoryHtml(gradeHistoryHtml);
    expect(h.cgpa).toBe(8.92);
    expect(h.creditsRegistered).toBe(172);
    expect(h.creditsEarned).toBe(120);
    expect(h.gradeCounts).toEqual({ S: 10, A: 8, B: 5, C: 2, D: 1, E: 0, F: 0, N: 0 });
    expect(h.effectiveGrades).toHaveLength(4);
    expect(h.effectiveGrades[0]).toMatchObject({
      basketTitle: 'Data Structures and Algorithms',
      courseType: 'ETH',
      creditsEarned: 4,
      grade: 'A',
    });
    expect(h.effectiveGrades[3]).toMatchObject({ courseType: 'ELA', creditsEarned: 1, grade: 'S', distributionType: 'Lab' });
  });

  it('throws ParseError on a login page', () => {
    expect(() => parseGradeHistoryHtml(loginPageHtml)).toThrow(ParseError);
  });
});

describe('gateway parseCgpaCreditsHtml (dashboard endpoint)', () => {
  it('reads Current CGPA + Total/Earned Credits from .list-group-item rows', () => {
    const g = parseCgpaCreditsHtml(cgpaCreditsHtml);
    expect(g).toEqual({ cgpa: 8.92, creditsRegistered: 172, creditsEarned: 78 });
  });

  it('keeps null for missing values (never fakes 0)', () => {
    const sparse = cgpaCreditsHtml.replace('<span>8.92</span>', '<span>-</span>').replace('<span>172</span>', '<span></span>');
    const g = parseCgpaCreditsHtml(sparse);
    expect(g.cgpa).toBeNull();
    expect(g.creditsRegistered).toBeNull();
  });

  it('throws ParseError on a login page', () => {
    expect(() => parseCgpaCreditsHtml(loginPageHtml)).toThrow(ParseError);
  });
});

describe('gateway parseProctorHtml (proctor/viewProctorDetails)', () => {
  it('extracts the proctor name/email/mobile/designation from label/value rows', () => {
    const p = parseProctorHtml(proctorHtml);
    expect(p.name).toBe('Dr. R. Ramanathan');
    expect(p.email).toBe('r.ramanathan@vit.ac.in');
    expect(p.mobile).toBe('9876501234');
    expect(p.designation).toBe('Associate Professor');
  });

  it('returns empty strings when the page is absent (no proctor assigned)', () => {
    expect(parseProctorHtml('<html><body><p>not found</p></body></html>')).toEqual({
      name: '', email: '', mobile: '', designation: '',
    });
    expect(parseProctorHtml(loginPageHtml)).toEqual({ name: '', email: '', mobile: '', designation: '' });
  });
});

describe('gateway OD parsers (processViewAttendanceDetail)', () => {
  // Real shape (corroborated by the live-tested VtopMCP client): the
  // attendance page rows carry onclick="processViewAttendanceDetail('clId','A1')".
  const attendanceWithRefs = `<html><body>
    <table>
      <tr><th>Course Code</th><th>Course Title</th><th>Slot</th><th>View</th></tr>
      <tr>
        <td>BCSE302L</td><td>Digital Electronics</td><td>A1+TA1</td>
        <td><a href="#" onclick="processViewAttendanceDetail('10111','A1')">View</a></td>
      </tr>
      <tr>
        <td>BMAT201L</td><td>Linear Algebra</td><td>B1+TB1</td>
        <td><a href="#" onclick="processViewAttendanceDetail('10122','B1')">View</a></td>
      </tr>
    </table>
  </body></html>`;

  it('extracts per-course detail handles (classId + slot)', () => {
    const refs = parseAttendanceDetailRefs(attendanceWithRefs);
    expect(refs).toHaveLength(2);
    expect(refs[0]).toMatchObject({ courseCode: 'BCSE302L', courseName: 'Digital Electronics', classId: '10111', slot: 'A1' });
    expect(refs[1]).toMatchObject({ courseCode: 'BMAT201L', classId: '10122', slot: 'B1' });
  });

  it('returns [] when the page has no detail views (OD unavailable)', () => {
    expect(parseAttendanceDetailRefs('<html><table><tr><td>x</td></tr></table></html>')).toEqual([]);
  });

  it('counts On Duty rows separately and derives OD hours from timings', () => {
    const detailHtml = `<html><body><table>
      <tr><th>Date</th><th>Day And Timing</th><th>Status</th></tr>
      <tr><td>01-AUG-2026</td><td>14:00-15:40</td><td>On Duty</td></tr>
      <tr><td>03-AUG-2026</td><td>08:00-08:50</td><td>On Duty</td></tr>
      <tr><td>05-AUG-2026</td><td>09:00-09:50</td><td>Present</td></tr>
      <tr><td>07-AUG-2026</td><td>10:00-10:50</td><td>Absent</td></tr>
    </table></body></html>`;
    const c = parseAttendanceDetail(detailHtml);
    // 2-period lab (14:00-15:40) counts as 2 hours; the 50-min slot as 1.
    expect(c).toEqual({ present: 1, absent: 1, onDuty: 2, total: 4, odHours: 3 });
  });

  it('handles 12-hour timings crossing noon without double-counting', () => {
    const detailHtml = `<html><body><table>
      <tr><th>Date</th><th>Day And Timing</th><th>Status</th></tr>
      <tr><td>01-AUG-2026</td><td>11:00 AM - 01:40 PM</td><td>On Duty</td></tr>
    </table></body></html>`;
    const c = parseAttendanceDetail(detailHtml);
    expect(c.odHours).toBe(3); // 160 min / 50 ≈ 3 periods
  });

  it('throws ParseError on a login page', () => {
    expect(() => parseAttendanceDetail(loginPageHtml)).toThrow(ParseError);
  });
});

describe('gateway academic-calendar parsers (3-step flow)', () => {
  it('extracts month tokens + month keys from the getListForSemester response', () => {
    const html = `<html><body>
      <a href="#" onclick="processViewCalendar('01-AUG-2026')">AUG</a>
      <a href="#" onclick="processViewCalendar('01-SEP-2026')">SEP</a>
      <a href="#" onclick="processViewCalendar('01-OCT-2026')">OCT</a>
    </body></html>`;
    const months = parseCalendarMonths(html);
    expect(months).toEqual([
      { token: '01-AUG-2026', monthKey: '2026-08' },
      { token: '01-SEP-2026', monthKey: '2026-09' },
      { token: '01-OCT-2026', monthKey: '2026-10' },
    ]);
  });

  it('deduplicates repeated month tokens', () => {
    const html = `<a onclick="processViewCalendar('01-AUG-2026')"></a><a onclick="processViewCalendar('01-AUG-2026')"></a>`;
    expect(parseCalendarMonths(html)).toHaveLength(1);
  });

  it('marks instructional days with day orders and holidays with labels', () => {
    const html = `<html><body><table class="calendar-table">
      <tr><td><span>1</span><span>Instructional Day</span><span>(Monday Day Order 2)</span></td></tr>
      <tr><td><span>15</span><span>Holiday</span><span>(Independence Day)</span></td></tr>
      <tr><td><span>22</span><span>Instructional Day</span><span>(Saturday Day Order 7)</span></td></tr>
    </table></body></html>`;
    const days = parseAcademicCalendar(html, '2026-08');
    expect(days[0]).toMatchObject({ date: '2026-08-01', instructional: true, dayOrder: 'Day Order 2', label: '' });
    expect(days[1]).toMatchObject({ date: '2026-08-15', instructional: false, dayOrder: null, label: 'Independence Day' });
    expect(days[2]).toMatchObject({ date: '2026-08-22', instructional: true, dayOrder: 'Day Order 7' });
  });

  it('throws ParseError when the calendar page has no table (structure changed)', () => {
    expect(() => parseAcademicCalendar('<html><body><p>no table here</p></body></html>', '2026-08')).toThrow(ParseError);
  });

  it('returns [] for a login/expired page (guard, not a parse error)', () => {
    expect(parseAcademicCalendar(loginPageHtml, '2026-08')).toEqual([]);
  });
});

describe('gateway curriculum-progress parser (grade-history page)', () => {
  const curriculumHtml = `<html><body>
    <table>
      <tr><th>Curriculum Details</th></tr>
      <tr><td>University Core</td><td>60</td><td>48</td></tr>
      <tr><td>School Core</td><td>40</td><td>24</td></tr>
      <tr><td>Total Credits</td><td>160</td><td>96</td></tr>
    </table>
    <table>
      <tr><th>Basket Details</th></tr>
      <tr><td>Elective Basket</td><td>FC</td><td>24</td><td>12</td></tr>
    </table>
    <table>
      <tr><td>CGPA</td><td>: 8.92</td></tr>
      <tr><td>Registered Credits</td><td>: 98</td></tr>
      <tr><td>S : 6</td><td>A : 14</td><td>B : 5</td><td>C : 1</td><td>F : 0</td></tr>
    </table>
  </body></html>`;

  it('parses totals, distribution types, baskets and grade counts', () => {
    const p = parseCurriculumProgressHtml(curriculumHtml);
    expect(p.totals).toMatchObject({ creditsRequired: 160, creditsEarned: 96, creditsRegistered: 98, cgpa: 8.92 });
    expect(p.distributionTypes).toContainEqual({ name: 'University Core', required: 60, earned: 48 });
    expect(p.baskets[0]).toMatchObject({ name: 'Elective Basket', distributionType: 'FC', required: 24, earned: 12 });
    expect(p.gradeCounts).toMatchObject({ S: 6, A: 14, B: 5, C: 1, F: 0 });
  });

  it('returns zeroed structure for a login page without throwing', () => {
    const p = parseCurriculumProgressHtml(loginPageHtml);
    expect(p.totals.creditsRequired).toBe(0);
    expect(p.totals.cgpa).toBeNull();
    expect(p.distributionTypes).toEqual([]);
  });
});

describe('gateway arrear parsers (2-step flow)', () => {
  const arrearInitHtml = `<html><body>
    <select name="arrearSemesterId">
      <option value="0">-- Select --</option>
      <option value="WS202324">Winter Semester 2023-24</option>
      <option value="WS202425">Winter Semester 2024-25</option>
    </select>
  </body></html>`;

  it('extracts semester options + the select field name', () => {
    const sems = parseArrearSemesters(arrearInitHtml);
    expect(sems).toEqual([
      { id: 'WS202324', name: 'Winter Semester 2023-24', fieldName: 'arrearSemesterId' },
      { id: 'WS202425', name: 'Winter Semester 2024-25', fieldName: 'arrearSemesterId' },
    ]);
  });

  it('returns [] when no semester selector exists (no arrear data)', () => {
    expect(parseArrearSemesters('<html><body><p>none</p></body></html>')).toEqual([]);
  });

  it('parses arrear rows with status classification (header-driven)', () => {
    const html = `<html><body><table>
      <tr><th>Course Code</th><th>Course Title</th><th>Credits</th><th>Grade</th><th>Status</th></tr>
      <tr><td>MAT2002</td><td>Discrete Mathematics</td><td>3</td><td></td><td>Pending</td></tr>
      <tr><td>CS101</td><td>Programming</td><td>4</td><td>B</td><td>Cleared</td></tr>
      <tr><td>PHY102</td><td>Physics</td><td>4</td><td></td><td>Registered</td></tr>
    </table></body></html>`;
    const rows = parseArrearHtml(html, 'WS202324', 'Winter Semester 2023-24');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ courseCode: 'MAT2002', credits: 3, grade: '', status: 'Pending' });
    expect(rows[1]).toMatchObject({ courseCode: 'CS101', status: 'Cleared', grade: 'B' });
    expect(rows[2]).toMatchObject({ courseCode: 'PHY102', status: 'Registered' });
  });

  it('returns [] for a no-data page (legitimate empty)', () => {
    expect(parseArrearHtml('<html><body><div class="no-data">No records found</div></body></html>', 'WS202324', 'x')).toEqual([]);
  });
});

describe('gateway circulars parser (cost-centre page)', () => {
  const circularsHtml = `<html><body>
    <ul id="tree1">
      <li><span>ACADEMIC CIRCULARS</span></li>
      <li><ul>
        <li><a href="#" onclick="viewCertificate('CIR-100')">CAT 2 Exam Schedule</a></li>
        <li><a href="#" onclick="viewCertificate('CIR-101')">FFCS Slot Registration</a></li>
      </ul></li>
      <li><span>EXAMINATION CIRCULARS</span></li>
      <li><ul>
        <li><a href="#" onclick="viewCertificate('CIR-200')">FAT Guidelines</a></li>
      </ul></li>
    </ul>
  </body></html>`;

  it('parses the nested tree into categorized circulars', () => {
    const circs = parseCircularsHtml(circularsHtml);
    expect(circs).toHaveLength(3);
    expect(circs[0]).toMatchObject({ id: 'CIR-100', title: 'CAT 2 Exam Schedule', category: 'ACADEMIC CIRCULARS' });
    expect(circs[1]).toMatchObject({ id: 'CIR-101', title: 'FFCS Slot Registration', category: 'ACADEMIC CIRCULARS' });
    expect(circs[2]).toMatchObject({ id: 'CIR-200', title: 'FAT Guidelines', category: 'EXAMINATION CIRCULARS' });
  });

  it('returns [] when the page has no tree (no circulars)', () => {
    expect(parseCircularsHtml('<html><body><p>No circulars</p></body></html>')).toEqual([]);
  });
});

describe('gateway special-exam parsers (makeup / reFAT / compre)', () => {
  const makeupInitHtml = `<html><body>
    <h3 class="box-title">Makeup Exam Schedule</h3>
    <select name="semesterSubId">
      <option value="0">-- Select --</option>
      <option value="WS202526">Winter Semester 2025-26</option>
    </select>
  </body></html>`;

  it('extracts makeup semester options from the init page', () => {
    const sems = specialExamSemesters(makeupInitHtml);
    expect(sems).toEqual([{ id: 'WS202526', name: 'Winter Semester 2025-26' }]);
  });

  it('parses makeup exam rows from the data response (header-driven)', () => {
    const html = `<html><body><table class="customTable">
      <tr><th>Slot</th><th>Exam Date</th><th>Reporting Time</th><th>Exam Time</th><th>Venue</th><th>Seat No</th></tr>
      <tr><td>D1</td><td>25-SEP-2026</td><td>09:30</td><td>10:00 AM - 01:00 PM</td><td>SJT 502</td><td>R5A12</td></tr>
    </table></body></html>`;
    const rows = parseExamTableRows(html);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ slot: 'D1', date: '2026-09-25', venue: 'SJT 502', seatNo: 'R5A12' });
  });

  it('returns [] for a no-data makeup response', () => {
    expect(parseExamTableRows('<html><body><div class="no-data">No records found</div></body></html>')).toEqual([]);
  });

  it('extracts the reFAT page heading', () => {
    expect(parseHeadingText('<html><body><h3>Re-FAT Registration Open</h3></body></html>')).toBe('Re-FAT Registration Open');
    expect(parseHeadingText('<html><body><p>none</p></body></html>')).toBe('');
  });

  it('parses reFAT course rows from the OnChange response', () => {
    const html = `<html><body><table>
      <tr><th>Course Code</th><th>Course Title</th></tr>
      <tr><td>BAMAT202</td><td>Linear Algebra</td></tr>
      <tr><td>BAEEE201</td><td>Digital Electronics</td></tr>
    </table></body></html>`;
    const courses = parseRefatCourses(html);
    expect(courses).toEqual([
      { courseCode: 'BAMAT202', courseTitle: 'Linear Algebra' },
      { courseCode: 'BAEEE201', courseTitle: 'Digital Electronics' },
    ]);
  });

  it('parses compre status (open vs closed)', () => {
    const open = `<html><body><h3>Comprehensive Examination</h3><p>Registration</p></body></html>`;
    const info = parseCompreInfo(open);
    expect(info.available).toBe(true);
    expect(info.status).toBe('registration_open');

    const closed = `<html><body><h3>Comprehensive Examination</h3><h3 class="text-danger">Registration Closed for your category</h3></body></html>`;
    const closedInfo = parseCompreInfo(closed);
    expect(closedInfo.available).toBe(true);
    expect(closedInfo.status).toBe('Registration Closed for your category');
  });

  it('marks compre unavailable on a login page', () => {
    expect(parseCompreInfo(loginPageHtml).available).toBe(false);
  });
});

describe('gateway parser guards + date helper', () => {
  it('detects both legacy and current-portal login pages', () => {
    expect(isLoginOrExpiredPage(loginPageHtml)).toBe(true);
    expect(isLoginOrExpiredPage('<form id="vtopLoginForm"><input name="captchaStr"></form>')).toBe(true);
    expect(isLoginOrExpiredPage('<html><body><table id="getStudentDetails"></table></body></html>')).toBe(false);
  });

  it('normalizes VTOP date formats to ISO', () => {
    expect(normalizeDate('18-AUG-2026')).toBe('2026-08-18');
    expect(normalizeDate('19/08/2026')).toBe('2026-08-19');
    expect(normalizeDate('2026-09-21')).toBe('2026-09-21');
    expect(normalizeDate('02-FEB-26')).toBe('2026-02-02');
  });
});

describe('gateway payments parser (p2p/Payments)', () => {
  it('parses no-dues marker + student info', () => {
    const html = `<html><body>
      <h3 class="box-title">Payments</h3>
      <div class="container"><div class="row">
        <b class="text-primary">: 21BCE1234</b><b class="text-primary">: Aanya Sharma</b>
        <b class="text-primary">: B.Tech CSE</b><b class="text-primary">: Chennai</b>
      </div></div>
      <font color="green">No dues pending for the current semester.</font>
      <table><tr><td>Fee Type</td><td>Amount</td></tr><tr><td>Tuition</td><td>0</td></tr></table>
    </body></html>`;
    const p = parsePaymentsHtml(html);
    expect(p.registerNumber).toBe('21BCE1234');
    expect(p.studentName).toBe('Aanya Sharma');
    expect(p.message).toContain('No dues');
    expect(p.hasDues).toBe(false);
  });

  it('flags dues when the green no-dues marker is absent', () => {
    const html = `<html><body><h3 class="box-title">Payments</h3>
      <table><tr><td>Total Fees Due</td><td>1,25,000</td></tr></table>
    </body></html>`;
    const p = parsePaymentsHtml(html);
    expect(p.hasDues).toBe(true);
    expect(p.rows.some((r) => r.label.includes('Total Fees Due'))).toBe(true);
  });

  it('throws on a login page', () => {
    expect(() => parsePaymentsHtml(loginPageHtml)).toThrow(ParseError);
  });
});

describe('gateway credentials parser (viewStudentCredentials)', () => {
  it('parses the customTable account rows', () => {
    const html = `<html><body><h3><b>Student Credentials</b></h3>
      <table class="customTable">
        <tr class="tableHeader"><td>Account</td><td>Username</td><td>Default Credentials</td><td>URL</td></tr>
        <tr class="tableContent">
          <td>VTOP</td><td>21BCE1234</td><td>****</td>
          <td><a href="https://vtopcc.vit.ac.in/vtop">vtopcc.vit.ac.in</a></td>
        </tr>
        <tr class="tableContent">
          <td>LMS</td><td>21BCE1234</td><td>****</td>
          <td><a href="https://lms.vit.ac.in">lms.vit.ac.in</a></td>
        </tr>
      </table>
    </body></html>`;
    const c = parseCredentialsHtml(html);
    expect(c.title).toBe('Student Credentials');
    expect(c.credentials).toHaveLength(2);
    expect(c.credentials[0].account).toBe('VTOP');
    expect(c.credentials[0].url).toBe('https://vtopcc.vit.ac.in/vtop');
    expect(c.credentials[1].account).toBe('LMS');
  });

  it('throws on a login page', () => {
    expect(() => parseCredentialsHtml(loginPageHtml)).toThrow(ParseError);
  });
});

describe('gateway transport parser (transportRegistration)', () => {
  it('parses a registered student + bus route id', () => {
    const html = `<html><body>
      <input id="busRouteId" value="R-117">
      <table class="table">
        <tr><td>Register Number</td><td>21BCE1234</td></tr>
        <tr><td>Name of the Student</td><td>Aanya Sharma</td></tr>
        <tr><td>Programme</td><td>B.Tech</td></tr>
        <tr><td>Branch</td><td>CSE</td></tr>
        <tr><td>Route Selected</td><td>CMBT</td></tr>
        <tr><td>FP Reference Number</td><td>FP-2026-001</td></tr>
        <tr><td>Payment Status</td><td>Paid</td></tr>
      </table>
      <img id="qrAttendance" src="data:image/png;base64,AAAA">
    </body></html>`;
    const t = parseTransportHtml(html);
    expect(t.hasRegistration).toBe(true);
    expect(t.busRouteId).toBe('R-117');
    expect(t.registerNumber).toBe('21BCE1234');
    expect(t.routeSelected).toBe('CMBT');
    expect(t.paymentStatus).toBe('Paid');
    expect(t.qrCode).toContain('data:image/png');
  });

  it('reports no registration when busRouteId is absent', () => {
    const html = `<html><body><table class="table"><tr><td>Register Number</td><td>21BCE1234</td></tr></table></body></html>`;
    const t = parseTransportHtml(html);
    expect(t.hasRegistration).toBe(false);
  });

  it('extracts QR when VTOP changes the image attribute order or label', () => {
    const html = `<input id="busRouteId" value="R-118"><table class="table"><tr><td>Route Selected</td><td>CMBT</td></tr><tr><td>Payment Status</td><td>Paid</td></tr></table><img src="data:image/jpeg;base64,QRDATA" alt="Daily Attendance QR">`;
    expect(parseTransportHtml(html).qrCode).toBe('data:image/jpeg;base64,QRDATA');
  });

  it('throws on a login page', () => {
    expect(() => parseTransportHtml(loginPageHtml)).toThrow(ParseError);
  });
});

describe('gateway SAP info parser (SapInformation)', () => {
  it('parses label/value rows', () => {
    const html = `<html><body><h3 class="box-title">SAP Information</h3>
      <table><tr><td>SAP ID</td><td>1256845</td></tr><tr><td>Status</td><td>Active</td></tr></table>
    </body></html>`;
    const s = parseSapInfoHtml(html);
    expect(s.available).toBe(true);
    expect(s.rows).toHaveLength(2);
    expect(s.rows[0]).toEqual({ label: 'SAP ID', value: '1256845' });
  });

  it('surfaces a warning box without fabricating rows', () => {
    const html = `<html><body><h3 class="box-title">SAP Information</h3>
      <div class="text-danger">SAP ID not mapped yet</div>
    </body></html>`;
    const s = parseSapInfoHtml(html);
    expect(s.available).toBe(false);
    expect(s.message).toContain('SAP ID not mapped');
  });

  it('throws on a login page', () => {
    expect(() => parseSapInfoHtml(loginPageHtml)).toThrow(ParseError);
  });
});

describe('gateway payment receipts parser (getReceiptsApplno)', () => {
  it('parses the table-bordered receipts (Chennai shape)', () => {
    const html = `<html><body><h3 class="box-title"><b>Receipts</b></h3>
      <table class="table table-bordered">
        <tr><td>Receipt No.</td><td>Date</td><td>Amount</td><td>Campus</td><td>Action</td></tr>
        <tr>
          <td>RCPT-2026-0001</td><td>18-AUG-2026</td><td>1,25,000</td><td>CC</td>
          <td><button onclick="doDuplicateReceipt('ABC123')">View</button>
              <input name="applno" value="APL-9"><input name="regno" value="25BEE1303"></td>
        </tr>
      </table>
    </body></html>`;
    const r = parsePaymentReceiptsHtml(html);
    expect(r.available).toBe(true);
    expect(r.receipts).toHaveLength(1);
    expect(r.receipts[0]).toMatchObject({
      receiptNumber: 'RCPT-2026-0001',
      amount: '1,25,000',
      campusCode: 'CC',
      viewKey: 'ABC123',
      applno: 'APL-9',
      regno: '25BEE1303',
    });
  });

  it('throws on a login page', () => {
    expect(() => parsePaymentReceiptsHtml(loginPageHtml)).toThrow(ParseError);
  });
});

describe('gateway employee search parser (EmployeeSearchForStudent)', () => {
  it('parses the employee record fields', () => {
    const html = `<html><body><h3 class="box-title">Employee Search</h3>
      <table><tr><td>Employee ID</td><td>50300</td></tr>
      <tr><td>Name</td><td>Dr. Viswanathan V</td></tr>
      <tr><td>Department</td><td>SCOPE</td></tr></table>
    </body></html>`;
    const e = parseEmployeeSearchHtml(html);
    expect(e.found).toBe(true);
    expect(e.fields.find((f) => f.label === 'Name')?.value).toBe('Dr. Viswanathan V');
  });

  it('reports not-found via the warning message', () => {
    const html = `<html><body><h3 class="box-title">Employee Search</h3>
      <div class="text-warning">No employee found with the given ID</div>
    </body></html>`;
    const e = parseEmployeeSearchHtml(html);
    expect(e.found).toBe(false);
    expect(e.message).toContain('No employee found');
  });

  it('throws on a login page', () => {
    expect(() => parseEmployeeSearchHtml(loginPageHtml)).toThrow(ParseError);
  });
});

describe('gateway DA assignments parser (StudentDA -> processDigitalAssignment)', () => {
  it('extracts classId options from the StudentDA page', () => {
    const html = `<html><body><select name="classId">
      <option value="2026WCBSE1">2026 W CSE Core</option>
      <option value="2026WCBSE2">2026 W CSE Elective</option>
    </select></body></html>`;
    const opts = parseDaClassOptions(html);
    expect(opts).toHaveLength(2);
    expect(opts[0]).toEqual({ value: '2026WCBSE1', text: '2026 W CSE Core' });
  });

  it('parses the DA table by header (course/assignment/due/status)', () => {
    const html = `<html><body><table class="customTable">
      <tr class="tableHeader"><td>S.No</td><td>Course Code</td><td>Course Title</td><td>Assignment</td><td>Due Date</td><td>Status</td></tr>
      <tr class="tableContent"><td>1</td><td>BAMAT202</td><td>Linear Algebra</td><td>Assignment - I</td><td>18-AUG-2026</td><td>Not Submitted</td></tr>
      <tr class="tableContent"><td>2</td><td>BACSE102</td><td>Problem Solving Using Java</td><td>Assignment - II</td><td>25-AUG-2026</td><td>Submitted</td></tr>
    </table></body></html>`;
    const a = parseDaAssignmentsHtml(html);
    expect(a).toHaveLength(2);
    expect(a[0]).toMatchObject({
      courseCode: 'BAMAT202',
      courseTitle: 'Linear Algebra',
      title: 'Assignment - I',
      dueDate: '2026-08-18',
      status: 'Not Submitted',
    });
    expect(a[1].courseCode).toBe('BACSE102');
  });

  it('handles column reordering (attribute-order tolerant)', () => {
    const html = `<html><body><table>
      <tr><td>Status</td><td>Due Date</td><td>Course</td><td>Assignment</td></tr>
      <tr><td>Graded</td><td>01-SEP-2026</td><td>BAPHY106</td><td>Quiz - I</td></tr>
    </table></body></html>`;
    const a = parseDaAssignmentsHtml(html);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ courseCode: 'BAPHY106', title: 'Quiz - I', dueDate: '2026-09-01', status: 'Graded' });
  });

  it('returns [] for an explicit no-data page', () => {
    const html = `<html><body><div class="text-warning">No data found for the selected class</div></body></html>`;
    expect(parseDaAssignmentsHtml(html)).toEqual([]);
  });

  it('throws ParseError for a table with no parseable rows (structure changed)', () => {
    const html = `<html><body><table><tr><td>Random</td><td>garbage</td><td>cells</td></tr></table></body></html>`;
    expect(() => parseDaAssignmentsHtml(html)).toThrow(ParseError);
  });

  it('throws on a login page', () => {
    expect(() => parseDaAssignmentsHtml(loginPageHtml)).toThrow(ParseError);
  });
});

describe('gateway single-step info parsers (bank / biometric / proctor / login-history)', () => {
  it('parses bank-info label/value rows + green message', () => {
    const html = `<html><body><h3 class="box-title">Bank Information</h3>
      <table><tr><td>Bank Name</td><td>State Bank of India</td></tr>
      <tr><td>Branch</td><td>Vandalur</td></tr></table>
      <font color="green">Bank details updated successfully.</font>
    </body></html>`;
    const b = parseBankInfoHtml(html);
    expect(b.available).toBe(true);
    expect(b.rows.find((r) => r.label === 'Bank Name')?.value).toBe('State Bank of India');
    expect(b.message).toContain('updated');
  });

  it('parses biometric rows', () => {
    const html = `<html><body><h3 class="box-title">Biometric</h3>
      <table><tr><td>Enrollment Date</td><td>12-JAN-2026</td></tr>
      <tr><td>Fingerprint Count</td><td>10</td></tr></table>
    </body></html>`;
    const b = parseBiometricInfoHtml(html);
    expect(b.rows).toHaveLength(2);
    expect(b.rows[0].label).toBe('Enrollment Date');
  });

  it('parses proctor message rows', () => {
    const html = `<html><body><table>
      <tr><th>From</th><th>Subject</th><th>Message</th><th>Date</th></tr>
      <tr><td>SUMATHI V</td><td>Meeting Reminder</td><td>Please meet in office.</td><td>10-AUG-2026</td></tr>
    </table></body></html>`;
    const m = parseProctorMessagesHtml(html);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ from: 'SUMATHI V', subject: 'Meeting Reminder', date: '10-AUG-2026' });
  });

  it('parses login history rows', () => {
    const html = `<html><body><table>
      <tr><th>Date</th><th>Time</th><th>IP</th><th>Status</th></tr>
      <tr><td>13-AUG-2026</td><td>18:22</td><td>10.1.2.3</td><td>Success</td></tr>
    </table></body></html>`;
    const h = parseLoginHistoryHtml(html);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ date: '13-AUG-2026', time: '18:22', ip: '10.1.2.3', status: 'Success' });
  });

  it('throws on login pages', () => {
    expect(() => parseBankInfoHtml(loginPageHtml)).toThrow(ParseError);
    expect(() => parseBiometricInfoHtml(loginPageHtml)).toThrow(ParseError);
    expect(() => parseProctorMessagesHtml(loginPageHtml)).toThrow(ParseError);
    expect(() => parseLoginHistoryHtml(loginPageHtml)).toThrow(ParseError);
  });
});

describe('gateway extended single-step parsers (class-messages / HOD / wallet / extra-curricular)', () => {
  it('parses class messages by header (skips the header row)', () => {
    const html = `<html><body><table>
      <tr><th>From</th><th>Subject</th><th>Message</th><th>Date</th></tr>
      <tr><td>FACULTY</td><td>Lab rescheduled</td><td>Wednesday lab moved to Thursday.</td><td>12-AUG-2026</td></tr>
    </table></body></html>`;
    const m = parseClassMessagesHtml(html);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ from: 'FACULTY', subject: 'Lab rescheduled', date: '12-AUG-2026' });
  });

  it('parses HOD/Dean label/value rows', () => {
    const html = `<html><body><h3 class="box-title">HOD &amp; Dean</h3>
      <table><tr><td>School</td><td>SCOPE</td></tr><tr><td>Dean</td><td>Dr. XYZ</td></tr></table>
    </body></html>`;
    const h = parseHodDeanHtml(html);
    expect(h.available).toBe(true);
    expect(h.rows.find((r) => r.label === 'Dean')?.value).toBe('Dr. XYZ');
  });

  it('parses wallet balance rows + green message', () => {
    const html = `<html><body><h3 class="box-title">Student Wallet</h3>
      <table><tr><td>Available Balance</td><td>₹ 1,250</td></tr></table>
      <font color="green">Wallet balance updated.</font>
    </body></html>`;
    const w = parseWalletHtml(html);
    expect(w.rows[0].value).toBe('₹ 1,250');
    expect(w.message).toContain('updated');
  });

  it('parses extra-curricular rows', () => {
    const html = `<html><body><h3 class="box-title">Extra Curricular</h3>
      <table><tr><td>Club</td><td>Robotics Club</td></tr><tr><td>Role</td><td>Member</td></tr></table>
    </body></html>`;
    const e = parseExtraCurricularHtml(html);
    expect(e.rows).toHaveLength(2);
    expect(e.rows[0].label).toBe('Club');
  });

  it('throws on login pages', () => {
    expect(() => parseClassMessagesHtml(loginPageHtml)).toThrow(ParseError);
    expect(() => parseHodDeanHtml(loginPageHtml)).toThrow(ParseError);
    expect(() => parseWalletHtml(loginPageHtml)).toThrow(ParseError);
    expect(() => parseExtraCurricularHtml(loginPageHtml)).toThrow(ParseError);
  });
});
