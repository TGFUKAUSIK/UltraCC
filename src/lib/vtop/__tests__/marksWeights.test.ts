/**
 * What the marks parser keeps from VTOP's page, and what it refuses to invent.
 *
 * The live Chennai marks page carries the numbers the whole grade model runs on:
 * Course Type and Slot (which half of an embedded course a row belongs to),
 * Weightage % (the only weight that may be used) and Weightage Mark (VTOP's own
 * weighted contribution). Every one of those was being dropped or replaced by a
 * regulation default, so this pins the capture.
 */

import { describe, it, expect } from 'vitest';
import { parseMarksHtml } from '../parsers/marks';

const COURSE_CELLS = (code: string, title: string, type: string, slot: string) => `
  <tr>
    <td>1</td><td>FALL 2025-26</td><td>${code}</td><td>${title}</td>
    <td>${type}</td><td>REG</td><td>Dr. Example</td><td>${slot}</td><td>SJT</td>
  </tr>`;

function row(title: string, max: string, weight: string, status: string, scored: string, weightMark = '') {
  return `<tr class="tableContent-level1">
    <td>1</td><td>${title}</td><td>${max}</td><td>${weight}</td>
    <td>${status}</td><td>${scored}</td><td>${weightMark}</td>
  </tr>`;
}

function marksPage(courses: string[]) {
  return `<html><body><table class="customTable">${courses.join('')}</table></body></html>`;
}

function nested(...rows: string[]) {
  return `<tr><td colspan="9"><table class="customTable-level1">
    <tr><th>S.No</th><th>Title</th><th>Max Mark</th><th>Weightage %</th><th>Status</th><th>Scored Mark</th><th>Weightage Mark</th></tr>
    ${rows.join('')}
  </table></td></tr>`;
}

describe('parseMarksHtml — the columns the grade model needs', () => {
  const page = marksPage([
    COURSE_CELLS('CSE2008', 'Problem Solving and Programming', 'ETH', 'A1'),
    nested(
      row('Continuous Assessment Test - I', '20', '15', 'Evaluated', '12', '9'),
      row('Final Assessment Test', '100', '40', 'Pending', '-'),
    ),
    COURSE_CELLS('CSE2008L', 'Problem Solving and Programming Lab', 'ELA', 'L36'),
    nested(
      row('Experiment', '50', '40', 'Evaluated', '45', '36'),
      row('LAB FAT', '50', '20', 'Evaluated', '18', '7.2'),
    ),
  ]);

  it('reads Course Type and Slot so theory and lab stay separate classes', () => {
    const records = parseMarksHtml(page);
    const theory = records.find((r) => r.courseCode === 'CSE2008')!;
    const lab = records.find((r) => r.courseCode === 'CSE2008L')!;
    expect(theory.courseType).toBe('ETH');
    expect(theory.slot).toBe('A1');
    expect(theory.cat1.part).toBe('T');
    expect(lab.courseType).toBe('ELA');
    expect(lab.extraComponents![0].part).toBe('L');
  });

  it('keeps VTOP\'s declared weightage and its own weighted mark', () => {
    const theory = parseMarksHtml(page).find((r) => r.courseCode === 'CSE2008')!;
    expect(theory.cat1.weightageMax).toBe(15);
    expect(theory.cat1.weightageMark).toBe(9);
    expect(theory.cat1.weightageScored).toBe(9);
  });

  it('takes the FAT weight from the page, never the assumed 50', () => {
    const theory = parseMarksHtml(page).find((r) => r.courseCode === 'CSE2008')!;
    expect(theory.fat!.weightageMax).toBe(40);
    expect(theory.fat!.status).toBe('Pending');
    // An ungraded row scores nothing and claims no weighted mark.
    expect(theory.fat!.weightageScored).toBe(0);
  });

  it('keeps both halves of an embedded course instead of the last row winning', () => {
    const records = parseMarksHtml(page);
    const lab = records.find((r) => r.courseCode === 'CSE2008L')!;
    // "LAB FAT" is a FAT row; the Experiment row is a separate component.
    expect(lab.fat).toBeTruthy();
    expect(lab.fat!.weightageMax).toBe(20);
    expect(lab.extraComponents!.map((c) => c.title)).toContain('Experiment');
  });

  it('publishes no assessment row VTOP did not serve', () => {
    // A course whose nested table is empty has no CAT 2, and must not arrive
    // with the old fabricated 15/15/5/5/10 weights.
    const only = marksPage([
      COURSE_CELLS('MAT2021', 'Statistics', 'ETH', 'B2'),
      nested(row('Continuous Assessment Test - I', '20', '18', 'Evaluated', '15', '13.5')),
    ]);
    const record = parseMarksHtml(only)[0];
    expect(record.cat1.weightageMax).toBe(18);
    expect(record.cat2.weightageMax).toBe(0);
    expect(record.da1.weightageMax).toBe(0);
    expect(record.quiz.weightageMax).toBe(0);
  });
});

describe('parseMarksHtml — two tables for one course', () => {
  it('merges a theory row set and a lab row set, keeping both FATs', () => {
    const page = marksPage([
      COURSE_CELLS('CSE3004', 'Data Structures', 'ETH', 'A1'),
      nested(
        row('Continuous Assessment Test - I', '25', '15', 'Evaluated', '20', '12'),
        row('Final Assessment Test', '100', '40', 'Pending', '-'),
      ),
      // The same course code served again for the lab half, as VTOP does when
      // the class is embedded and the lab is registered without an L suffix.
      COURSE_CELLS('CSE3004', 'Data Structures', 'ELA', 'L21'),
      nested(
        row('Experiment', '50', '30', 'Evaluated', '28', '16.8'),
        row('LAB FAT', '50', '30', 'Evaluated', '40', '24'),
      ),
    ]);
    const records = parseMarksHtml(page);
    expect(records).toHaveLength(1);
    const merged = records[0];
    expect(merged.cat1.part).toBe('T');
    expect(merged.extraComponents!.some((c) => c.part === 'L')).toBe(true);
    // The theory FAT is the one to solve for; the lab paper is still on record.
    expect(merged.fat!.part).toBe('T');
    expect(merged.fat!.weightageMax).toBe(40);
    expect(merged.labFat).toBeTruthy();
    expect(merged.labFat!.part).toBe('L');
  });
});
