/**
 * Shared semester-aware sync helpers, used by both the sync modal and the
 * dashboard's semester switcher so the two can never drift apart.
 *
 * Rule: a sync ALWAYS belongs to exactly one semester. `syncSemesterData`
 * fetches every dataset for the given semester, joins the VTOP exam page
 * (which has no course-code column) to that semester's timetable, and writes
 * the whole result to IndexedDB in a single transaction — atomically
 * invalidating any previous semester's cache (the stores are cleared and
 * rewritten together with the new `selectedSemesterId` metadata).
 */

import { RealVTOPClient } from './realClient';
import { SemesterInfo } from './types';
import { vtopDb } from '../db/vtopDatabase';
import { enrichExamsWithCourses } from '../../utils/examUtils';
import { attachCreditsToMarks } from '../../utils/courseCredits';
import { debugErrorDetail, humanErrorCopy } from '../errorCopy';
import { getLmsClient } from '../lms/lmsClient';
import type { AssignmentRecord } from './types';

/** Build VTOP-style assignment records from cached LMS IndexedDB data. */
async function assignmentsFromLmsCache(): Promise<AssignmentRecord[]> {
  const courses = await vtopDb.getLmsCourses();
  if (!courses.length) return [];
  const out: AssignmentRecord[] = [];
  for (const course of courses) {
    const data = await vtopDb.getLmsCourseData(course.courseId);
    if (!data?.assignments.length) continue;
    const courseCodeMatch = course.name.match(/^([A-Z]{2,5}\d{3,4})/i);
    const courseCode = courseCodeMatch
      ? courseCodeMatch[1].toUpperCase()
      : course.shortName || course.name;
    for (const a of data.assignments) {
      out.push({
        id: `lms-${course.courseId}-${a.assignmentId}`,
        courseCode,
        courseTitle: course.name,
        title: a.name,
        dueDate: a.dueDate || '',
        weightage: 0,
        status: 'Pending',
      });
    }
  }
  return out;
}

/**
 * Pick the semester to sync:
 *   1. the student's saved selection (persisted in IndexedDB metadata), if it
 *      still exists in VTOP's list — never silently overwritten by the
 *      "current" semester;
 *   2. VTOP's active semester;
 *   3. the first available option.
 */
export function pickSemesterId(savedId: string, semesters: SemesterInfo[]): string {
  if (!semesters.length) return '';
  if (savedId && semesters.some((s) => s.id === savedId)) return savedId;
  return semesters.find((s) => s.isCurrent)?.id || semesters[0].id || '';
}

/** One dataset's outcome after a sync — lets the UI show exactly what failed. */
export interface SyncDatasetResult {
  key: string;
  label: string;
  ok: boolean;
  error?: string;
  /** Sanitized diagnostic detail (e.g. marks assessment titles VTOP served). */
  detail?: string;
}

const DATASET_LABELS: [string, string][] = [
  ['profile', 'Profile'],
  ['attendance', 'Attendance'],
  ['timetable', 'Timetable'],
  ['marks', 'Marks'],
  ['exams', 'Exams'],
  ['assignments', 'Assignments'],
  ['grades', 'CGPA / Credits'],
  ['gradeHistory', 'Grade History'],
  ['semesterGrades', 'Semester Grades'],
  ['od', 'OD Hours'],
  ['calendar', 'Academic Calendar'],
  ['arrears', 'Arrears'],
  ['circulars', 'Circulars'],
  ['curriculum', 'Credit Progress'],
  ['makeupExams', 'Makeup Exams'],
  ['refat', 'Re-exam (reFAT)'],
  ['compre', 'Compre Exam'],
  ['payments', 'Fee Dues'],
  ['credentials', 'My Credentials'],
  ['transport', 'Transport Registration'],
  ['sapInfo', 'SAP Info'],
  ['paymentReceipts', 'Payment Receipts'],
  ['bankInfo', 'Bank Info'],
  ['biometric', 'Biometric'],
  ['proctorMessages', 'Proctor Messages'],
  ['loginHistory', 'Login History'],
  ['classMessages', 'Class Messages'],
  ['hodDean', 'HOD / Dean'],
  ['wallet', 'Wallet'],
  ['extraCurricular', 'Extra-Curricular'],
];

