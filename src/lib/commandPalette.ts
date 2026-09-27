/**
 * commandPalette.ts — the data layer behind the ⌘K command palette.
 *
 * Command-palette parity: search must reach REAL synced records —
 * courses, faculty, venues, exams, attendance and marks — not just a handful
 * of hard-coded intent phrases. Everything here is pure: an index is built
 * from already-synced data and ranked with a simple multi-token scorer.
 *
 * Matching contract: every whitespace-separated token must match somewhere
 * ("cse fat" narrows to the FAT exam of CSE courses). Title prefix matches
 * rank highest, then title substrings, then subtitle/keyword matches.
 */

import type { AttendanceRecord, CourseMarks, ExamSchedule, TimetableSlot } from '../types';
import { isNavHiddenInMode, type FeatureMode } from './navVisibility';

export interface PaletteItem {
  id: string;
  title: string;
  subtitle: string;
  category: string;
  /** Destination tab the palette navigates to. */
  tab: string;
  /** Extra searchable text (slot tokens, venues, faculty, intent words). */
  keywords: string;
}

export interface PaletteIndexInput {
  timetable: TimetableSlot[];
  attendance: AttendanceRecord[];
  exams: ExamSchedule[];
  marks: CourseMarks[];
}

interface Destination {
  label: string;
  subtitle: string;
  tab: string;
  keywords: string;
}

/**
 * Mirrors the app's VALID_TABS with human labels + intent keywords.
 *
 * Labels are the same strings the desktop rail and the services menu show
 * (naming.test.ts asserts the parity).
 */
const DESTINATIONS: Destination[] = [
  { label: 'Dashboard', subtitle: 'Today at a glance', tab: 'dashboard', keywords: 'home today overview next class status' },
  { label: 'Timetable', subtitle: 'Weekly class schedule', tab: 'timetable', keywords: 'schedule classes slots weekly ongoing next' },
  { label: 'Syllabus', subtitle: 'VTOP’s syllabus file for each course', tab: 'syllabus', keywords: 'syllabus course curriculum topics units textbooks registered courses' },
  { label: 'Attendance', subtitle: 'Bunk calculator, attendance detail, OD', tab: 'academics', keywords: 'attendance academics bunk safe skip od on duty predictor' },
  { label: 'Marks & Grades', subtitle: 'Marks breakdown and grade estimates', tab: 'grades', keywords: 'marks grades gpa cgpa score grade predictor reverse target' },
  { label: 'Exam Schedule', subtitle: 'CAT / FAT seating and venues', tab: 'exams', keywords: 'exam cat fat seat hall venue seating' },
  { label: 'Academic Calendar', subtitle: 'Semester events and holidays', tab: 'calendar', keywords: 'calendar holiday event semester dates recess' },
  { label: 'FFCS', subtitle: 'Course registration planner', tab: 'ffcs', keywords: 'ffcs registration courses plan slots compare' },
  { label: 'AI Advisor', subtitle: 'Ask about bunk, exams, study plans', tab: 'ai-advisor', keywords: 'ai advisor strategist academic strategy help question ask' },
  { label: 'Assignments & Courses', subtitle: 'Moodle coursework and deadlines', tab: 'lms', keywords: 'lms moodle assignments quizzes deadlines coursework materials' },
  { label: 'Campus Map', subtitle: 'VIT WayFinder navigation', tab: 'campus', keywords: 'map wayfinder building room where location directions find' },
  { label: 'Rooms & Labs', subtitle: 'Free classroom and lab availability by period', tab: 'freeClassrooms', keywords: 'free classroom lab rooms empty available vacant space' },
  { label: 'Campus Facilities', subtitle: 'Printing, study groups, services', tab: 'campus-utils', keywords: 'campus utilities facilities printing printer photocopy scan study group spaces' },
  { label: 'Student Communities', subtitle: 'Clubs, chapters and special teams', tab: 'clubs', keywords: 'clubs chapters technical cultural communities hub' },
  { label: 'Transport', subtitle: 'Bus routes and day-scholar info', tab: 'transport', keywords: 'bus transport route day scholar boarding' },
  { label: 'Library', subtitle: 'Catalog search and due dates', tab: 'library', keywords: 'library koha book catalog search due' },
  { label: 'Events', subtitle: 'Event Hub discovery', tab: 'events', keywords: 'events clubs fest workshops riviera' },
  { label: 'Hostel', subtitle: 'Mess menu, leave, laundry', tab: 'hostel', keywords: 'hostel mess menu leave laundry warden counselling campus life' },
  { label: 'Faculty & Proctor', subtitle: 'Your proctor and course teachers', tab: 'faculty', keywords: 'faculty proctor teacher courses timetable staff' },
  { label: 'Faculty Directory', subtitle: 'Find faculty contacts', tab: 'directory', keywords: 'faculty teacher professor contact directory search staff' },
  { label: 'Timetable Compare', subtitle: 'Compare schedules with friends', tab: 'social', keywords: 'compare timetable friend free slots common social study groups' },
  { label: 'Profile', subtitle: 'My info, fees, credentials', tab: 'my-info', keywords: 'profile my info account details regno fees credentials wallet' },
  { label: 'Cab Share', subtitle: 'Share rides with batchmates', tab: 'cabshare', keywords: 'cab share ride taxi airport station' },
  { label: 'Student Tools', subtitle: 'Calculators and utilities', tab: 'tools', keywords: 'tools hub calculators utilities converters export' },
  { label: 'Placements', subtitle: 'Eligibility and prep tracker', tab: 'placement', keywords: 'placement portal job internship eligibility sde resume' },
  { label: 'Question Bank', subtitle: 'Past papers and practice sets', tab: 'qbank', keywords: 'qbank question bank papers practice pyq exam prep' },
  { label: 'Fresher Guide', subtitle: 'First-year orientation and terms', tab: 'fresher', keywords: 'fresher first year orientation guide terms january batch newcomer campus FAQ' },
];

