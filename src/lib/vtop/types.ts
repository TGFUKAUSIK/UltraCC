export interface StudentProfile {
  registrationNo: string;
  name: string;
  /** VTOP's "Programme" row — the study LEVEL (literally "UG"), not a degree name. */
  program: string;
  /**
   * The academic branch, only when VTOP states it on a row labelled as such.
   * The Chennai profile page has none, so this is normally ''. VTOP's
   * "Branch / Group Studied" row is the Class-XII group and lands in
   * `groupStudied` instead — never here.
   */
  branch: string;
  /** Class-XII (+2) subject group VTOP calls "Branch / Group Studied" ("PCM"). */
  groupStudied?: string;
  school: string;
  semester: string;
  cgpa: number;
  proctorName: string;
  proctorEmail: string;
  proctorMobile: string;
  hostelBlock?: string;
  roomNo?: string;
  /** Authenticated VTOP profile image returned as a data URI by the gateway. */
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

export interface TimetableSlot {
  id: string;
  slot: string;
  courseCode: string;
  courseTitle: string;
  /** 'ETH' (theory) / 'ELA' (lab) — from the timetable's THEORY/LAB rows. */
  courseType: string;
  facultyName: string;
  venue: string;
  building: string;
  startTime: string;
  endTime: string;
  day: 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday';
  /** Credits from the course list's LTPJC column (undefined = not synced yet). */
  credits?: number;
}

export type MarkPart = 'T' | 'L';

export interface ComponentMark {
  title: string;
  maxMarks: number;
  scored: number;
  weightageMax: number;
  weightageScored: number;
  status: 'Evaluated' | 'Pending';
  /**
   * VTOP's own "Weightage Mark" column for this row, when it published one.
   * The predictor prefers this over recomputing scored/max × weightage,
   * because VTOP — not us — decides how a row lands in the final score.
   * Undefined for rows VTOP left blank and for caches that predate capture.
   */
  weightageMark?: number;
  /**
   * Which half of the course this row belongs to: 'T' for the theory class,
   * 'L' for the lab class of an embedded course. Taken from VTOP's own Course
   * Type / Slot cell for the row's parent course row — never inferred from the
   * assessment title. Undefined on caches that predate capture.
   */
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
  /** FAT assessment when the marks page exposes it (usually Pending pre-FAT). */
  fat?: ComponentMark;
  /**
   * The other half's FAT, for an embedded course. VTOP serves a theory FAT and
   * a lab FAT as two tables under one course code; collapsing them made the
   * model read a 3-credit theory exam and a 1-credit lab exam as the same
   * weight of the grade.
   */
  labFat?: ComponentMark;
  /** ALL assessment components from VTOP, including unmapped ones
   *  (PAT, Experiment, Project Review, Assessment-N, Completion Status, etc.).
   *  Preserves the original VTOP title so the UI can display every row. */
  extraComponents?: ComponentMark[];
  /** VTOP's Course Type column ('ETH' / 'ELA' / 'TH' / 'EPJ' / …). */
  courseType?: string;
  /** VTOP's Slot column for this course row ('A1', 'L36+L41', …). */
  slot?: string;
  /**
   * Registered credits from VTOP's own course list (L T P J C), joined at sync
   * time. `theoryCredits` + `labCredits` split an embedded course the way the
   * curriculum registers it (3+1). Undefined = not synced since credits were
   * captured, which the UI reports instead of assuming a number.
   */
  credits?: number;
  theoryCredits?: number;
  labCredits?: number;
  totalInternalWeightScored: number;
  currentEstimatedGrade: string;
}

export interface ExamRecord {
  id: string;
  /** Present on the real schedule page; empty when the source page has none. */
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

/**
 * Cumulative grade summary parsed from the VTOP grade-history page.
 * null = genuinely unavailable (never displayed as 0).
 */
export interface GradeSummary {
  available: boolean;
  cgpa: number | null;
  /** Total credits registered across the programme (from the CGPA summary). */
  creditsRegistered: number | null;
  /** Total credits earned (from the CGPA summary). */
  creditsEarned: number | null;
}

/** One course's final letter grade in a semester (doStudentGradeView). */
export interface SemesterGradeRecord {
  courseCode: string;
  courseTitle: string;
  courseType: string;
  /** Total marks out of 100 as shown by VTOP (null = not published). */
  grandTotal: number | null;
  /** Final letter grade (S/A/B/C/D/E/F/N). Empty = grade not yet published. */
  grade: string;
}

/** Per-semester grade view for the selected semester. */
export interface SemesterGrades {
  available: boolean;
  gpa: number | null;
  grades: SemesterGradeRecord[];
}

/** One row of the cumulative effective-grades table (StudentGradeHistory). */
export interface EffectiveGrade {
  basketTitle: string;
  courseType: string;
  creditsEarned: number | null;
  grade: string;
  distributionType: string;
}

/** Cumulative grade history: CGPA summary + grade-count distribution + effective grades. */
export interface GradeHistory {
  available: boolean;
  cgpa: number | null;
  creditsRegistered: number | null;
  creditsEarned: number | null;
  gradeCounts: { S: number; A: number; B: number; C: number; D: number; E: number; F: number; N: number } | null;
  effectiveGrades: EffectiveGrade[];
}

/** One date-wise attendance row from VTOP's per-class detail page. */
export interface AttendanceDateRow {
  /** VTOP's date cell, "DD-MMM-YYYY" (e.g. "01-AUG-2026"). */
  date: string;
  /** VTOP's "Day And Timing" cell (e.g. "09:00-09:50"). */
  timing: string;
  /** VTOP's status cell ("Present" / "Absent" / "On Duty" / …). */
  status: string;
}

/** Per-course OD totals from the per-class attendance detail page. */
export interface OdEntry {
  courseCode: string;
  courseName: string;
  slot: string;
  /** On-Duty time in class-hours (a 2-period lab counts as 2). */
  odHours: number;
  onDutyCount: number;
  present: number;
  absent: number;
  total: number;
  /**
   * Date-wise attendance for this class, in VTOP's own order. The same detail
   * page that yields the OD counts also carries the Date/Day-timing/Status
   * columns; surfacing them here gives the Attendance view its class-by-class
   * record without inventing any date.
   */
  dates: AttendanceDateRow[];
}

export interface OdSummary {
  /** false = VTOP exposes no OD data for this student (never shown as 0). */
  available: boolean;
  /**
   * VIT's semester cap on on-duty hours, as the gateway reports it (public
   * policy: 40 class-hours). `null` when the response carries no cap: the client
   * used to answer 40 itself, which quietly copied a policy number into a second
   * place and printed a denominator nothing had measured. A surface with no cap
   * says how many hours are used and leaves the fraction out.
   */
  limitHours: number | null;
  totalOdHours: number;
  perCourse: OdEntry[];
}

/** One month of the VIT academic calendar (3-step gateway flow). */
export interface CalendarDay {
  /** ISO date "2025-12-01". */
  date: string;
  instructional: boolean;
  /** Timetable order to follow ("Day Order 2") — null on holidays. */
  dayOrder: string | null;
  /** Event/holiday label — empty for plain instructional days. */
  label: string;
}

export interface AcademicCalendar {
  months: { token: string; monthKey: string }[];
  days: CalendarDay[];
  available: boolean;
}

/** Degree/credit progress parsed from the cumulative grade-history page. */
export interface CurriculumRow {
  name: string;
  required: number;
  earned: number;
  distributionType?: string;
}

export interface CurriculumProgress {
  totals: {
    creditsRequired: number;
    creditsEarned: number;
    creditsRegistered: number;
    cgpa: number | null;
  };
  distributionTypes: CurriculumRow[];
  baskets: CurriculumRow[];
  gradeCounts: { S: number; A: number; B: number; C: number; D: number; E: number; F: number; N: number };
  available: boolean;
}

/** One backlog (arrear) course, semester-scoped. */
export interface ArrearRecord {
  semesterId: string;
  semesterName: string;
  courseCode: string;
  courseTitle: string;
  credits: number;
  /** Final grade if cleared, empty if still pending. */
  grade: string;
  status: 'Pending' | 'Cleared' | 'Registered';
}

/** One VTOP circular/notice (from the cost-centre circulars page). */
export interface CircularRecord {
  id: string;
  title: string;
  category: string;
  date: string;
}

/** One makeup-exam schedule entry (semester-scoped). */
export interface MakeupExamRecord extends ExamRecord {
  semesterId: string;
  semesterName: string;
}

/** Re-exam / reFAT eligibility + course list per semester. */
export interface RefatInfo {
  available: boolean;
  status: string;
  message: string;
  semesters: { id: string; name: string; courses: { courseCode: string; courseTitle: string }[] }[];
}

/** Comprehensive-exam registration status. */
export interface CompreInfo {
  available: boolean;
  status: string;
  message: string;
}

/** Fee dues summary from /vtop/p2p/Payments. */
export interface PaymentsInfo {
  title: string;
  registerNumber: string;
  studentName: string;
  programme: string;
  campus: string;
  /** VTOP's explicit green "no dues" message, when present. */
  message: string;
  hasDues: boolean;
  rows: { label: string; value: string }[];
}

/** One credential row from VTOP's credentials page (account / username / URL). */
export interface CredentialRow {
  account: string;
  username: string;
  defaultCredentials: string;
  url: string;
  venueDate: string;
  seatLocation: string;
}

export interface CredentialsInfo {
  title: string;
  credentials: CredentialRow[];
}

/** SAP ID info from /vtop/sap/SapInformation. */
export interface SapInfo {
  title: string;
  rows: { label: string; value: string }[];
  message: string;
  available: boolean;
}

/** One fee receipt from /vtop/p2p/getReceiptsApplno. */
export interface ReceiptRecord {
  receiptNumber: string;
  date: string;
  amount: string;
  campusCode: string;
  viewKey: string | null;
  applno: string;
  regno: string;
}

export interface PaymentReceiptsInfo {
  title: string;
  receipts: ReceiptRecord[];
  available: boolean;
}

/** HRMS employee search result (label/value record from VTOP). */
export interface EmployeeSearchResult {
  title: string;
  fields: { label: string; value: string }[];
  message: string;
  found: boolean;
}

/** Bank information from /vtop/studentBankInformation/BankInfoStudent. */
export interface BankInfo {
  title: string;
  rows: { label: string; value: string }[];
  message: string;
  available: boolean;
}

/** Biometric info from /vtop/academics/common/BiometricInfo. */
export interface BiometricInfo {
  title: string;
  rows: { label: string; value: string }[];
  message: string;
  available: boolean;
}

/** One message from the proctor (viewMessagesSendByProctor). */
export interface ProctorMessage {
  from: string;
  subject: string;
  body: string;
  date: string;
}

/** One login-history row (show/login/history). */
export interface LoginHistoryRow {
  date: string;
  time: string;
  ip: string;
  status: string;
}

/** One class message (academics/common/StudentClassMessage). */
export interface ClassMessage {
  from: string;
  subject: string;
  body: string;
  date: string;
}

/** HOD / Dean details (hrms/viewHodDeanDetails). */
export interface HodDeanInfo {
  title: string;
  rows: { label: string; value: string }[];
  available: boolean;
}

/** Student wallet (finance/getStudentWallet). */
export interface WalletInfo {
  title: string;
  rows: { label: string; value: string }[];
  message: string;
  available: boolean;
}

/** Extra-curricular activities (academics/common/ExtraCurricular). */
export interface ExtraCurricularInfo {
  title: string;
  rows: { label: string; value: string }[];
  available: boolean;
}

/**
 * Syllabus fetch outcome from the gateway's 'syllabus' target — VTOP's
 * authenticated Course Page (Academics → Course Page → course → syllabus
 * download), fetched and parsed server-side. The browser receives only the
 * parsed course identity and the file bytes. When VTOP has no syllabus link for
 * a course that arrives as available:false with a reason; nothing is invented
 * to fill the gap.
 */
/**
 * A syllabus file the gateway already downloaded over the student's session.
 * The BYTES cross the boundary; the cookie jar, CSRF token and authorizedID
 * never do (same discipline as the profile photo in photo.ts).
 */
export interface SyllabusDocument {
  /** `data:` URI of the file. */
  dataUrl: string;
  /** Sniffed from the file's magic bytes, not from VTOP's Content-Type. */
  contentType: string;
  fileName: string;
  bytes: number;
  /** Which VTOP link produced it — the UI labels the two differently. */
  origin: 'course-syllabus' | 'course-plan';
}

/**
 * Course identity exactly as VTOP's Course Page states it — code, title and
 * the registration type.
 *
 * There is deliberately NO class placement here (VTOP's class id, slot,
 * faculty or class group). Those are how the gateway FINDS a course's syllabus
 * inside VTOP; they are not part of what a student sees or chooses, so they are
 * not part of the payload the browser is given either.
 */
export interface SyllabusCourseIdentity {
  courseCode: string;
  courseTitle: string;
  courseType?: string;
}

/**
 * Why VTOP could not produce a syllabus. These are VTOP's own outcomes, not
 * failures to hide and not excuses for inventing content.
 *
 * The student is shown one of a small set of sentences (see `describeAbsence`);
 * these reasons are what tells them apart, so a "VTOP lists no such course" can
 * never be printed for a page that was never read.
 */
export type SyllabusAbsentReason =
  /**
   * VTOP's course list WAS read, and this course is not in it. Its `detail`
   * names the courses VTOP did list.
   */
  | 'no-course-match'
  /** VTOP answered the Course Page and it lists no courses for this term. */
  | 'course-list-empty'
  /** Nothing was asked properly: no route, no answer, a 404, a failed request. */
  | 'vtop-unreachable'
  /** VTOP's Course Page offered no term that could be asked about. */
  | 'semester-unknown'
  /** The course detail page carries no `courseSyllabusDownload` link. */
  | 'no-syllabus-link'
  /** A link existed but its file could not be delivered. */
  | 'document'
  /** VTOP's class table offered no usable class row for this course. */
  | 'no-slot'
  /** VTOP's rows carried slots, but none with the faculty that was asked for. */
  | 'no-faculty';

/**
 * One row of VTOP's own class table: the slot, the faculty VTOP attributes to
 * it, and the ids its detail page needs. Kept for the cache records below, and
 * for nothing the browser shows — a student chooses a course, never a slot.
 */
export interface SyllabusSlotOption {
  slot: string;
  faculty: string;
  classId?: string;
  erpId?: string;
  classGroup?: string;
}

/**
 * VTOP's own term, when its Course Page answered for a different one than the
 * client asked about. Only ever set from the page's own semester dropdown, and
 * always reported — the syllabus that came back is about `used`, so a stale
 * UltraCC selection can never be presented as the term VTOP answered for.
 */
export interface SyllabusSemesterUsed {
  /** What UltraCC named — its semester id, or its own label if it sent no id. */
  requested: string;
  /** VTOP's own semester id, which this answer is about. */
  used: string;
  /** VTOP's label for it, as printed. */
  label: string;
}

/**
 * One course's syllabus as the browser receives it: whether VTOP has a
 * document, the course it belongs to, and the file itself. Nothing about how
 * the gateway located it — no class id, slot or faculty — is part of this.
 */
export interface SyllabusInfo {
  available: boolean;
  reason?: SyllabusAbsentReason;
  /** Safe, human-readable cause when a document was attempted and failed. */
  detail?: string;
  course?: SyllabusCourseIdentity;
  document?: SyllabusDocument | null;
  /** How far VTOP's Course Page flow got before it answered. */
  reached?: 'course-page' | 'courses' | 'slots' | 'detail' | 'document';
  /** Set only when VTOP's own page named another term than the client's. */
  semester?: SyllabusSemesterUsed;
}

/**
 * WHAT THE BROWSER IS ALLOWED TO ASK. A course — its code and, from an
 * external deep link, its registration type — plus which term the student is
 * looking at. Everything else VTOP needs to locate the document (the term's
 * real id, the course's row, the class, the slot) is resolved inside the
 * gateway, so there is nothing here for the UI to guess at or get wrong.
 */
export interface SyllabusRequest {
  courseCode?: string;
  courseType?: string;
  /** The term the student is viewing, when the app knows it (CH2025261-style). */
  semesterId?: string;
  /** Its name ("Fall Semester 2026-27") — the gateway's fallback when no id. */
  semesterLabel?: string;
}

/**
 * A cached syllabus answer, keyed by student + course + semester so one
 * student's document can never surface under another's profile or under a
 * different term's course of the same code.
 */
export interface SyllabusCacheEntry {
  cacheKey: string;
  registrationNo: string;
  /**
   * The term the answer is about: VTOP's own id when one was known, otherwise
   * the semester's label — the key has to separate two terms even when the
   * client only ever had a name for one of them.
   */
  semesterId: string;
  courseCode: string;
  courseType: string;
  syllabus: SyllabusInfo;
  cachedAt: number;
}

/**
 * One registered class as VTOP's own Course Page states it — the shape of the
 * cached registered-class listing.
 *
 * The Syllabus tab no longer asks for that listing: its cards come from the
 * student's own courses and each card fetches its syllabus on demand, so the
 * browser is never handed VTOP's class placement. This type and the store it
 * feeds (see `COURSE_PAGE_STORE` in db/vtopDatabase.ts) are kept so an existing
 * browser profile keeps the schema it already has.
 *
 * VTOP's class table has no credits column, so no credits field exists here and
 * no code may fill one in from a dataset that has them.
 */
export interface CoursePageClass {
  courseCode: string;
  courseTitle: string;
  /** VTOP's own type spelling for the registration: "ETH", "ELC", "LO" … */
  courseType: string;
  /** VTOP's class id — what its detail page is opened with. */
  classId: string;
  classGroup: string;
  /** VTOP's slot for THIS class ("F1", "L41+L42"), not a timetable cell. */
  slot: string;
  /** Empty when VTOP's class table never answered: unknown, never guessed. */
  faculty: string;
  erpId: string;
  /** False for a course VTOP's dropdown listed but whose class row is missing. */
  resolved: boolean;
  slotOptions?: SyllabusSlotOption[];
}

/** One semester's Course Page listing, cached per student so it survives reload. */
export interface CoursePageCacheEntry {
  cacheKey: string;
  registrationNo: string;
  semesterId: string;
  classes: CoursePageClass[];
  cachedAt: number;
}

/** Day-scholar transport registration from VTOP (Chennai). */
export interface TransportInfo {
  hasRegistration: boolean;
  registerNumber: string;
  name: string;
  programme: string;
  branch: string;
  routeSelected: string;
  fpReference: string;
  paymentStatus: string;
  busRouteId: string;
  qrCode: string;
  rows: { label: string; value: string }[];
}

/** Chennai day-scholar bus route (VIT Chennai transport route dataset). */
export interface BusRoute {
  id: string;
  type: string;
  route: string;
  boardingPoints: string[];
  driverName?: string;
  driverPhone?: string;
  whatsappGroup?: string;
  busLocation?: string;
}

/** Community cab-share ride. */
export interface CabRide {
  id: string;
  from: string;
  to: string;
  date: string;
  time: string;
  seats: number;
  seatsLeft: number;
  notes: string;
  contact: string;
  createdBy: string;
  createdAt: number;
}

/** Shared question paper entry. */
export interface QnPaper {
  id: string;
  courseCode: string;
  courseTitle: string;
  examType: string;
  title: string;
  url: string;
  uploadedAt: number;
}

export interface CaptchaPredictionResult {
  captchaText: string;
  confidence: number; // 0 to 1
  imageBase64?: string;
  /** Human-readable note explaining the prediction (or absence of one). */
  note?: string;
}

export interface VtopSyncMetadata {
  lastSyncedAt: number; // timestamp
  syncSource: 'LIVE_VTOP' | 'CACHED_INDEXEDDB' | 'DEMO_MODE';
  isOnline: boolean;
  selectedSemesterId?: string;
  /** Reg no of the student whose live data is cached (demo cache left empty). */
  registrationNo?: string;
  /** Sanitized marks diagnostic from the last sync: which assessment
   *  components VTOP actually served per course (component names only —
   *  never marks values or credentials). Lets the Grades view show why a
   *  marks table is sparse instead of assuming a parser bug. */
  marksDiag?: { courseCode: string; courseTitle: string; assessments: string[] }[];
}

export interface VTOPClient {
  isExtensionAvailable(): Promise<boolean>;
  initializeSession(): Promise<{ csrfToken: string; captchaImageBase64?: string }>;
  getCaptcha(): Promise<CaptchaPredictionResult>;
  login(regNo: string, password: string, captchaText: string): Promise<{ success: boolean; message: string; authorizedId?: string }>;
  getSemesters(): Promise<SemesterInfo[]>;
  getSessionStatus(): Promise<{ authenticated: boolean }>;
  getProfile(): Promise<StudentProfile>;
  getAttendance(semesterId?: string): Promise<AttendanceRecord[]>;
  getTimetable(semesterId?: string): Promise<TimetableSlot[]>;
  getMarks(semesterId?: string): Promise<CourseMarksRecord[]>;
  getExams(semesterId?: string): Promise<ExamRecord[]>;
  getAssignments(semesterId?: string): Promise<AssignmentRecord[]>;
  /** Cumulative CGPA + earned/registered credits (grade-history page). */
  getGrades(): Promise<GradeSummary>;
  /** Cumulative grade history (effective grades + grade-count distribution). */
  getGradeHistory(): Promise<GradeHistory>;
  /** Per-semester course-wise letter grades + GPA for the selected semester. */
  getSemesterGrades(semesterId?: string): Promise<SemesterGrades>;
  /** On-Duty hours from per-class attendance detail (same session). */
  getOd(semesterId?: string): Promise<OdSummary>;
  /** VIT academic calendar (3-step gateway flow, same session, semester-scoped). */
  getCalendar(semesterId?: string): Promise<AcademicCalendar>;
  /** Backlog/arrear courses across all semesters. */
  getArrears(): Promise<ArrearRecord[]>;
  /** VTOP circulars/notices feed. */
  getCirculars(): Promise<CircularRecord[]>;
  /** Degree/credit progress from the grade-history page. */
  getCurriculum(): Promise<CurriculumProgress>;
  /** Makeup exam schedule (2-step gateway flow, same session). */
  getMakeupExams(): Promise<MakeupExamRecord[]>;
  /** Re-exam / reFAT eligibility + courses. */
  getRefat(): Promise<RefatInfo>;
  /** Compre exam registration status. */
  getCompre(): Promise<CompreInfo>;
  /** Fee dues summary (/vtop/p2p/Payments). */
  getPayments(): Promise<PaymentsInfo>;
  /** VTOP-managed student credentials (accounts + usernames). */
  getCredentials(): Promise<CredentialsInfo>;
  /** Day-scholar transport registration (Chennai). */
  getTransport(): Promise<TransportInfo>;
  /** SAP ID info (/vtop/sap/SapInformation). */
  getSapInfo(): Promise<SapInfo>;
  /** Fee payment receipts (/vtop/p2p/getReceiptsApplno). */
  getPaymentReceipts(): Promise<PaymentReceiptsInfo>;
  /** HRMS employee search by employee ID / name. */
  searchEmployee(empId: string): Promise<EmployeeSearchResult>;
  /** Bank information (/vtop/studentBankInformation/BankInfoStudent). */
  getBankInfo(): Promise<BankInfo>;
  /** Biometric info (/vtop/academics/common/BiometricInfo). */
  getBiometricInfo(): Promise<BiometricInfo>;
  /** Proctor messages (/vtop/proctor/viewMessagesSendByProctor). */
  getProctorMessages(): Promise<ProctorMessage[]>;
  /** Login history (/vtop/show/login/history). */
  getLoginHistory(): Promise<LoginHistoryRow[]>;
  /** Class messages (/vtop/academics/common/StudentClassMessage). */
  getClassMessages(): Promise<ClassMessage[]>;
  /** HOD / Dean details (/vtop/hrms/viewHodDeanDetails). */
  getHodDean(): Promise<HodDeanInfo>;
  /** Student wallet (/vtop/finance/getStudentWallet). */
  getWallet(): Promise<WalletInfo>;
  /** Extra-curricular activities (/vtop/academics/common/ExtraCurricular). */
  getExtraCurricular(): Promise<ExtraCurricularInfo>;
  /** One course's syllabus, over VTOP's authenticated Course Page flow. */
  getSyllabus(request: SyllabusRequest): Promise<SyllabusInfo>;
  logout(): Promise<void>;
}
