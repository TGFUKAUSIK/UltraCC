/**
 * Adapters: canonical VTOP types (what parsers produce and IndexedDB stores)
 * -> UI view-model types (what the React components consume).
 *
 * The UI components were built against a richer view-model (venues, room
 * numbers, safe/warning/critical categories, weightage strings, ...). These
 * adapters derive that view-model deterministically from the normalized VTOP
 * data — no fabricated values are introduced except neutral defaults that the
 * UI needs to render (e.g. fat weightage of 50).
 */

import {
  StudentProfile as VtopProfile,
  AttendanceRecord as VtopAttendance,
  TimetableSlot as VtopTimetableSlot,
  CourseMarksRecord as VtopMarks,
  ExamRecord as VtopExam,
  AssignmentRecord as VtopAssignment,
  TransportInfo,
} from './types';
import {
  StudentProfile,
  AttendanceRecord,
  TimetableSlot,
  CourseMarks,
  ExamSchedule,
  AssignmentTask,
} from '../../types';
import { GradeSummary } from './types';
import { to24hTime } from './parsers/helpers';
import { resolveSchool } from '../../utils/vitSchools';
import { isLabSession, combineLabSessions } from '../../utils/labSessions';

/**
 * Placeholder faculty values that older parser versions (or stale caches
 * written before the "never fabricate" fix) may have stored. Anything in
 * this list becomes an honest empty string — never displayed.
 */
const PLACEHOLDER_FACULTY = new Set([
  'Faculty Member',
  'Faculty Name',
  'Faculty name defaultly present',
  'Faculty not provided',
  'Faculty not provided by VTOP',
  'Faculty',
  'Staff',
  'Professor',
  'Instructor',
  'TBD',
]);

/**
 * Class-XII (+2) subject groups, i.e. what VTOP's "Branch / Group Studied" row
 * actually holds. A cache written before that row was separated from `branch`
 * stored one of these AS the academic branch, so the adapter rejects them here
 * too: a +2 group must never surface as a branch or course label, even from a
 * stale cache. Same precedent as PLACEHOLDER_FACULTY above.
 */
const PLUS_TWO_GROUPS = new Set([
  'pcm', 'pcb', 'pcmb', 'pcmc', 'ceba', 'ecba', 'meca', 'mecs',
  'computer with maths', 'computer science with maths',
  'mathematics with computer science', 'physics chemistry mathematics',
  'physics chemistry biology', 'science group',
]);
const isPlusTwoGroup = (value: string): boolean => PLUS_TWO_GROUPS.has((value || '').trim().toLowerCase());

function cleanFaculty(name: string | undefined | null): string {
  let trimmed = (name || '').trim();
  if (PLACEHOLDER_FACULTY.has(trimmed)) return '';
  // Real VTOP faculty cells often carry an employee ID prefix and the school
  // suffix, e.g. "50596 BINU BEN JOSE D R SELECT" or "Dr. X - Professor".
  // Strip the ID and school/acronym tokens so the actual name shows; vendor
  // names like "ETHNUS ETHNUS (APT) ACAD" are left untouched.
  trimmed = trimmed.replace(/^\d{4,6}\s+/, '').trim();
  trimmed = trimmed.replace(/\s+[-–]\s*(Professor|Associate Professor|Assistant Professor|Prof\.?|Dr\.?)$/i, '').trim();
  trimmed = trimmed.replace(/\s+(SELECT|SSL|SCOPE|SENSE|SMEC|SAS|SBST|SCE|VFIT|V-SMART|SJT|AB1|AB2)$/i, '').trim();
  return trimmed;
}

/**
 * Mirror of the gateway's cleanCourseTitle: caches written before that fix
 * (or by any older client) carry "- Title ( Embedded Theory )" artifacts.
 * Applied at read time so existing IndexedDB data displays clean without a
 * re-sync, and new syncs stay clean even if an old gateway is reached.
 */
function cleanCourseTitle(rawTitle: string | undefined | null, courseCode?: string): string {
  let t = (rawTitle || '').replace(/\s+/g, ' ').trim();
  if (courseCode) t = t.replace(new RegExp(`^${courseCode}\\s*[-–:]?\\s*`, 'i'), '');
  t = t.replace(/^[-–:]\s*/, '');
  t = t.replace(/\s*\(\s*[^()]*\s*\)\s*$/, '');
  return t.trim();
}