/**
 * Datasets whose rows belong to one specific term (as opposed to the whole
 * account). Used to decide which cached rows may survive a failed refresh.
 */
const TERM_SCOPED_DATASETS = new Set([
  'attendance', 'timetable', 'marks', 'exams', 'assignments', 'semesterGrades', 'od', 'calendar',
]);

function toSyncError(e: unknown): string {
  if (e instanceof Error) {
    // Strip the raw gateway error noise — keep only the human part.
    const msg = e.message;
    const human = msg.includes(':') ? msg.split(':').slice(1).join(':').trim() || msg : msg;
    // Curated copy ("VTOP changed its page structure", "Session expired")
    // survives; transport noise ("Failed to fetch", "HTTP 502 Bad Gateway",
    // an aborted request) becomes one actionable line in every dataset chip.
    return humanErrorCopy(human, 'VTOP could not be reached for this — showing cached data.');
  }
  return humanErrorCopy(e, 'VTOP could not be reached for this — showing cached data.');
}

/**
 * Fetch every dataset for one semester and persist it (invalidates stale cache).
 *
 * FAILURES ARE NEVER SILENT: a dataset that fails to fetch is stored empty (so
 * stale data from another semester can't leak in) but its error is returned in
 * `results` — the sync modal surfaces it (e.g. "Marks: VTOP changed its page
 * structure") instead of pretending everything synced.
 */
