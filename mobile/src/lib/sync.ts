/**
 * sync.ts — semester-scoped sync orchestration, mirroring the web app's
 * src/lib/vtop/syncSemester.ts. A sync always belongs to one semester; every
 * dataset is fetched with Promise.allSettled so a single VTOP failure can't
 * wipe the rest, and term-scoped datasets fall back to cached rows only when
 * the SAME student is re-syncing the SAME term.
 */

import { VtopGatewayClient } from './gateway';
import type {
  AcademicCalendar,
  AssignmentRecord,
  AttendanceRecord,
  CourseMarksRecord,
  ExamRecord,
  GradeSummary,
  OdSummary,
  SemesterGrades,
  SemesterInfo,
  StudentProfile,
  TimetableSlot,
  TransportInfo,
} from '../types';
import { attachCreditsToMarks } from '../utils/courseCredits';
import { enrichExamsWithCourses } from '../utils/examUtils';
import { clearAllCache, readCache, writeCache } from './storage';

/** The whole synced snapshot, persisted as one JSON blob per term. */
export interface CachedData {
  registrationNo: string;
  semesterId: string;
  syncedAt: number;
  profile: StudentProfile | null;
  attendance: AttendanceRecord[];
  timetable: TimetableSlot[];
  marks: CourseMarksRecord[];
  exams: ExamRecord[];
  assignments: AssignmentRecord[];
  grades: GradeSummary | null;
  semesterGrades: SemesterGrades | null;
  od: OdSummary | null;
  calendar: AcademicCalendar | null;
  transport: TransportInfo | null;
}

export interface SyncResult {
  ok: boolean;
  /** Per-dataset outcomes, so the UI can show exactly what failed. */
  datasets: { key: string; label: string; ok: boolean }[];
  syncedAt: number | null;
  error?: string;
}

const META_KEY = 'meta';

interface Meta {
  registrationNo: string;
  selectedSemesterId: string;
  campus: string;
}

export async function readMeta(): Promise<Meta | null> {
  return readCache<Meta>(META_KEY);
}

export async function writeMeta(meta: Meta): Promise<void> {
  await writeCache(META_KEY, meta);
}

export function cacheKey(regNo: string, semId: string): string {
  return `data:${regNo.trim().toUpperCase()}:${semId}`;
}

const TERM_SCOPED = new Set(['attendance', 'timetable', 'marks', 'exams', 'assignments', 'semesterGrades', 'od', 'calendar']);

export function pickSemesterId(savedId: string, semesters: SemesterInfo[]): string {
  if (!semesters.length) return '';
  if (savedId && semesters.some((s) => s.id === savedId)) return savedId;
  return semesters.find((s) => s.isCurrent)?.id || semesters[0].id || '';
}

/**
 * Fetch every dataset for one semester and persist it atomically. Failures are
 * reported per-dataset; term-scoped datasets fall back to the previous cache
 * only when the SAME student re-syncs the SAME term (never across accounts).
 */
export async function syncSemesterData(
  client: VtopGatewayClient,
  semId: string,
  semesters: SemesterInfo[],
): Promise<SyncResult> {
  const settled = await Promise.allSettled([
    client.getProfile(),
    client.getAttendance(semId),
    client.getTimetable(semId),
    client.getMarks(semId),
    client.getExams(semId),
    client.getAssignments(semId),
    client.getGrades(),
    client.getSemesterGrades(semId),
    client.getOd(semId),
    client.getCalendar(semId),
    client.getTransport(),
  ]);

  const keys = ['profile', 'attendance', 'timetable', 'marks', 'exams', 'assignments', 'grades', 'semesterGrades', 'od', 'calendar', 'transport'];
  const labels = ['Profile', 'Attendance', 'Timetable', 'Marks', 'Exams', 'Assignments', 'CGPA / Credits', 'Semester Grades', 'OD Hours', 'Academic Calendar', 'Transport'];
  const datasets = settled.map((s, i) => ({ key: keys[i], label: labels[i], ok: s.status === 'fulfilled' }));

  const [profile, attendance, timetable, marks, exams, assignments, grades, semesterGrades, od, calendar, transport] = settled;

  const incomingRegNo = (profile.status === 'fulfilled' ? profile.value?.registrationNo : '') || '';
  const meta = await readMeta();
  const accountSwitched =
    incomingRegNo.trim().toUpperCase() !== '' &&
    !!meta?.registrationNo &&
    incomingRegNo.trim().toUpperCase() !== meta.registrationNo.trim().toUpperCase();

  if (accountSwitched) {
    await clearAllCache();
  }

  const switchingSemesters = !!meta?.selectedSemesterId && meta.selectedSemesterId !== semId;
  const prev = accountSwitched ? null : await readCache<CachedData>(cacheKey(incomingRegNo || meta?.registrationNo || '', semId));

  function orPrev<T>(key: string, result: PromiseSettledResult<T>, fallback: T): T {
    if (result.status === 'fulfilled') return result.value;
    if (switchingSemesters && TERM_SCOPED.has(key)) return fallback;
    if (prev) return (prev as unknown as Record<string, T>)[key] ?? fallback;
    return fallback;
  }

  const timetableResolved = timetable.status === 'fulfilled' ? timetable.value : (prev?.timetable ?? []);
  const marksResolved = attachCreditsToMarks(orPrev('marks', marks, [] as CourseMarksRecord[]), timetableResolved);
  const examsResolved =
    exams.status === 'fulfilled'
      ? enrichExamsWithCourses(exams.value, timetableResolved)
      : switchingSemesters
        ? []
        : (prev?.exams ?? []);

  const data: CachedData = {
    registrationNo: incomingRegNo || meta?.registrationNo || '',
    semesterId: semId,
    syncedAt: Date.now(),
    profile: orPrev('profile', profile, null as StudentProfile | null),
    attendance: orPrev('attendance', attendance, [] as AttendanceRecord[]),
    timetable: timetableResolved,
    marks: marksResolved,
    exams: examsResolved,
    assignments: orPrev('assignments', assignments, [] as AssignmentRecord[]),
    grades: orPrev('grades', grades, null as GradeSummary | null),
    semesterGrades: orPrev('semesterGrades', semesterGrades, null as SemesterGrades | null),
    od: orPrev('od', od, null as OdSummary | null),
    calendar: orPrev('calendar', calendar, null as AcademicCalendar | null),
    transport: orPrev('transport', transport, null as TransportInfo | null),
  };

  try {
    await writeCache(cacheKey(data.registrationNo, semId), data);
    await writeMeta({
      registrationNo: data.registrationNo,
      selectedSemesterId: semId,
      campus: 'chennai',
    });
  } catch {
    return { ok: false, datasets, syncedAt: null, error: 'Data was fetched but could not be saved on this device.' };
  }

  // If no dataset failed and we have a profile, this is a clean sync.
  const ok = datasets.every((d) => d.ok) || data.profile !== null;
  return { ok, datasets, syncedAt: data.syncedAt };
}

export async function loadCachedData(regNo: string, semId: string): Promise<CachedData | null> {
  return readCache<CachedData>(cacheKey(regNo, semId));
}
