/**
 * Authoritative course credits, straight from VTOP's own registration data.
 *
 * VTOP publishes the real credit structure on the timetable page's course list
 * ("L T P J C"), where the final number is the credits the student is actually
 * registered for. A theory class and the lab class of the same course are
 * listed separately — CSE3004 at 3 credits and CSE3004L at 1 — so an embedded
 * course carries 4 credits in two classes that are assessed apart.
 *
 * Before this module the credit number reached the UI by two unreliable
 * routes: the first positive `TimetableSlot.credits` for a code (which loses
 * the lab half of an embedded course and depends on row order) and a `?? 3`
 * default in the CGPA simulator (which invented credits for every course VTOP
 * had not been re-synced for). Both are gone: this is the only credit source,
 * and when it has nothing for a course the caller says so instead of guessing.
 */

import type { CourseMarksRecord } from '../lib/vtop/types';

/**
 * The part of a timetable entry this module needs, so either TimetableSlot
 * shape (the VTOP record type and the UI type) can be credited from the same code.
 */
export interface CreditBearingSlot {
  courseCode: string;
  slot: string;
  courseType?: string;
  /** The UI timetable shape flags a lab class directly. */
  isLab?: boolean;
  credits?: number;
}

export interface CourseCreditProfile {
  /** Total registered credits (theory + lab). */
  total: number;
  /** Credits of the theory class, 0 when the course has none. */
  theory: number;
  /** Credits of the lab class, 0 when the course has none. */
  lab: number;
  /** True when VTOP registered both a theory and a lab class for this code. */
  isEmbedded: boolean;
}

/**
 * VTOP's marks page keys an embedded course by its base code and separates the
 * halves by slot; the course list separates them by an `L` suffix. Lab course
 * codes exist in both spellings, so keys here are always normalised.
 */
export function baseCourseCode(code: string): string {
  const raw = (code || '').trim().toUpperCase();
  return raw.length > 4 && raw.endsWith('L') ? raw.slice(0, -1) : raw;
}

/** A lab class is registered as its own code (`…L`) or sits in an L slot. */
function isLabClass(slot: CreditBearingSlot): boolean {
  if (slot.isLab) return true;
  const type = (slot.courseType || '').toUpperCase();
  if (type.includes('ELA') || type.includes('LAB')) return true;
  const code = (slot.courseCode || '').trim().toUpperCase();
  if (code.length > 4 && code.endsWith('L')) return true;
  // A plain theory course never meets in an L slot; combined labs read "L31+L32".
  const slots = (slot.slot || '').toUpperCase().replace(/\s+/g, '');
  return slots.length > 0 && slots.split('+').every((s) => /^L\d/.test(s));
}

/**
 * Build the credit profile of every registered course from the timetable's
 * course-list data. Uses the LARGEST credit VTOP stated per class, so a course
 * listed once per slot is not counted per meeting.
 */
export function creditProfilesFromTimetable(
  slots: CreditBearingSlot[],
): Map<string, CourseCreditProfile> {
  const byBase = new Map<string, { theory: number; lab: number }>();
  for (const slot of slots || []) {
    const credits = Number(slot.credits);
    if (!Number.isFinite(credits) || credits <= 0) continue;
    const base = baseCourseCode(slot.courseCode);
    if (!base) continue;
    const entry = byBase.get(base) || { theory: 0, lab: 0 };
    const key = isLabClass(slot) ? 'lab' : 'theory';
    entry[key] = Math.max(entry[key], credits);
    byBase.set(base, entry);
  }
  const profiles = new Map<string, CourseCreditProfile>();
  for (const [base, { theory, lab }] of byBase) {
    profiles.set(base, {
      theory,
      lab,
      total: theory + lab,
      isEmbedded: theory > 0 && lab > 0,
    });
  }
  return profiles;
}

/**
 * Stamp VTOP's registered credits onto the marks records for that semester.
 *
 * Runs at the sync seam, where both the course list (as timetable slots) and
 * the marks rows are in hand — so the grade model reads credits off the same
 * record it reads assessments from, and a cached semester keeps the numbers it
 * was actually synced with. Marks rows for a course VTOP's timetable does not
 * list are returned untouched: no credit is better than a made-up one.
 */
export function attachCreditsToMarks(
  records: CourseMarksRecord[],
  slots: CreditBearingSlot[],
): CourseMarksRecord[] {
  const profiles = creditProfilesFromTimetable(slots);
  if (!profiles.size) return records;
  return records.map((record) => {
    const profile = profiles.get(baseCourseCode(record.courseCode));
    if (!profile) return record;
    return {
      ...record,
      credits: profile.total,
      theoryCredits: profile.theory,
      labCredits: profile.lab,
    };
  });
}

/**
 * Credits for one course, from the record VTOP synced. `null` means VTOP's
 * credit data is not in this cache — callers must surface that and exclude the
 * course from any credit-weighted average, never substitute a default.
 */
export function creditsOfMarkRecord(record?: {
  credits?: number;
  theoryCredits?: number;
  labCredits?: number;
} | null): CourseCreditProfile | null {
  if (!record) return null;
  const total = Number(record.credits);
  const theory = Number(record.theoryCredits);
  const lab = Number(record.labCredits);
  const hasTotal = Number.isFinite(total) && total > 0;
  const splitParts = [theory, lab].filter((n) => Number.isFinite(n) && n > 0);
  const split = splitParts.reduce((s, n) => s + n, 0);
  if (hasTotal && split > 0) {
    return { total: Math.max(total, split), theory, lab, isEmbedded: theory > 0 && lab > 0 };
  }
  if (hasTotal) {
    return { total, theory: total, lab: 0, isEmbedded: false };
  }
  if (split > 0) {
    return { total: split, theory, lab, isEmbedded: theory > 0 && lab > 0 };
  }
  return null;
}
