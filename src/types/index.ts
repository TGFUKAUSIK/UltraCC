export interface StudentProfile {
  name: string;
  regNo: string;
  /**
   * Academic branch, from a row VTOP labels as the branch (profile page, or
   * the programme/branch pair on the transport registration record). '' when
   * VTOP states neither — screens must then fall back to `school`, never to a
   * +2 group or a hardcoded degree.
   */
  branch: string;
  /** VTOP's "Programme" row: the study level ("UG"/"PG"), not a degree name. */
  program: string;
  /** School / centre the student belongs to, as VTOP names it. */
  school: string;
  /** Class-XII (+2) subject group — "PCM", "Computer with Maths". Never a course or branch label. */
  groupStudied: string;
  semester: number;
  /** null = genuinely unavailable (never silently shown as 0). */
  cgpa: number | null;
  totalCreditsCompleted: number | null;
  totalCreditsRequired: number | null;
  proctorName: string;
  proctorContact: string;
  /** false = VTOP provides no proctor info (shown as unavailable). */
  proctorAvailable: boolean;
  hostelBlock: string;
  roomNo: string;
  dayScholar: boolean;
  busRoute?: string;
  /** VTOP photo, already fetched through the authenticated gateway. */
  profilePhotoUrl?: string;
}

export interface AttendanceRecord {
  courseCode: string;
  courseTitle: string;
  type: 'ETH' | 'ELA' | 'EPJ' | 'TH' | 'LO';
  slot: string;
  facultyName: string;
  attended: number;
  totalHeld: number;
  percentage: number;
  /**
   * No `category`: a Safe/Warning/Critical word baked in at sync time is a
   * second attendance bar next to the one the student actually set, and it
   * goes stale the moment the slider moves. Surfaces judge `percentage`
   * against `getTargetAttendance()` when they render.
   */
  lastUpdated: string;
  venue: string;
}

/**
 * One assessment row exactly as VTOP served it.
 *
 * `status` is VTOP's own evaluation state ('Evaluated' | 'Pending'). VTOP
 * declares rows before grading them (a pending FAT arrives with max 100 and
 * scored 0), so a Pending row must never be read as a scored zero — use
 * utils/assessmentStatus to test a row instead of comparing `max > 0`.
 */
export interface AssessmentScore {
  scored: number;
  max: number;
  weightage: number;
  status?: string;
  /** VTOP's published weighted mark for this row, when it served one. */
  weightageMark?: number;
  /** 'T' theory class / 'L' lab class of an embedded course (VTOP's own column). */
  part?: 'T' | 'L';
}

/**
 * The two halves of an embedded course carry different credit weights, so the
 * grade model keeps them apart instead of blending every row into one sum.
 */
export type MarkPart = 'T' | 'L';

export interface CourseMarks {
  courseCode: string;
  courseTitle: string;
  cat1: AssessmentScore;
  cat2: AssessmentScore;
  da1: AssessmentScore;
  da2: AssessmentScore;
  da3: AssessmentScore;
  quiz: AssessmentScore;
  fat: Omit<AssessmentScore, 'scored'> & { scored?: number };
  /** The lab half's FAT, when VTOP serves one alongside the theory FAT. */
  labFat?: Omit<AssessmentScore, 'scored'> & { scored?: number };
  /** ALL assessment components from VTOP (PAT, Experiment, Project Review, etc.) */
  extraComponents?: { title: string; scored: number; max: number; weightage: number; status: string; weightageMark?: number; part?: MarkPart }[];
  /** VTOP's Course Type column ('ETH' / 'ELA' / …); '' when not synced. */
  courseType?: string;
  /** VTOP's Slot column for this course row ('A1', 'L36+L41', …). */
  slot?: string;
  /** Registered credits (VTOP's L T P J C course list). Undefined = unknown;
   *  consumers must say so, never substitute a default. */
  credits?: number;
  theoryCredits?: number;
  labCredits?: number;
  totalScoredSoFar: number;
  currentEstimatedGrade: string;
}

export interface TimetableSlot {
  id: string;
  courseCode: string;
  courseTitle: string;
  slot: string;
  facultyName: string;
  venue: string;
  /** '' when VTOP gave a venue this campus map cannot resolve to a building. */
  building: 'SJT' | 'AB1' | 'AB2' | 'MB' | 'Lab Block' | '';
  roomNo: string;
  day: 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday';
  startTime: string; // e.g., "08:00"
  endTime: string;   // e.g., "08:50"
  isLab: boolean;
  /** Credits from VTOP's LTPJC column (undefined = not synced yet). */
  credits?: number;
}

export interface ExamSchedule {
  id: string;
  /** VTOP slot (A1, B1, ...) — the exam page's primary identifier. */
  slot?: string;
  courseCode: string;
  courseTitle: string;
  /** 'Other' = VTOP called it something we do not recognise (model exam,
   *  supplementary...). It is never guessed into CAT/FAT — a wrong label here
   *  would tell a student which assessment they were looking at. */
  examType: 'CAT 1' | 'CAT 2' | 'FAT' | 'Lab FAT' | 'Other';
  date: string;
  time: string;
  venue: string;
  seatNo: string;
  syllabusTopics: string[];
  topicsCompleted: number;
  studyPriority: 'High' | 'Medium' | 'Low';
}

export interface AssignmentTask {
  id: string;
  courseCode: string;
  courseTitle: string;
  title: string;
  dueDate: string;
  dueTime: string;
  status: 'Pending' | 'Submitted' | 'Late';
  weightage: string;
  description: string;
}

export interface FresherTerm {
  term: string;
  fullForm?: string;
  category: 'Academic' | 'Registration' | 'Campus' | 'Evaluation';
  meaning: string;
  studentAdvice: string;
  example: string;
}
