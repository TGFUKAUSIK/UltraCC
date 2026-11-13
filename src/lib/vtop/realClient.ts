/**
 * RealVTOPClient — Supabase Edge Function gateway transport.
 *
 * All VTOP HTTP happens server-side in the vtop-gateway Edge Function.
 *
 * SESSION DESIGN (stateless roundtrip):
 *   - After INITIALIZE_SESSION, the gateway returns an AES-GCM encrypted
 *     `sessionToken` that encodes { cookie, csrf, authorizedId }.
 *   - The browser stores this token IN MEMORY ONLY (class field, not
 *     localStorage / sessionStorage).
 *   - Every subsequent call passes the token back; the gateway decrypts,
 *     uses, re-encrypts, and returns a fresh token.
 *   - On logout / tab close the token is gone — no persistent session.
 *
 * SECURITY:
 *   - VTOP credentials (password, CAPTCHA) transit the gateway over HTTPS.
 *   - This is NOT zero-knowledge. The UI must clearly state this.
 *   - The gateway never persists credentials, cookies, or CSRF tokens.
 *   - Raw VTOP HTML never reaches the browser.
 *   - Gemini / AI services receive zero VTOP credentials or raw HTML.
 */

import {
  VTOPClient,
  StudentProfile,
  AttendanceRecord,
  TimetableSlot,
  CourseMarksRecord,
  ExamRecord,
  CaptchaPredictionResult,
  SemesterInfo,
  AssignmentRecord,
  GradeSummary,
  GradeHistory,
  SemesterGrades,
  OdSummary,
  AcademicCalendar,
  CalendarDay,
  ArrearRecord,
  CircularRecord,
  CurriculumProgress,
  MakeupExamRecord,
  RefatInfo,
  CompreInfo,
  PaymentsInfo,
  CredentialsInfo,
  TransportInfo,
  SapInfo,
  PaymentReceiptsInfo,
  EmployeeSearchResult,
  BankInfo,
  BiometricInfo,
  ProctorMessage,
  LoginHistoryRow,
  ClassMessage,
  HodDeanInfo,
  WalletInfo,
  ExtraCurricularInfo,
  SyllabusInfo,
  SyllabusRequest,
} from './types';
import { NOT_AUTHENTICATED_MESSAGE, VtopError } from './errors';
import { debugErrorDetail } from '../errorCopy';
import { syllabusFailureInfo, syllabusFailureLine, type SyllabusFailureStage } from '../syllabusDiagnostics';
import { combineLabSessions } from '../../utils/labSessions';
import { classifyAssignmentStatus } from '../../utils/assessmentStatus';

// ---------------------------------------------------------------------------
// Gateway configuration
// ---------------------------------------------------------------------------

/**
 * REGRESSION GUARD (2026-09-07): a placeholder env value (e.g. from copying
 * .env.example verbatim) silently overrode the known-good fallback and sent
 * every gateway request to a non-existent host — VTOP login broke with
 * VTOP_UNAVAILABLE while the deployed gateway was perfectly healthy.
 * Placeholder values are therefore treated as "unset".
 */
export function isPlaceholder(value: string | undefined | null): boolean {
  if (!value) return true;
  const v = value.trim();
  return (
    v.length === 0 ||
    /your[_-]/i.test(v) ||
    /^<.*>$/.test(v) ||
    /^(change|replace|insert|add)[_-]?(me|this|here|your)/i.test(v) ||
    /example\.com|your-project\.supabase\.co/i.test(v)
  );
}

function envOr(key: string, fallback: string): string {
  const value =
    typeof import.meta !== 'undefined' ? (import.meta as any).env?.[key] : undefined;
  return isPlaceholder(value) ? fallback : value;
}

/** VITE_VTOP_GATEWAY_URL must be set to your deployed Supabase function URL. */
function gatewayUrl(): string {
  // Vite exposes env vars prefixed with VITE_ to the browser bundle. The
  // public build ships a placeholder, so nothing here names a deployed
  // project: set VITE_VTOP_GATEWAY_URL in your own .env.
  return envOr('VITE_VTOP_GATEWAY_URL', 'https://your-project.supabase.co/functions/v1/vtop-gateway');
}

