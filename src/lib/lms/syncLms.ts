/**
 * syncLms — LMS (Moodle) sync orchestration.
 *
 * Mirrors syncSemesterData's discipline: FAILURES ARE NEVER SILENT. Each
 * dataset returns an outcome; the UI surfaces exactly which dataset failed
 * and why. Nothing is written to IndexedDB unless it parsed successfully
 * (a failed dataset keeps its previous cache rather than being wiped — for
 * the LMS, unlike VTOP, there is no semester-swap invalidation concern, so
 * keeping the last good cache is the better offline-first behavior).
 */

import { LmsRealClient } from './realClient';
import { LmsCourse, LmsSyncDatasetResult } from './types';
import { humanErrorCopy } from '../errorCopy';
import { vtopDb } from '../db/vtopDatabase';

export interface LmsSyncOutcome {
  results: LmsSyncDatasetResult[];
  courses: LmsCourse[];
  /** Per-course outcomes (course label + which datasets failed). */
  courseResults: { courseId: number; courseName: string; results: LmsSyncDatasetResult[] }[];
}

/**
 * A dataset failure string is rendered straight into the LMS panel and the
 * Settings diagnostics, so it has to be copy already. The old version here
 * split on ':' and kept the tail, which turned
 * "LMS gateway returned HTTP 502: <html…>" into a page of markup — the
 * colon-stripping was a symptom-level fix for leaky transport messages, and
 * those are now curated at the source (realClient / the gateway). What is left
 * is the shared gate: keep a sentence our code wrote, replace anything that
 * reads like a machine.
 */
function toSyncError(e: unknown): string {
  return humanErrorCopy(e, 'The LMS did not answer, so this was not loaded. Your other data is unaffected.');
}

const COURSE_LABELS: [string, string][] = [
  ['assignments', 'Assignments'],
  ['quiz-windows', 'Quiz Windows'],
  ['gradebook', 'Gradebook'],
  ['materials', 'Materials'],
  ['forum', 'Forum'],
];

/**
 * Sync all LMS data:
 *   1. courses (GET /my/),
 *   2. per course: assignments / quiz-windows / gradebook / materials / forum,
 *   3. calendar events (global).
 *
 * Returns per-dataset outcomes so the UI can show exactly what failed.
 */
export async function syncLmsData(client: LmsRealClient): Promise<LmsSyncOutcome> {
  // Step 1: courses
  let courses: LmsCourse[] = [];
  let coursesOk = true;
  let coursesError: string | undefined;
  try {
    courses = await client.getCourses();
    await vtopDb.saveLmsCourses(courses);
  } catch (e) {
    coursesOk = false;
    coursesError = toSyncError(e);
    // A transient gateway/Moodle failure must not hide a valid offline cache
    // or prevent the rest of the sync UI from explaining what is stale.
    // Never write [] after a failed live request.
    try {
      courses = await vtopDb.getLmsCourses();
    } catch {
      courses = [];
    }
  }
  const results: LmsSyncDatasetResult[] = [
    { key: 'courses', label: 'Courses', ok: coursesOk, ...(coursesError ? { error: coursesError } : {}) },
  ];

  const courseResults: LmsSyncOutcome['courseResults'] = [];

  // Step 2: per-course datasets (sequential — a handful of courses)
  for (const course of courses) {
    const courseR: LmsSyncDatasetResult[] = [];
    // Keep requests serial: every gateway response contains a freshly
    // encrypted session token. Parallel requests would all start with the
    // same token and whichever response completed last could roll the client
    // back to an older cookie jar.
    const settled: PromiseSettledResult<unknown>[] = [];
    for (const fetcher of [
      () => client.getAssignments(course.courseId),
      () => client.getQuizWindows(course.courseId),
      () => client.getGradebook(course.courseId),
      () => client.getMaterials(course.courseId),
      () => client.getForumAnnouncements(course.courseId),
    ]) {
      try {
        settled.push({ status: 'fulfilled', value: await fetcher() });
      } catch (reason) {
        settled.push({ status: 'rejected', reason });
      }
    }

    settled.forEach((s, i) => {
      courseR.push({
        key: COURSE_LABELS[i][0],
        label: COURSE_LABELS[i][1],
        ok: s.status === 'fulfilled',
        ...(s.status === 'rejected' ? { error: toSyncError(s.reason) } : {}),
      });
    });

    const [assignments, quizzes, gradebook, materials, forum] = settled as [
      PromiseSettledResult<Awaited<ReturnType<LmsRealClient['getAssignments']>>>,
      PromiseSettledResult<Awaited<ReturnType<LmsRealClient['getQuizWindows']>>>,
      PromiseSettledResult<Awaited<ReturnType<LmsRealClient['getGradebook']>>>,
      PromiseSettledResult<Awaited<ReturnType<LmsRealClient['getMaterials']>>>,
      PromiseSettledResult<Awaited<ReturnType<LmsRealClient['getForumAnnouncements']>>>,
    ];
    // Only persist datasets that parsed successfully.
    await vtopDb.saveLmsCourseData(course.courseId, {
      assignments: assignments.status === 'fulfilled' ? assignments.value : undefined,
      quizzes: quizzes.status === 'fulfilled' ? quizzes.value : undefined,
      gradebook: gradebook.status === 'fulfilled' ? gradebook.value : undefined,
      materials: materials.status === 'fulfilled' ? materials.value : undefined,
      forum: forum.status === 'fulfilled' ? forum.value : undefined,
    });

    courseResults.push({ courseId: course.courseId, courseName: course.name, results: courseR });
    results.push(...courseR.map((r) => ({ ...r, key: `${course.courseId}:${r.key}`, label: `${course.name}: ${r.label}` })));
  }

  // Step 3: calendar events
  try {
    const events = await client.getCalendarEvents();
    await vtopDb.saveLmsCalendar(events);
    results.push({ key: 'calendar', label: 'LMS Calendar', ok: true });
  } catch (e) {
    results.push({ key: 'calendar', label: 'LMS Calendar', ok: false, error: toSyncError(e) });
  }

  // Metadata: username hint (first 4 chars, safe)
  let usernameHint = '';
  try {
    const creds = (await import('../settings')).getSavedLmsCredentials();
    usernameHint = creds.username.slice(0, 4);
  } catch { /* ignore */ }

  const attemptedAt = Date.now();
  const successfulDatasets = results.filter((result) => result.ok).length;
  const previousMeta = await vtopDb.getLmsMetadata();
  const status: 'synced' | 'partial' | 'failed' = successfulDatasets === 0
    ? 'failed'
    : results.every((result) => result.ok)
      ? 'synced'
      : 'partial';
  await vtopDb.saveLmsMetadata({
    // Keep the last known-good timestamp on a completely failed run. This
    // makes “last synced” mean what it says instead of meaning “last tried”.
    lastSyncedAt: successfulDatasets > 0 ? attemptedAt : (previousMeta?.lastSyncedAt || 0),
    lastAttemptedAt: attemptedAt,
    lastSyncStatus: status,
    usernameHint,
    coursesSynced: courses.length,
  });

  return { results, courses, courseResults };
}
