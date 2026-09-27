/**
 * vtop-gateway — Supabase Edge Function (Deno)
 *
 * Stateless VTOP Chennai proxy. The browser sends an opaque `sessionToken`
 * (AES-GCM encrypted JSON) on every authenticated request; this function
 * decrypts it, performs the VTOP HTTP call, re-encrypts the updated session
 * state, and returns clean JSON to the browser.
 *
 * SECURITY GUARANTEES:
 *   - Credentials (password, CAPTCHA) exist only during the DO_LOGIN call's
 *     request lifetime — they are never written to logs, DB, or storage.
 *   - JSESSIONID / CSRF / authorizedID travel encrypted in the sessionToken;
 *     the browser holds the encryption key (derived from a random per-session
 *     salt) and the function holds the master secret (env var SESSION_SECRET).
 *   - No VTOP HTML is ever forwarded to the browser raw.
 *   - No credentials or cookies are emitted to Deno logs.
 *   - Strict VTOP-only URL allowlist — no arbitrary proxy.
 *
 * NOT zero-knowledge: VTOP credentials transit this function over HTTPS.
 * The UI must clearly inform the user of this.
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------
import {
  fetchProfilePhotoDataUrl,
  summarizePhotoDiag,
} from './photo.ts';
import {
  requestWithJar,
  buildSessionDiag,
  sessionJsidHash,
  extractAuthorizedId,
  extractCsrf,
  extractSetCookies,
  isSessionExpired,
  mergeCookieJar,
  type SessionDiag,
  type FetchImpl,
} from './session.ts';
import {
  ParseError,
  parseAttendanceHtml,
  parseTimetableHtml,
  parseMarksHtml,
  marksDiagnostic,
  parseExamsHtml,
  parseProfileHtml,
  extractProfilePhotoSource,
  parseSemestersHtml,
  parseCgpaCreditsHtml,
  parseProctorHtml,
  parseSemesterGradesHtml,
  parseGradeHistoryHtml,
  parseAttendanceDetailRefs,
  parseAttendanceDetail,
  parseCalendarMonths,
  parseAcademicCalendar,
  parseDaClassOptions,
  parseDaAssignmentsHtml,
  parseBankInfoHtml,
  parseBiometricInfoHtml,
  parseProctorMessagesHtml,
  parseLoginHistoryHtml,
  parseClassMessagesHtml,
  parseHodDeanHtml,
  parseWalletHtml,
  parseExtraCurricularHtml,
  parseCurriculumProgressHtml,
  parseArrearSemesters,
  parseArrearHtml,
  parseCircularsHtml,
  type AttendanceDetailRef,
  type GatewayCalendarMonth,
  type GatewayCalendarDay,
  type GatewayAssignment,
  type GatewayBankInfo,
  type GatewayBiometricInfo,
  type GatewayProctorMessage,
  type GatewayLoginHistoryRow,
  type GatewayClassMessage,
  type GatewayHodDean,
  type GatewayWallet,
  type GatewayExtraCurricular,
  type GatewayArrearSemester,
  type GatewayArrear,
  type GatewayCircular,
  type GatewayMakeupExam,
  type GatewayRefatInfo,
  type GatewayCompreInfo,
  specialExamSemesters,
  parseExamTableRows,
  parseRefatCourses,
  parseCompreInfo,
  parseHeadingText,
  parsePaymentsHtml,
  parseCredentialsHtml,
  parseTransportHtml,
  parseSapInfoHtml,
  parsePaymentReceiptsHtml,
  parseEmployeeSearchHtml,
  type GatewayPaymentsInfo,
  type GatewayCredentialsInfo,
  type GatewayTransportInfo,
  type GatewaySapInfo,
  type GatewayPaymentReceiptsInfo,
  type GatewayEmployeeSearchInfo,
} from './parsers.ts';
import {
  armStudentSession,
  submitLogin,
  ArmError,
  extractCaptchaDataUri,
  hasRecaptcha,
  describeLoginShape,
  type ArmResult,
} from './flows.ts';
import {
  fetchCourseSyllabus,
  classifySyllabusFailure,
  fileNameFromDisposition,
  isSafeDownloadPath,
  summarizeSyllabusDiag,
  summarizeSyllabusFailure,
  MAX_SYLLABUS_BYTES,
  type SyllabusFailureStage,
  type SyllabusRoutes,
  type SyllabusTransport,
  type SyllabusFailure,
} from './syllabus.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface SessionState {
  // FULL cookie jar (JSESSIONID + SERVERID + cookiesession1 ...). VTOP's
  // "armed" prelogin state is bound to a specific LB backend node via the
  // affinity cookies — dropping them makes DO_LOGIN land on a random node and
  // fail with 404 "session not armed" (verified live).
  cookie: string;
  csrf: string;        // _csrf token value
  authorizedId: string;// authorizedIDX / authorizedID value (post-login)
  regNo?: string;      // sanitized, logged only as partial (first 4 chars)
  // Truncated SHA-256 of the JSESSIONID that was ARMED by prelogin/setup.
  // Never the value itself — lets diagnostics report session consistency
  // (same/different) without exposing the session id.
  jsidHash?: string;
  /** Campus identifier — determines which VTOP host to target. */
  campus?: string;
}

interface GatewayRequest {
  action:
    | 'INITIALIZE_SESSION'
    | 'FETCH_CAPTCHA'
    | 'DO_LOGIN'
    | 'GET_SESSION_STATUS'
    | 'FETCH_DATA'
    | 'LOGOUT';
  // Encrypted session state blob — opaque to the browser.
  sessionToken?: string;
  // DO_LOGIN only — cleared from memory immediately after use.
  credentials?: { regNo: string; password: string; captchaText: string };
  // FETCH_DATA query params (e.g. employeeSearch -> { empId }).
  query?: Record<string, string>;
  // FETCH_DATA target
  dataTarget?:
    | 'attendance' | 'timetable' | 'marks' | 'exams' | 'profile'
    | 'semesters' | 'assignments' | 'grades' | 'gradeHistory' | 'semesterGrades' | 'od';
  semesterId?: string;
  /** Campus identifier (chennai/vellore/ap/bhopal). Default: chennai. */
  campus?: string;
}