/** Supabase anon key — set VITE_SUPABASE_ANON_KEY to your own project's key. */
function anonKey(): string {
  return envOr('VITE_SUPABASE_ANON_KEY', 'your_supabase_anon_key');
}

// ---------------------------------------------------------------------------
// Gateway call helper
// ---------------------------------------------------------------------------

interface GatewayPayload {
  action: string;
  sessionToken?: string;
  credentials?: { regNo: string; password: string; captchaText: string };
  dataTarget?: string;
  semesterId?: string;
  query?: Record<string, string>;
  /** Campus identifier (chennai/vellore/ap/bhopal). Default: chennai. */
  campus?: string;
}

interface GatewayResponse {
  ok: boolean;
  action: string;
  sessionToken?: string;
  captchaImageBase64?: string;
  loginSuccess?: boolean;
  loginError?: string;
  captchaMismatch?: boolean;
  sessionExpired?: boolean;
  data?: unknown;
  parseFailed?: boolean;
  unavailable?: boolean;
  /**
   * VTOP served no page for that dataset's own address. The session is fine —
   * this one dataset is simply not on the account. Distinct from
   * `sessionExpired` precisely so it cannot sign the student out; see the
   * gateway's `isSessionExpired`.
   */
  notAvailable?: boolean;
  marksDiag?: { courseCode: string; courseTitle: string; assessments: string[] }[];
  /** SAFE one-line profile-photo fetch outcome (step/MIME/bytes only). */
  photoDiag?: string;
  /** SAFE one-line syllabus fetch outcome (step/status/counts only). */
  syllabusDiag?: string;
  /**
   * SAFE structured syllabus failure: the STAGE that failed and a reason from
   * the gateway's closed vocabulary (e.g. COURSE / COURSE_NOT_FOUND), plus the
   * HTTP status of the step that decided it. Development diagnostics only —
   * never a cookie, token, session id, course code, VTOP HTML or file byte.
   * Absent on success and on gateways older than the fields.
   */
  syllabusStage?: string;
  syllabusReason?: string;
  syllabusStatus?: number;
  error?: string;
}

/**
 * Hard client-side deadline for every gateway call. Without it a hung Edge
 * Function (e.g. VTOP LB node accepting connections but never responding)
 * kept the login button disabled forever — the await never settled. 75s also
 * stays under Supabase's own edge-function wall clock so the typed gateway
 * error usually wins the race.
 */
const GATEWAY_TIMEOUT_MS = 75_000;

/** AbortSignal.timeout with a fallback for environments that lack it. */
function deadlineSignal(ms: number): AbortSignal | undefined {
  try {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      return AbortSignal.timeout(ms);
    }
  } catch { /* fall through */ }
  return undefined;
}

/**
 * One safe line for a syllabus failure that died in transport, before the
 * gateway's own fields could be read at all (a rejected token, a gateway HTTP
 * error, a non-JSON body, a network failure). Fixed vocabulary, fixed shape —
 * the same one `syllabusFailureInfo` produces — so a capture always finds
 * exactly one line whatever hop died.
 */
function logSyllabusTransportFailure(
  stage: SyllabusFailureStage,
  reason: string,
  status?: number,
): void {
  console.info(`[UltraCC syllabus] ${syllabusFailureLine({ stage, reason, ...(status !== undefined ? { status } : {}) })}`);
}

