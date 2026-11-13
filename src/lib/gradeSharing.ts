/**
 * gradeSharing.ts — the opt-in marks aggregate behind "Grade Prediction".
 *
 * Privacy model, the same one the rest of the app uses:
 *
 *   - A contribution is keyed by a random per-browser device code, never by a
 *     registration number, name or account. The server keeps one private row
 *     per (device, course, term, component) so it can update that row on the
 *     next sync and delete it when the student turns sharing off.
 *   - Reads are aggregates only: count, mean and standard deviation. There is
 *     no client RPC that returns a contributor's row, and the table itself is
 *     RLS deny-all with no SELECT grant.
 *   - Groups are course + term + regulation + faculty + slot + component +
 *     stage. A different faculty, slot or batch is a different class, and its
 *     marks are not comparable — so the server never pools them.
 *   - Below `MIN_COHORT_SIZE` the server returns no figures, and this module
 *     enforces the same floor again before anything reaches a screen.
 *
 * Sharing defaults ON because the brief asks for it, and the toggle lives in
 * the prediction panel rather than in Settings. Turning it off withdraws the
 * stored contribution immediately; a failed withdrawal is reported, not hidden.
 */

import { callBackendRpc } from './communityBackend';
import { makeDeviceCode } from './phoneIdentity';
import { baseCourseCode } from '../utils/courseCredits';
import type { CourseMarks, TimetableSlot } from '../types';
import type { CourseTotals } from '../utils/courseTotals';

export const SHARE_STORAGE_KEY = 'ultracc.grades.share';
export const SHARE_DEFAULT_ON = true;

/** The privacy floor. A group smaller than this yields no figures at all. */
export const MIN_COHORT_SIZE = 15;

const DEVICE_STORAGE_KEY = 'ultracc.grades.deviceCode';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function storage(): Store | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Read the student's choice. Anything but a stored "off" is the default, ON. */
export function readSharePreference(store: Store | null = storage()): boolean {
  if (!store) return SHARE_DEFAULT_ON;
  try {
    return store.getItem(SHARE_STORAGE_KEY) !== 'off';
  } catch {
    return SHARE_DEFAULT_ON;
  }
}

/** Persist the student's choice so it survives a reload. */
export function writeSharePreference(on: boolean, store: Store | null = storage()): void {
  try {
    store?.setItem(SHARE_STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    /* Private mode: the choice holds for this session only. */
  }
}

/** This browser's capability token for marks sharing. */
export function getSharingDeviceCode(store: Store | null = storage()): string {
  try {
    const existing = store?.getItem(DEVICE_STORAGE_KEY);
    if (existing && existing.length >= 16) return existing;
    const code = makeDeviceCode();
    store?.setItem(DEVICE_STORAGE_KEY, code);
    return code;
  } catch {
    return makeDeviceCode();
  }
}

// ---------------------------------------------------------------------------
// Cohort identity
// ---------------------------------------------------------------------------

export type MarkComponent = 'theory' | 'lab';
export type MarkStage = 'internal' | 'final';

export interface CohortKey {
  courseCode: string;
  term: string;
  regulation: string;
  faculty: string;
  slot: string;
  component: MarkComponent;
  stage: MarkStage;
}

export interface ContributionContext {
  term: string;
  regulation: string;
  faculty: string;
  slot: string;
}

function normalize(value: string): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
}

/** One string that is equal only for genuinely comparable students. */
export function cohortKeyOf(key: CohortKey): string {
  return [
    normalize(key.courseCode),
    normalize(key.term),
    normalize(key.regulation),
    normalize(key.faculty),
    normalize(key.slot),
    key.component,
    key.stage,
  ].join('|');
}

export function sameCohort(a: CohortKey, b: CohortKey): boolean {
  return cohortKeyOf(a) === cohortKeyOf(b);
}

/** "25BEE0001" → "V2025"; an unknown register number is stated as unknown. */
export function regulationOf(regNo: string | null | undefined): string {
  const match = /^\s*(\d{2})/.exec(regNo ?? '');
  return match ? `V20${match[1]}` : '';
}

/**
 * The faculty, slot and batch columns for one course.
 *
 * VTOP's timetable registers the class; the marks record carries the slot but
 * no faculty. The timetable is the only source for who teaches it, so a course
 * with no timetable match contributes under an empty faculty and is therefore
 * only compared with students whose faculty is also unknown.
 */
export function contextOf(
  course: CourseMarks,
  timetable: TimetableSlot[],
  options: { term?: string; regNo?: string | null } = {},
): ContributionContext {
  const base = baseCourseCode(course.courseCode).toUpperCase();
  const registered = timetable.find((t) => baseCourseCode(t.courseCode).toUpperCase() === base);
  return {
    term: options.term ?? '',
    regulation: regulationOf(options.regNo),
    faculty: registered?.facultyName ?? '',
    slot: course.slot || registered?.slot || '',
  };
}

// ---------------------------------------------------------------------------
// Contributions
// ---------------------------------------------------------------------------

export interface MarksContribution extends CohortKey {
  /** The class's internal pace on the internal weight VTOP has graded, 0–100. */
  percent: number;
  /** Weight VTOP declared for that class. */
  weight: number;
}

