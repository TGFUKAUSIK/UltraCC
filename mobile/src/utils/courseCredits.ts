/**
 * courseCredits.ts — authoritative course credits, from VTOP's own registered
 * course list (L T P J C). Ported verbatim.
 */

import type { CourseMarksRecord } from '../types';

export interface CreditBearingSlot {
  courseCode: string;
  slot: string;
  courseType?: string;
  isLab?: boolean;
  credits?: number;
}

export interface CourseCreditProfile {
  total: number;
  theory: number;
  lab: number;
  isEmbedded: boolean;
}

export function baseCourseCode(code: string): string {
  const raw = (code || '').trim().toUpperCase();
  return raw.length > 4 && raw.endsWith('L') ? raw.slice(0, -1) : raw;
}

function isLabClass(slot: CreditBearingSlot): boolean {
  if (slot.isLab) return true;
  const type = (slot.courseType || '').toUpperCase();
  if (type.includes('ELA') || type.includes('LAB')) return true;
  const code = (slot.courseCode || '').trim().toUpperCase();
  if (code.length > 4 && code.endsWith('L')) return true;
  const slots = (slot.slot || '').toUpperCase().replace(/\s+/g, '');
  return slots.length > 0 && slots.split('+').every((s) => /^L\d/.test(s));
}

export function creditProfilesFromTimetable(slots: CreditBearingSlot[]): Map<string, CourseCreditProfile> {
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
    profiles.set(base, { theory, lab, total: theory + lab, isEmbedded: theory > 0 && lab > 0 });
  }
  return profiles;
}

export function attachCreditsToMarks(records: CourseMarksRecord[], slots: CreditBearingSlot[]): CourseMarksRecord[] {
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
