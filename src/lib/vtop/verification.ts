/**
 * Central, honest ledger of how much of the VTOP integration is verified.
 *
 * Rules enforced by the rest of the code:
 * - VERIFIED   -> behaviour confirmed against the live VTOP Chennai portal.
 * - UNVERIFIED -> implemented from research / behavior reference but NOT yet
 *                 confirmed against a live authenticated session.
 * - MOCK       -> demo-only synthetic data.
 *
 * Nothing is marked VERIFIED until a real session proves it. Do not edit these
 * flags based on speculation — only after a successful live test.
 *
 * Reference used for post-login behaviour: the MIT-licensed VtopMCP project
 * (github.com/Vikranth-jagdish/VtopMCP), which is live-tested against
 * vtopcc.vit.ac.in. Its route names, page shapes and session quirks were used
 * as a behavioral reference and reimplemented independently here.
 */

export type VerificationStatus = 'VERIFIED' | 'UNVERIFIED' | 'MOCK';

export interface VerificationEntry {
  status: VerificationStatus;
  /** What was verified (or why it is not yet). */
  note: string;
  /** Human date of last verification attempt. */
  lastChecked: string;
}

export const VTOP_VERIFICATION: Record<string, VerificationEntry> = {
  'endpoint:setup': {
    status: 'VERIFIED',
    note: 'LIVE (2026-08-10, pre-auth): GET /vtop/login -> role chooser with _csrf (36 chars). POST /vtop/prelogin/setup with _csrf+flag=VTOP arms the session and returns the student login form (verified with and without -L; the arming handshake is required). Without _csrf the POST 404s.',
    lastChecked: '2026-08-10',
  },
  'endpoint:captcha': {
    status: 'VERIFIED',
    note: 'LIVE (2026-08-10, pre-auth): CAPTCHA is embedded in the student login form as a base64 JPEG inside #captchaBlock; refresh via GET /vtop/get/new/captcha returns an <img src="data:image/jpeg;base64,..."> fragment. NOT the legacy /vtop/captcha. Local manual entry only; no OCR, no external solver.',
    lastChecked: '2026-08-10',
  },
  'endpoint:login': {
    status: 'VERIFIED',
    note: 'LIVE (2026-08-10, pre-auth): POST /vtop/login with username/password/captchaStr/_csrf. FAILURE path verified: bad input -> 302 /vtop/login/error which re-renders the login form ("Invalid Captcha" / "Invalid username or password" / account-locked / max-attempts markers). The 404-when-not-armed quirk verified live (POST /login without prelogin/setup -> HTTP 404). SUCCESS path (authorizedIDX embedded in the inline dashboard response) UNVERIFIED — requires real credentials.',
    lastChecked: '2026-08-10',
  },
  'endpoint:content': {
    status: 'UNVERIFIED',
    note: 'LIVE (2026-08-10, pre-auth): unauthenticated GET /vtop/content -> 302 to the login page (usable for session-status checks). Authenticated dashboard behavior (authorizedIDX present) UNVERIFIED.',
    lastChecked: '2026-08-10',
  },
  'endpoint:attendance': {
    status: 'UNVERIFIED',
    note: 'POST /vtop/processViewStudentAttendance with _csrf, authorizedID, semesterSubId. Route name corroborated by live-tested VtopMCP (MIT); page shape #getStudentDetails. Returns 404 unauthenticated (session-not-armed signature) — needs a real authenticated pass.',
    lastChecked: 'never',
  },
  'endpoint:timetable': {
    status: 'UNVERIFIED',
    note: 'POST /vtop/processViewTimeTable with _csrf, authorizedID, semesterSubId. Route + page shapes (#studentDetailsList course list + THEORY/LAB day×time grid) corroborated by live-tested VtopMCP. Needs a real authenticated pass.',
    lastChecked: 'never',
  },
  'endpoint:semesters': {
    status: 'UNVERIFIED',
    note: 'POST /vtop/academics/common/StudentTimeTableChn with verifyMenu=true & nocache returns the semester <select> options. Corroborated by live-tested VtopMCP. Needs a real authenticated pass.',
    lastChecked: 'never',
  },
  'endpoint:marks': {
    status: 'UNVERIFIED',
    note: 'POST /vtop/examinations/doStudentMarkView with _csrf, authorizedID, semesterSubId (NOT the legacy processViewStudentMarks — that name is stale research). Page shape table.customTable with tr.tableContent course rows + nested table.customTable-level1 assessment rows (<output> cells). #fixedTableContainer kept as legacy fallback. Needs a real authenticated pass.',
    lastChecked: 'never',
  },
  'endpoint:grades': {
    status: 'UNVERIFIED',
    note: 'POST /vtop/examinations/examGradeView/StudentGradeHistory with _csrf, authorizedID, verifyMenu=true & nocache returns the cumulative CGPA summary table (Credits Registered | Credits Earned | CGPA). Route + shape corroborated by live-tested VtopMCP. Needs a real authenticated pass.',
    lastChecked: 'never',
  },
  'endpoint:semester-grades': {
    status: 'UNVERIFIED',
    note: 'POST /vtop/examinations/examGradeView/doStudentGradeView with _csrf, authorizedID, semesterSubId & x returns the per-semester grade view (table.table-bordered: GPA row with align=center + course rows with grade at col 10, grand total col 9). Needs a real authenticated pass.',
    lastChecked: 'never',
  },
  'endpoint:exams': {
    status: 'UNVERIFIED',
    note: 'POST /vtop/examinations/doSearchExamScheduleForStudent with _csrf, authorizedID, semesterSubId (NOT the legacy processViewExamSchedule). Page shape: table with colspan exam-type header rows; columns slot/date/exam time/venue/location/seat no; NO course-code column on the page. Corroborated by live-tested VtopMCP. Needs a real authenticated pass.',
    lastChecked: 'never',
  },
  'endpoint:profile': {
    status: 'UNVERIFIED',
    note: 'POST /vtop/studentsRecord/StudentProfileAllView with verifyMenu=true & nocache. Registration number in a hidden input[name="regno"]; rest is label/value td pairs. Corroborated by live-tested VtopMCP. Needs a real authenticated pass.',
    lastChecked: 'never',
  },
  'endpoint:attendance-detail': {
    status: 'UNVERIFIED',
    note: 'POST /vtop/processViewAttendanceDetail(classId, slot) for per-class status counts. Corroborated by live-tested VtopMCP. Needs a real authenticated pass.',
    lastChecked: 'never',
  },
  'endpoint:assignments': {
    status: 'UNVERIFIED',
    note: 'VTOP Chennai exposes NO verified unified assignment/DA endpoint. Legacy processViewStudentDA is only probed; the feature stays UNVERIFIED and never invents assignments.',
    lastChecked: 'never',
  },
  'endpoint:od': {
    status: 'UNVERIFIED',
    note: 'OD comes from per-class attendance detail: POST /vtop/processViewAttendanceDetail(classId, slot) rows marked "On Duty". Handles (classId/slot) are parsed from the attendance page onclicks. Corroborated by live-tested VtopMCP (od-calc). Needs a real authenticated pass.',
    lastChecked: 'never',
  },
  'parser:grades': {
    status: 'UNVERIFIED',
    note: 'Gateway parseGradeSummaryHtml reads the CGPA summary table by header text (Credits + CGPA); missing values stay null, never 0. Fixture-tested; not live-tested.',
    lastChecked: 'never',
  },
  'parser:od': {
    status: 'UNVERIFIED',
    note: 'Gateway parseAttendanceDetailRefs + parseAttendanceDetail tally On Duty statuses and derive OD hours from class timings (~50min/period, 2-period lab = 2). Fixture-tested; not live-tested.',
    lastChecked: 'never',
  },
  'parser:attendance': {
    status: 'UNVERIFIED',
    note: 'Header-driven parser, prefers table#getStudentDetails, course-type column mapped, strict numeric validation. Fixture-tested (incl. reordered headers); not live-tested.',
    lastChecked: 'never',
  },
  'parser:timetable': {
    status: 'UNVERIFIED',
    note: 'Parses #studentDetailsList course list + THEORY/LAB day×time grid with explicit start/end header rows; generic row-list/grid fallbacks. Fixture-tested; not live-tested.',
    lastChecked: 'never',
  },
  'parser:marks': {
    status: 'UNVERIFIED',
    note: 'Primary: table.customTable + nested customTable-level1 (<output> cells), positional course row [2]=code [3]=title, assessments mapped to CAT 1/2, DA 1/2, Quiz + FAT; AB/Pending -> Pending. Legacy #fixedTableContainer + flat fallbacks kept. Fixture-tested; not live-tested.',
    lastChecked: 'never',
  },
  'parser:semester-grades': {
    status: 'UNVERIFIED',
    note: 'Gateway parseSemesterGradesHtml reads the per-semester grade view (GPA row via align=center, course rows with grade col 10 / grand total col 9). Missing values stay null/empty, never fabricated. Fixture-tested; not live-tested.',
    lastChecked: 'never',
  },
  'parser:grade-history': {
    status: 'UNVERIFIED',
    note: 'Gateway parseGradeHistoryHtml reads the cumulative grade history (CGPA/credits summary + S/A/B/C/D/E/F/N grade-count row + effective-grades table). Missing values stay null. Fixture-tested; not live-tested.',
    lastChecked: 'never',
  },
  'parser:exams': {
    status: 'UNVERIFIED',
    note: 'Parses the colspan exam-type schedule (slot/date/time/venue/location/seat no.); course codes are not on the page so courseCode stays empty (never invented). Fixture-tested; not live-tested.',
    lastChecked: 'never',
  },
  'parser:semesters': {
    status: 'UNVERIFIED',
    note: 'Parses select#semesterSubId options (id authoritative, never fabricated). Fixture-tested; not live-tested.',
    lastChecked: 'never',
  },
  'parser:profile': {
    status: 'UNVERIFIED',
    note: 'Reads hidden input[name="regno"] + label/value td pairs with first-match semantics; hard-validates the reg number. Fixture-tested; not live-tested.',
    lastChecked: 'never',
  },
  'parser:login': {
    status: 'VERIFIED',
    note: 'LIVE (2026-08-10): parsers validated against SANITIZED REAL login pages captured from vtopcc.vit.ac.in (role chooser, student login form with vtopLoginForm/captchaStr/captchaBlock, captcha fragment, login-error page). Field names + actions match the real portal.',
    lastChecked: '2026-08-10',
  },
  'ocr:captcha': {
    status: 'MOCK',
    note: 'No OCR is shipped. VTOP CAPTCHAs are not reliably readable by local heuristics, so the flow is manual entry only.',
    lastChecked: 'never',
  },
  'demo:data': {
    status: 'MOCK',
    note: 'Synthetic student data used only in DEMO MODE. Never mixed with live data.',
    lastChecked: 'never',
  },

  // --- LMS (lms.vit.ac.in Moodle) — separate credential set, HTML scraping ---
  // Researched live (2026-08-13): no SSO with VTOP; Moodle web services API
  // DISABLED (token.php -> enablewsdescription); standard logintoken + POST
  // login flow; MoodleSession cookie; all targets 303 -> /login/index.php
  // when unauthenticated. All lms:* entries below start UNVERIFIED until a
  // real authenticated LMS session confirms them.
  'lms:login': {
    status: 'UNVERIFIED',
    note: 'GET /login/index.php -> logintoken hidden field; POST logintoken+username+password -> 303 /my/ (success) or re-rendered login with loginerrors (failure). Login page shape verified pre-auth; success/failure paths need a real account.',
    lastChecked: 'never',
  },
  'lms:courses': {
    status: 'UNVERIFIED',
    note: 'GET /my/ -> course cards (course/view.php?id=N links). Fixture-tested; not live-tested.',
    lastChecked: 'never',
  },
  'lms:assignments': {
    status: 'UNVERIFIED',
    note: 'GET /mod/assign/index.php?id={courseId} -> assignment rows with due-date cells. Fixture-tested; not live-tested.',
    lastChecked: 'never',
  },
  'lms:quiz-windows': {
    status: 'UNVERIFIED',
    note: 'GET /mod/quiz/index.php?id={courseId} -> quiz links; each /mod/quiz/view.php?id=N summary table (Opens/Closes/Time limit/Attempts allowed). The open/close timestamps feed the quiz-window notifications — MUST be live-verified for accuracy.',
    lastChecked: 'never',
  },
  'lms:gradebook': {
    status: 'UNVERIFIED',
    note: 'GET /grade/report/user/index.php?id={courseId} -> single-user grade table (item/grade/range/percentage/feedback). Fixture-tested; not live-tested.',
    lastChecked: 'never',
  },
  'lms:materials': {
    status: 'UNVERIFIED',
    note: 'GET /course/view.php?id={courseId} -> li.activity elements linking to pluginfile.php / mod_resource / mod_folder. Fixture-tested; not live-tested.',
    lastChecked: 'never',
  },
  'lms:forum': {
    status: 'UNVERIFIED',
    note: 'Course page -> first /mod/forum/view.php?id=N -> article.forumpost posts (title/author/date/body). Fixture-tested; not live-tested.',
    lastChecked: 'never',
  },
  'lms:calendar': {
    status: 'UNVERIFIED',
    note: 'GET /calendar/view.php?view=upcoming -> event blocks (date/name/time/course). Fixture-tested; not live-tested.',
    lastChecked: 'never',
  },
  'lms:gradebook-mismatch': {
    status: 'UNVERIFIED',
    note: 'LMS gradebook vs VTOP CAT/DA comparison — heuristic component-name matching, non-blocking alerts only. Needs a real student with data in both systems.',
    lastChecked: 'never',
  },
  'lms:grade-predictor': {
    status: 'UNVERIFIED',
    note: 'Relative grading predictor uses a community μ/σ estimate by default; empirical μ/σ only when >=15 anonymous grade_submissions exist for a course. Needs real submissions.',
    lastChecked: 'never',
  },
  'vtop:makeup-exams': {
    status: 'UNVERIFIED',
    note: '2-step flow POST /vtop/examinations/StudExamScheduleForMakeupExam -> semester <select> -> POST /vtop/examinations/doSearchExamScheduleForStudentMakeupExam. Route + page shape fixture-tested. Needs a real authenticated pass.',
    lastChecked: 'never',
  },
  'vtop:refat': {
    status: 'UNVERIFIED',
    note: 'Re-exam/reFAT: POST /vtop/examinations/reFAT/StudentReFATRequestPageController -> semester <select> -> POST /vtop/examinations/reFAT/StudentReFATRequestOnChange. Fixture-tested; needs a real pass.',
    lastChecked: 'never',
  },
  'vtop:compre': {
    status: 'UNVERIFIED',
    note: 'POST /vtop/compre/registrationForm -> status/message (h3.text-danger = closed). Fixture-tested; needs a real pass.',
    lastChecked: 'never',
  },
};

export function verificationStatus(key: string): VerificationStatus {
  return VTOP_VERIFICATION[key]?.status ?? 'UNVERIFIED';
}