/**
 * What one course contributes: each published class, at the internal stage.
 *
 * A half with no graded row contributes nothing — the server must never read a
 * missing class as a zero. A course whose final total VTOP has posted stops
 * contributing internal figures, because those belong to a stage the cohort
 * has already left.
 */
export function contributionsOf(
  course: CourseMarks,
  totals: CourseTotals,
  context: ContributionContext,
): MarksContribution[] {
  // Without a term and a batch there is no cohort to belong to; an empty label
  // would pool this student with every other unsynced one.
  if (!context.term || !context.regulation) return [];
  if (totals.finalTotal !== null) return [];
  return totals.classes
    .filter((c) => !c.unpublished && c.percent !== null && c.graded > 0)
    .map((c) => ({
      courseCode: course.courseCode,
      ...context,
      component: c.part === 'L' ? 'lab' : 'theory',
      stage: 'internal',
      percent: c.percent as number,
      weight: c.declared,
    }));
}

/** Upsert this device's rows. Repeating a sync updates, never duplicates. */
export async function shareContributions(
  deviceCode: string,
  rows: MarksContribution[],
): Promise<number> {
  for (const row of rows) {
    await callBackendRpc('share_marks', {
      p_device_code: deviceCode,
      p_course_code: row.courseCode,
      p_term: row.term,
      p_regulation: row.regulation,
      p_faculty: row.faculty,
      p_slot: row.slot,
      p_component: row.component,
      p_stage: row.stage,
      p_percent: row.percent,
      p_weight: row.weight,
    });
  }
  return rows.length;
}

/** Remove every contribution this device has stored. */
export async function withdrawContributions(deviceCode: string): Promise<boolean> {
  const result = await callBackendRpc<{ withdrawn?: boolean }>('withdraw_marks', {
    p_device_code: deviceCode,
  });
  return !!result?.withdrawn;
}

// ---------------------------------------------------------------------------
// Aggregate reads
// ---------------------------------------------------------------------------

export interface CohortStats {
  count: number;
  mean: number | null;
  sd: number | null;
  /** The group is below the floor; no figures are being shown. */
  suppressed: boolean;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Accept a server payload only if it respects the floor.
 *
 * The RPC already suppresses small groups; this is the second check, so a
 * misconfigured deployment cannot leak a "mean of 3" into a screen.
 */
export function normalizeCohortStats(payload: unknown): CohortStats {
  const raw = (payload ?? {}) as Record<string, unknown>;
  const count = typeof raw.count === 'number' && Number.isFinite(raw.count) && raw.count >= 0
    ? Math.floor(raw.count)
    : 0;
  const mean = finiteOrNull(raw.mean);
  const sd = finiteOrNull(raw.sd);
  if (count < MIN_COHORT_SIZE || mean === null) {
    return { count, mean: null, sd: null, suppressed: true };
  }
  return { count, mean, sd, suppressed: false };
}

/** Mean and spread for one cohort. Contains no contributor-level data. */
export async function fetchCohortStats(key: CohortKey): Promise<CohortStats> {
  const payload = await callBackendRpc<unknown>('shared_marks_stats', {
    p_course_code: key.courseCode,
    p_term: key.term,
    p_regulation: key.regulation,
    p_faculty: key.faculty,
    p_slot: key.slot,
    p_component: key.component,
    p_stage: key.stage,
  });
  return normalizeCohortStats(payload);
}

export interface StatsReading {
  level: 'none' | 'ok';
  count: number;
  mean: number | null;
  sd: number | null;
  /** Own pace minus the group mean, in percentage points. */
  difference: number | null;
  /** Mean ± one standard deviation, clamped to 0–100. Null without an SD. */
  band: [number, number] | null;
  /** A reason to read the group cautiously, when one applies. */
  warning: string | null;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/**
 * How a cohort's figures may be stated.
 *
 * Under the floor there is nothing to say beyond "not enough comparable data".
 * Above it, the difference and the spread are stated; a small group or a wide
 * spread earns a warning instead of quiet confidence.
 */
export function readCohortStats(stats: CohortStats, ownPercent: number | null): StatsReading {
  if (stats.mean === null || stats.count < MIN_COHORT_SIZE) {
    return {
      level: 'none',
      count: stats.count,
      mean: null,
      sd: null,
      difference: null,
      band: null,
      warning: null,
    };
  }
  const band = stats.sd === null
    ? null
    : [clampPercent(stats.mean - stats.sd), clampPercent(stats.mean + stats.sd)] as [number, number];
  const difference = ownPercent === null ? null : Math.round((ownPercent - stats.mean) * 100) / 100;
  const warning = stats.count < 30
    ? `Small group (${stats.count} students) — treat this as a rough comparison.`
    : stats.sd !== null && stats.sd > 15
      ? 'Wide spread in this group, so the average describes the class loosely.'
      : null;
  return {
    level: 'ok',
    count: stats.count,
    mean: Math.round(stats.mean * 100) / 100,
    sd: stats.sd,
    difference,
    band,
    warning,
  };
}