const COURSE_LABEL: Record<AttendanceRecord['type'], string> = {
  ETH: 'Theory', ELA: 'Lab', EPJ: 'Project', TH: 'Theory', LO: 'Lab-only',
};

function titleCaseLabel(code: string, title: string): string {
  return title && title.trim() ? `${code} — ${title.trim()}` : code;
}

/** Builds the searchable palette index from already-synced datasets. */
export function buildPaletteIndex(input: PaletteIndexInput, mode: FeatureMode = 'complete'): PaletteItem[] {
  const items: PaletteItem[] = [];
  const courseCodes = new Set<string>();

  // Courses — one entry per course code across all timetable meetings.
  const courseMeta = new Map<string, { title: string; faculty: string; venues: Set<string>; slotTokens: Set<string>; isLab: boolean }>();
  input.timetable.forEach((slot) => {
    const code = (slot.courseCode || '').trim().toUpperCase();
    if (!code) return;
    const existing = courseMeta.get(code);
    const venues = existing?.venues ?? new Set<string>();
    const slotTokens = existing?.slotTokens ?? new Set<string>();
    if (slot.venue) venues.add(slot.venue.trim());
    (slot.slot || '').split(/[+,\s]+/).filter(Boolean).forEach((token) => slotTokens.add(token.toUpperCase()));
    courseMeta.set(code, {
      title: slot.courseTitle || existing?.title || '',
      faculty: slot.facultyName || existing?.faculty || '',
      venues,
      slotTokens,
      isLab: Boolean(existing?.isLab) || slot.isLab,
    });
  });
  courseMeta.forEach((meta, code) => {
    courseCodes.add(code);
    items.push({
      id: `course:${code}`,
      title: titleCaseLabel(code, meta.title),
      subtitle: `Class · ${meta.isLab ? 'Lab' : 'Theory'}${meta.faculty ? ` · ${meta.faculty}` : ''}${meta.venues.size ? ` · ${[...meta.venues].join(', ')}` : ''}`,
      category: 'Course',
      tab: 'timetable',
      keywords: [...meta.slotTokens, ...meta.venues, meta.faculty, ...meta.title.split(/\s+/)].filter(Boolean).join(' ').toLowerCase(),
    });
  });

  // Attendance — searchable per course with live percentages.
  input.attendance.forEach((record) => {
    const code = (record.courseCode || '').trim().toUpperCase();
    if (!code) return;
    courseCodes.add(code);
    items.push({
      id: `attendance:${code}:${record.type}`,
      title: `${code} attendance · ${record.percentage}%`,
      subtitle: `${record.attended}/${record.totalHeld} ${COURSE_LABEL[record.type] ?? 'classes'} held · ${record.category}`,
      category: 'Attendance',
      tab: 'academics',
      keywords: [record.courseTitle, record.facultyName, record.slot, record.venue, 'bunk safe skip'].filter(Boolean).join(' ').toLowerCase(),
    });
  });

  // Exams — CAT/FAT rows with venue and seat.
  input.exams.forEach((exam, index) => {
    const code = (exam.courseCode || '').trim().toUpperCase();
    items.push({
      id: `exam:${exam.id || `${code}-${exam.examType}-${index}`}`,
      title: `${exam.examType} · ${code}`,
      subtitle: `${exam.date}${exam.time ? ` · ${exam.time}` : ''}${exam.venue ? ` · ${exam.venue}` : ''}${exam.seatNo ? ` · Seat ${exam.seatNo}` : ''}`,
      category: 'Exam',
      tab: 'exams',
      keywords: [exam.courseTitle, exam.slot, exam.venue, exam.examType].filter(Boolean).join(' ').toLowerCase(),
    });
  });

  // Marks — only for courses NOT already covered above (no duplicates).
  input.marks.forEach((mark) => {
    const code = (mark.courseCode || '').trim().toUpperCase();
    if (!code || courseCodes.has(code)) return;
    courseCodes.add(code);
    items.push({
      id: `marks:${code}`,
      title: titleCaseLabel(code, mark.courseTitle),
      subtitle: 'Marks breakdown & grade estimate',
      category: 'Marks',
      // Marks live on the Marks & Grades screen; sending students to
      // 'academics' (attendance) landed them where no marks are shown.
      tab: 'grades',
      keywords: [mark.courseTitle, 'marks assessment cat fat grade'].filter(Boolean).join(' ').toLowerCase(),
    });
  });

  // Destinations — every app screen with intent keywords. ⌘K is navigation, so
  // it honours the same withdrawal list as the rail and the services menu: a
  // hidden screen (or a non-essential screen in minimal mode) must not be one
  // keystroke away either.
  DESTINATIONS.filter((dest) => !isNavHiddenInMode(dest.tab, mode)).forEach((dest) => {
    items.push({
      id: `go:${dest.tab}`,
      title: dest.label,
      subtitle: dest.subtitle,
      category: 'Go to',
      tab: dest.tab,
      keywords: `${dest.keywords} ${dest.label}`.toLowerCase(),
    });
  });

  return items;
}

export interface PaletteSearchHit extends PaletteItem {
  score: number;
}

/**
 * Ranked multi-token search. Every token must match (AND semantics);
 * title-prefix > title-substring > subtitle/keyword. Returns up to `limit`.
 */
export function searchPalette(items: PaletteItem[], query: string, limit = 12): PaletteSearchHit[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const hits: PaletteSearchHit[] = [];
  for (const item of items) {
    const title = item.title.toLowerCase();
    const haystack = `${title} ${item.subtitle} ${item.keywords}`.toLowerCase();
    let score = 0;
    let matchedAll = true;
    for (const token of tokens) {
      if (title.startsWith(token)) score += 4;
      else if (title.includes(token)) score += 2;
      else if (haystack.includes(token)) score += 1;
      else { matchedAll = false; break; }
    }
    if (matchedAll) hits.push({ ...item, score });
  }
  return hits
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, limit);
}
