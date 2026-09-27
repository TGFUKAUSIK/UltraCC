/**
 * The credit path, end to end.
 *
 * VTOP states credits on the timetable's course list ("L T P J C", the last
 * number being the credits registered) and nowhere on the marks page. The
 * parser used to read that column and then drop it on the floor, so every
 * consumer downstream — the CGPA planner above all — worked without it and
 * filled the hole with a default. These tests follow one registered course from
 * the page HTML to the marks record the grade model reads.
 */

import { describe, it, expect } from 'vitest';
import { parseTimetableHtml } from '../parsers/timetable';
import { attachCreditsToMarks } from '../../../utils/courseCredits';
import type { CourseMarksRecord } from '../types';

/**
 * VTOP's course list without a day×time grid — the shape the portal serves:
 * table.table, positional cells, slot and venue sharing one cell.
 */
function courseListPage(rows: string[]) {
  return `<html><body><table class="table table-bordered table-striped">
    <tr class="tableHeader"><th>S.No</th><th>Class Nbr</th><th>Course Code</th><th>L T P J C</th><th>Category</th><th>Course Type</th><th>Class Id</th><th>Slot</th><th>Faculty Details</th></tr>
    ${rows.join('')}
  </table></body></html>`;
}

function courseRow(code: string, title: string, ltpjc: string, type: string, slotVenue: string) {
  return `<tr>
    <td>1</td><td>21BCE9999</td><td>${code} ${title}</td><td>${ltpjc}</td>
    <td>PC</td><td>${type}</td><td>CH202627019999</td><td>${slotVenue}</td><td>Dr. Example</td>
  </tr>`;
}

const marksRecord = (code: string): CourseMarksRecord => ({
  courseCode: code,
  courseTitle: code,
  cat1: { title: 'CAT 1', maxMarks: 20, scored: 12, weightageMax: 15, weightageScored: 9, status: 'Evaluated' },
  cat2: { title: 'CAT 2', maxMarks: 0, scored: 0, weightageMax: 0, weightageScored: 0, status: 'Pending' },
  da1: { title: 'DA 1', maxMarks: 0, scored: 0, weightageMax: 0, weightageScored: 0, status: 'Pending' },
  da2: { title: 'DA 2', maxMarks: 0, scored: 0, weightageMax: 0, weightageScored: 0, status: 'Pending' },
  da3: { title: 'DA 3', maxMarks: 0, scored: 0, weightageMax: 0, weightageScored: 0, status: 'Pending' },
  quiz: { title: 'Quiz', maxMarks: 0, scored: 0, weightageMax: 0, weightageScored: 0, status: 'Pending' },
  totalInternalWeightScored: 9,
  currentEstimatedGrade: '',
});

describe('registered credits survive the timetable parser', () => {
  it('carries the L T P J C credit count onto the slots it builds', () => {
    const slots = parseTimetableHtml(courseListPage([
      courseRow('CSE3004', 'Data Structures and Algorithms', '3 0 1 0 3', 'ETH', 'A1 SJT-302'),
    ]));
    expect(slots.length).toBeGreaterThan(0);
    // Not 0 and not undefined: this is the number the CGPA planner weights by.
    expect(slots.every((s) => s.credits === 3)).toBe(true);
  });

  it('joins those credits to the marks record at the sync seam', () => {
    const slots = parseTimetableHtml(courseListPage([
      courseRow('CSE3004', 'Data Structures and Algorithms', '3 0 1 0 3', 'ETH', 'A1 SJT-302'),
      courseRow('CSE3004L', 'Data Structures and Algorithms Lab', '0 0 0 2 1', 'ELA', 'L41 TT-302'),
    ]));
    const [theory, lab] = attachCreditsToMarks([marksRecord('CSE3004'), marksRecord('CSE3004L')], slots);
    // Both halves of an embedded course read as 4 registered credits: the same
    // number VTOP's course list states across its two rows.
    expect(theory.credits).toBe(4);
    expect(theory.theoryCredits).toBe(3);
    expect(theory.labCredits).toBe(1);
    expect(lab.credits).toBe(4);
  });

  it('leaves a course the timetable does not list uncredited', () => {
    const slots = parseTimetableHtml(courseListPage([
      courseRow('CSE3004', 'Data Structures and Algorithms', '3 0 1 0 3', 'ETH', 'A1 SJT-302'),
    ]));
    const [untouched] = attachCreditsToMarks([marksRecord('AUD1001')], slots);
    expect(untouched.credits).toBeUndefined();
  });
});