interface GatewayResponse {
  ok: boolean;
  action: string;
  // Updated encrypted session token to store in browser RAM.
  sessionToken?: string;
  // INITIALIZE_SESSION / FETCH_CAPTCHA
  captchaImageBase64?: string;
  // DO_LOGIN
  loginSuccess?: boolean;
  loginError?: string;
  captchaMismatch?: boolean;
  sessionExpired?: boolean;
  // FETCH_DATA
  data?: unknown;
  // FETCH_DATA — page shape didn't match any known VTOP structure (never
  // silently empty: the student sees an explicit parse error).
  parseFailed?: boolean;
  // FETCH_DATA — the target has no verified VTOP source.
  unavailable?: boolean;
  // FETCH_DATA — VTOP served no page for this dataset's own address (404). The
  // session is still alive; this one dataset simply is not on the account. Kept
  // apart from `sessionExpired` so a sync's "you have no wallet" answers are
  // not read as session deaths that sign the student out.
  notAvailable?: boolean;
  // FETCH_DATA — marks: per-course assessment titles VTOP actually served
  // (sanitized — component names like "CAT 1", NOT marks values or credentials).
  // Lets the client prove whether CAT/DA rows exist before blaming the parser.
  marksDiag?: { courseCode: string; courseTitle: string; assessments: string[] }[];
  // FETCH_DATA — profile: SAFE one-line photo-fetch outcome (step/MIME/bytes/
  // hops only — never cookies, session data, or photo bytes). Surfaced so the
  // dev console can distinguish "VTOP served no photo" from a fetch failure.
  photoDiag?: string;
  // FETCH_DATA — syllabus: safe one-line outcome of the 5-step Course Page
  // flow (step/status/counts/bytes only — never HTML, cookies, ids or file
  // contents). Surfaced because the Chennai route spellings are unverified:
  // the first real attempt must say WHICH step died instead of reading as
  // "VTOP has no syllabus".
  syllabusDiag?: string;
  // FETCH_DATA — syllabus: WHICH STAGE failed and a fixed-vocabulary reason
  // (SESSION | SEMESTER | COURSE | SLOT | FACULTY | DETAIL | DOWNLOAD |
  // UPSTREAM). Development diagnostics only, and safe by construction: a stage
  // token from a closed list, a reason token from a closed list and, when a
  // route answered, its HTTP status. Never a course code, a cookie, a token,
  // a session id, VTOP HTML or file bytes. Absent on success.
  syllabusStage?: SyllabusFailureStage;
  syllabusReason?: string;
  syllabusStatus?: number;
  // SAFE session diagnostics (booleans/counts only — never values)
  diag?: SessionDiag;
  // Error
  error?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Campus-specific VTOP hosts. Only Chennai is live-verified. */
const CAMPUS_HOSTS: Record<string, string> = {
  chennai: 'https://vtopcc.vit.ac.in',
  vellore: 'https://vtop.vit.ac.in',
  ap: 'https://vtopcc.vitap.ac.in',
  bhopal: 'https://vtopcc.vitbhopal.ac.in',
};
const DEFAULT_CAMPUS = 'chennai';

function vtopOrigin(campus?: string): string {
  return CAMPUS_HOSTS[campus || DEFAULT_CAMPUS] || CAMPUS_HOSTS[DEFAULT_CAMPUS];
}
function vtopBase(campus?: string): string {
  return `${vtopOrigin(campus)}/vtop`;
}

// Strict allowlist — no arbitrary proxy
const ALLOWED_ENDPOINTS: Record<string, string> = {
  login:          'login',
  preloginSetup:  'prelogin/setup',
  newCaptcha:     'get/new/captcha',
  content:        'content',
  logout:         'processLogout',
  attendance:     'processViewStudentAttendance',
  timetable:      'processViewTimeTable',
  semesters:      'academics/common/StudentTimeTableChn',
  marks:          'examinations/doStudentMarkView',
  exams:          'examinations/doSearchExamScheduleForStudent',
  profile:        'studentsRecord/StudentProfileAllView',
  assignments:    'processViewStudentDA',
  // CGPA + credits summary (cumulative grade history).
  gradeHistory:   'examinations/examGradeView/StudentGradeHistory',
  // Per-semester grade view (course-wise letter grades + GPA).
  semesterGrades: 'examinations/examGradeView/doStudentGradeView',
  // PRIMARY CGPA/credits — the dashboard endpoint (live-verified).
  cgpaCredits:    'get/dashboard/current/cgpa/credits',
  // Proctor details (live-verified).
  proctor:        'proctor/viewProctorDetails',
  // Per-class attendance detail — the only VTOP Chennai page that marks OD.
  attendanceDetail: 'processViewAttendanceDetail',
  // Academic calendar — 3-step flow (CalendarPreview -> getListForSemester ->
  // processViewCalendar), live-tested via the MIT VtopMCP reference.
  calendarPreview: 'academics/common/CalendarPreview',
  calendarMonthList: 'getListForSemester',
  calendarMonth: 'processViewCalendar',
  // Arrears (backlogs) — live-verified Chennai endpoint.
  arrearInit: 'examinations/arrearRegistration/LoadRegularArrearViewPage',
  arrearData: 'examinations/arrearRegistration/viewRARArrearBySemesterWise',
  // Circulars — live-verified Chennai endpoint.
  circulars: 'admissions/costCentreCircularsViewPageController',
  // Special exams (live-verified Chennai endpoints):
  // makeup schedule (2-step), re-FAT request, compre registration.
  makeupInit: 'examinations/StudExamScheduleForMakeupExam',
  makeupData: 'examinations/doSearchExamScheduleForStudentMakeupExam',
  refatPage: 'examinations/reFAT/StudentReFATRequestPageController',
  refatData: 'examinations/reFAT/StudentReFATRequestOnChange',
  compre: 'compre/registrationForm',
  // Fee dues — live-verified Chennai endpoint.
  payments: 'p2p/Payments',
  // Student credentials (accounts VTOP manages for you).
  credentials: 'proctor/viewStudentCredentials',
  // Day-scholar transport registration.
  transport: 'transport/transportRegistration',
  // SAP ID info.
  sapInfo: 'sap/SapInformation',
  // Fee receipts — p2p/getReceiptsApplno.
  receiptsInit: 'p2p/getReceiptsApplno',
  // Digital Assignments (capstone/DAs) — 2-step flow:
  //   StudentDA page -> processDigitalAssignment { classId } -> DA table.
  daPage: 'examinations/StudentDA',
  daData: 'examinations/processDigitalAssignment',
  // HRMS employee search (find any VIT faculty by employee ID).
  employeeSearchInit: 'hrms/employeeSearchForStudent',
  employeeSearchData: 'hrms/EmployeeSearchForStudent',
  // Bank info — single-step.
  bankInfo: 'studentBankInformation/BankInfoStudent',
  // Biometric info — single-step.
  biometric: 'academics/common/BiometricInfo',
  // Proctor messages — single-step.
  proctorMessages: 'proctor/viewMessagesSendByProctor',
  // Login history — single-step.
  loginHistory: 'show/login/history',
  // Class messages — single-step.
  classMessages: 'academics/common/StudentClassMessage',
  // HOD/Dean details — single-step.
  hodDean: 'hrms/viewHodDeanDetails',
  // Student wallet — single-step.
  wallet: 'finance/getStudentWallet',
  // Extra-curricular activities — single-step.
  extraCurricular: 'academics/common/ExtraCurricular',
  // Per-course syllabus — a 5-step flow, not a page in the Academics menu.
  // VTOP serves the document only from the Course Page's course-detail
  // response, so all four routes below are walked in order (see syllabus.ts
  // for the provenance of each and what is still unverified for Chennai).
  // The document download itself is NOT listed here: its path is read out of
  // VTOP's own vtopDownload() link and validated by isSafeDownloadPath(),
  // which accepts only courseSyllabusDownload, CoursePlanExcelDownload,
  // allCourseMeterialDownload and downloadPdf — relative, under /vtop/, no
  // "..", no host. Anything else is refused rather than fetched.
  coursePage: 'academics/common/StudentCoursePage',
  coursePageChn: 'academics/common/StudentCoursePageChn',
  coursePageCourses: 'getCourseForCoursePage',
  coursePageSlots: 'getSlotIdForCoursePage',
  courseDetail: 'processViewStudentCourseDetail',
  // VTOP's own course-plan workbook for a class — the fallback artifact when
  // a course page links no syllabus PDF. Built from the detail page's own
  // semesterSubId + classId, never from a guessed id.
  coursePlan: 'academics/common/CoursePlanExcelDownload',
};

/** VIT caps On-Duty (OD) at 40 class-hours per semester (public policy). */
const OD_LIMIT_HOURS = 40;

// ---------------------------------------------------------------------------
// Crypto helpers — AES-GCM session token encryption
// ---------------------------------------------------------------------------

/** Import the master secret from env as a raw 256-bit AES key. */
async function getMasterKey(): Promise<CryptoKey> {
  // REQUIRED. The session token encrypts the VTOP cookie jar + CSRF + auth
  // identity; a deterministic fallback derived from public values (SUPABASE_URL)
  // would let anyone decrypt a stolen token. No fallback — refuse to run.
  const secret = Deno.env.get('SESSION_SECRET');
  if (!secret) {
    throw new Error(
      'SESSION_SECRET environment variable is required. Set it once with: ' +
      'supabase secrets set SESSION_SECRET=<long-random-string>' +
      ' (see supabase/functions/vtop-gateway/README.md)'
    );
  }
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function base64ToBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function encryptSession(state: SessionState): Promise<string> {
  const key = await getMasterKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(state));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  // Format: base64(iv) + '.' + base64(ciphertext)
  return `${bufferToBase64(iv.buffer)}.${bufferToBase64(ciphertext)}`;
}

async function decryptSession(token: string): Promise<SessionState> {
  const [ivB64, ctB64] = token.split('.');
  if (!ivB64 || !ctB64) throw new Error('Invalid session token format');
  const key = await getMasterKey();
  const iv = new Uint8Array(base64ToBuffer(ivB64));
  const ciphertext = base64ToBuffer(ctB64);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return JSON.parse(new TextDecoder().decode(plaintext)) as SessionState;
}

// ---------------------------------------------------------------------------
// VTOP HTTP helpers
// ---------------------------------------------------------------------------

// VTOP Chennai (vtopcc.vit.ac.in) uses a valid Sectigo certificate but their server
// does NOT send the intermediate certificate in the TLS handshake.
// Deno's bundled Mozilla trust store requires the full chain.
// Fix: provide the missing intermediate + root certs via caCerts so Deno can verify.
//
// Cert chain (rotated 2026-09): *.vit.ac.in → Sectigo Public Server Authentication
// CA DV R36 → Sectigo Public Server Authentication Root R46. The intermediate is
// what VTOP's server omits. The PRE-rotation chain (Sectigo RSA DV Secure Server
// CA → USERTrust RSA) is kept pinned as well: some VTOP load-balancer nodes may
// still serve it, and an extra trust anchor costs nothing.

const SECTIGO_INTERMEDIATE_CA = `-----BEGIN CERTIFICATE-----
MIIGEzCCA/ugAwIBAgIQfVtRJrR2uhHbdBYLvFMNpzANBgkqhkiG9w0BAQwFADCB
iDELMAkGA1UEBhMCVVMxEzARBgNVBAgTCk5ldyBKZXJzZXkxFDASBgNVBAcTC0pl
cnNleSBDaXR5MR4wHAYDVQQKExVUaGUgVVNFUlRSVVNUIE5ldHdvcmsxLjAsBgNV
BAMTJVVTRVJUcnVzdCBSU0EgQ2VydGlmaWNhdGlvbiBBdXRob3JpdHkwHhcNMTgx
MTAyMDAwMDAwWhcNMzAxMjMxMjM1OTU5WjCBjzELMAkGA1UEBhMCR0IxGzAZBgNV
BAgTEkdyZWF0ZXIgTWFuY2hlc3RlcjEQMA4GA1UEBxMHU2FsZm9yZDEYMBYGA1UE
ChMPU2VjdGlnbyBMaW1pdGVkMTcwNQYDVQQDEy5TZWN0aWdvIFJTQSBEb21haW4g
VmFsaWRhdGlvbiBTZWN1cmUgU2VydmVyIENBMIIBIjANBgkqhkiG9w0BAQEFAAOC
AQ8AMIIBCgKCAQEA1nMz1tc8INAA0hdFuNY+B6I/x0HuMjDJsGz99J/LEpgPLT+N
TQEMgg8Xf2Iu6bhIefsWg06t1zIlk7cHv7lQP6lMw0Aq6Tn/2YHKHxYyQdqAJrkj
eocgHuP/IJo8lURvh3UGkEC0MpMWCRAIIz7S3YcPb11RFGoKacVPAXJpz9OTTG0E
oKMbgn6xmrntxZ7FN3ifmgg0+1YuWMQJDgZkW7w33PGfKGioVrCSo1yfu4iYCBsk
Haswha6vsC6eep3BwEIc4gLw6uBK0u+QDrTBQBbwb4VCSmT3pDCg/r8uoydajotY
uK3DGReEY+1vVv2Dy2A0xHS+5p3b4eTlygxfFQIDAQABo4IBbjCCAWowHwYDVR0j
BBgwFoAUU3m/WqorSs9UgOHYm8Cd8rIDZsswHQYDVR0OBBYEFI2MXsRUrYrhd+mb
+ZsF4bgBjWHhMA4GA1UdDwEB/wQEAwIBhjASBgNVHRMBAf8ECDAGAQH/AgEAMB0G
A1UdJQQWMBQGCCsGAQUFBwMBBggrBgEFBQcDAjAbBgNVHSAEFDASMAYGBFUdIAAw
CAYGZ4EMAQIBMFAGA1UdHwRJMEcwRaBDoEGGP2h0dHA6Ly9jcmwudXNlcnRydXN0
LmNvbS9VU0VSVHJ1c3RSU0FDZXJ0aWZpY2F0aW9uQXV0aG9yaXR5LmNybDB2Bggr
BgEFBQcBAQRqMGgwPwYIKwYBBQUHMAKGM2h0dHA6Ly9jcnQudXNlcnRydXN0LmNv
bS9VU0VSVHJ1c3RSU0FBZGRUcnVzdENBLmNydDAlBggrBgEFBQcwAYYZaHR0cDov
L29jc3AudXNlcnRydXN0LmNvbTANBgkqhkiG9w0BAQwFAAOCAgEAMr9hvQ5Iw0/H
ukdN+Jx4GQHcEx2Ab/zDcLRSmjEzmldS+zGea6TvVKqJjUAXaPgREHzSyrHxVYbH
7rM2kYb2OVG/Rr8PoLq0935JxCo2F57kaDl6r5ROVm+yezu/Coa9zcV3HAO4OLGi
H19+24rcRki2aArPsrW04jTkZ6k4Zgle0rj8nSg6F0AnwnJOKf0hPHzPE/uWLMUx
RP0T7dWbqWlod3zu4f+k+TY4CFM5ooQ0nBnzvg6s1SQ36yOoeNDT5++SR2RiOSLv
xvcRviKFxmZEJCaOEDKNyJOuB56DPi/Z+fVGjmO+wea03KbNIaiGCpXZLoUmGv38
sbZXQm2V0TP2ORQGgkE49Y9Y3IBbpNV9lXj9p5v//cWoaasm56ekBYdbqbe4oyAL
l6lFhd2zi+WJN44pDfwGF/Y4QA5C5BIG+3vzxhFoYt/jmPQT2BVPi7Fp2RBgvGQq
6jG35LWjOhSbJuMLe/0CjraZwTiXWTb2qHSihrZe68Zk6s+go/lunrotEbaGmAhY
LcmsJWTyXnW0OMGuf1pGg+pRyrbxmRE1a6Vqe8YAsOf4vmSyrcjC8azjUeqkk+B5
yOGBQMkKW+ESPMFgKuOXwIlCypTPRpgSabuY0MLTDXJLR27lk8QyKGOHQ+SwMj4K
00u/I5sUKUErmgQfky3xxzlIPK1aEn8=
-----END CERTIFICATE-----`;

const USERTRUST_ROOT_CA = `-----BEGIN CERTIFICATE-----
MIIF3jCCA8agAwIBAgIQAf1tMPyjylGoG7xkDjUDLTANBgkqhkiG9w0BAQwFADCB
iDELMAkGA1UEBhMCVVMxEzARBgNVBAgTCk5ldyBKZXJzZXkxFDASBgNVBAcTC0pl
cnNleSBDaXR5MR4wHAYDVQQKExVUaGUgVVNFUlRSVVNUIE5ldHdvcmsxLjAsBgNV
BAMTJVVTRVJUcnVzdCBSU0EgQ2VydGlmaWNhdGlvbiBBdXRob3JpdHkwHhcNMTAw
MjAxMDAwMDAwWhcNMzgwMTE4MjM1OTU5WjCBiDELMAkGA1UEBhMCVVMxEzARBgNV
BAgTCk5ldyBKZXJzZXkxFDASBgNVBAcTC0plcnNleSBDaXR5MR4wHAYDVQQKExVU
aGUgVVNFUlRSVVNUIE5ldHdvcmsxLjAsBgNVBAMTJVVTRVJUcnVzdCBSU0EgQ2Vy
dGlmaWNhdGlvbiBBdXRob3JpdHkwggIiMA0GCSqGSIb3DQEBAQUAA4ICDwAwggIK
AoICAQCAEmUXNg7D2wiz0KxXDXbtzSfTTK1Qg2HiqiBNCS1kCdzOiZ/MPans9s/B
3PHTsdZ7NygRK0faOca8Ohm0X6a9fZ2jY0K2dvKpOyuR+OJv0OwWIJAJPuLodMkY
tJHUYmTbf6MG8YgYapAiPLz+E/CHFHv25B+O1ORRxhFnRghRy4YUVD+8M/5+bJz/
Fp0YvVGONaanZshyZ9shZrHUm3gDwFA66Mzw3LyeTP6vBZY1H1dat//O+T23LLb2
VN3I5xI6Ta5MirdcmrS3ID3KfyI0rn47aGYBROcBTkZTmzNg95S+UzeQc0PzMsNT
79uq/nROacdrjGCT3sTHDN/hMq7MkztReJVni+49Vv4M0GkPGw/zJSZrM233bkf6
c0Plfg6lZrEpfDKEY1WJxA3Bk1QwGROs0303p+tdOmw1XNtB1xLaqUkL39iAigmT
Yo61Zs8liM2EuLE/pDkP2QKe6xJMlXzzawWpXhaDzLhn4ugTncxbgtNMs+1b/97l
c6wjOy0AvzVVdAlJ2ElYGn+SNuZRkg7zJn0cTRe8yexDJtC/QV9AqURE9JnnV4ee
UB9XVKg+/XRjL7FQZQnmWEIuQxpMtPAlR1n6BB6T1CZGSlCBst6+eLf8ZxXhyVeE
Hg9j1uliutZfVS7qXMYoCAQlObgOK6nyTJccBz8NUvXt7y+CDwIDAQABo0IwQDAd
BgNVHQ4EFgQUU3m/WqorSs9UgOHYm8Cd8rIDZsswDgYDVR0PAQH/BAQDAgEGMA8G
A1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQEMBQADggIBAFzUfA3P9wF9QZllDHPF
Up/L+M+ZBn8b2kMVn54CVVeWFPFSPCeHlCjtHzoBN6J2/FNQwISbxmtOuowhT6KO
VWKR82kV2LyI48SqC/3vqOlLVSoGIG1VeCkZ7l8wXEskEVX/JJpuXior7gtNn3/3
ATiUFJVDBwn7YKnuHKsSjKCaXqeYalltiz8I+8jRRa8YFWSQEg9zKC7F4iRO/Fjs
8PRF/iKz6y+O0tlFYQXBl2+odnKPi4w2r78NBc5xjeambx9spnFixdjQg3IM8WcR
iQycE0xyNN+81XHfqnHd4blsjDwSXWXavVcStkNr/+XeTWYRUc+ZruwXtuhxkYze
Sf7dNXGiFSeUHM9h4ya7b6NnJSFd5t0dCy5oGzuCr+yDZ4XUmFF0sbmZgIn/f3gZ
XHlKYC6SQK5MNyosycdiyA5d9zZbyuAlJQG03RoHnHcAP9Dc1ew91Pq7P8yF1m9/
qS3fuQL39ZeatTXaw2ewh0qpKJ4jjv9cJ2vhsE/zB+4ALtRZh8tSQZXq9EfX7mRB
VXyNWQKV3WKdwrnuWih0hKWbt5DHDAff9Yk2dDLWKMGwsAvgnEzDHNb842m1R0aB
L6KCq9NjRHDEjf8tM7qtj3u1cIiuPhnPQCjY/MiQu12ZIvVS5ljFH4gxQ+6IHdfG
jjxDah2nGN59PRbxYvnKkKj9
-----END CERTIFICATE-----`;

// CURRENT chain (observed live 2026-09-19): the intermediate VTOP's server omits
// today. Fetched from Sectigo's AIA repository (crt.sectigo.com) and verified
// locally against the live leaf: leaf → this intermediate → Root R46 = OK.
const SECTIGO_DV_R36_INTERMEDIATE_CA = `-----BEGIN CERTIFICATE-----
MIIGTDCCBDSgAwIBAgIQOXpmzCdWNi4NqofKbqvjsTANBgkqhkiG9w0BAQwFADBf
MQswCQYDVQQGEwJHQjEYMBYGA1UEChMPU2VjdGlnbyBMaW1pdGVkMTYwNAYDVQQD
Ey1TZWN0aWdvIFB1YmxpYyBTZXJ2ZXIgQXV0aGVudGljYXRpb24gUm9vdCBSNDYw
HhcNMjEwMzIyMDAwMDAwWhcNMzYwMzIxMjM1OTU5WjBgMQswCQYDVQQGEwJHQjEY
MBYGA1UEChMPU2VjdGlnbyBMaW1pdGVkMTcwNQYDVQQDEy5TZWN0aWdvIFB1Ymxp
YyBTZXJ2ZXIgQXV0aGVudGljYXRpb24gQ0EgRFYgUjM2MIIBojANBgkqhkiG9w0B
AQEFAAOCAY8AMIIBigKCAYEAljZf2HIz7+SPUPQCQObZYcrxLTHYdf1ZtMRe7Yeq
RPSwygz16qJ9cAWtWNTcuICc++p8Dct7zNGxCpqmEtqifO7NvuB5dEVexXn9RFFH
12Hm+NtPRQgXIFjx6MSJcNWuVO3XGE57L1mHlcQYj+g4hny90aFh2SCZCDEVkAja
EMMfYPKuCjHuuF+bzHFb/9gV8P9+ekcHENF2nR1efGWSKwnfG5RawlkaQDpRtZTm
M64TIsv/r7cyFO4nSjs1jLdXYdz5q3a4L0NoabZfbdxVb+CUEHfB0bpulZQtH1Rv
38e/lIdP7OTTIlZh6OYL6NhxP8So0/sht/4J9mqIGxRFc0/pC8suja+wcIUna0HB
pXKfXTKpzgis+zmXDL06ASJf5E4A2/m+Hp6b84sfPAwQ766rI65mh50S0Di9E3Pn
2WcaJc+PILsBmYpgtmgWTR9eV9otfKRUBfzHUHcVgarub/XluEpRlTtZudU5xbFN
xx/DgMrXLUAPaI60fZ6wA+PTAgMBAAGjggGBMIIBfTAfBgNVHSMEGDAWgBRWc1hk
lfmSGrASKgRieaFAFYghSTAdBgNVHQ4EFgQUaMASFhgOr872h6YyV6NGUV3LBycw
DgYDVR0PAQH/BAQDAgGGMBIGA1UdEwEB/wQIMAYBAf8CAQAwHQYDVR0lBBYwFAYI
KwYBBQUHAwEGCCsGAQUFBwMCMBsGA1UdIAQUMBIwBgYEVR0gADAIBgZngQwBAgEw
VAYDVR0fBE0wSzBJoEegRYZDaHR0cDovL2NybC5zZWN0aWdvLmNvbS9TZWN0aWdv
UHVibGljU2VydmVyQXV0aGVudGljYXRpb25Sb290UjQ2LmNybDCBhAYIKwYBBQUH
AQEEeDB2ME8GCCsGAQUFBzAChkNodHRwOi8vY3J0LnNlY3RpZ28uY29tL1NlY3Rp
Z29QdWJsaWNTZXJ2ZXJBdXRoZW50aWNhdGlvblJvb3RSNDYucDdjMCMGCCsGAQUF
BzABhhdodHRwOi8vb2NzcC5zZWN0aWdvLmNvbTANBgkqhkiG9w0BAQwFAAOCAgEA
YtOC9Fy+TqECFw40IospI92kLGgoSZGPOSQXMBqmsGWZUQ7rux7cj1du6d9rD6C8
ze1B2eQjkrGkIL/OF1s7vSmgYVafsRoZd/IHUrkoQvX8FZwUsmPu7amgBfaY3g+d
q1x0jNGKb6I6Bzdl6LgMD9qxp+3i7GQOnd9J8LFSietY6Z4jUBzVoOoz8iAU84OF
h2HhAuiPw1ai0VnY38RTI+8kepGWVfGxfBWzwH9uIjeooIeaosVFvE8cmYUB4TSH
5dUyD0jHct2+8ceKEtIoFU/FfHq/mDaVnvcDCZXtIgitdMFQdMZaVehmObyhRdDD
4NQCs0gaI9AAgFj4L9QtkARzhQLNyRf87Kln+YU0lgCGr9HLg3rGO8q+Y4ppLsOd
unQZ6ZxPNGIfOApbPVf5hCe58EZwiWdHIMn9lPP6+F404y8NNugbQixBber+x536
WrZhFZLjEkhp7fFXf9r32rNPfb74X/U90Bdy4lzp3+X1ukh1BuMxA/EEhDoTOS3l
7ABvc7BYSQubQ2490OcdkIzUh3ZwDrakMVrbaTxUM2p24N6dB+ns2zptWCva6jzW
r8IWKIMxzxLPv5Kt3ePKcUdvkBU/smqujSczTzzSjIoR5QqQA6lN1ZRSnuHIWCvh
JEltkYnTAH41QJ6SAWO66GrrUESwN/cgZzL4JLEqz1Y=
-----END CERTIFICATE-----`;

const SECTIGO_ROOT_R46_CA = `-----BEGIN CERTIFICATE-----
MIIFijCCA3KgAwIBAgIQdY39i658BwD6qSWn4cetFDANBgkqhkiG9w0BAQwFADBf
MQswCQYDVQQGEwJHQjEYMBYGA1UEChMPU2VjdGlnbyBMaW1pdGVkMTYwNAYDVQQD
Ey1TZWN0aWdvIFB1YmxpYyBTZXJ2ZXIgQXV0aGVudGljYXRpb24gUm9vdCBSNDYw
HhcNMjEwMzIyMDAwMDAwWhcNNDYwMzIxMjM1OTU5WjBfMQswCQYDVQQGEwJHQjEY
MBYGA1UEChMPU2VjdGlnbyBMaW1pdGVkMTYwNAYDVQQDEy1TZWN0aWdvIFB1Ymxp
YyBTZXJ2ZXIgQXV0aGVudGljYXRpb24gUm9vdCBSNDYwggIiMA0GCSqGSIb3DQEB
AQUAA4ICDwAwggIKAoICAQCTvtU2UnXYASOgHEdCSe5jtrch/cSV1UgrJnwUUxDa
ef0rty2k1Cz66jLdScK5vQ9IPXtamFSvnl0xdE8H/FAh3aTPaE8bEmNtJZlMKpnz
SDBh+oF8HqcIStw+KxwfGExxqjWMrfhu6DtK2eWUAtaJhBOqbchPM8xQljeSM9xf
iOefVNlI8JhD1mb9nxc4Q8UBUQvX4yMPFF1bFOdLvt30yNoDN9HWOaEhUTCDsG3X
ME6WW5HwcCSrv0WBZEMNvSE6Lzzpng3LILVCJ8zab5vuZDCQOc2TZYEhMbUjUDM3
IuM47fgxMMxF/mL50V0yeUKH32rMVhlATc6qu/m1dkmU8Sf4kaWD5QazYw6A3OAS
VYCmO2a0OYctyPDQ0RTp5A1NDvZdV3LFOxxHVp3i1fuBYYzMTYCQNFu31xR13NgE
SJ/AwSiItOkcyqex8Va3e0lMWeUgFaiEAin6OJRpmkkGj80feRQXEgyDet4fsZfu
+Zd4KKTIRJLpfSYFplhym3kT2BFfrsU4YjRosoYwjviQYZ4ybPUHNs2iTG7sijbt
8uaZFURww3y8nDnAtOFr94MlI1fZEoDlSfB1D++N6xybVCi0ITz8fAr/73trdf+L
HaAZBav6+CuBQug4urv7qv094PPK306Xlynt8xhW6aWWrL3DkJiy4Pmi1KZHQ3xt
zwIDAQABo0IwQDAdBgNVHQ4EFgQUVnNYZJX5khqwEioEYnmhQBWIIUkwDgYDVR0P
AQH/BAQDAgGGMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQEMBQADggIBAC9c
mTz8Bl6MlC5w6tIyMY208FHVvArzZJ8HXtXBc2hkeqK5Duj5XYUtqDdFqij0lgVQ
YKlJfp/imTYpE0RHap1VIDzYm/EDMrraQKFz6oOht0SmDpkBm+S8f74TlH7Kph52
gDY9hAaLMyZlbcp+nv4fjFg4exqDsQ+8FxG75gbMY/qB8oFM2gsQa6H61SilzwZA
Fv97fRheORKkU55+MkIQpiGRqRxOF3yEvJ+M0ejf5lG5Nkc/kLnHvALcWxxPDkjB
JYOcCj+esQMzEhonrPcibCTRAUH4WAP+JWgiH5paPHxsnnVI84HxZmduTILA7rpX
DhjvLpr3Etiga+kFpaHpaPi8TD8SHkXoUsCjvxInebnMMTzD9joiFgOgyY9mpFui
TdaBJQbpdqQACj7LzTWb4OE4y2BThihCQRxEV+ioratF4yUQvNs+ZUH7G6aXD+u5
dHn5HrwdVw1Hr8Mvn4dGp+smWg9WY7ViYG4A++MnESLn/pmPNPW56MORcr3Ywx65
LvKRRFHQV80MNNVIIb/bE/FmJUNS0nAiNs2fxBx1IK1jcmMGDw4nztJqDby1ORrp
0XZ60Vzk50lJLVU3aPAaOpg+VBeHVOmmJ1CJeyAvP/+/oYtKR5j/K3tJPsMpRmAY
QqszKbrAKbkTidOIijlBO8n9pu0f9GBj39ItVQGL
-----END CERTIFICATE-----`;

// Build the HTTP client with the CA cert chain so Deno can verify VTOP's incomplete chain.
// TLS verification is NEVER disabled: if the CA-chain client cannot be created,
// fall back to standard fetch (Deno's default trust store), not acceptInvalidCerts.
let httpClient: ReturnType<typeof Deno.createHttpClient> | null = null;
try {
  // @ts-ignore: Deno-specific API
  httpClient = Deno.createHttpClient({
    caCerts: [
      SECTIGO_DV_R36_INTERMEDIATE_CA,
      SECTIGO_ROOT_R46_CA,
      SECTIGO_INTERMEDIATE_CA,
      USERTRUST_ROOT_CA,
    ],
  });
  console.log('[vtop-gateway] HTTP client initialized with Sectigo CA chain');
} catch (_e1) {
  console.warn('[vtop-gateway] Deno.createHttpClient unavailable — using standard fetch (default TLS verification)');
  httpClient = null;
}

function buildHeaders(campus?: string): Record<string, string> {
  return {
    // A complete browser UA string. A truncated UA is a classic bot signature,
    // and VTOP is known to risk-score this server's egress IP (answering some
    // sessions with Google reCAPTCHA instead of the readable image CAPTCHA).
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': `${vtopBase(campus)}/login`,
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
  };
}

// VTOP requests go through requestWithJar (session.ts): the FULL cookie jar
// is sent on every request AND every redirect hop, Set-Cookie from every hop
// is merged back into the jar, and redirects are followed manually so no hop
// can silently swap the session cookie.
const DIRECT_FETCH_TIMEOUT_MS = 20_000;
const vtopFetchImpl: FetchImpl = async (url, init) => {
  const opts: RequestInit & { client?: unknown } = { ...init };
  // Safety net for direct (non-requestWithJar) callers such as the profile
  // photo and transport-QR fetches: bound them too so a stalled VTOP node can
  // never hang the whole sync. requestWithJar passes its own signal — never
  // override it.
  if (!opts.signal && typeof AbortSignal !== 'undefined' && typeof (AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal }).timeout === 'function') {
    opts.signal = (AbortSignal as unknown as { timeout: (ms: number) => AbortSignal }).timeout(DIRECT_FETCH_TIMEOUT_MS);
  }
  if (httpClient) {
    // @ts-ignore: Deno-specific option (TLS verification via CA chain)
    opts.client = httpClient;
  }
  try {
    return await fetch(url, opts as RequestInit);
  } catch (err) {
    // VTOP rotates its certificate without notice and serves an incomplete
    // chain, so the PINNED client can reject a handshake that the platform
    // trust store would accept (observed live 2026-09-19: every request died
    // with "invalid peer certificate" after a Sectigo rotation). Retry once on
    // the default client — still fully verified, never acceptInvalidCerts — so
    // a future rotation degrades this path instead of bricking every login.
    if (httpClient && opts.client && isTlsTrustError(err)) {
      const retry: RequestInit & { client?: unknown } = { ...opts };
      delete retry.client;
      return fetch(url, retry as RequestInit);
    }
    throw err;
  }
};

