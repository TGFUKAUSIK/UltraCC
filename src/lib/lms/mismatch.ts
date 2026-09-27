/**
 * Marks Mismatch Detector (3c).
 *
 * Compares LMS gradebook component marks against VTOP CAT/DA marks for the
 * same course. Heuristic matching by component-name similarity; NEVER
 * auto-resolves — it only flags divergences for the student to check with
 * faculty.
 *
 * Rules:
 *   - Both sides must have a real numeric score (never compare null/0).
 *   - Divergence > 1 point OR different max marks triggers a flag.
 *   - LMS items that match no VTOP component (or vice versa) are NOT flagged
 *     (absence is normal — e.g. FAT not yet published on one side).
 */

import { CourseMarks } from '../../types';
import { LmsGradeItem } from './types';

export interface MarksMismatch {
  courseCode: string;
  component: string;
  lmsValue: string;
  vtopValue: string;
  detail: string;
}

/** Normalize a component name for fuzzy matching. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Detect mismatches between one course's LMS gradebook and its VTOP marks.
 */
export function detectMismatches(lmsItems: LmsGradeItem[], vtop: CourseMarks): MarksMismatch[] {
  const out: MarksMismatch[] = [];
  for (const item of lmsItems) {
    if (item.score === null || item.maxScore === null) continue;
    const n = norm(item.itemName);

    // Match against each VTOP component by name (either direction — LMS names
    // vary: "Assignment 1 (DA 1)", "CAT1", "Quiz 2", etc.).
    const comps: [string, { scored: number; max: number } | null | undefined][] = [
      ['CAT 1', vtop.cat1],
      ['CAT 2', vtop.cat2],
      ['DA 1', vtop.da1],
      ['DA 2', vtop.da2],
      ['DA 3', vtop.da3],
      ['Quiz', vtop.quiz],
    ];
    for (const [component, v] of comps) {
      const cn = norm(component);
      const matches =
        n.includes(cn) || cn.includes(n) ||
        (cn === 'da1' && /(?:^|\D)da1|assignment\s*1/.test(n)) ||
        (cn === 'da2' && /(?:^|\D)da2|assignment\s*2/.test(n)) ||
        (cn === 'da3' && /(?:^|\D)da3|assignment\s*3/.test(n)) ||
        (cn === 'cat1' && /(?:^|\D)cat\s*1|internal\s*1/.test(n)) ||
        (cn === 'cat2' && /(?:^|\D)cat\s*2|internal\s*2/.test(n));
      if (!matches) continue;
      if (!v || v.max <= 0) continue;
      const lmsScore = item.score;
      const vtopScore = v.scored;
      const maxDiffers = Math.abs(item.maxScore - v.max) > 0.01;
      const scoreDiffers = Math.abs(lmsScore - vtopScore) > 1.0;
      if (scoreDiffers || maxDiffers) {
        out.push({
          courseCode: vtop.courseCode,
          component,
          lmsValue: `${item.score}/${item.maxScore}`,
          vtopValue: `${vtopScore}/${v.max}`,
          detail: `LMS shows ${item.score}/${item.maxScore}, VTOP shows ${vtopScore}/${v.max}${maxDiffers ? ' (max marks differ)' : ''} — could be a sync delay or faculty entry error.`,
        });
      }
      break;
    }
  }
  return out;
}
