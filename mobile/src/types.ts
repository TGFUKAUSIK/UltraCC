/**
 * types.ts — the mobile app's data model. Mirrors the web app's VTOP types
 * (src/lib/vtop/types.ts) so the same backend payloads and the same academic
 * rules apply. No browser-only fields are carried over.
 */

export interface StudentProfile {
  registrationNo: string;
  name: string;
  program: string;
  branch: string;
  groupStudied?: string;
  school: string;
  semester: string;
  cgpa: number;
  proctorName: string;
  proctorEmail: string;
  proctorMobile: string;
  hostelBlock?: string;
  roomNo?: string;
  profilePhotoDataUrl?: string;
}

export interface AttendanceRecord {
  courseCode: string;
  courseTitle: string;
  courseType: string;
  slot: string;
  facultyName: string;
  attended: number;
  totalHeld: number;
  percentage: number;
  category: string;
  lastUpdated: string;
}

export type Weekday =
  | 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday';

export interface TimetableSlot {
  id: string;
  slot: string;
  courseCode: string;
  courseTitle: string;
  courseType: string;
  facultyName: string;
  venue: string;
  building: string;
  startTime: string;
  endTime: string;
  day: Weekday;
  credits?: number;
  /** Set by the lab-session normaliser (a 2-period lab is ONE session). */
  isLab?: boolean;
}

export type MarkPart = 'T' | 'L';

export interface ComponentMark {
  title: string;
  maxMarks: number;
  scored: number;
  weightageMax: number;
  weightageScored: number;
  status: 'Evaluated' | 'Pending';
  weightageMark?: number;
  part?: MarkPart;
}

export interface CourseMarksRecord {
  courseCode: string;
  courseTitle: string;
  cat1: ComponentMark;
  cat2: ComponentMark;
  da1: ComponentMark;
  da2: ComponentMark;
  da3: ComponentMark;
  quiz: ComponentMark;
  fat?: ComponentMark;
  labFat?: ComponentMark;
  extraComponents?: ComponentMark[];
  courseType?: string;
  slot?: string;
  credits?: number;
  theoryCredits?: number;
  labCredits?: number;
  totalInternalWeightScored: number;
  currentEstimatedGrade: string;
}

export interface ExamRecord {
  id: string;
  slot: string;
  courseCode: string;
  courseTitle: string;
  examType: 'CAT 1' | 'CAT 2' | 'FAT' | 'Lab FAT' | 'Other';
  date: string;
  time: string;
  venue: string;
  seatNo: string;
  syllabusTopics: string[];
}

export interface AssignmentRecord {
  id: string;
  courseCode: string;
  courseTitle: string;
  title: string;
  dueDate: string;
  weightage: number;
  status: 'Pending' | 'Submitted' | 'Graded';
}

export interface SemesterInfo {
  id: string;
  name: string;
  isCurrent: boolean;
}

export interface GradeSummary {
  available: boolean;
  cgpa: number | null;
  creditsRegistered: number | null;
  creditsEarned: number | null;
}

export interface SemesterGradeRecord {
  courseCode: string;
  courseTitle: string;
  courseType: string;
  grandTotal: number | null;
  grade: string;
}

export interface SemesterGrades {
  available: boolean;
  gpa: number | null;
  grades: SemesterGradeRecord[];
}

export interface OdEntry {
  courseCode: string;
  courseName: string;
  slot: string;
  odHours: number;
  onDutyCount: number;
  present: number;
  absent: number;
  total: number;
  dates: AttendanceDateRow[];
}

export interface AttendanceDateRow {
  date: string;
  timing: string;
  status: string;
}

export interface OdSummary {
  available: boolean;
  limitHours: number;
  totalOdHours: number;
  perCourse: OdEntry[];
}

export interface CalendarDay {
  date: string;
  instructional: boolean;
  dayOrder: string | null;
  label: string;
}

export interface AcademicCalendar {
  months: { token: string; monthKey: string }[];
  days: CalendarDay[];
  available: boolean;
}

export interface TransportInfo {
  hasRegistration: boolean;
  registerNumber: string;
  name: string;
  programme: string;
  branch: string;
  routeSelected: string;
  fpReference: string;
  paymentStatus: string;
}

/** A public event-hub card (same shape the web app's edge function serves). */
export interface HubEventOption {
  type: string;
  price: string;
  eligibility: string;
}

export interface HubEvent {
  eid: string;
  title: string;
  date: string;
  location: string;
  posterUrl: string;
  /** The same poster mirrored by the event-hub function, for phones that cannot
   *  repair the Event Hub host's incomplete TLS chain. See lib/eventPoster.ts. */
  posterProxy?: string;
  registerUrl: string;
  teamSize: string;
  type: string;
  price: string;
  eligibility: string;
  options: HubEventOption[];
}

/** A previous-year paper row from the public PostgREST archive. */
export interface ArchivePaper {
  id: number;
  external_paper_id: string;
  course_code: string | null;
  course_title: string | null;
  title: string | null;
  exam_type: string | null;
  academic_year: string | null;
  semester: string | null;
  slot: string | null;
  campus: string | null;
  paper_url: string;
  answer_key_url: string | null;
  answer_key_included: boolean | null;
  thumbnail_url: string | null;
  file_type: string | null;
  source_created_at: string | null;
  imported_at: string;
}

/** One course's grade-prediction inputs (the same model the web uses). */
export type CourseMarks = CourseMarksRecord;
