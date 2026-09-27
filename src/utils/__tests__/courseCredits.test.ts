/**
 * Credits are VTOP's registered numbers or nothing.
 *
 * The credit figure used to reach the UI through the first timetable row that
 * happened to carry one, and through a `?? 3` default in the CGPA planner — so
 * an embedded course lost its lab credit and every unsynced course was silently
 * worth 3. These tests pin the replacement.
 */

import { describe, it, expect } from 'vitest';
import type { CourseMarksRecord, TimetableSlot } from '../../lib/vtop/types';
import {
  attachCreditsToMarks,
  baseCourseCode,
  creditProfilesFromTimetable,
  creditsOfMarkRecord,
} from '../courseCredits';

function slot(over: Partial<TimetableSlot> = {}): TimetableSlot {
  return {
    id: 's1',
    slot: 'A1',
    courseCode: 'CSE3004',
    courseTitle: 'Data Structures and Algorithms',
    courseType: 'ETH',
    facultyName: 'Dr. Example',
    venue: 'SJT - 302',
    building: 'SJT',
    startTime: '08:00',
    endTime: '08:50',
    day: 'Monday',
    ...over,
  };
}

describe('baseCourseCode', () => {
  it('strips the lab suffix but never a short code', () => {
    expect(baseCourseCode('CSE3004L')).toBe('CSE3004');
    expect(baseCourseCode('cse3004l')).toBe('CSE3004');
    expect(baseCourseCode('CSE3004')).toBe('CSE3004');
    // A four-character code ending in L is a course in its own right (BCM1001L
    // would be the lab; bare "MATL" is not a lab suffix case).
    expect(baseCourseCode('MAT2021')).toBe('MAT2021');
  });
});

describe('creditProfilesFromTimetable', () => {
  it('adds a separately registered lab class to its theory credits', () => {
    const profiles = creditProfilesFromTimetable([
      slot({ slot: 'A1', credits: 3 }),
      slot({ slot: 'A1', courseCode: 'CSE3004', credits: 3, id: 's2' }),
      slot({ slot: 'L41+L42', courseCode: 'CSE3004L', courseType: 'ELA', credits: 1, id: 's3' }),
    ]);
    expect(profiles.get('CSE3004')).toEqual({ theory: 3, lab: 1, total: 4, isEmbedded: true });
  });

  it('reads an L slot as the lab half even when the code has no suffix', () => {
    const profiles = creditProfilesFromTimetable([
      slot({ courseCode: 'ECE2011', credits: 3 }),
      slot({ courseCode: 'ECE2011', slot: 'L21', courseType: 'ELA', credits: 1, id: 's9' }),
    ]);
    expect(profiles.get('ECE2011')).toEqual({ theory: 3, lab: 1, total: 4, isEmbedded: true });
  });

  it('takes the largest credit VTOP stated for a class, not one per meeting', () => {
    const profiles = creditProfilesFromTimetable([
      slot({ id: 'a', credits: 4 }),
      slot({ id: 'b', slot: 'A2', credits: 4 }),
      slot({ id: 'c', slot: 'A3', credits: 0 }),
    ]);
    expect(profiles.get('CSE3004')!.total).toBe(4);
  });

  it('ignores rows with no credit data instead of defaulting them', () => {
    expect(creditProfilesFromTimetable([slot()]).size).toBe(0);
  });
});

describe('attachCreditsToMarks', () => {
  const record = (code: string): CourseMarksRecord => ({
    courseCode: code,
    courseTitle: code,
    cat1: { title: 'CAT 1', maxMarks: 20, scored: 0, weightageMax: 15, weightageScored: 0, status: 'Pending' },
    cat2: { title: 'CAT 2', maxMarks: 20, scored: 0, weightageMax: 15, weightageScored: 0, status: 'Pending' },
    da1: { title: 'DA 1', maxMarks: 10, scored: 0, weightageMax: 5, weightageScored: 0, status: 'Pending' },
    da2: { title: 'DA 2', maxMarks: 10, scored: 0, weightageMax: 5, weightageScored: 0, status: 'Pending' },
    da3: { title: 'DA 3', maxMarks: 10, scored: 0, weightageMax: 5, weightageScored: 0, status: 'Pending' },
    quiz: { title: 'Quiz', maxMarks: 10, scored: 0, weightageMax: 10, weightageScored: 0, status: 'Pending' },
    totalInternalWeightScored: 0,
    currentEstimatedGrade: '',
  });

  it('stamps the joined credits onto the marks record the model reads', () => {
    const [stamped] = attachCreditsToMarks([record('CSE3004')], [
      slot({ credits: 3 }),
      slot({ courseCode: 'CSE3004L', slot: 'L41', courseType: 'ELA', credits: 1, id: 'l' }),
    ]);
    expect(stamped.credits).toBe(4);
    expect(stamped.theoryCredits).toBe(3);
    expect(stamped.labCredits).toBe(1);
  });

  it('leaves a course VTOP never listed alone, rather than guessing 3', () => {
    const [untouched] = attachCreditsToMarks([record('PHY1001')], [slot({ credits: 3 })]);
    expect(untouched.credits).toBeUndefined();
    expect(creditsOfMarkRecord(untouched)).toBeNull();
  });
});

describe('creditsOfMarkRecord', () => {
  it('returns null when VTOP supplied no credits at all', () => {
    expect(creditsOfMarkRecord({})).toBeNull();
    expect(creditsOfMarkRecord(undefined)).toBeNull();
  });

  it('keeps a stated total that exceeds its split', () => {
    expect(creditsOfMarkRecord({ credits: 4, theoryCredits: 3, labCredits: 1 })).toEqual({
      theory: 3, lab: 1, total: 4, isEmbedded: true,
    });
  });

  it('sums a split when the total was never stamped', () => {
    const profile = creditsOfMarkRecord({ theoryCredits: 3, labCredits: 1 })!;
    expect(profile.total).toBe(4);
    expect(profile.isEmbedded).toBe(true);
  });
});