/**
 * Build the UI profile model from VTOP data.
 *
 * RULES ("never silently show 0 / Not assigned"):
 *   - CGPA comes from the cumulative grade-history summary when available;
 *     a profile-page CGPA is only used when > 0. Otherwise cgpa = null
 *     ("not synced / unavailable"), never 0.
 *   - Credits come from the grade summary (registered vs earned). Absent -> null.
 *   - Proctor: shown only when VTOP actually provided a name.
 *   - Branch/programme: only from rows VTOP labels as such. The profile page's
 *     "Programme" row is the study LEVEL ("UG"), and "Branch / Group Studied"
 *     is the Class-XII group ("PCM"), so neither may stand in for the branch.
 *     `transport` is the optional second look at the same student's own record:
 *     VTOP's transport registration page prints the admitted Programme and
 *     Branch verbatim, so it is the only other authoritative source in-app.
 */
export function toUiProfile(
  p: VtopProfile,
  grades?: GradeSummary | null,
  transport?: TransportInfo | null,
): StudentProfile {
  const gradesAvailable = !!grades?.available;
  const profileCgpa = typeof p.cgpa === 'number' && Number.isFinite(p.cgpa) && p.cgpa > 0 ? p.cgpa : null;
  const cgpa = gradesAvailable && grades!.cgpa !== null && grades!.cgpa >= 0 ? grades!.cgpa : profileCgpa;
  const proctorName = p.proctorName || '';
  // Branch and programme, from the rows that actually name them. A profile
  // whose only "Branch…" row is the +2 group must not print "PCM" as the
  // branch, and the LEVEL ("UG") must not show as a degree name.
  // A cache written before the parser split can still hold branch: 'PCM' — that
  // value is demoted to `groupStudied`, where it is labelled correctly.
  const staleGroupAsBranch = isPlusTwoGroup(p.branch) ? p.branch : '';
  const rawBranch = (staleGroupAsBranch ? '' : p.branch) || transport?.branch || '';
  const branch = isPlusTwoGroup(rawBranch) ? '' : rawBranch;
  const groupStudied = p.groupStudied || staleGroupAsBranch;
  const program = transport?.programme || p.program || '';
  // Dev-only photo diagnostic: SAFE metadata only (field present, source
  // shape, MIME). Never any credential, session token, or raw HTML.
  const devMode = (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV;
  if (devMode) {
    const photo = p.profilePhotoDataUrl;
    const shape = !photo ? 'none' : photo.startsWith('data:') ? `data-uri:${photo.slice(5, photo.indexOf(';'))}` : 'url';
    console.info(`[photo] field found: ${photo ? 'yes' : 'no'}; source type: ${shape}; bytes: ${photo?.length ?? 0}`);
  }
  return {
    name: p.name || 'Student',
    regNo: p.registrationNo || '',
    branch,
    program,
    // VTOP's "School" row is not the student's school for many records — it
    // carries the faculty/research centre the row is grouped under (a real
    // B.Tech EEE profile reads "Centre for e-Automation Technologies" there,
    // where the school is SELECT). Show it only when it genuinely names a VIT
    // Chennai school; otherwise derive the school from the branch VTOP served,
    // and otherwise show nothing. See src/utils/vitSchools.ts.
    school: resolveSchool(p.school, branch),
    groupStudied,
    semester: extractSemesterNumber(p.semester),
    cgpa,
    totalCreditsCompleted: gradesAvailable ? grades!.creditsEarned : null,
    totalCreditsRequired: gradesAvailable ? grades!.creditsRegistered : null,
    proctorName,
    proctorContact: [p.proctorEmail, p.proctorMobile].filter(Boolean).join(' | '),
    proctorAvailable: !!proctorName,
    hostelBlock: p.hostelBlock || '',
    roomNo: p.roomNo || '',
    dayScholar: false,
    profilePhotoUrl: p.profilePhotoDataUrl || undefined,
  };
}

function extractSemesterNumber(semester: string): number {
  const match = String(semester).match(/(\d{1,2})/);
  return match ? parseInt(match[1], 10) : 0;
}

export function toUiAttendance(rows: VtopAttendance[], timetable?: VtopTimetableSlot[]): AttendanceRecord[] {
  const venueByCourse = new Map<string, string>();
  (timetable || []).forEach((slot) => {
    if (!venueByCourse.has(slot.courseCode)) venueByCourse.set(slot.courseCode, slot.venue);
  });

  return rows.map((r) => ({
    courseCode: r.courseCode,
    courseTitle: cleanCourseTitle(r.courseTitle, r.courseCode) || r.courseCode,
    type: toUiCourseType(r.courseType, r.courseCode),
    slot: r.slot,
    // Empty when VTOP provides no faculty — never a placeholder name.
    facultyName: cleanFaculty(r.facultyName),
    attended: r.attended,
    totalHeld: r.totalHeld,
    percentage: r.percentage,
    category: categoryFromPercentage(r.percentage),
    lastUpdated: r.lastUpdated || '',
    venue: venueByCourse.get(r.courseCode) || '',
  }));
}

function toUiCourseType(courseType: string, courseCode: string): AttendanceRecord['type'] {
  const t = courseType.toUpperCase();
  if (t.includes('LAB') || courseCode.toUpperCase().endsWith('L')) return 'ELA';
  if (t.includes('PROJECT') || t.includes('EPJ')) return 'EPJ';
  if (t.includes('LO')) return 'LO';
  // NOTE: check ETH before TH — 'ETH' contains 'TH'.
  if (t.includes('ETH') || t === 'THEORY') return 'ETH';
  if (t.includes('TH')) return 'TH';
  return 'ETH';
}

function categoryFromPercentage(pct: number): AttendanceRecord['category'] {
  if (pct >= 80) return 'Safe';
  if (pct >= 75) return 'Warning';
  return 'Critical';
}

export function toUiTimetable(slots: VtopTimetableSlot[]): TimetableSlot[] {
  // VTOP serves a 2-period lab as two per-slot rows; the UI model must show
  // the ONE combined teaching session the student actually attends. Input
  // that is already combined passes through untouched (merging needs a
  // contiguous single-token pair), so this is safe on cached data too.
  return combineLabSessions(slots).map((s) => {
    const { building, roomNo } = buildingFromVenue(s.venue);
    // A lab is ONE combined session: lab-ness follows the whole session's
    // slot tokens ("L31+L32"), not just the first token.
    const labSession = isLabSession({ slot: s.slot, courseType: s.courseType });
    return {
      id: s.id,
      courseCode: s.courseCode,
      courseTitle: cleanCourseTitle(s.courseTitle, s.courseCode) || s.courseCode,
      slot: s.slot,
      // Empty when VTOP provides no faculty — never a placeholder name.
      facultyName: cleanFaculty(s.facultyName),
      venue: s.venue,
      building,
      roomNo,
      day: toUiDay(s.day),
      startTime: to24hTime(s.startTime),
      endTime: to24hTime(s.endTime),
      isLab: labSession || s.courseType.toUpperCase().includes('LAB') || s.courseCode.toUpperCase().endsWith('L'),
      credits: typeof s.credits === 'number' ? s.credits : undefined,
    };
  });
}

function toUiDay(day: string): TimetableSlot['day'] {
  const normalized = day.charAt(0).toUpperCase() + day.slice(1).toLowerCase();
  const valid = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  return (valid.includes(normalized) ? normalized : 'Monday') as TimetableSlot['day'];
}

function buildingFromVenue(venue: string): { building: TimetableSlot['building']; roomNo: string } {
  const upper = (venue || '').toUpperCase();
  const roomMatch = venue.match(/(\d{2,4})$/);
  const roomNo = roomMatch ? roomMatch[1] : '';
  if (upper.includes('AB2')) return { building: 'AB2', roomNo };
  if (upper.includes('AB1')) return { building: 'AB1', roomNo };
  if (upper.includes('MB') || upper.includes('MAIN BLOCK')) return { building: 'MB', roomNo };
  if (upper.includes('LAB') || upper.includes('TT')) return { building: 'Lab Block', roomNo };
  if (upper.includes('SJT') || upper.includes('SILVER JUBILEE')) return { building: 'SJT', roomNo };
  // Unresolved venues stay unresolved: claiming SJT sent students to the wrong
  // building for CCE/CRIS/hostel-lab rooms.
  return { building: '', roomNo };
}

export function toUiMarks(records: VtopMarks[]): CourseMarks[] {
  return records.map((m) => {
    // VTOP's own evaluation status travels with every row: a declared-but-
    // ungraded assessment keeps its max/weightage (that is the weight a
    // student can still earn) and is flagged Pending, so no consumer reads it
    // as a scored zero. Only a row VTOP never served collapses to all-zeros.
    const safe = (c?: { scored: number; maxMarks: number; weightageMax: number; status?: string; weightageMark?: number; part?: 'T' | 'L' }) =>
      c && Number.isFinite(c.scored)
        ? { scored: c.scored, max: c.maxMarks, weightage: c.weightageMax, status: c.status, weightageMark: c.weightageMark, part: c.part }
        : { scored: 0, max: 0, weightage: c?.weightageMax ?? 0, status: c?.status, weightageMark: c?.weightageMark, part: c?.part };
    // The FAT row is kept whenever VTOP served one, graded or not. A pending
    // FAT is the single most useful fact on the marks page — it is what the
    // "score ~X/100 in FAT for a B" arithmetic needs — so its declared max
    // and weightage survive; `status: 'Pending'` is what marks it ungraded.
    // No FAT row at all stays all-zero (final exam not declared yet).
    const fatOf = (c?: { scored: number; maxMarks: number; weightageMax: number; status?: string; weightageMark?: number }) =>
      c
        ? {
          scored: Number.isFinite(c.scored) ? c.scored : 0,
          max: c.maxMarks,
          // VTOP's declared weight only. A `|| 50` default stood in for a
          // weight the portal never published, putting every FAT target on the
          // wrong scale (VIT's FAT is commonly 40, and lab FATs differ again).
          weightage: c.weightageMax,
          status: c.status,
          weightageMark: c.weightageMark,
        }
        : { scored: 0, max: 0, weightage: 0 };
    return {
      courseCode: m.courseCode,
      courseTitle: cleanCourseTitle(m.courseTitle, m.courseCode) || m.courseCode,
      cat1: safe(m.cat1),
      cat2: safe(m.cat2),
      da1: safe(m.da1),
      da2: safe(m.da2),
      da3: safe(m.da3),
      quiz: safe(m.quiz),
      fat: fatOf(m.fat),
      labFat: fatOf(m.labFat),
      extraComponents: (m.extraComponents || []).map(ec => ({
        title: ec.title,
        scored: Number.isFinite(ec.scored) ? ec.scored : 0,
        max: ec.maxMarks,
        weightage: ec.weightageMax,
        status: ec.status,
        weightageMark: ec.weightageMark,
        part: ec.part,
      })),
      courseType: m.courseType || '',
      slot: m.slot || '',
      credits: typeof m.credits === 'number' ? m.credits : undefined,
      theoryCredits: typeof m.theoryCredits === 'number' ? m.theoryCredits : undefined,
      labCredits: typeof m.labCredits === 'number' ? m.labCredits : undefined,
      totalScoredSoFar: Number.isFinite(m.totalInternalWeightScored) ? m.totalInternalWeightScored : 0,
      currentEstimatedGrade: m.currentEstimatedGrade || 'Estimate unavailable',
    };
  });
}

export function toUiExams(exams: VtopExam[]): ExamSchedule[] {
  const today = new Date();
  return exams.map((e) => {
    const daysUntil = daysUntilDate(e.date, today);
    return {
      id: e.id,
      slot: e.slot || undefined,
      courseCode: e.courseCode,
      courseTitle: cleanCourseTitle(e.courseTitle, e.courseCode) || e.courseCode,
      examType: toUiExamType(e.examType),
      date: e.date,
      time: e.time,
      venue: e.venue,
      // Seat number is only shown when VTOP actually provided one.
      seatNo: e.seatNo || '',
      syllabusTopics: e.syllabusTopics || [],
      topicsCompleted: 0,
      studyPriority: daysUntil === null ? 'Low' : daysUntil <= 3 ? 'High' : daysUntil <= 7 ? 'Medium' : 'Low',
    };
  });
}

function toUiExamType(type: string): ExamSchedule['examType'] {
  const t = type.toUpperCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ');
  if (/\bCAT\s*[- ]?1\b/.test(t) || /CONTINUOUS\s+ASSESSMENT\s+TEST\s*[- ]?I\b/.test(t)) return 'CAT 1';
  if (/\bCAT\s*[- ]?2\b/.test(t) || /CONTINUOUS\s+ASSESSMENT\s+TEST\s*[- ]?II\b/.test(t)) return 'CAT 2';
  if (t.includes('LAB')) return 'Lab FAT';
  if (t.includes('FAT') || t.includes('FINAL ASSESSMENT')) return 'FAT';
  // Anything else (model exam, supplementary, a wording VTOP changed overnight)
  // stays 'Other'. Labelling it 'FAT' invented an assessment type the
  // student's own mark sheet does not have.
  return 'Other';
}

function daysUntilDate(dateStr: string, from: Date): number | null {
  if (!dateStr) return null;
  const date = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  return Math.round((date.getTime() - start.getTime()) / 86400000);
}

export function toUiAssignments(tasks: VtopAssignment[]): AssignmentTask[] {
  return tasks.map((t, idx) => ({
    id: t.id || `asgn-${idx}`,
    courseCode: t.courseCode,
    courseTitle: cleanCourseTitle(t.courseTitle, t.courseCode) || t.courseCode,
    title: t.title,
    dueDate: t.dueDate,
    // VTOP's assignment list publishes a date but no cut-off time; don't invent
    // one.
    dueTime: '',
    status: t.status === 'Graded' ? 'Submitted' : t.status,
    weightage: t.weightage ? `${t.weightage} Marks` : '—',
    description: '',
  }));
}