/** True for handshake rejections caused by an untrusted/rotated CA chain. */
function isTlsTrustError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /invalid peer certificate|unknown issuer|certificate verify failed/i.test(msg);
}

async function vtopGet(path: string, cookie?: string, campus?: string): Promise<{ html: string; cookie: string; status: number; url: string }> {
  const res = await requestWithJar(
    vtopFetchImpl,
    `${vtopBase(campus)}/${path}`,
    { method: 'GET', headers: buildHeaders(campus) },
    cookie || ''
  );
  return { html: res.html, cookie: res.jar, status: res.status, url: res.url };
}

/**
 * Dev-only diagnostics toggle (set `supabase secrets set VTOP_PHOTO_DIAG=1`).
 * When enabled, profile-photo fetches log a SAFE one-line summary — step/
 * MIME/bytes/hops only. Never cookies, session data, or raw HTML.
 */
let photoDiagEnabled: boolean | null = null;
function isPhotoDiagEnabled(): boolean {
  if (photoDiagEnabled === null) {
    try {
      photoDiagEnabled = Deno.env.get('VTOP_PHOTO_DIAG') === '1';
    } catch {
      photoDiagEnabled = false;
    }
  }
  return photoDiagEnabled;
}

/**
 * Same idea for the syllabus flow (set `VTOP_SYLLABUS_DIAG=1`).
 *
 * This one matters more than the photo toggle: the Course Page route
 * spellings are verified for Vellore, not yet for a live Chennai session
 * (syllabus.ts documents why no synthetic probe can reach them). So the first
 * real attempt must be diagnosable — the log says which of the five steps
 * died and with what status, instead of leaving "unavailable" ambiguous
 * between "VTOP has no syllabus for this course" and "the route moved".
 */
let syllabusDiagEnabled: boolean | null = null;
function isSyllabusDiagEnabled(): boolean {
  if (syllabusDiagEnabled === null) {
    try {
      syllabusDiagEnabled = Deno.env.get('VTOP_SYLLABUS_DIAG') === '1';
    } catch {
      syllabusDiagEnabled = false;
    }
  }
  return syllabusDiagEnabled;
}

// ---------------------------------------------------------------------------
// Binary GET — the one request in this gateway that returns bytes, not HTML
// ---------------------------------------------------------------------------

/** Budget for one document download (all redirect hops included). */
const VTOP_FILE_TIMEOUT_MS = 30_000;
const VTOP_FILE_MAX_HOPS = 3;

