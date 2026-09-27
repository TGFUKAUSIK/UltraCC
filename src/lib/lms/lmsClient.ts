/**
 * LMS Client — unified facade over LmsRealClient + syncLmsData.
 *
 * Moodle credentials are separate from VTOP credentials. The LMS username is
 * the exact username/email supplied by the student from VTOP's credentials
 * area; it must never be derived from a VTOP registration number.
 */

import { VtopError } from '../vtop/errors';
import { saveLmsCredentials } from '../settings';
import type { AssignmentRecord } from '../vtop/types';
import { LmsRealClient } from './realClient';
import { syncLmsData, type LmsSyncOutcome } from './syncLms';
import type { LmsCourse } from './types';

// ---------------------------------------------------------------------------
// Shared in-memory client (session token never persisted)
// ---------------------------------------------------------------------------

let _client: LmsRealClient | null = null;

export function getLmsRealClient(): LmsRealClient {
  if (!_client) _client = new LmsRealClient();
  return _client;
}

export function resetLmsClient(): void {
  _client = null;
}

/** Preserve the exact Moodle username supplied by the student. */
export function lmsUsernameFromRegNo(username: string): string {
  return username.trim();
}

// ---------------------------------------------------------------------------
// Full LMS sync — login + fetch all datasets + persist to IndexedDB
// ---------------------------------------------------------------------------

export interface LmsSyncRunResult {
  ok: boolean;
  message: string;
  outcome?: LmsSyncOutcome;
  failed: { label: string; error: string }[];
}

/**
 * A dataset row always renders as "<label>: <error>", so an outcome that
 * somehow arrives without a reason still has to read like one.
 */
const LMS_DATASET_FAILED = 'The LMS did not answer, so this was not loaded.';

/**
 * The one sentence that means "the LMS has never been given credentials".
 * Exported because the LMS panel's status badge keys off it — as a bare string
 * literal in two files, editing one silently turned "Authentication required"
 * into "Not synced".
 */
export const LMS_NEEDS_CREDENTIALS = 'Enter your LMS username and password in Settings first.';

/**
 * Authenticate with Moodle and sync courses, assignments, quizzes,
 * gradebook, materials, forum, and calendar into IndexedDB.
 */
export async function runFullLmsSync(username: string, password: string): Promise<LmsSyncRunResult> {
  const lmsUsername = lmsUsernameFromRegNo(username);
  saveLmsCredentials({ username: lmsUsername, password });

  const client = getLmsRealClient();
  await client.initializeSession();
  await client.login(lmsUsername, password);

  const outcome = await syncLmsData(client);
  const failed = outcome.results
    .filter((r) => !r.ok)
    .map((r) => ({ label: r.label, error: r.error || LMS_DATASET_FAILED }));

  const msg = failed.length === 0
    ? `LMS synced — ${outcome.courses.length} course${outcome.courses.length === 1 ? '' : 's'}.`
    : `LMS synced with ${failed.length} issue${failed.length === 1 ? '' : 's'}.`;

  return { ok: failed.length === 0, message: msg, outcome, failed };
}

/**
 * Attempt LMS login + full sync after VTOP login (same credentials).
 * Non-fatal wrapper — returns false on failure without throwing.
 */
export async function tryLmsLogin(regNo: string, password: string): Promise<boolean> {
  try {
    const result = await runFullLmsSync(regNo, password);
    return result.ok || (result.outcome?.courses.length ?? 0) > 0;
  } catch (e) {
    console.warn('[lmsClient] LMS sync failed:', e instanceof Error ? e.message : String(e));
    return false;
  }
}

// ---------------------------------------------------------------------------
// Assignment helpers (used by syncSemester as LMS-first fallback)
// ---------------------------------------------------------------------------

export async function getAllLmsAssignments(): Promise<AssignmentRecord[]> {
  const client = getLmsRealClient();
  if (!client.hasSessionToken()) return [];

  let courses: LmsCourse[];
  try {
    courses = await client.getCourses();
  } catch {
    return [];
  }
  if (!courses.length) return [];

  const allAssignments: AssignmentRecord[] = [];
  for (const course of courses) {
    try {
      const assignments = await client.getAssignments(course.courseId);
      for (const a of assignments) {
        const courseCodeMatch = course.name.match(/^([A-Z]{2,5}\d{3,4})/i);
        const courseCode = courseCodeMatch
          ? courseCodeMatch[1].toUpperCase()
          : course.shortName || course.name;

        allAssignments.push({
          id: `lms-${course.courseId}-${a.assignmentId}`,
          courseCode,
          courseTitle: course.name,
          title: a.name,
          dueDate: a.dueDate || '',
          weightage: 0,
          status: 'Pending',
        });
      }
    } catch {
      console.warn(`[lmsClient] Failed to fetch assignments for course ${course.name}`);
    }
  }
  return allAssignments;
}

/** Thin wrapper — syncSemester uses .authenticated / .getAllAssignments(). */
export class LmsClient {
  get authenticated(): boolean {
    return getLmsRealClient().hasSessionToken();
  }

  async initializeSession(): Promise<void> {
    return getLmsRealClient().initializeSession();
  }

  async login(regNo: string, password: string): Promise<void> {
    const email = lmsUsernameFromRegNo(regNo);
    await getLmsRealClient().login(email, password);
  }

  async checkSession(): Promise<boolean> {
    try {
      const status = await getLmsRealClient().getSessionStatus();
      return status.authenticated;
    } catch (e) {
      if (e instanceof VtopError && e.code === 'SESSION_EXPIRED') return false;
      return false;
    }
  }

  async getCourses() {
    return getLmsRealClient().getCourses();
  }

  async getCourseAssignments(courseId: number) {
    return getLmsRealClient().getAssignments(courseId);
  }

  async getAllAssignments(): Promise<AssignmentRecord[]> {
    return getAllLmsAssignments();
  }

  async logout(): Promise<void> {
    await getLmsRealClient().logout();
    resetLmsClient();
  }
}

let _instance: LmsClient | null = null;

export function getLmsClient(): LmsClient {
  if (!_instance) _instance = new LmsClient();
  return _instance;
}