export async function syncSemesterData(
  client: RealVTOPClient,
  semId: string,
  semestersList: SemesterInfo[]
): Promise<SyncDatasetResult[]> {
  const settled = await Promise.allSettled([
    client.getProfile(),
    client.getAttendance(semId),
    client.getTimetable(semId),
    client.getMarks(semId),
    client.getExams(semId),
    client.getAssignments(semId),
    client.getGrades(),
    client.getGradeHistory(),
    client.getSemesterGrades(semId),
    client.getOd(semId),
    client.getCalendar(semId),
    client.getArrears(),
    client.getCirculars(),
    client.getCurriculum(),
    client.getMakeupExams(),
    client.getRefat(),
    client.getCompre(),
    client.getPayments(),
    client.getCredentials(),
    client.getTransport(),
    client.getSapInfo(),
    client.getPaymentReceipts(),
    client.getBankInfo(),
    client.getBiometricInfo(),
    client.getProctorMessages(),
    client.getLoginHistory(),
    client.getClassMessages(),
    client.getHodDean(),
    client.getWallet(),
    client.getExtraCurricular(),
  ]);
  const keys = DATASET_LABELS.map(([k]) => k);

  const results: SyncDatasetResult[] = settled.map((s, i) => ({
    key: keys[i],
    label: DATASET_LABELS[i][1],
    ok: s.status === 'fulfilled',
    ...(s.status === 'rejected' ? { error: toSyncError(s.reason) } : {}),
  }));

  // Marks diagnostic: prove which assessment components VTOP actually served
  // (sanitized titles only) so a sparse table is diagnosable, never assumed.
  // This is developer information, so it goes to the dev console and the sync
  // record — not to the Marks page.
  const marksDiag = (client as { lastMarksDiag?: { courseCode: string; courseTitle: string; assessments: string[] }[] }).lastMarksDiag ?? [];
  if (marksDiag.length) {
    const marksIdx = results.findIndex((r) => r.key === 'marks');
    const totalAssessments = marksDiag.reduce((n, c) => n + c.assessments.length, 0);
    const summary = `${marksDiag.length} course${marksDiag.length === 1 ? '' : 's'}, ${totalAssessments} assessment${totalAssessments === 1 ? '' : 's'} served by VTOP`;
    if (marksIdx >= 0) results[marksIdx].detail = summary;
    debugErrorDetail('marks-sync', `${summary} :: ${marksDiag.map((c) => `${c.courseCode}=[${c.assessments.join(', ') || 'none'}]`).join(' ')}`);
  }

  const [profile, attendance, timetable, marks, exams, assignments, grades, gradeHistory, semesterGrades, od, calendar, arrears, circulars, curriculum, makeupExams, refat, compre, payments, credentials, transport, sapInfo, paymentReceipts, bankInfo, biometric, proctorMessages, loginHistory, classMessages, hodDean, wallet, extraCurricular] = settled;

  const timetableResolved = timetable.status === 'fulfilled' ? timetable.value : [];

  // CRITICAL: Read existing cache BEFORE saving.  For any dataset that failed
  // (rejected), preserve the previous cached data so the user sees stale-but-
  // valid data instead of an empty wipe.  This matches the UI promise:
  // "showing previous cached data where possible."
  const existingCache = await vtopDb.getAllData();

  // The fallback above is only valid for the SAME student. When a different
  // registration number signs in, the previous account's bank info, wallet,
  // fees and messages must never be merged into this sync — and must not be
  // left behind in stores this sync writes nothing for.
  const incomingRegNo = (profile.status === 'fulfilled' ? profile.value?.registrationNo : '') || '';
  const cachedRegNo = existingCache?.metadata?.registrationNo || '';
  const accountSwitched =
    incomingRegNo.trim().toUpperCase() !== '' &&
    cachedRegNo.trim().toUpperCase() !== '' &&
    incomingRegNo.trim().toUpperCase() !== cachedRegNo.trim().toUpperCase();
  if (accountSwitched) {
    // Best-effort: whatever happens to this delete, the previous account's
    // rows must not be merged in below, hence `prev` is nulled either way.
    try {
      await vtopDb.clearVtopStores();
    } catch (e) {
      results.push({
        key: 'cache-clear',
        label: 'Previous account data',
        ok: false,
        error: `Could not clear the previous account's cached data: ${toSyncError(e)}`,
      });
    }
    /*
     * The LMS stores live outside VTOP_STORES — Moodle data is keyed by
     * courseId, so clearVtopStores() cannot reach it. Without this second
     * delete, signing in as a different student on a shared phone left the
     * previous student's Moodle courses, assignments, materials and username
     * hint readable in the LMS section. Reported separately on purpose: failing
     * to clear LMS rows is its own honest failure, not a VTOP one.
     */
    try {
      await vtopDb.clearLmsData();
    } catch (e) {
      results.push({
        key: 'lms-cache-clear',
        label: 'Previous LMS data',
        ok: false,
        error: `Could not clear the previous account's LMS data: ${toSyncError(e)}`,
      });
    }
  }

  /**
   * A dataset that failed to refresh falls back to the previous cache below.
   * That is only valid for datasets that belong to the whole account: on a
   * semester switch, reusing the *other* term's attendance, marks, timetable or
   * OD rows re-labelled them as the new term's own data and stored them under
   * the new semester id. For term-scoped datasets a failure now means empty
   * plus an explicit per-dataset error, which is what the UI already surfaces.
   */
  const cachedSemesterId = (existingCache?.metadata?.selectedSemesterId || '').trim();
  const switchingSemesters = cachedSemesterId !== '' && cachedSemesterId !== semId;
  const prev = (accountSwitched ? null : existingCache) || ({} as Partial<typeof existingCache>);

  /** Return the fresh value when fulfilled, otherwise the previous cache value. */
  function orPrev<T>(key: string, settledResult: PromiseSettledResult<T>, prevVal: T | undefined, fallback: T): T {
    if (settledResult.status === 'fulfilled') return settledResult.value;
    if (switchingSemesters && TERM_SCOPED_DATASETS.has(key)) return fallback;
    return prevVal !== undefined ? prevVal : fallback;
  }

  const resolved = {
    profile:     orPrev('profile',     profile,     prev.profile,     null),
    attendance:  orPrev('attendance',  attendance,  prev.attendance,  []),
    timetable:   timetableResolved,
    // VTOP's marks page has no credits column. The credits a course is graded
    // with come from the same semester's registered course list (L T P J C),
    // so they are joined here — the one place both datasets are in hand — and
    // stored on the marks record. Without this the grade model had to take
    // first-slot-wins credits or invent 3 per course.
    marks:       attachCreditsToMarks(orPrev('marks', marks, prev.marks, []), timetableResolved),
    // The VTOP exam page has no course-code column — join to the
    // semester's timetable by slot (deterministic, never guessed).
    exams:       exams.status === 'fulfilled' ? enrichExamsWithCourses(exams.value, timetableResolved) : (switchingSemesters ? [] : (prev.exams ?? [])),
    assignments: await (async () => {
      // After an account switch the LMS session/cache still belongs to the
      // previous student, so only this sync's VTOP assignments may be used.
      if (!accountSwitched) {
        // Try live LMS session first (lms.vit.ac.in)
        try {
          const lms = getLmsClient();
          if (lms.authenticated) {
            const lmsAssignments = await lms.getAllAssignments();
            if (lmsAssignments.length > 0) return lmsAssignments;
          }
        } catch { /* fall through */ }
        // Cached LMS data (populated by runFullLmsSync after VTOP login)
        try {
          const cached = await assignmentsFromLmsCache();
          if (cached.length > 0) return cached;
        } catch { /* fall through */ }
      }
      // Fallback: VTOP Digital Assignments
      return orPrev('assignments', assignments, prev.assignments, []);
    })(),
    grades:      orPrev('grades',      grades,      prev.grades,      null),
    gradeHistory: orPrev('gradeHistory', gradeHistory, prev.gradeHistory, null),
    semesterGrades: orPrev('semesterGrades', semesterGrades, prev.semesterGrades, null),
    od:          orPrev('od',          od,          prev.od,          null),
    calendar:    orPrev('calendar',    calendar,    prev.calendar,    null),
    arrears:     orPrev('arrears',     arrears,     prev.arrears,     []),
    circulars:   orPrev('circulars',   circulars,   prev.circulars,   []),
    curriculum:  orPrev('curriculum',  curriculum,  prev.curriculum,  null),
    makeupExams: orPrev('makeupExams', makeupExams, prev.makeupExams, []),
    refat:       orPrev('refat',       refat,       prev.refat,       null),
    compre:      orPrev('compre',      compre,      prev.compre,      null),
    payments:    orPrev('payments',    payments,    prev.payments,    null),
    credentials: orPrev('credentials', credentials, prev.credentials, null),
    transport:   orPrev('transport',   transport,   prev.transport,   null),
    sapInfo:     orPrev('sapInfo',     sapInfo,     prev.sapInfo,     null),
    paymentReceipts: orPrev('paymentReceipts', paymentReceipts, prev.paymentReceipts, null),
    bankInfo:    orPrev('bankInfo',    bankInfo,    prev.bankInfo,    null),
    biometric:   orPrev('biometric',   biometric,   prev.biometric,   null),
    proctorMessages: orPrev('proctorMessages', proctorMessages, prev.proctorMessages, []),
    loginHistory: orPrev('loginHistory', loginHistory, prev.loginHistory, []),
    classMessages: orPrev('classMessages', classMessages, prev.classMessages, []),
    hodDean:     orPrev('hodDean',     hodDean,     prev.hodDean,     null),
    wallet:      orPrev('wallet',      wallet,      prev.wallet,      null),
    extraCurricular: orPrev('extraCurricular', extraCurricular, prev.extraCurricular, null),
  };

  // The cache is a local concern. VTOP accepted the login and answered every
  // dataset; failing to persist that must be reported, never re-thrown — the
  // rethrow surfaced as "VTOP sync failed" and locked a signed-in student out
  // of an app that had their whole semester in memory.
  try {
    await vtopDb.saveAllData(
      { ...resolved, semesters: semestersList, marksDiag },
      'LIVE_VTOP',
      semId,
      resolved.profile?.registrationNo
    );
  } catch (e) {
    results.push({
      key: 'cache',
      label: 'Local cache',
      ok: false,
      error: `Data was fetched but could not be saved on this device: ${toSyncError(e)}`,
    });
  }

  return results;
}