async function callGateway(payload: GatewayPayload): Promise<GatewayResponse> {
  /** Only a syllabus click needs its failing stage named on this path. */
  const isSyllabus = payload.dataTarget === 'syllabus';

  let res: Response;
  try {
    res = await fetch(gatewayUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${anonKey()}`,
      },
      body: JSON.stringify(payload),
      signal: deadlineSignal(GATEWAY_TIMEOUT_MS),
    });
  } catch (networkErr: unknown) {
    const timedOut = networkErr instanceof Error && (
      networkErr.name === 'TimeoutError' ||
      networkErr.name === 'AbortError'
    );
    debugErrorDetail('vtop-gateway request failed', networkErr);
    if (isSyllabus) logSyllabusTransportFailure('UPSTREAM', 'GATEWAY_UNREACHABLE');
    throw new VtopError(
      'VTOP_UNAVAILABLE',
      timedOut
        ? 'VTOP did not respond in time — it may be down or overloaded. Try again in a minute.'
        : 'VTOP could not be reached. Check your internet connection and try again.'
    );
  }

  if (res.status === 401) {
    // The gateway rejected the session token; no retry can change that.
    let errorBody = '';
    try { errorBody = await res.text(); } catch { /* ignore */ }
    debugErrorDetail('vtop-gateway rejected the session token (HTTP 401)', errorBody);
    // The gateway's 401 body names this pair; it is repeated here because the
    // body is not read on this path.
    if (isSyllabus) logSyllabusTransportFailure('SESSION', 'SESSION_INVALID', 401);
    throw new VtopError('SESSION_EXPIRED', 'Your VTOP session is no longer valid. Sign in again to continue.');
  }

  if (!res.ok && res.status !== 200) {
    let errorBody = '';
    try { errorBody = await res.text(); } catch { /* ignore */ }
    // The raw status/body is unhelpful in the login modal; log it for dev only.
    debugErrorDetail(`vtop-gateway HTTP ${res.status}`, errorBody);
    if (isSyllabus) logSyllabusTransportFailure('UPSTREAM', 'GATEWAY_HTTP_ERROR', res.status);
    throw new VtopError('VTOP_UNAVAILABLE', 'VTOP is temporarily unavailable. Try again.');
  }

  let body: GatewayResponse;
  try {
    body = await res.json();
  } catch (parseErr: unknown) {
    debugErrorDetail('vtop-gateway non-JSON response', parseErr);
    if (isSyllabus) logSyllabusTransportFailure('UPSTREAM', 'GATEWAY_NON_JSON', res.status);
    throw new VtopError('VTOP_UNAVAILABLE', 'VTOP is temporarily unavailable. Try again.');
  }

  return body;
}

// ---------------------------------------------------------------------------
// RealVTOPClient
// ---------------------------------------------------------------------------

export class RealVTOPClient implements VTOPClient {
  /**
   * In-memory session token — AES-GCM encrypted { cookie, csrf, authorizedId }.
   * Never written to localStorage, sessionStorage, or any persistent store.
   * Cleared on logout() or when the page unloads.
   */
  private sessionToken: string | null = null;
  /**
   * True only after VTOP accepted the credentials for this token. A token
   * exists as soon as the CAPTCHA is armed, so `sessionToken` alone cannot
   * answer "can we fetch data?" — and FETCH_DATA on an armed-but-unauthenticated
   * session is a gateway error, not a sync.
   */
  private authenticated = false;
  /** Campus identifier — threaded through to the gateway. */
  private campus: string;
  /**
   * Observer for session-state transitions, installed by `liveSession.ts`.
   * One-way and valueless: it signals a change and the subscriber re-reads
   * `isAuthenticated()`. Never persisted.
   */
  private sessionWatcher: ((authenticated: boolean) => void) | null = null;
  /** Last state pushed to the watcher, so a token rotation is not a transition. */
  private lastNotified: boolean | null = null;

  constructor() {
    // Read campus from localStorage (set by Settings modal)
    this.campus = 'chennai';
    try {
      const stored = localStorage.getItem('ultracc:campus');
      if (stored && ['chennai', 'vellore', 'ap', 'bhopal'].includes(stored)) {
        this.campus = stored;
      }
    } catch { /* localStorage unavailable */ }
  }

  /** Set the campus for this session (chennai/vellore/ap/bhopal). */
  setCampus(campus: string): void {
    this.campus = campus;
  }

  /** True while an in-memory encrypted session token exists. */
  hasSessionToken(): boolean {
    return !!this.sessionToken;
  }

  /** True only while that token represents a signed-in VTOP session. */
  isAuthenticated(): boolean {
    return this.authenticated && !!this.sessionToken;
  }

  /**
   * Install the session-state observer (null to remove it). The state that is
   * true right now is pushed immediately, so a subscriber can never render a
   * stale answer after mounting late.
   */
  setSessionWatcher(fn: ((authenticated: boolean) => void) | null): void {
    this.sessionWatcher = fn;
    this.lastNotified = null;
    if (fn) this.notifySession();
  }

  /** The only writer of `sessionToken`. */
  private setSessionToken(next: string | null): void {
    this.sessionToken = next;
    this.notifySession();
  }

  /** The only writer of `authenticated`. */
  private setAuthenticated(next: boolean): void {
    this.authenticated = next;
    this.notifySession();
  }

  /** Push a transition — and only a transition — to the session observer. */
  private notifySession(): void {
    const now = this.isAuthenticated();
    if (now === this.lastNotified) return;
    this.lastNotified = now;
    try {
      this.sessionWatcher?.(now);
    } catch {
      // A broken subscriber must never break the VTOP call that changed state.
    }
  }

  // Deprecated: the browser-extension bridge is gone.
  async isExtensionAvailable(): Promise<boolean> {
    return false;
  }

  // ------------------------------------------------------------------
  // Session initialization — fetches VTOP role chooser + student login form
  // ------------------------------------------------------------------
  async initializeSession(): Promise<{ csrfToken: string; captchaImageBase64?: string }> {
    const res = await callGateway({ action: 'INITIALIZE_SESSION', campus: this.campus });
    if (!res.ok || !res.sessionToken) {
      throw new VtopError(
        'CAPTCHA_FAILED',
        res.error || 'Could not initialize VTOP session. VTOP may be down or unreachable.'
      );
    }
    this.setSessionToken(res.sessionToken);
    // A freshly armed session has a token but no authorization yet.
    this.setAuthenticated(false);
    return {
      csrfToken: '(managed-by-gateway)',
      captchaImageBase64: res.captchaImageBase64 || '',
    };
  }

  // ------------------------------------------------------------------
  // CAPTCHA — fetches a fresh CAPTCHA image from VTOP (same session)
  // ------------------------------------------------------------------
  async getCaptcha(): Promise<CaptchaPredictionResult> {
    if (!this.sessionToken) {
      // Auto-initialize if not yet done
      await this.initializeSession();
    }
    const res = await callGateway({ action: 'FETCH_CAPTCHA', sessionToken: this.sessionToken! });
    if (!res.ok) {
      throw new VtopError('CAPTCHA_FAILED', res.error || 'Could not retrieve the VTOP CAPTCHA image.');
    }
    if (res.sessionToken) this.setSessionToken(res.sessionToken);
    return {
      captchaText: '', // No OCR prediction — student enters manually
      confidence: 0,
      imageBase64: res.captchaImageBase64 || '',
      note: 'No OCR prediction — VTOP CAPTCHA must be entered manually.',
    };
  }

  // ------------------------------------------------------------------
  // Login — credentials transit the gateway over HTTPS (NOT zero-knowledge)
  // ------------------------------------------------------------------
  async login(
    regNo: string,
    password: string,
    captchaText: string
  ): Promise<{ success: boolean; message: string; authorizedId?: string }> {
    if (!this.sessionToken) {
      throw new VtopError('CAPTCHA_FAILED', 'No active VTOP session. Call initializeSession() first.');
    }

    const res = await callGateway({
      action: 'DO_LOGIN',
      sessionToken: this.sessionToken,
      credentials: { regNo, password, captchaText },
    });

    if (res.sessionToken) this.setSessionToken(res.sessionToken);

    if (res.loginSuccess) {
      this.setAuthenticated(true);
      return {
        success: true,
        message: 'Successfully authenticated with VTOP Chennai.',
      };
    }

    if (res.captchaMismatch) {
      throw new VtopError('CAPTCHA_FAILED', res.loginError || 'VTOP rejected the CAPTCHA. Refresh and re-enter.');
    }
    if (res.sessionExpired) {
      this.setSessionToken(null);
      this.setAuthenticated(false);
      throw new VtopError('SESSION_EXPIRED', 'VTOP session expired. Please refresh the CAPTCHA and try again.');
    }

    throw new VtopError('LOGIN_FAILED', res.loginError || 'VTOP login failed. Check registration number, password, and CAPTCHA.');
  }

  // ------------------------------------------------------------------
  // Session status
  // ------------------------------------------------------------------
  async getSessionStatus(): Promise<{ authenticated: boolean }> {
    if (!this.sessionToken) return { authenticated: false };

    const res = await callGateway({ action: 'GET_SESSION_STATUS', sessionToken: this.sessionToken });
    if (res.sessionToken) this.setSessionToken(res.sessionToken);

    if (res.sessionExpired) {
      this.setSessionToken(null);
      this.setAuthenticated(false);
      throw new VtopError('SESSION_EXPIRED', 'VTOP session has expired. Please re-login.');
    }

    const data = res.data as { authenticated: boolean } | undefined;
    this.setAuthenticated(data?.authenticated ?? false);
    return { authenticated: this.authenticated };
  }

  // ------------------------------------------------------------------
  // Data fetchers — all use FETCH_DATA action with dataTarget parameter
  // ------------------------------------------------------------------

  async getSemesters(): Promise<SemesterInfo[]> {
    return this.fetchData<SemesterInfo[]>('semesters');
  }

  async getProfile(): Promise<StudentProfile> {
    return this.fetchData<StudentProfile>('profile');
  }

  async getAttendance(semesterId?: string): Promise<AttendanceRecord[]> {
    return this.fetchData<AttendanceRecord[]>('attendance', semesterId);
  }

  async getTimetable(semesterId?: string): Promise<TimetableSlot[]> {
    const slots = await this.fetchData<TimetableSlot[]>('timetable', semesterId);
    // The gateway parses VTOP's per-slot rows verbatim, so a 2-period lab
    // arrives as TWO rows. Normalise at this single entry point into the
    // cache/UI pipeline so every consumer (IndexedDB cache, dashboard, week
    // grid, ICS export, reminders) sees the lab as ONE combined session.
    return combineLabSessions(slots);
  }

  /** Assessment titles VTOP actually served per course on the last marks fetch
   *  (sanitized — component names only, never marks values or credentials).
   *  Lets the UI prove whether CAT/DA rows existed before blaming the parser. */
  lastMarksDiag: { courseCode: string; courseTitle: string; assessments: string[] }[] = [];

  async getMarks(semesterId?: string): Promise<CourseMarksRecord[]> {
    const { data, diag } = await this.fetchDataWithDiag<CourseMarksRecord[]>('marks', semesterId);
    this.lastMarksDiag = diag ?? [];
    return data;
  }

  async getExams(semesterId?: string): Promise<ExamRecord[]> {
    return this.fetchData<ExamRecord[]>('exams', semesterId);
  }

  async getAssignments(semesterId?: string): Promise<AssignmentRecord[]> {
    const data = await this.fetchData<{ courseCode: string; courseTitle: string; title: string; dueDate: string; weightage: number | null; status: string; id?: string }[]>('assignments', semesterId);
    return (data ?? []).map((a, i) => {
      const status: AssignmentRecord['status'] = classifyAssignmentStatus(a.status);
      return {
        id: a.id || `${a.courseCode}-${i}`,
        courseCode: a.courseCode,
        courseTitle: a.courseTitle,
        title: a.title,
        dueDate: a.dueDate,
        weightage: a.weightage ?? 0,
        status,
      };
    });
  }

  async getGrades(): Promise<GradeSummary> {
    const data = await this.fetchData<{ cgpa: number | null; creditsRegistered: number | null; creditsEarned: number | null }>('grades');
    return {
      available: data.cgpa !== null || data.creditsRegistered !== null || data.creditsEarned !== null,
      cgpa: data.cgpa ?? null,
      creditsRegistered: data.creditsRegistered ?? null,
      creditsEarned: data.creditsEarned ?? null,
    };
  }

  async getGradeHistory(): Promise<GradeHistory> {
    const data = await this.fetchData<GradeHistory>('gradeHistory');
    return {
      available: !!data.available || data.cgpa !== null || data.creditsRegistered !== null || data.creditsEarned !== null || (data.effectiveGrades || []).length > 0 || data.gradeCounts !== null,
      cgpa: data.cgpa ?? null,
      creditsRegistered: data.creditsRegistered ?? null,
      creditsEarned: data.creditsEarned ?? null,
      gradeCounts: data.gradeCounts ?? null,
      effectiveGrades: data.effectiveGrades ?? [],
    };
  }

  async getSemesterGrades(semesterId?: string): Promise<SemesterGrades> {
    const data = await this.fetchData<SemesterGrades>('semesterGrades', semesterId);
    return {
      available: !!data.available || data.grades.length > 0 || data.gpa !== null,
      gpa: data.gpa ?? null,
      grades: data.grades ?? [],
    };
  }

  async getOd(semesterId?: string): Promise<OdSummary> {
    const data = await this.fetchData<OdSummary>('od', semesterId);
    return {
      available: !!data.available,
      // The cap is the gateway's policy number, not this client's. Used to be
      // `?? 40`, which restated the rule in a second place and printed a
      // denominator no response had supplied.
      limitHours: typeof data.limitHours === 'number' && data.limitHours > 0 ? data.limitHours : null,
      totalOdHours: data.totalOdHours ?? 0,
      perCourse: data.perCourse ?? [],
    };
  }

  async getCalendar(semesterId?: string): Promise<AcademicCalendar> {
    const data = await this.fetchData<{ months: { token: string; monthKey: string }[]; days: CalendarDay[] }>('calendar', semesterId);
    return {
      available: data.months.length > 0 || data.days.length > 0,
      months: data.months ?? [],
      days: data.days ?? [],
    };
  }

  async getArrears(): Promise<ArrearRecord[]> {
    const data = await this.fetchData<ArrearRecord[]>('arrears');
    return data ?? [];
  }

  async getCirculars(): Promise<CircularRecord[]> {
    const data = await this.fetchData<CircularRecord[]>('circulars');
    return data ?? [];
  }

  async getCurriculum(): Promise<CurriculumProgress> {
    const data = await this.fetchData<CurriculumProgress>('curriculum');
    return {
      available: data.totals.creditsRequired > 0 || data.distributionTypes.length > 0 || data.baskets.length > 0,
      totals: data.totals ?? { creditsRequired: 0, creditsEarned: 0, creditsRegistered: 0, cgpa: null },
      distributionTypes: data.distributionTypes ?? [],
      baskets: data.baskets ?? [],
      gradeCounts: data.gradeCounts ?? { S: 0, A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, N: 0 },
    };
  }

  async getMakeupExams(): Promise<MakeupExamRecord[]> {
    const data = await this.fetchData<MakeupExamRecord[]>('makeupExams');
    return data ?? [];
  }

  async getRefat(): Promise<RefatInfo> {
    const data = await this.fetchData<RefatInfo>('refat');
    return {
      available: !!data.available,
      status: data.status ?? '',
      message: data.message ?? '',
      semesters: data.semesters ?? [],
    };
  }

  async getCompre(): Promise<CompreInfo> {
    const data = await this.fetchData<CompreInfo>('compre');
    return {
      available: !!data.available,
      status: data.status ?? '',
      message: data.message ?? '',
    };
  }

  async getPayments(): Promise<PaymentsInfo> {
    const data = await this.fetchData<PaymentsInfo>('payments');
    return {
      title: data.title ?? '',
      registerNumber: data.registerNumber ?? '',
      studentName: data.studentName ?? '',
      programme: data.programme ?? '',
      campus: data.campus ?? '',
      message: data.message ?? '',
      hasDues: !!data.hasDues,
      rows: data.rows ?? [],
    };
  }

  async getCredentials(): Promise<CredentialsInfo> {
    const data = await this.fetchData<CredentialsInfo>('credentials');
    return { title: data.title ?? '', credentials: data.credentials ?? [] };
  }

  async getSapInfo(): Promise<SapInfo> {
    const data = await this.fetchData<SapInfo>('sapInfo');
    return {
      title: data.title ?? '',
      rows: data.rows ?? [],
      message: data.message ?? '',
      available: !!data.available,
    };
  }

  async getPaymentReceipts(): Promise<PaymentReceiptsInfo> {
    const data = await this.fetchData<PaymentReceiptsInfo>('paymentReceipts');
    return { title: data.title ?? '', receipts: data.receipts ?? [], available: !!data.available };
  }

  async searchEmployee(empId: string): Promise<EmployeeSearchResult> {
    const data = await this.fetchData<EmployeeSearchResult>('employeeSearch', undefined, { empId });
    return {
      title: data.title ?? '',
      fields: data.fields ?? [],
      message: data.message ?? '',
      found: !!data.found,
    };
  }

  async getBankInfo(): Promise<BankInfo> {
    const data = await this.fetchData<BankInfo>('bankInfo');
    return { title: data.title ?? '', rows: data.rows ?? [], message: data.message ?? '', available: !!data.available };
  }

  async getBiometricInfo(): Promise<BiometricInfo> {
    const data = await this.fetchData<BiometricInfo>('biometric');
    return { title: data.title ?? '', rows: data.rows ?? [], message: data.message ?? '', available: !!data.available };
  }

  async getProctorMessages(): Promise<ProctorMessage[]> {
    return this.fetchData<ProctorMessage[]>('proctorMessages');
  }

  async getLoginHistory(): Promise<LoginHistoryRow[]> {
    return this.fetchData<LoginHistoryRow[]>('loginHistory');
  }

  async getClassMessages(): Promise<ClassMessage[]> {
    return this.fetchData<ClassMessage[]>('classMessages');
  }

  async getHodDean(): Promise<HodDeanInfo> {
    const data = await this.fetchData<HodDeanInfo>('hodDean');
    return { title: data.title ?? '', rows: data.rows ?? [], available: !!data.available };
  }

  async getWallet(): Promise<WalletInfo> {
    const data = await this.fetchData<WalletInfo>('wallet');
    return { title: data.title ?? '', rows: data.rows ?? [], message: data.message ?? '', available: !!data.available };
  }

  async getExtraCurricular(): Promise<ExtraCurricularInfo> {
    const data = await this.fetchData<ExtraCurricularInfo>('extraCurricular');
    return { title: data.title ?? '', rows: data.rows ?? [], available: !!data.available };
  }

  /**
   * One course's syllabus, over the gateway's 'syllabus' target — VTOP's
   * authenticated Course Page flow (Academics → Course Page → course → the
   * syllabus link on its detail page), run server-side. The browser sends
   * COURSE IDENTITY ONLY: the code, its type, and whichever term the app knows.
   * It cannot name a slot, a faculty or a class, because there is no parameter
   * for one — the gateway resolves VTOP's own class row itself.
   *
   * The browser gets the file bytes and VTOP's own course naming; never a
   * cookie, CSRF token or authorizedID.
   *
   * An absence is a real answer: VTOP either has no syllabus link for the
   * course or its list held no such course, and that arrives as
   * available:false with the gateway's reason. Nothing here invents content,
   * and nothing here redirects the student elsewhere to find out.
   */
  async getSyllabus(request: SyllabusRequest = {}): Promise<SyllabusInfo> {
    const query: Record<string, string> = {};
    const put = (key: string, value: string | undefined) => {
      const v = (value || '').trim();
      if (v) query[key] = v;
    };
    put('courseCode', request.courseCode);
    put('courseType', request.courseType);
    // The term the app is showing, when it knows one. A student on an older
    // term gets that term; the gateway falls back to VTOP's own selection when
    // this is empty, so an unsynced app is never blocked by a missing id.
    put('semesterLabel', request.semesterLabel);

    const data = await this.fetchData<Partial<SyllabusInfo> | null>(
      'syllabus',
      request.semesterId,
      Object.keys(query).length ? query : undefined,
    );

    const doc = data?.document;
    return {
      available: !!data?.available,
      reason: data?.reason,
      // VTOP's own words about a failed download; safe to show verbatim.
      detail: typeof data?.detail === 'string' ? data.detail : undefined,
      course: data?.course,
      reached: data?.reached,
      // VTOP's term, when its Course Page answered for a different one than the
      // client asked for. Passed through so the sheet can say which term the
      // document it is showing belongs to.
      semester: data?.semester,
      document: doc?.dataUrl && doc.contentType
        ? {
          dataUrl: doc.dataUrl,
          contentType: doc.contentType,
          fileName: doc.fileName || 'syllabus',
          bytes: Number(doc.bytes) || doc.dataUrl.length,
          origin: doc.origin === 'course-plan' ? 'course-plan' : 'course-syllabus',
        }
        : null,
    };
  }

  async getTransport(): Promise<TransportInfo> {
    const data = await this.fetchData<TransportInfo>('transport');
    return {
      hasRegistration: !!data.hasRegistration,
      registerNumber: data.registerNumber ?? '',
      name: data.name ?? '',
      programme: data.programme ?? '',
      branch: data.branch ?? '',
      routeSelected: data.routeSelected ?? '',
      fpReference: data.fpReference ?? '',
      paymentStatus: data.paymentStatus ?? '',
      busRouteId: data.busRouteId ?? '',
      qrCode: data.qrCode ?? '',
      rows: data.rows ?? [],
    };
  }

  // ------------------------------------------------------------------
  // Logout
  // ------------------------------------------------------------------
  async logout(): Promise<void> {
    if (this.sessionToken) {
      try {
        await callGateway({ action: 'LOGOUT', sessionToken: this.sessionToken });
      } catch {
        // Best effort — local session cleared regardless
      }
      this.setSessionToken(null);
      this.setAuthenticated(false);
    }
  }

  // ------------------------------------------------------------------
  // Private: generic FETCH_DATA call
  // ------------------------------------------------------------------
  private async fetchData<T>(dataTarget: string, semesterId?: string, query?: Record<string, string>): Promise<T> {
    const { data } = await this.fetchDataWithDiag<T>(dataTarget, semesterId, query);
    return data;
  }

  /** fetchData + sanitized marks diagnostic (assessment titles VTOP served). */
  private async fetchDataWithDiag<T>(dataTarget: string, semesterId?: string, query?: Record<string, string>): Promise<{ data: T; diag?: GatewayResponse['marksDiag'] }> {
    if (!this.isAuthenticated()) {
      // An armed CAPTCHA session is not a signed-in one; report it as such
      // instead of "session expired".
      throw new VtopError('SESSION_EXPIRED', NOT_AUTHENTICATED_MESSAGE);
    }

    const res = await callGateway({
      action: 'FETCH_DATA',
      sessionToken: this.sessionToken,
      dataTarget,
      semesterId,
      query,
    });

    if (res.sessionToken) this.setSessionToken(res.sessionToken);

    if (dataTarget === 'syllabus') {
      // Structured, single-line failure tag: fixed shape, no free text,
      // re-validated in syllabusDiagnostics.ts. Never shown to the student.
      const failure = syllabusFailureInfo(res);
      if (failure) console.info(`[UltraCC syllabus] ${syllabusFailureLine(failure)}`);

      // Dev-only verbose line: the gateway's step-by-step outcome.
      const devMode = typeof import.meta !== 'undefined' ? (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV : false;
      if (devMode && res.syllabusDiag) console.info(`[${dataTarget} gateway] ${res.syllabusDiag}`);
    }

    if (res.sessionExpired) {
      this.setSessionToken(null);
      this.setAuthenticated(false);
      throw new VtopError('SESSION_EXPIRED', 'VTOP session expired while fetching ' + dataTarget + '. Please re-login.');
    }

    if (res.parseFailed) {
      throw new VtopError(
        'PARSE_FAILED',
        res.error || `VTOP changed its page structure — ${dataTarget} could not be parsed.`
      );
    }

    if (res.notAvailable) {
      // Not a session event: a sync asks VTOP for many datasets, some of which
      // legitimately have no page. Never touch the session here.
      throw new VtopError('VTOP_UNAVAILABLE', res.error || `VTOP has nothing for ${dataTarget} on your account.`);
    }

    if (!res.ok) {
      // Worded like the branches above so the dataset name survives.
      throw new VtopError('VTOP_UNAVAILABLE', res.error || `VTOP could not provide your ${dataTarget} data. Try again in a moment.`);
    }

    // Dev-only: surface the photo-fetch outcome (metadata only) for diagnosing
    // a missing avatar.
    if (res.photoDiag && dataTarget === 'profile') {
      const devMode = typeof import.meta !== 'undefined' ? (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV : false;
      if (devMode) console.info(`[photo gateway] ${res.photoDiag}`);
    }

    return { data: res.data as T, diag: res.marksDiag };
  }
}
