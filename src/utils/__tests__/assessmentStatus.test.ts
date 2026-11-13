/**
 * assessmentStatus tests — the single authority on "has VTOP graded this row?"
 *
 * VTOP publishes assessment rows BEFORE they are evaluated: the row carries a
 * real maxMarks and weightage, scored is 0 and status is 'Pending'. Anything
 * that gates on `max > 0` therefore reads an exam that has not been held as a
 * scored zero. These tests pin the distinction.
 */

import { describe, it, expect } from 'vitest';
import {
  isPendingAssessment, isEvaluatedAssessment, pendingWeightage, pendingCourseWeightage,
  classifyAssignmentStatus,
} from '../assessmentStatus';

describe('isPendingAssessment', () => {
  it('recognises the statuses VTOP actually serves for an ungraded row', () => {
    expect(isPendingAssessment('Pending')).toBe(true);
    expect(isPendingAssessment('AB')).toBe(true);
    expect(isPendingAssessment('Absent')).toBe(true);
    expect(isPendingAssessment('N/A')).toBe(true);
    expect(isPendingAssessment('Not Evaluated')).toBe(true);
    expect(isPendingAssessment('  pending  ')).toBe(true);
  });

  it('does not invent a pending state when VTOP gave no status', () => {
    // Unknown status must fall through to the numeric check, not to a guess.
    expect(isPendingAssessment(undefined)).toBe(false);
    expect(isPendingAssessment('')).toBe(false);
    expect(isPendingAssessment(null)).toBe(false);
  });

  it('treats a graded row as graded', () => {
    expect(isPendingAssessment('Evaluated')).toBe(false);
  });
});

describe('isEvaluatedAssessment', () => {
  it('accepts a row with a real score and a real maximum', () => {
    expect(isEvaluatedAssessment({ scored: 0, max: 50, weightage: 15 })).toBe(true);
    expect(isEvaluatedAssessment({ scored: 42.5, max: 50, weightage: 15, status: 'Evaluated' })).toBe(true);
  });

  it('rejects a Pending row even though VTOP declared its max and weightage', () => {
    // This is the bug the module exists for: max > 0 is NOT evidence of a score.
    expect(isEvaluatedAssessment({ scored: 0, max: 50, weightage: 15, status: 'Pending' })).toBe(false);
  });

  it('rejects a row VTOP has not declared at all', () => {
    expect(isEvaluatedAssessment(undefined)).toBe(false);
    expect(isEvaluatedAssessment(null)).toBe(false);
    expect(isEvaluatedAssessment({ scored: 0, max: 0, weightage: 0 })).toBe(false);
  });

  it('rejects non-finite numbers', () => {
    expect(isEvaluatedAssessment({ scored: NaN, max: 50 })).toBe(false);
    expect(isEvaluatedAssessment({ scored: 10, max: Infinity })).toBe(false);
  });
});

describe('pendingWeightage', () => {
  it('returns 0 for a graded component — its weight is already earned', () => {
    expect(pendingWeightage({ scored: 40, max: 50, weightage: 15 })).toBe(0);
  });

  it('returns the weight VTOP declared for an ungraded component', () => {
    expect(pendingWeightage({ scored: 0, max: 50, weightage: 15, status: 'Pending' })).toBe(15);
    expect(pendingWeightage({ scored: 0, max: 0, weightage: 5 })).toBe(5);
  });

  it('returns 0 when no weight was declared — unknown stays unknown', () => {
    expect(pendingWeightage({ scored: 0, max: 0, weightage: 0 })).toBe(0);
    expect(pendingWeightage(undefined)).toBe(0);
  });
});

describe('pendingCourseWeightage', () => {
  it('sums only the ungraded rows', () => {
    expect(pendingCourseWeightage([
      { scored: 42, max: 50, weightage: 15, status: 'Evaluated' },
      { scored: 0, max: 50, weightage: 15, status: 'Pending' },
      { scored: 0, max: 10, weightage: 5, status: 'Pending' },
      undefined,
    ])).toBe(20);
  });

  it('is 0 once everything is graded', () => {
    expect(pendingCourseWeightage([
      { scored: 42, max: 50, weightage: 15 },
      { scored: 8, max: 10, weightage: 5 },
    ])).toBe(0);
  });
});

/**
 * The LMS assignment table has its own vocabulary: 'Not Graded', 'Submitted',
 * 'Graded'. A plain substring test on those words reads "Not Graded" as a
 * grade, which told students an assignment was marked when it was waiting to
 * be. Negation wins over the positive word wherever both appear.
 */
describe('classifyAssignmentStatus', () => {
  it('does not read a negated status as a grade', () => {
    expect(classifyAssignmentStatus('Not Graded')).toBe('Pending');
    expect(classifyAssignmentStatus('not graded')).toBe('Pending');
    expect(classifyAssignmentStatus('Not Evaluated')).toBe('Pending');
    expect(classifyAssignmentStatus('Not Submitted')).toBe('Pending');
    expect(classifyAssignmentStatus('UNGRADED')).toBe('Pending');
    expect(classifyAssignmentStatus('Not Uploaded')).toBe('Pending');
  });

  it('recognises the statuses VTOP actually publishes', () => {
    expect(classifyAssignmentStatus('Graded')).toBe('Graded');
    expect(classifyAssignmentStatus('Evaluated')).toBe('Graded');
    expect(classifyAssignmentStatus('Marks Published')).toBe('Graded');
    expect(classifyAssignmentStatus('Submitted')).toBe('Submitted');
    expect(classifyAssignmentStatus('Uploaded')).toBe('Submitted');
    expect(classifyAssignmentStatus('Checked')).toBe('Graded');
  });

  it('grades outrank a mere submission', () => {
    expect(classifyAssignmentStatus('Submitted and Graded')).toBe('Graded');
  });

  it('treats an absent or unfamiliar status as Pending, never as done', () => {
    expect(classifyAssignmentStatus(undefined)).toBe('Pending');
    expect(classifyAssignmentStatus('')).toBe('Pending');
    expect(classifyAssignmentStatus(null)).toBe('Pending');
    expect(classifyAssignmentStatus('—')).toBe('Pending');
    expect(classifyAssignmentStatus('In Progress')).toBe('Pending');
  });
});