/**
 * VTOP's own `vtopDownload()` JS appends `authorizedID` + `_csrf` to the
 * download URL, because a browser navigation cannot POST them. This gateway
 * does not need to copy that: it holds the session COOKIE, which is what
 * actually authenticates a Struts session, and a URL is a leaky place —
 * VTOP's load balancer, any proxy between us and Deno, and Deno's own access
 * log all record query strings. So `_csrf` and `authorizedID` are deliberately
 * NOT sent here, and no other request in this file puts them in one either.
 *
 * If live Chennai ever rejects the download for a missing token, flip this to
 * true as a considered decision (it re-introduces a session token into a URL)
 * rather than widening every GET by accident.
 */
const SYLLABUS_DOWNLOAD_SENDS_CREDENTIALS = false;

/**
 * GET a document through the authenticated session. Separate from `vtopGet`
 * on purpose: reading a PDF as text would corrupt it, and its bytes must
 * never reach a log. Redirects are followed manually and only while they stay
 * on the same VTOP origin.
 */
async function vtopGetFile(
  path: string,
  query: Record<string, string>,
  cookie: string,
  campus?: string
): Promise<{ bytes: Uint8Array; status: number; contentType: string; fileName: string; cookie: string }> {
  // Second gate, independent of syllabus.ts: whatever the caller was asked for
  // must still be one of VTOP's own download routes, relative, and `..`-free.
  if (!isSafeDownloadPath(path)) {
    throw new Error(`Refused to fetch a syllabus download outside VTOP's own routes: ${path.split('?')[0].slice(0, 60)}`);
  }
  const origin = new URL(vtopOrigin(campus)).origin;
  const [pathOnly, existingQuery] = path.split('?');
  const params = new URLSearchParams(query);
  const search = [existingQuery, params.toString()].filter(Boolean).join('&');
  let url = new URL(`${vtopBase(campus)}/${pathOnly.replace(/^\/+/, '')}${search ? `?${search}` : ''}`);
  if (url.origin !== origin) throw new Error('Syllabus download left the VTOP origin');

  const empty = (status: number, jar: string) => ({ bytes: new Uint8Array(0), status, contentType: '', fileName: '', cookie: jar });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), VTOP_FILE_TIMEOUT_MS);
  let jar = cookie;
  try {
    for (let hop = 0; hop <= VTOP_FILE_MAX_HOPS; hop++) {
      const res = await vtopFetchImpl(url.href, {
        method: 'GET',
        headers: {
          ...buildHeaders(campus),
          ...(jar ? { Cookie: jar } : {}),
          Accept: 'application/pdf,application/octet-stream;q=0.9,*/*;q=0.5',
        },
        redirect: 'manual',
        signal: ctrl.signal,
      });
      jar = mergeCookieJar(jar, extractSetCookies(res.headers));

      if (res.status >= 301 && res.status <= 308 && res.status !== 304) {
        const location = res.headers.get('location');
        if (!location) return empty(res.status, jar);
        const next = new URL(location, url);
        if (next.origin !== origin) throw new Error('Syllabus download redirected off the VTOP origin');
        url = next;
        continue;
      }
      if (!res.ok) return empty(res.status, jar);

      // Guard the size BEFORE reading: a misconfigured origin could answer a
      // download with an unbounded body, and `arrayBuffer()` would take it all
      // into function memory. Chunked responses with no Content-Length fall
      // through to syllabus.ts's own cap once the bytes are in hand.
      // 413 is reported as if the server itself refused, so the student-facing
      // wording stays "VTOP answered 413" rather than a false "empty file".
      const declaredLength = Number.parseInt(res.headers.get('content-length') || '', 10);
      if (Number.isFinite(declaredLength) && declaredLength > MAX_SYLLABUS_BYTES) {
        return empty(413, jar);
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      return {
        bytes,
        status: res.status,
        contentType: (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase(),
        fileName: fileNameFromDisposition(res.headers.get('content-disposition') || ''),
        cookie: jar,
      };
    }
    throw new Error('Syllabus download followed too many redirects');
  } catch (err: unknown) {
    if (ctrl.signal.aborted) {
      throw new Error(`VTOP syllabus download timed out after ${VTOP_FILE_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch VTOP's actual profile image through the authenticated session
 * (see photo.ts for the safe, testable core).
 */
async function fetchProfilePhotoWithDiag(
  source: string | undefined,
  cookie: string,
  campus?: string,
): Promise<{ dataUrl?: string; diagLine: string }> {
  const result = await fetchProfilePhotoDataUrl(source, cookie, vtopOrigin(campus), vtopFetchImpl);
  const diagLine = summarizePhotoDiag(result.diag);
  if (isPhotoDiagEnabled()) {
    console.log(`[vtop-gateway] profile ${diagLine}`);
  }
  return { dataUrl: result.dataUrl, diagLine };
}

async function vtopPost(
  path: string,
  fields: Record<string, string>,
  cookie?: string,
  referer?: string,
  campus?: string
): Promise<{ html: string; cookie: string; status: number; url: string }> {
  const body = new URLSearchParams(fields).toString();
  const res = await requestWithJar(
    vtopFetchImpl,
    `${vtopBase(campus)}/${path}`,
    {
      method: 'POST',
      headers: {
        ...buildHeaders(campus),
        'Content-Type': 'application/x-www-form-urlencoded',
        // VTOP serves some examination pages only to the /open/page referer
        // (used by the DA flow).
        ...(referer ? { Referer: referer } : {}),
      },
      body,
    },
    cookie || ''
  );
  return { html: res.html, cookie: res.jar, status: res.status, url: res.url };
}

// ---------------------------------------------------------------------------
// HTML extraction helpers (no external DOM library needed — regex for tiny fields)
// ---------------------------------------------------------------------------

// NOTE: extractCsrf and extractAuthorizedId live in session.ts (pure +
// unit-tested). extractCsrf matches both hidden-input value= and meta
// content= forms; extractAuthorizedId matches the Chennai post-login marker
// <input id="authorizedIDX" value="…">.

// NOTE: extractCaptchaDataUri and hasRecaptcha live in flows.ts (pure +
// unit-tested). The arming flow (GET /login -> POST /prelogin/setup ->
// CAPTCHA, with full re-roll retries) and the login submission (POST /login
// + /content fallback + failure classification) also live there.

// `isSessionExpired` (VTOP's own evidence that a session is gone) lives in
// session.ts, exported and unit-tested. An HTTP 404 is a per-dataset answer,
// not proof of a dead session: here it answers `FETCH_DATA` with
// `notAvailable: true` and leaves the session alone.

// ---------------------------------------------------------------------------
// Small local helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// All VTOP page parsing lives in parsers.ts (strict, header-driven, throws
// ParseError on structural mismatch). The gateway answers PARSE_FAILED when a
// parser rejects a page.

// ---------------------------------------------------------------------------
// CAPTCHA OCR — lightweight server-side heuristic (pixel-density analysis on
// the raw base64 image). Confidence is always < 1.0, so the UI shows the image
// for manual override.
// ---------------------------------------------------------------------------

/**
 * Attempt heuristic OCR on a VTOP CAPTCHA data URI.
 * Returns { text, confidence } — confidence is MEASURED, not assumed.
 *
 * The placeholder returns an empty string (manual entry) until a real model is
 * available; the edge function still returns the image for the student.
 */
async function attemptCaptchaOcr(_dataUri: string): Promise<{ text: string; confidence: number }> {
  // No prediction: manual entry is the primary flow.
  return { text: '', confidence: 0 };
}

// ---------------------------------------------------------------------------
// CORS headers
// ---------------------------------------------------------------------------
function corsHeaders(origin: string): Record<string, string> {
  // In development, only allow known local origins.
  // In production, allow any origin so the deployed PWA (any domain) can call this function.
  // The function is protected by Supabase JWT verification (verify_jwt=false here, anon key required).
  const appUrl = Deno.env.get('APP_URL') || '';
  const isDev = origin.includes('localhost') || origin.includes('127.0.0.1');

  let allowedOrigin: string;
  if (isDev) {
    allowedOrigin = origin; // reflect back in dev
  } else if (appUrl && origin === appUrl) {
    allowedOrigin = origin;
  } else {
    // Allow all origins in production — the function is stateless and session
    // tokens are encrypted. Restricting origin provides minimal security benefit
    // and breaks deployments to arbitrary Vercel/Netlify preview URLs.
    allowedOrigin = '*';
  }

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonResponse(body: GatewayResponse, status = 200, origin = ''): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(origin),
    },
  });
}

/**
 * Respond + log SAFE session diagnostics. The diag object only contains
 * booleans, a cookie count, and a same/different consistency flag — never
 * JSESSIONID / CSRF / cookie values.
 */
function respond(body: GatewayResponse, origin: string, action: string): Response {
  if (body.diag) {
    console.log(`[vtop-gateway] ${action} diag: ${JSON.stringify(body.diag)}`);
  }
  return jsonResponse(body, 200, origin);
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

async function handleInitializeSession(campus?: string): Promise<GatewayResponse> {
  // Full arming flow with per-attempt FRESH-session re-rolls (see flows.ts).
  // VTOP intermittently 404s the setup POST or serves a reCAPTCHA variant to
  // datacenter IPs; a fresh GET /login per attempt is the reliable recovery.
  const base = vtopBase(campus);
  let arm: ArmResult;
  try {
    arm = await armStudentSession(vtopFetchImpl, base, buildHeaders(campus));
  } catch (err: unknown) {
    if (err instanceof ArmError) {
      // VTOP-side condition (blocked / reCAPTCHA / unreachable) — not a
      // gateway bug; return a clear typed error instead of a 500.
      return { ok: false, action: 'INITIALIZE_SESSION', error: err.message };
    }
    throw err;
  }

  const ocr = await attemptCaptchaOcr(arm.captchaUri);

  // Record which JSESSIONID was armed — used by diagnostics to detect any
  // later session swap (never the value itself, just a truncated hash).
  const jsidHash = await sessionJsidHash(arm.cookie);
  const state: SessionState = { cookie: arm.cookie, csrf: arm.csrf, authorizedId: '', jsidHash, campus };
  const token = await encryptSession(state);
  const diag = await buildSessionDiag(arm.cookie, arm.csrf, jsidHash);
  return { ok: true, action: 'INITIALIZE_SESSION', sessionToken: token, captchaImageBase64: arm.captchaUri, ...ocr, diag };
}

async function handleFetchCaptcha(session: SessionState): Promise<{ newToken: string; captchaImageBase64: string; diag: SessionDiag }> {
  // GET /vtop/get/new/captcha — returns a fresh captcha fragment. Uses the
  // SAME jar as the armed session — no new session is created.
  const res = await vtopGet(ALLOWED_ENDPOINTS.newCaptcha, session.cookie, session.campus);
  const captchaUri = extractCaptchaDataUri(res.html);
  if (!captchaUri) {
    throw new Error(
      hasRecaptcha(res.html)
        ? 'VTOP served a Google reCAPTCHA instead of the image CAPTCHA (the server IP is risk-scored). Retry in a few minutes.'
        : 'No CAPTCHA image was returned for a fresh CAPTCHA.'
    );
  }
  const newState: SessionState = { ...session, cookie: res.cookie || session.cookie };
  const newToken = await encryptSession(newState);
  const diag = await buildSessionDiag(newState.cookie, newState.csrf, newState.jsidHash);
  return { newToken, captchaImageBase64: captchaUri, diag };
}

async function handleDoLogin(
  session: SessionState,
  regNo: string,
  password: string,
  captchaText: string
): Promise<GatewayResponse> {
  if (!session.csrf) throw new Error('No CSRF token in session — call INITIALIZE_SESSION first');

  // Submit on the SAME armed session (full cookie jar + CSRF, held in the
  // session token). The captcha is single-use and session-bound — it is never
  // retried on a different session (see flows.ts for the classification).
  const outcome = await submitLogin(
    vtopFetchImpl,
    vtopBase(session.campus),
    buildHeaders(session.campus),
    { cookie: session.cookie, csrf: session.csrf },
    { regNo, password, captchaText }
  );

  // Clear credential references (best effort — strings are immutable; this
  // simply drops our local references as early as possible).
  password = '';
  captchaText = '';

  const diag = await buildSessionDiag(outcome.cookie, outcome.csrf, session.jsidHash);
  // Credential-free one-liner describing what VTOP actually served back, so a
  // failure names the real cause instead of guessing. Safe to log and to show.
  const shapeNote = describeLoginShape(outcome.shape);
  if (outcome.kind !== 'success') {
    console.log(`[vtop-gateway] DO_LOGIN ${outcome.kind}: ${shapeNote} ${JSON.stringify(diag)}`);
  }

  switch (outcome.kind) {
    case 'success': {
      // Keep the ORIGINAL armed jsidHash — the token's cookie jar is updated
      // but consistency vs. the armed session stays detectable.
      const newState: SessionState = {
        cookie: outcome.cookie || session.cookie,
        csrf: outcome.csrf,
        authorizedId: outcome.authorizedId,
        regNo,
        jsidHash: session.jsidHash,
      };
      const sessionToken = await encryptSession(newState);
      return { ok: true, action: 'DO_LOGIN', loginSuccess: true, sessionToken, diag };
    }
    case 'not-armed':
      return {
        ok: false, action: 'DO_LOGIN', loginSuccess: false, captchaMismatch: true,
        loginError: `VTOP session not armed (404). The CAPTCHA belongs to a session VTOP did not recognize — refresh the CAPTCHA and try again. (${shapeNote})`,
        diag,
      };
    case 'invalid-captcha':
      return {
        ok: false, action: 'DO_LOGIN', loginSuccess: false, captchaMismatch: true,
        loginError: 'VTOP rejected the CAPTCHA. Refresh and re-enter (match the image exactly, including case).',
        diag,
      };
    case 'session-expired':
      // VTOP's armed session died while the CAPTCHA was being read or typed.
      // A fresh CAPTCHA from a fresh arming is the whole fix, so this is
      // reported as a CAPTCHA problem and the auto-login loop retries it.
      return {
        ok: false, action: 'DO_LOGIN', loginSuccess: false, captchaMismatch: true,
        loginError: `VTOP's session expired before it checked the CAPTCHA — a fresh one is needed. (${shapeNote})`,
        diag,
      };
    case 'password-mismatch':
      return {
        ok: false, action: 'DO_LOGIN', loginSuccess: false,
        // Live-probed 2026-09-19: VTOP answers a login id it RECOGNIZES with
        // "Invalid Credentials" when the password on record differs, and an
        // UNKNOWN login id with "Invalid Username/Password". So this branch
        // means the account exists and the password submitted is not the one
        // VTOP holds — changed on the portal, expired and reset there, or
        // autofilled from Settings out of date. Retyping it here cannot help;
        // the fix lives on the portal, so say exactly that.
        loginError: `VTOP recognizes this login ID, but the password it has on record is NOT the one this form sent — retyping the same password here will get the same answer. Reset or confirm it with "Forgot Password" at vtopcc.vit.ac.in, then sign in here with the new one (and update the copy saved in Settings). (${shapeNote})`,
        diag,
      };
    case 'invalid-credentials':
      return {
        ok: false, action: 'DO_LOGIN', loginSuccess: false,
        // VTOP checks the CAPTCHA BEFORE the credentials, so reaching this
        // branch means the session, the CSRF token and the CAPTCHA were all
        // accepted and the portal then rejected the username/password pair it
        // received. VTOP's own words are appended verbatim (redacted) so the
        // student sees which of the two the portal objected to instead of a
        // generic guess.
        loginError: `VTOP accepted the CAPTCHA but does not accept this login ID / password pair as typed — check the login ID spelling (registration number, or the custom ID exactly as the portal stores it) and the password, or sign in at vtopcc.vit.ac.in to confirm the pair. (${shapeNote})`,
        diag,
      };
    case 'password-expired':
      return {
        ok: false, action: 'DO_LOGIN', loginSuccess: false,
        loginError: `VTOP says this account's password has expired and must be changed on the portal before anyone can sign in with it. Change it at vtopcc.vit.ac.in, then sync again. (${shapeNote})`,
        diag,
      };
    case 'locked':
      return {
        ok: false, action: 'DO_LOGIN', loginSuccess: false,
        loginError: 'Your VTOP account is locked. Contact VIT administration.',
        diag,
      };
    case 'max-attempts':
      return {
        ok: false, action: 'DO_LOGIN', loginSuccess: false,
        loginError: 'Maximum login attempts reached. Open VTOP in your browser to reset.',
        diag,
      };
    case 'unknown-failure':
      return {
        ok: false, action: 'DO_LOGIN', loginSuccess: false, captchaMismatch: true,
        loginError: `VTOP did not return an authorization token after login — refresh the CAPTCHA and try again. (${shapeNote})`,
        diag,
      };
  }
}

async function handleGetSessionStatus(session: SessionState): Promise<GatewayResponse> {
  const res = await vtopGet(ALLOWED_ENDPOINTS.content, session.cookie, session.campus);
  // Authenticated = the /content page carries the authorizedIDX marker. The
  // old `|| !isSessionExpired` clause produced FALSE POSITIVES (e.g. a VTOP
  // maintenance page with no login form was reported as "authenticated").
  const authed = !!extractAuthorizedId(res.html);
  if (authed) {
    const csrf = extractCsrf(res.html) || session.csrf;
    const authorizedId = extractAuthorizedId(res.html) || session.authorizedId;
    const newState: SessionState = { ...session, cookie: res.cookie || session.cookie, csrf, authorizedId };
    const sessionToken = await encryptSession(newState);
    const diag = await buildSessionDiag(newState.cookie, csrf, newState.jsidHash);
    return { ok: true, action: 'GET_SESSION_STATUS', sessionToken, data: { authenticated: true }, diag };
  }
  const diag = await buildSessionDiag(res.cookie || session.cookie, session.csrf, session.jsidHash);
  return { ok: true, action: 'GET_SESSION_STATUS', sessionExpired: true, data: { authenticated: false }, diag };
}

async function handleFetchData(
  session: SessionState,
  target: string,
  semesterId?: string,
  query?: Record<string, string>
): Promise<GatewayResponse> {
  if (!session.authorizedId) throw new Error('Not authenticated — call DO_LOGIN first');

  // Assignments (Digital Assignments) — 2-step flow on the
  // SAME session: StudentDA page -> processDigitalAssignment { classId }.
  if (target === 'assignments') {
    return handleFetchAssignments(session, semesterId || '');
  }

  // --- On-Duty (OD): per-class attendance detail, the only VTOP Chennai page
  // that marks OD. Two steps on the SAME session: (1) the attendance page for
  // the per-course detail handles, (2) each course's detail page for the
  // on-duty count/hours. Never derived from attendance percentages — OD is
  // only ever read from VTOP's explicit "On Duty" status rows.
  if (target === 'od') {
    return handleFetchOd(session, semesterId);
  }

  // --- Multi-step flows that need their own request sequences.
  if (target === 'calendar') return handleFetchCalendar(session, semesterId || '');
  if (target === 'arrears') return handleFetchArrears(session);
  if (target === 'circulars') return handleFetchCirculars(session);
  if (target === 'makeupExams') return handleFetchMakeupExams(session);
  if (target === 'refat') return handleFetchRefat(session);
  if (target === 'compre') return handleFetchCompre(session);
  if (target === 'payments') return handleFetchPayments(session);
  if (target === 'credentials') return handleFetchCredentials(session);
  if (target === 'transport') return handleFetchTransport(session);
  if (target === 'sapInfo') return handleFetchSapInfo(session);
  if (target === 'paymentReceipts') return handleFetchPaymentReceipts(session);
  if (target === 'employeeSearch') return handleFetchEmployeeSearch(session, query?.empId || '');
  if (target === 'bankInfo') return handleFetchSimple(session, 'bankInfo', ALLOWED_ENDPOINTS.bankInfo, parseBankInfoHtml);
  if (target === 'biometric') return handleFetchSimple(session, 'biometric', ALLOWED_ENDPOINTS.biometric, parseBiometricInfoHtml);
  if (target === 'proctorMessages') return handleFetchSimple(session, 'proctorMessages', ALLOWED_ENDPOINTS.proctorMessages, parseProctorMessagesHtml);
  if (target === 'loginHistory') return handleFetchSimple(session, 'loginHistory', ALLOWED_ENDPOINTS.loginHistory, parseLoginHistoryHtml);
  if (target === 'classMessages') return handleFetchSimple(session, 'classMessages', ALLOWED_ENDPOINTS.classMessages, parseClassMessagesHtml);
  if (target === 'hodDean') return handleFetchSimple(session, 'hodDean', ALLOWED_ENDPOINTS.hodDean, parseHodDeanHtml);
  if (target === 'wallet') return handleFetchSimple(session, 'wallet', ALLOWED_ENDPOINTS.wallet, parseWalletHtml);
  if (target === 'extraCurricular') return handleFetchSimple(session, 'extraCurricular', ALLOWED_ENDPOINTS.extraCurricular, parseExtraCurricularHtml);

  // --- Syllabus: a 5-step authenticated Course Page flow, not a page.
  if (target === 'syllabus') {
    return handleFetchSyllabus(session, semesterId, query);
  }

  const endpointMap: Record<string, string> = {
    attendance: ALLOWED_ENDPOINTS.attendance,
    timetable: ALLOWED_ENDPOINTS.timetable,
    semesters: ALLOWED_ENDPOINTS.semesters,
    marks: ALLOWED_ENDPOINTS.marks,
    exams: ALLOWED_ENDPOINTS.exams,
    profile: ALLOWED_ENDPOINTS.profile,
    grades: ALLOWED_ENDPOINTS.cgpaCredits,
    gradeHistory: ALLOWED_ENDPOINTS.gradeHistory,
    semesterGrades: ALLOWED_ENDPOINTS.semesterGrades,
    // Curriculum progress parses the SAME cumulative grade-history page.
    curriculum: ALLOWED_ENDPOINTS.gradeHistory,
  };

  const endpoint = endpointMap[target];
  if (!endpoint) throw new Error(`Unknown data target: ${target}`);

  // Build post fields
  const fields: Record<string, string> = {
    _csrf: session.csrf,
    authorizedID: session.authorizedId,
  };
  if (target === 'semesters' || target === 'profile' || target === 'gradeHistory' || target === 'curriculum') {
    fields.verifyMenu = 'true';
    fields.nocache = String(Date.now());
  } else if (target === 'grades' || target === 'semesterGrades') {
    fields.x = String(Date.now());
  } else if (semesterId) {
    fields.semesterSubId = semesterId;
  }
  // Semester-grade view is semester-scoped (all-grades payload).
  if (target === 'semesterGrades') {
    fields.semesterSubId = semesterId || '';
  }

  let resp = await vtopPost(endpoint, fields, session.cookie, undefined, session.campus);
  if (resp.status === 404) {
    // A persistent 404 on an AUTHENTICATED request is VTOP's session-expiry
    // signature (some endpoints 404 when the session is dead). Retry once to
    // absorb a transient blip (pattern from the live-tested VtopMCP client).
    await sleep(500);
    resp = await vtopPost(endpoint, fields, session.cookie, undefined, session.campus);
  }
  const { html, cookie, status } = resp;

  if (isSessionExpired(html, status)) {
    return { ok: false, action: 'FETCH_DATA', sessionExpired: true, error: 'VTOP session expired. Please re-login.' };
  }

  if (status === 404) {
    // Per-dataset, not per-session: see the isSessionExpired note above. The
    // wording stays free of status codes so it reads as copy, not as noise, in
    // the sync panel's dataset chips.
    return {
      ok: false,
      action: 'FETCH_DATA',
      notAvailable: true,
      error: 'VTOP served no page for this, so it is not available on your account.',
    };
  }

  // Parse the HTML into normalized data. Strict parsers throw ParseError on
  // structural mismatch — the student sees an explicit parse error instead of
  // silently-empty/fabricated data.
  let data: unknown;
  let unavailable = false;
  let marksDiag: GatewayResponse['marksDiag'];
  let photoDiag: GatewayResponse['photoDiag'];

  try {
    switch (target) {
      case 'attendance':  data = parseAttendanceHtml(html); break;
      case 'semesters':   data = parseSemestersHtml(html); break;
      case 'profile': {
        const parsedProfile = parseProfileHtml(html);
        const photoSource = parsedProfile.profilePhotoSource || extractProfilePhotoSource(html);
        const photo = await fetchProfilePhotoWithDiag(photoSource, cookie || session.cookie, session.campus);
        const { profilePhotoSource: _profilePhotoSource, ...profile } = parsedProfile;
        data = photo.dataUrl ? { ...profile, profilePhotoDataUrl: photo.dataUrl } : profile;
        photoDiag = photo.diagLine;
        // Proctor lives on a SEPARATE page (proctor/viewProctorDetails) —
        // fetch it with the same session and merge into the profile.
        const proctor = await tryFetchProctor(session, cookie || session.cookie);
        if (proctor) {
          data = {
            ...(data as object),
            proctorName: proctor.name || (data as any).proctorName,
            proctorEmail: proctor.email || (data as any).proctorEmail,
            proctorMobile: proctor.mobile || (data as any).proctorMobile,
          };
        }
        break;
      }
      case 'timetable':   data = parseTimetableHtml(html); break;
      case 'marks': {
        data = parseMarksHtml(html);
        marksDiag = marksDiagnostic(html);
        break;
      }
      case 'exams':       data = parseExamsHtml(html); break;
      case 'grades': {
        const g = parseCgpaCreditsHtml(html);
        data = g;
        // All values null = the page genuinely exposes none (never faked as 0).
        unavailable = g.cgpa === null && g.creditsRegistered === null && g.creditsEarned === null;
        break;
      }
      case 'gradeHistory': {
        const h = parseGradeHistoryHtml(html);
        data = h;
        unavailable = h.cgpa === null && h.creditsRegistered === null && h.creditsEarned === null && h.effectiveGrades.length === 0 && h.gradeCounts === null;
        break;
      }
      case 'semesterGrades': {
        const s = parseSemesterGradesHtml(html);
        data = s;
        unavailable = s.grades.length === 0 && s.gpa === null;
        break;
      }
      case 'curriculum': {
        const c = parseCurriculumProgressHtml(html);
        data = c;
        unavailable = c.totals.creditsRequired === 0 && c.distributionTypes.length === 0 && c.baskets.length === 0;
        break;
      }
      default:            data = [];
    }
  } catch (err: unknown) {
    if (err instanceof ParseError) {
      return {
        ok: false, action: 'FETCH_DATA', parseFailed: true,
        error: `VTOP changed its page structure — ${err.message} (${err.target} could not be parsed).`,
      };
    }
    throw err;
  }

  // Refresh session token with potentially refreshed cookie
  const newState: SessionState = { ...session, cookie: cookie || session.cookie };
  const sessionToken = await encryptSession(newState);
  const diag = await buildSessionDiag(newState.cookie, newState.csrf, newState.jsidHash);

  return { ok: true, action: 'FETCH_DATA', sessionToken, data, unavailable, diag, marksDiag, photoDiag };
}

/** Proctor details from proctor/viewProctorDetails (same session, best-effort). */
async function tryFetchProctor(session: SessionState, cookie: string): Promise<{ name: string; email: string; mobile: string } | null> {
  try {
    const res = await vtopPost(
      ALLOWED_ENDPOINTS.proctor,
      {
        _csrf: session.csrf,
        authorizedID: session.authorizedId,
        verifyMenu: 'true',
        nocache: String(Date.now()),
      },
      cookie
    );
    if (isSessionExpired(res.html, res.status) || res.status === 404) return null;
    return parseProctorHtml(res.html);
  } catch {
    return null;
  }
}

/**
 * OD flow — see handleFetchData. Returns { available:false } when the
 * attendance page exposes no detail views (VTOP has no OD data for this
 * student) rather than fabricating zeros.
 */
async function handleFetchOd(session: SessionState, semesterId?: string): Promise<GatewayResponse> {
  if (!semesterId) throw new Error('semesterId is required for OD data');

  let cookie = session.cookie;
  const base = {
    _csrf: session.csrf,
    authorizedID: session.authorizedId,
    semesterSubId: semesterId,
  };

  // Step 1: attendance page -> per-course detail handles.
  let attResp = await vtopPost(ALLOWED_ENDPOINTS.attendance, base, cookie);
  if (attResp.status === 404) {
    await sleep(500);
    attResp = await vtopPost(ALLOWED_ENDPOINTS.attendance, base, cookie);
  }
  if (isSessionExpired(attResp.html, attResp.status)) {
    return { ok: false, action: 'FETCH_DATA', sessionExpired: true, error: 'VTOP session expired. Please re-login.' };
  }
  cookie = attResp.cookie || cookie;

  let refs: AttendanceDetailRef[];
  try {
    refs = parseAttendanceDetailRefs(attResp.html);
  } catch (err: unknown) {
    if (err instanceof ParseError) {
      return { ok: false, action: 'FETCH_DATA', parseFailed: true, error: `VTOP changed its page structure — ${err.message} (od could not be parsed).` };
    }
    throw err;
  }
  if (!refs.length) {
    // The page has no detail views -> VTOP exposes no OD for this student.
    const sessionToken = await encryptSession({ ...session, cookie });
    const diag = await buildSessionDiag(cookie, session.csrf, session.jsidHash);
    return {
      ok: true, action: 'FETCH_DATA', sessionToken,
      data: { available: false, limitHours: OD_LIMIT_HOURS, totalOdHours: 0, perCourse: [] },
      unavailable: true, diag,
    };
  }

  // Step 2: each course's per-class detail (serial — a handful of courses).
  const perCourse: {
    courseCode: string; courseName: string; slot: string;
    odHours: number; onDutyCount: number; present: number; absent: number; total: number;
  }[] = [];
  // Detail POST matches the live-verified payload exactly
  // (_csrf + authorizedID + x + classId + slotName — no semesterSubId).
  const detailFields = {
    _csrf: session.csrf,
    authorizedID: session.authorizedId,
    x: new Date().toUTCString(),
  };
  for (const ref of refs) {
    let dResp = await vtopPost(
      ALLOWED_ENDPOINTS.attendanceDetail,
      { ...detailFields, classId: ref.classId, slotName: ref.slot },
      cookie
    );
    if (dResp.status === 404) {
      await sleep(300);
      dResp = await vtopPost(
        ALLOWED_ENDPOINTS.attendanceDetail,
        { ...detailFields, classId: ref.classId, slotName: ref.slot },
        cookie
      );
    }
    if (isSessionExpired(dResp.html, dResp.status)) {
      return { ok: false, action: 'FETCH_DATA', sessionExpired: true, error: 'VTOP session expired. Please re-login.' };
    }
    cookie = dResp.cookie || cookie;
    const counts = parseAttendanceDetail(dResp.html);
    perCourse.push({
      courseCode: ref.courseCode,
      courseName: ref.courseName || ref.courseCode,
      slot: ref.slot,
      odHours: counts.odHours,
      onDutyCount: counts.onDuty,
      present: counts.present,
      absent: counts.absent,
      total: counts.total,
    });
  }

  const totalOdHours = Math.round(perCourse.reduce((s, c) => s + c.odHours, 0) * 100) / 100;
  const sessionToken = await encryptSession({ ...session, cookie });
  const diag = await buildSessionDiag(cookie, session.csrf, session.jsidHash);
  return {
    ok: true, action: 'FETCH_DATA', sessionToken,
    data: { available: true, limitHours: OD_LIMIT_HOURS, totalOdHours, perCourse },
    diag,
  };
}

/**
 * Academic calendar — 3-step flow on the SAME session:
 *   1. POST academics/common/CalendarPreview  (establishes calendar context)
 *   2. POST getListForSemester                 -> month tokens
 *   3. POST processViewCalendar { month }      -> one month's day cells
 * Live-tested via the MIT VtopMCP reference (Chennai vtopcc).
 */
async function handleFetchCalendar(session: SessionState, semesterId: string): Promise<GatewayResponse> {
  let cookie = session.cookie;
  const base = { _csrf: session.csrf, authorizedID: session.authorizedId };
  const x = () => new Date().toUTCString();

  // Step 1: establish calendar context.
  let resp = await vtopPost(ALLOWED_ENDPOINTS.calendarPreview, { ...base, verifyMenu: 'true', nocache: String(Date.now()) }, cookie);
  if (isSessionExpired(resp.html, resp.status)) {
    return { ok: false, action: 'FETCH_DATA', sessionExpired: true, error: 'VTOP session expired. Please re-login.' };
  }
  cookie = resp.cookie || cookie;

  // Step 2: month tokens for the selected semester (live-verified via the
  // VtopMCP reference: paramReturnId + semSubId + classGroupId are required,
  // otherwise VTOP serves the wrong semester's buttons).
  resp = await vtopPost(ALLOWED_ENDPOINTS.calendarMonthList, {
    ...base,
    paramReturnId: 'getListForSemester',
    semSubId: semesterId,
    classGroupId: 'COMB',
    x: x(),
  }, cookie);
  if (isSessionExpired(resp.html, resp.status)) {
    return { ok: false, action: 'FETCH_DATA', sessionExpired: true, error: 'VTOP session expired. Please re-login.' };
  }
  cookie = resp.cookie || cookie;
  let months: GatewayCalendarMonth[];
  try {
    months = parseCalendarMonths(resp.html);
  } catch (err: unknown) {
    if (err instanceof ParseError) {
      return { ok: false, action: 'FETCH_DATA', parseFailed: true, error: `VTOP changed its page structure — ${err.message} (calendar could not be parsed).` };
    }
    throw err;
  }
  if (!months.length) {
    const sessionToken = await encryptSession({ ...session, cookie });
    const diag = await buildSessionDiag(cookie, session.csrf, session.jsidHash);
    return { ok: true, action: 'FETCH_DATA', sessionToken, data: { months: [], days: [] }, diag };
  }

  // Step 3: fetch each month's day cells (serial, a handful of months).
  // calDate (not `month`) + semSubId + classGroupId are the real VTOP fields
  // (VtopMCP-verified) — posting `month` alone returns an empty table.
  const days: GatewayCalendarDay[] = [];
  for (const month of months) {
    resp = await vtopPost(ALLOWED_ENDPOINTS.calendarMonth, {
      ...base,
      calDate: month.token,
      semSubId: semesterId,
      classGroupId: 'COMB',
      x: x(),
    }, cookie);
    if (isSessionExpired(resp.html, resp.status)) {
      return { ok: false, action: 'FETCH_DATA', sessionExpired: true, error: 'VTOP session expired. Please re-login.' };
    }
    cookie = resp.cookie || cookie;
    try {
      days.push(...parseAcademicCalendar(resp.html, month.monthKey));
    } catch (err: unknown) {
      if (err instanceof ParseError) {
        return { ok: false, action: 'FETCH_DATA', parseFailed: true, error: `VTOP changed its page structure — ${err.message} (calendar could not be parsed).` };
      }
      throw err;
    }
  }

  const sessionToken = await encryptSession({ ...session, cookie });
  const diag = await buildSessionDiag(cookie, session.csrf, session.jsidHash);
  return { ok: true, action: 'FETCH_DATA', sessionToken, data: { months, days }, diag };
}

/**
 * Generic single-step fetch for simple label/value pages (bank info,
 * biometric, proctor messages, login history). One POST with verifyMenu,
 * same-session cookie, parse-or-typed-error, and honest unavailable state.
 */
async function handleFetchSimple<T>(
  session: SessionState,
  target: string,
  endpoint: string,
  parser: (html: string) => T
): Promise<GatewayResponse> {
  let cookie = session.cookie;
  const resp = await vtopPost(
    endpoint,
    { _csrf: session.csrf, authorizedID: session.authorizedId, verifyMenu: 'true', nocache: String(Date.now()) },
    cookie
  );
  if (isSessionExpired(resp.html, resp.status)) {
    return { ok: false, action: 'FETCH_DATA', sessionExpired: true, error: 'VTOP session expired. Please re-login.' };
  }
  cookie = resp.cookie || cookie;
  let data: T;
  try {
    data = parser(resp.html);
  } catch (err: unknown) {
    if (err instanceof ParseError) {
      return { ok: false, action: 'FETCH_DATA', parseFailed: true, error: `VTOP changed its page structure — ${err.message} (${target} could not be parsed).` };
    }
    throw err;
  }
  const sessionToken = await encryptSession({ ...session, cookie });
  const diag = await buildSessionDiag(cookie, session.csrf, session.jsidHash);
  return { ok: true, action: 'FETCH_DATA', sessionToken, data, diag };
}

/**  * Assignments (Digital Assignments) — flow:
  *   Primary (live-verified): POST examinations/processDigitalAssignment
 *     { classId = semesterId, x } with the /open/page referer — VTOP serves
 *     the DA table directly, no menu page needed.
 *   Fallback (when no semesterId, or the direct call looked expired / the
 *     structure changed): 2-step — POST examinations/StudentDA for classId
 *     options, then processDigitalAssignment { classId }.
 */
async function handleFetchAssignments(session: SessionState, semesterId: string): Promise<GatewayResponse> {
  let cookie = session.cookie;
  // Warm-up: visit the main content page to establish session context.
  const warmup = await vtopGet(ALLOWED_ENDPOINTS.content, cookie, session.campus);
  if (warmup.cookie) cookie = warmup.cookie;

  const base = { _csrf: session.csrf, authorizedID: session.authorizedId };
  const daReferer = `${vtopBase(session.campus)}/open/page`;

  // Primary path — direct call with the selected semester as classId.
  if (semesterId) {
    let resp = await vtopPost(ALLOWED_ENDPOINTS.daData, { ...base, classId: semesterId, x: new Date().toUTCString() }, cookie, daReferer);
    if (!isSessionExpired(resp.html, resp.status)) {
      cookie = resp.cookie || cookie;
      try {
        const data = parseDaAssignmentsHtml(resp.html);
        const sessionToken = await encryptSession({ ...session, cookie });
        const diag = await buildSessionDiag(cookie, session.csrf, session.jsidHash);
        return { ok: true, action: 'FETCH_DATA', sessionToken, data, diag };
      } catch (err: unknown) {
        // A changed structure (or an endpoint-specific login redirect) is NOT
        // a dead session — fall through to the 2-step flow before giving up.
        if (!(err instanceof ParseError)) throw err;
      }
    }
    // Fall through: the direct call may need the StudentDA menu context.
  }

  // Fallback: the StudentDA page (establishes context + serves classId options).
  let resp = await vtopPost(ALLOWED_ENDPOINTS.daPage, { ...base, verifyMenu: 'true', nocache: String(Date.now()) }, cookie, daReferer);
  if (isSessionExpired(resp.html, resp.status)) {
    return { ok: false, action: 'FETCH_DATA', sessionExpired: true, error: 'VTOP session expired. Please re-login.' };
  }
  cookie = resp.cookie || cookie;

  // If the client did not pass a classId, take the first select option whose
  // text looks like a course/semester (fallback: first non-empty option).
  let classId = semesterId;
  if (!classId) {
    const options = parseDaClassOptions(resp.html);
    const candidate = options.find((o) => o.value && /\d/.test(o.value)) || options[0];
    classId = candidate?.value || '';
  }
  if (!classId) {
    const sessionToken = await encryptSession({ ...session, cookie });
    const diag = await buildSessionDiag(cookie, session.csrf, session.jsidHash);
    return { ok: true, action: 'FETCH_DATA', sessionToken, data: [], unavailable: true, diag };
  }

  // Step 2: the DA table for that class.
  resp = await vtopPost(ALLOWED_ENDPOINTS.daData, { ...base, classId, x: new Date().toUTCString() }, cookie, daReferer);
  if (isSessionExpired(resp.html, resp.status)) {
    return { ok: false, action: 'FETCH_DATA', sessionExpired: true, error: 'VTOP session expired. Please re-login.' };
  }
  cookie = resp.cookie || cookie;
  let data: GatewayAssignment[];
  try {
    data = parseDaAssignmentsHtml(resp.html);
  } catch (err: unknown) {
    if (err instanceof ParseError) {
      return { ok: false, action: 'FETCH_DATA', parseFailed: true, error: `VTOP changed its page structure — ${err.message} (assignments could not be parsed).` };
    }
    throw err;
  }

  const sessionToken = await encryptSession({ ...session, cookie });
  const diag = await buildSessionDiag(cookie, session.csrf, session.jsidHash);
  return { ok: true, action: 'FETCH_DATA', sessionToken, data, diag };
}

/**
 * Arrears (backlogs) — 2-step flow on the SAME session:
 *   1. POST examinations/arrearRegistration/LoadRegularArrearViewPage
 *   2. POST .../viewRARArrearBySemesterWise with the semester <select> field  *      name from step 1 (live-verified).
 */
async function handleFetchArrears(session: SessionState): Promise<GatewayResponse> {
  let cookie = session.cookie;
  const base = { _csrf: session.csrf, authorizedID: session.authorizedId };

  let resp = await vtopPost(ALLOWED_ENDPOINTS.arrearInit, { ...base, verifyMenu: 'true', nocache: String(Date.now()) }, cookie);
  if (isSessionExpired(resp.html, resp.status)) {
    return { ok: false, action: 'FETCH_DATA', sessionExpired: true, error: 'VTOP session expired. Please re-login.' };
  }
  cookie = resp.cookie || cookie;

  let semesters: GatewayArrearSemester[];
  try {
    semesters = parseArrearSemesters(resp.html);
  } catch (err: unknown) {
    if (err instanceof ParseError) {
      return { ok: false, action: 'FETCH_DATA', parseFailed: true, error: `VTOP changed its page structure — ${err.message} (arrears could not be parsed).` };
    }
    throw err;
  }
  if (!semesters.length) {
    // Page exposed no semester selector -> no arrear data (or page changed).
    const sessionToken = await encryptSession({ ...session, cookie });
    const diag = await buildSessionDiag(cookie, session.csrf, session.jsidHash);
    return { ok: true, action: 'FETCH_DATA', sessionToken, data: [], diag };
  }

  const arrears: GatewayArrear[] = [];
  for (const sem of semesters) {
    resp = await vtopPost(ALLOWED_ENDPOINTS.arrearData, { ...base, [sem.fieldName]: sem.id }, cookie);
    if (isSessionExpired(resp.html, resp.status)) {
      return { ok: false, action: 'FETCH_DATA', sessionExpired: true, error: 'VTOP session expired. Please re-login.' };
    }
    cookie = resp.cookie || cookie;
    try {
      arrears.push(...parseArrearHtml(resp.html, sem.id, sem.name));
    } catch (err: unknown) {
      if (err instanceof ParseError) {
        return { ok: false, action: 'FETCH_DATA', parseFailed: true, error: `VTOP changed its page structure — ${err.message} (arrears could not be parsed).` };
      }
      throw err;
    }
  }

  const sessionToken = await encryptSession({ ...session, cookie });
  const diag = await buildSessionDiag(cookie, session.csrf, session.jsidHash);
  return { ok: true, action: 'FETCH_DATA', sessionToken, data: arrears, diag };
}

/**
 * Circulars — single POST to admissions/costCentreCircularsViewPageController  * (live-verified). Empty tree -> [] (legitimate).
 */
async function handleFetchCirculars(session: SessionState): Promise<GatewayResponse> {
  let cookie = session.cookie;
  const resp = await vtopPost(
    ALLOWED_ENDPOINTS.circulars,
    { _csrf: session.csrf, authorizedID: session.authorizedId, verifyMenu: 'true', nocache: String(Date.now()) },
    cookie
  );
  if (isSessionExpired(resp.html, resp.status)) {
    return { ok: false, action: 'FETCH_DATA', sessionExpired: true, error: 'VTOP session expired. Please re-login.' };
  }
  cookie = resp.cookie || cookie;
  let data: GatewayCircular[];
  try {
    data = parseCircularsHtml(resp.html);
  } catch (err: unknown) {
    if (err instanceof ParseError) {
      return { ok: false, action: 'FETCH_DATA', parseFailed: true, error: `VTOP changed its page structure — ${err.message} (circulars could not be parsed).` };
    }
    throw err;
  }
  const sessionToken = await encryptSession({ ...session, cookie });
  const diag = await buildSessionDiag(cookie, session.csrf, session.jsidHash);
  return { ok: true, action: 'FETCH_DATA', sessionToken, data, diag };
}

/**
 * Makeup exam schedule — 2-step flow on the SAME session:
 *   1. POST examinations/StudExamScheduleForMakeupExam
 *   2. POST examinations/doSearchExamScheduleForStudentMakeupExam per semester  *      option (live-verified). No data -> [] (legitimate).
 */
async function handleFetchMakeupExams(session: SessionState): Promise<GatewayResponse> {
  let cookie = session.cookie;
  const base = { _csrf: session.csrf, authorizedID: session.authorizedId };

  let resp = await vtopPost(ALLOWED_ENDPOINTS.makeupInit, { ...base, verifyMenu: 'true', nocache: String(Date.now()) }, cookie);
  if (isSessionExpired(resp.html, resp.status)) {
    return { ok: false, action: 'FETCH_DATA', sessionExpired: true, error: 'VTOP session expired. Please re-login.' };
  }
  cookie = resp.cookie || cookie;
  const semesters = specialExamSemesters(resp.html);
  if (!semesters.length) {
    const sessionToken = await encryptSession({ ...session, cookie });
    const diag = await buildSessionDiag(cookie, session.csrf, session.jsidHash);
    return { ok: true, action: 'FETCH_DATA', sessionToken, data: [], diag };
  }

  const makeup: GatewayMakeupExam[] = [];
  for (const sem of semesters) {
    resp = await vtopPost(ALLOWED_ENDPOINTS.makeupData, { ...base, x: new Date().toUTCString(), semesterSubId: sem.id }, cookie);
    if (isSessionExpired(resp.html, resp.status)) {
      return { ok: false, action: 'FETCH_DATA', sessionExpired: true, error: 'VTOP session expired. Please re-login.' };
    }
    cookie = resp.cookie || cookie;
    for (const ex of parseExamTableRows(resp.html)) {
      makeup.push({ ...ex, semesterId: sem.id, semesterName: sem.name });
    }
  }
  const sessionToken = await encryptSession({ ...session, cookie });
  const diag = await buildSessionDiag(cookie, session.csrf, session.jsidHash);
  return { ok: true, action: 'FETCH_DATA', sessionToken, data: makeup, diag };
}

/**
 * Re-exam / reFAT — 2-step flow:
 *   1. POST examinations/reFAT/StudentReFATRequestPageController
 *   2. POST examinations/reFAT/StudentReFATRequestOnChange per semester option  * (live-verified). No eligibility -> { available:false }.
 */
async function handleFetchRefat(session: SessionState): Promise<GatewayResponse> {
  let cookie = session.cookie;
  const base = { _csrf: session.csrf, authorizedID: session.authorizedId };

  let resp = await vtopPost(ALLOWED_ENDPOINTS.refatPage, { ...base, verifyMenu: 'true', nocache: String(Date.now()) }, cookie);
  if (isSessionExpired(resp.html, resp.status)) {
    return { ok: false, action: 'FETCH_DATA', sessionExpired: true, error: 'VTOP session expired. Please re-login.' };
  }
  cookie = resp.cookie || cookie;
  const semesters = specialExamSemesters(resp.html);
  if (!semesters.length) {
    const sessionToken = await encryptSession({ ...session, cookie });
    const diag = await buildSessionDiag(cookie, session.csrf, session.jsidHash);
    return {
      ok: true, action: 'FETCH_DATA', sessionToken,
      data: { available: false, status: '', message: '', semesters: [] },
      unavailable: true, diag,
    };
  }

  const info: GatewayRefatInfo = {
    available: true,
    status: parseHeadingText(resp.html),
    message: '',
    semesters: [],
  };
  for (const sem of semesters) {
    resp = await vtopPost(ALLOWED_ENDPOINTS.refatData, { ...base, x: new Date().toUTCString(), semesterSubId: sem.id }, cookie);
    if (isSessionExpired(resp.html, resp.status)) {
      return { ok: false, action: 'FETCH_DATA', sessionExpired: true, error: 'VTOP session expired. Please re-login.' };
    }
    cookie = resp.cookie || cookie;
    info.semesters.push({ id: sem.id, name: sem.name, courses: parseRefatCourses(resp.html) });
  }
  const sessionToken = await encryptSession({ ...session, cookie });
  const diag = await buildSessionDiag(cookie, session.csrf, session.jsidHash);
  return { ok: true, action: 'FETCH_DATA', sessionToken, data: info, diag };
}

/** Compre exam registration status — single POST (live-verified). */
async function handleFetchCompre(session: SessionState): Promise<GatewayResponse> {
  let cookie = session.cookie;
  const resp = await vtopPost(
    ALLOWED_ENDPOINTS.compre,
    { _csrf: session.csrf, authorizedID: session.authorizedId, verifyMenu: 'true', nocache: String(Date.now()) },
    cookie
  );
  if (isSessionExpired(resp.html, resp.status)) {
    return { ok: false, action: 'FETCH_DATA', sessionExpired: true, error: 'VTOP session expired. Please re-login.' };
  }
  cookie = resp.cookie || cookie;
  const info = parseCompreInfo(resp.html);
  const sessionToken = await encryptSession({ ...session, cookie });
  const diag = await buildSessionDiag(cookie, session.csrf, session.jsidHash);
  return {
    ok: true, action: 'FETCH_DATA', sessionToken,
    data: info, unavailable: !info.available, diag,
  };
}

// --- Single-step authenticated pages (payments / credentials / transport) ---
// All three are Chennai VTOP pages verified against the live portal.
// They share the same pattern: one POST with verifyMenu + nocache on the
// SAME session, then a strict parse. Session expiry is checked on every
// response; the cookie jar is carried forward so nothing re-arms a session.

async function handleFetchPayments(session: SessionState): Promise<GatewayResponse> {
  let cookie = session.cookie;
  // Warm-up: visit the main content page to establish session context.
  // VTOP sub-pages (payments, credentials, transport) often return login
  // redirects when the session hasn't been "touched" by a main page visit.
  const warmup = await vtopGet(ALLOWED_ENDPOINTS.content, cookie, session.campus);
  if (warmup.cookie) cookie = warmup.cookie;
  // Step 1b: visit the attendance page — VTOP uses this as a session prover
  // for many sub-pages. This extra hop resolves most "session expired" false
  // positives on later sub-page calls.
  const warmup2 = await vtopGet(ALLOWED_ENDPOINTS.attendance, cookie, session.campus);
  if (warmup2.cookie) cookie = warmup2.cookie;

  const resp = await vtopPost(
    ALLOWED_ENDPOINTS.payments,
    { _csrf: session.csrf, authorizedID: session.authorizedId, verifyMenu: 'true', nocache: String(Date.now()) },
    cookie
  );
  if (isSessionExpired(resp.html, resp.status)) {
    return { ok: false, action: 'FETCH_DATA', sessionExpired: true, error: 'VTOP session expired. Please re-login.' };
  }
  cookie = resp.cookie || cookie;
  let data: GatewayPaymentsInfo;
  try {
    data = parsePaymentsHtml(resp.html);
  } catch (err: unknown) {
    if (err instanceof ParseError) {
      return { ok: false, action: 'FETCH_DATA', parseFailed: true, error: `VTOP changed its page structure — ${err.message} (payments could not be parsed).` };
    }
    throw err;
  }
  const sessionToken = await encryptSession({ ...session, cookie });
  const diag = await buildSessionDiag(cookie, session.csrf, session.jsidHash);
  return { ok: true, action: 'FETCH_DATA', sessionToken, data, diag };
}

async function handleFetchCredentials(session: SessionState): Promise<GatewayResponse> {
  let cookie = session.cookie;
  const resp = await vtopPost(
    ALLOWED_ENDPOINTS.credentials,
    { _csrf: session.csrf, authorizedID: session.authorizedId, verifyMenu: 'true', nocache: String(Date.now()) },
    cookie
  );
  if (isSessionExpired(resp.html, resp.status)) {
    return { ok: false, action: 'FETCH_DATA', sessionExpired: true, error: 'VTOP session expired. Please re-login.' };
  }
  cookie = resp.cookie || cookie;
  let data: GatewayCredentialsInfo;
  try {
    data = parseCredentialsHtml(resp.html);
  } catch (err: unknown) {
    if (err instanceof ParseError) {
      return { ok: false, action: 'FETCH_DATA', parseFailed: true, error: `VTOP changed its page structure — ${err.message} (credentials could not be parsed).` };
    }
    throw err;
  }
  const sessionToken = await encryptSession({ ...session, cookie });
  const diag = await buildSessionDiag(cookie, session.csrf, session.jsidHash);
  return { ok: true, action: 'FETCH_DATA', sessionToken, data, diag };
}

async function handleFetchTransport(session: SessionState): Promise<GatewayResponse> {
  let cookie = session.cookie;
  const resp = await vtopPost(
    ALLOWED_ENDPOINTS.transport,
    { _csrf: session.csrf, authorizedID: session.authorizedId, verifyMenu: 'true', nocache: String(Date.now()) },
    cookie
  );
  if (isSessionExpired(resp.html, resp.status)) {
    return { ok: false, action: 'FETCH_DATA', sessionExpired: true, error: 'VTOP session expired. Please re-login.' };
  }
  cookie = resp.cookie || cookie;
  let data: GatewayTransportInfo;
  try {
    data = parseTransportHtml(resp.html);
    data = await inlineTransportQr(data, cookie || session.cookie, session.campus);
  } catch (err: unknown) {
    if (err instanceof ParseError) {
      return { ok: false, action: 'FETCH_DATA', parseFailed: true, error: `VTOP changed its page structure — ${err.message} (transport could not be parsed).` };
    }
    throw err;
  }
  const sessionToken = await encryptSession({ ...session, cookie });
  const diag = await buildSessionDiag(cookie, session.csrf, session.jsidHash);
  return { ok: true, action: 'FETCH_DATA', sessionToken, data, diag };
}

/** VTOP sometimes serves the attendance QR as a session-bound relative image.
 * Fetch it inside the gateway with the authenticated cookie and return a data
 * URL so the browser never loses the VTOP session while rendering the QR. */
async function inlineTransportQr(data: GatewayTransportInfo, cookie: string, campus?: string): Promise<GatewayTransportInfo> {
  if (!data.qrCode || /^(?:data:image\/|https?:\/\/)/i.test(data.qrCode)) return data;
  try {
    const url = new URL(data.qrCode, `${vtopBase(campus)}/`).href;
    const response = await vtopFetchImpl(url, { method: 'GET', headers: { ...buildHeaders(campus), Cookie: cookie } });
    if (!response.ok) return { ...data, qrCode: '' };
    const type = response.headers.get('content-type') || 'image/png';
    if (!type.toLowerCase().startsWith('image/')) return { ...data, qrCode: '' };
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { ...data, qrCode: `data:${type};base64,${btoa(binary)}` };
  } catch {
    return { ...data, qrCode: '' };
  }
}

// --- SAP info / payment receipts / employee search (Chennai pages) ---
// Same single-session pattern as payments/credentials/transport above.

async function handleFetchSapInfo(session: SessionState): Promise<GatewayResponse> {
  let cookie = session.cookie;
  const resp = await vtopPost(
    ALLOWED_ENDPOINTS.sapInfo,
    { _csrf: session.csrf, authorizedID: session.authorizedId, verifyMenu: 'true', nocache: String(Date.now()) },
    cookie
  );
  if (isSessionExpired(resp.html, resp.status)) {
    return { ok: false, action: 'FETCH_DATA', sessionExpired: true, error: 'VTOP session expired. Please re-login.' };
  }
  cookie = resp.cookie || cookie;
  let data: GatewaySapInfo;
  try {
    data = parseSapInfoHtml(resp.html);
  } catch (err: unknown) {
    if (err instanceof ParseError) {
      return { ok: false, action: 'FETCH_DATA', parseFailed: true, error: `VTOP changed its page structure — ${err.message} (SAP info could not be parsed).` };
    }
    throw err;
  }
  const sessionToken = await encryptSession({ ...session, cookie });
  const diag = await buildSessionDiag(cookie, session.csrf, session.jsidHash);
  return { ok: true, action: 'FETCH_DATA', sessionToken, data, diag };
}

async function handleFetchPaymentReceipts(session: SessionState): Promise<GatewayResponse> {
  let cookie = session.cookie;
  const resp = await vtopPost(
    ALLOWED_ENDPOINTS.receiptsInit,
    { _csrf: session.csrf, authorizedID: session.authorizedId, verifyMenu: 'true', nocache: String(Date.now()) },
    cookie
  );
  if (isSessionExpired(resp.html, resp.status)) {
    return { ok: false, action: 'FETCH_DATA', sessionExpired: true, error: 'VTOP session expired. Please re-login.' };
  }
  cookie = resp.cookie || cookie;
  let data: GatewayPaymentReceiptsInfo;
  try {
    data = parsePaymentReceiptsHtml(resp.html);
  } catch (err: unknown) {
    if (err instanceof ParseError) {
      return { ok: false, action: 'FETCH_DATA', parseFailed: true, error: `VTOP changed its page structure — ${err.message} (payment receipts could not be parsed).` };
    }
    throw err;
  }
  const sessionToken = await encryptSession({ ...session, cookie });
  const diag = await buildSessionDiag(cookie, session.csrf, session.jsidHash);
  return { ok: true, action: 'FETCH_DATA', sessionToken, data, diag };
}

async function handleFetchEmployeeSearch(session: SessionState, empId: string): Promise<GatewayResponse> {
  if (!empId) return { ok: false, action: 'FETCH_DATA', error: 'empId is required for employeeSearch' };
  let cookie = session.cookie;
  // Step 1: prime the search page on the SAME session.
  const init = await vtopPost(
    ALLOWED_ENDPOINTS.employeeSearchInit,
    { _csrf: session.csrf, authorizedID: session.authorizedId, verifyMenu: 'true', nocache: String(Date.now()) },
    cookie
  );
  if (isSessionExpired(init.html, init.status)) {
    return { ok: false, action: 'FETCH_DATA', sessionExpired: true, error: 'VTOP session expired. Please re-login.' };
  }
  cookie = init.cookie || cookie;
  // Step 2: the actual search (employee ID or partial name, uppercased).
  const resp = await vtopPost(
    ALLOWED_ENDPOINTS.employeeSearchData,
    { _csrf: session.csrf, authorizedID: session.authorizedId, x: new Date().toUTCString(), empId: empId.toUpperCase().trim() },
    cookie
  );
  if (isSessionExpired(resp.html, resp.status)) {
    return { ok: false, action: 'FETCH_DATA', sessionExpired: true, error: 'VTOP session expired. Please re-login.' };
  }
  cookie = resp.cookie || cookie;
  let data: GatewayEmployeeSearchInfo;
  try {
    data = parseEmployeeSearchHtml(resp.html);
  } catch (err: unknown) {
    if (err instanceof ParseError) {
      return { ok: false, action: 'FETCH_DATA', parseFailed: true, error: `VTOP changed its page structure — ${err.message} (employee search could not be parsed).` };
    }
    throw err;
  }
  const sessionToken = await encryptSession({ ...session, cookie });
  const diag = await buildSessionDiag(cookie, session.csrf, session.jsidHash);
  return { ok: true, action: 'FETCH_DATA', sessionToken, data, diag };
}

/**
 * VTOP's Course Page routes and transport, shared by the single-course syllabus
 * walk and the semester's registered-class listing. Both are the same
 * authenticated pages a student clicks through in Academics → Course Page, so
 * they must go through one allowlist rather than two copies that can drift.
 */
function syllabusRoutes(): SyllabusRoutes {
  return {
    // Chennai's spelling of the Course Page is unverified, so both are tried.
    warmup: [ALLOWED_ENDPOINTS.coursePage, ALLOWED_ENDPOINTS.coursePageChn],
    courses: ALLOWED_ENDPOINTS.coursePageCourses,
    slots: ALLOWED_ENDPOINTS.coursePageSlots,
    detail: ALLOWED_ENDPOINTS.courseDetail,
    coursePlan: ALLOWED_ENDPOINTS.coursePlan,
  };
}

function syllabusTransport(session: SessionState): SyllabusTransport {
  return {
    post: async (path, fields, cookie) => {
      const res = await vtopPost(path, fields, cookie, undefined, session.campus);
      return { html: res.html, status: res.status, cookie: res.cookie };
    },
    getFile: async (path, params, cookie) => {
      // Cookie-only by default: see SYLLABUS_DOWNLOAD_SENDS_CREDENTIALS.
      // `x` is a cache-buster, not a secret.
      const q: Record<string, string> = { x: params.x || String(Date.now()) };
      if (SYLLABUS_DOWNLOAD_SENDS_CREDENTIALS) {
        q.authorizedID = session.authorizedId;
        q._csrf = session.csrf;
      }
      return vtopGetFile(path, q, cookie, session.campus);
    },
  };
}

/**
 * Syllabus for ONE course, over VTOP's authenticated Course Page flow.
 *
 * The flow itself (and every reason it can come back empty) lives in
 * syllabus.ts; this function only supplies it with the session, the
 * allowlisted routes, and the transport. It never returns VTOP HTML,
 * cookies, the CSRF token or the authorizedID — the browser gets the
 * document as a data URL, or an honest absence with a safe `detail` line.
 *
 * THE BROWSER ASKS WITH COURSE IDENTITY ONLY. A course code (plus its optional
 * registration type) and, at most, which term the student is looking at. The
 * semester, the VTOP course id, the class row, the slot and the faculty are all
 * resolved inside the flow — a caller cannot name a class even if it wanted to,
 * because nothing here forwards a slot, a faculty or a class erpId. That is the
 * product rule (a student picks a course, never a slot) enforced at the edge.
 */
async function handleFetchSyllabus(
  session: SessionState,
  semesterId?: string,
  query?: Record<string, string>
): Promise<GatewayResponse> {
  const routes = syllabusRoutes();
  const transport = syllabusTransport(session);

  let outcome;
  try {
    outcome = await fetchCourseSyllabus(transport, session.cookie, {
      csrf: session.csrf,
      authorizedId: session.authorizedId,
      // Hints, not requirements: the flow resolves the term from VTOP's own
      // Course Page and only reports `semester-unknown` when VTOP offers none.
      semesterId: semesterId || query?.semesterId || '',
      semesterLabel: query?.semesterLabel,
      routes,
      courseCode: query?.courseCode,
      courseType: query?.courseType,
    });
  } catch (err: unknown) {
    // A transport failure (timeout, TLS, DNS) is a genuine VTOP outage, not a
    // "no syllabus" answer. Say which, and keep the safe diagnostic line. The
    // structured fields still name the stage: this is the gateway's own hop
    // failing, never a session and never a course.
    const message = err instanceof Error ? err.message : String(err);
    console.error('[vtop-gateway] syllabus flow failed:', message.substring(0, 200));
    return {
      ok: false, action: 'FETCH_DATA',
      error: message.substring(0, 300),
      syllabusStage: 'UPSTREAM', syllabusReason: 'GATEWAY_TRANSPORT_ERROR',
      syllabusDiag: 'syllabus flow aborted: transport error',
    };
  }

  const diagLine = summarizeSyllabusDiag(outcome.diag);
  if (isSyllabusDiagEnabled()) console.log(`[vtop-gateway] ${diagLine}`);
  const sessionToken = await encryptSession({ ...session, cookie: outcome.cookie });
  // STEP 0, reported honestly and on every outcome: the session booleans travel
  // with the answer, so "this request died" can never be read as "the session
  // died" without evidence — and the reverse. Booleans and counts only; no
  // cookie value, no JSESSIONID, no CSRF token, no authorizedID.
  const diag = await buildSessionDiag(outcome.cookie, session.csrf, session.jsidHash);

  const failure = classifySyllabusFailure(outcome);
  if (failure) {
    // One safe, unconditional line per failed attempt — the stage and reason in
    // fixed vocabulary, then the session booleans. Development diagnostics only
    // reach a log sink; the student still reads the flow's own curated sentence.
    console.log(
      `[vtop-gateway] syllabus failure ${summarizeSyllabusFailure(failure)} `
      + `session(exists=${diag.sessionExists},jsid=${diag.jsessionidExists},csrf=${diag.csrfExists},`
      + `cookies=${diag.cookieCount},consistency=${diag.sessionIdConsistency})`
    );
  }

  if (outcome.sessionExpired) {
    return {
      ok: false, action: 'FETCH_DATA', sessionExpired: true, error: outcome.error,
      ...failureFields(failure), diag, syllabusDiag: diagLine,
    };
  }
  if (outcome.parseFailed) {
    return {
      ok: false, action: 'FETCH_DATA', parseFailed: true, error: outcome.error,
      ...failureFields(failure), diag, syllabusDiag: diagLine,
    };
  }

  // `error` on an ok response is the actionable line for the "we could not
  // even ask properly" cases (bad semester id, nothing selected). It travels
  // inside `data.detail` too, because the client treats a top-level error on
  // ok:true as ignorable and reads the payload instead.
  const info = outcome.info;
  const data = info.available || !outcome.error
    ? info
    : { ...info, detail: info.detail || outcome.error };
  return {
    ok: true, action: 'FETCH_DATA', sessionToken, data,
    unavailable: !info.available,
    ...failureFields(failure),
    diag, syllabusDiag: diagLine,
  };
}

/**
 * The three structured failure fields, spread into a failing response, or
 * nothing at all when the flow served a document. Kept in one place so every
 * failing branch reports the same shape and no branch can invent a stage.
 */
function failureFields(failure: SyllabusFailure | null): Partial<GatewayResponse> {
  if (!failure) return {};
  return {
    syllabusStage: failure.stage,
    syllabusReason: failure.reason,
    ...(failure.status !== undefined ? { syllabusStatus: failure.status } : {}),
  };
}

async function handleLogout(session: SessionState): Promise<GatewayResponse> {
  try {
    await vtopGet(ALLOWED_ENDPOINTS.logout, session.cookie, session.campus);
  } catch {
    // Ignore — session is local anyway
  }
  const diag = await buildSessionDiag(session.cookie, session.csrf, session.jsidHash);
  return { ok: true, action: 'LOGOUT', diag };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') || '';

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, action: 'ERROR', error: 'Method not allowed' }, 405, origin);
  }

  // Rate limiting hint: Supabase automatically applies function invocation limits.
  // For additional rate limiting, add a Supabase RLS policy or an API gateway rule.

  let body: GatewayRequest;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ ok: false, action: 'ERROR', error: 'Invalid JSON body' }, 400, origin);
  }

  const { action, sessionToken, credentials, dataTarget, semesterId, campus } = body;
  const reqCampus = campus && CAMPUS_HOSTS[campus] ? campus : DEFAULT_CAMPUS;

  try {
    // Actions that don't need an existing session
    if (action === 'INITIALIZE_SESSION') {
      const result = await handleInitializeSession(reqCampus);
      return respond(result, origin, action);
    }

    // All other actions require a valid session token
    if (!sessionToken) {
      return jsonResponse({ ok: false, action, error: 'sessionToken is required' }, 400, origin);
    }

    let session: SessionState;
    try {
      session = await decryptSession(sessionToken);
    } catch {
      // A token that does not decrypt is a SESSION answer: nothing was asked of
      // VTOP, so this must never be read as "VTOP unreachable". The structured
      // fields name the stage for a development client; the status line stays
      // 401 for every action.
      return jsonResponse({
        ok: false, action, error: 'Invalid or expired session token',
        ...(action === 'FETCH_DATA'
          ? { syllabusStage: 'SESSION', syllabusReason: 'SESSION_INVALID' }
          : {}),
      }, 401, origin);
    }

    switch (action) {
      case 'FETCH_CAPTCHA': {
        const result = await handleFetchCaptcha(session);
        return respond({
          ok: true, action,
          sessionToken: result.newToken,
          captchaImageBase64: result.captchaImageBase64,
          diag: result.diag,
        }, origin, action);
      }

      case 'DO_LOGIN': {
        if (!credentials) {
          return jsonResponse({ ok: false, action, error: 'credentials required for DO_LOGIN' }, 400, origin);
        }
        const { regNo, password, captchaText } = credentials;
        if (!regNo || !password || !captchaText) {
          return jsonResponse({ ok: false, action, error: 'regNo, password and captchaText are all required' }, 400, origin);
        }
        const result = await handleDoLogin(session, regNo, password, captchaText);
        return respond(result, origin, action);
      }

      case 'GET_SESSION_STATUS': {
        const result = await handleGetSessionStatus(session);
        return respond(result, origin, action);
      }

      case 'FETCH_DATA': {
        if (!dataTarget) {
          return jsonResponse({ ok: false, action, error: 'dataTarget is required for FETCH_DATA' }, 400, origin);
        }
        const validTargets = ['attendance', 'timetable', 'marks', 'exams', 'profile', 'semesters', 'assignments', 'grades', 'gradeHistory', 'semesterGrades', 'od', 'calendar', 'arrears', 'circulars', 'curriculum', 'makeupExams', 'refat', 'compre', 'payments', 'credentials', 'transport', 'sapInfo', 'paymentReceipts', 'employeeSearch', 'bankInfo', 'biometric', 'proctorMessages', 'loginHistory', 'classMessages', 'hodDean', 'wallet', 'extraCurricular', 'syllabus'];
        if (!validTargets.includes(dataTarget)) {
          return jsonResponse({ ok: false, action, error: `Invalid dataTarget: ${dataTarget}` }, 400, origin);
        }
        const query = body.query && typeof body.query === 'object' ? body.query as Record<string, string> : undefined;
        const result = await handleFetchData(session, dataTarget, semesterId, query);
        return respond(result, origin, action);
      }

      case 'LOGOUT': {
        const result = await handleLogout(session);
        return respond(result, origin, action);
      }

      default:
        return jsonResponse({ ok: false, action: action || 'UNKNOWN', error: `Unknown action: ${action}` }, 400, origin);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    // Never log credentials or cookies — only the sanitized error message.
    console.error(`[vtop-gateway] ${action} error:`, message.substring(0, 200));
    return jsonResponse({ ok: false, action: action || 'ERROR', error: message }, 500, origin);
  }
});
