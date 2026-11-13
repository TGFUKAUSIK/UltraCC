/**
 * gateway.ts — the mobile client for the shared VTOP gateway edge function.
 *
 * Same stateless-roundtrip design as the web app (src/lib/vtop/realClient.ts):
 *   - INITIALIZE_SESSION returns an AES-GCM `sessionToken` encoding
 *     { cookie, csrf, authorizedId }.
 *   - The token is held IN MEMORY ONLY (a class field) and rotated on every
 *     call. It is never written to AsyncStorage, SecureStore, or disk.
 *   - VTOP credentials (password, CAPTCHA) transit the gateway over HTTPS and
 *     are never persisted by this client.
 *
 * Only the public Supabase anon key is used (see config.ts); no service-role
 * key, no private token, no CAPTCHA bypass.
 */

import { ANON_KEY, VTOP_GATEWAY_URL, type Campus } from '../config';
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
import { combineLabSessions } from '../utils/labSessions';

const GATEWAY_TIMEOUT_MS = 75_000;

interface GatewayPayload {
  action: string;
  sessionToken?: string;
  credentials?: { regNo: string; password: string; captchaText: string };
  dataTarget?: string;
  semesterId?: string;
  query?: Record<string, string>;
  campus?: string;
}

interface GatewayResponse {
  ok: boolean;
  action: string;
  sessionToken?: string;
  captchaImageBase64?: string;
  /** The gateway's own reading of the CAPTCHA image; '' when it made none. */
  captchaText?: string;
  /** 0..1 confidence in `captchaText`, from the gateway's template engine. */
  captchaConfidence?: number;
  loginSuccess?: boolean;
  loginError?: string;
  captchaMismatch?: boolean;
  sessionExpired?: boolean;
  data?: unknown;
  parseFailed?: boolean;
  unavailable?: boolean;
  notAvailable?: boolean;
  marksDiag?: { courseCode: string; courseTitle: string; assessments: string[] }[];
  error?: string;
}

export class VtopError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'VtopError';
    this.code = code;
  }
}

function timeoutSignal(ms: number): { signal?: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

async function callGateway(payload: GatewayPayload): Promise<GatewayResponse> {
  const { signal, clear } = timeoutSignal(GATEWAY_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(VTOP_GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ANON_KEY}`,
      },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    throw new VtopError(
      'VTOP_UNAVAILABLE',
      timedOut
        ? 'VTOP did not respond in time — it may be down or overloaded. Try again in a minute.'
        : 'VTOP could not be reached. Check your internet connection and try again.',
    );
  } finally {
    clear();
  }

  if (res.status === 401) {
    throw new VtopError('SESSION_EXPIRED', 'Your VTOP session is no longer valid. Sign in again to continue.');
  }
  if (!res.ok && res.status !== 200) {
    throw new VtopError('VTOP_UNAVAILABLE', 'VTOP is temporarily unavailable. Try again.');
  }

  let body: GatewayResponse;
  try {
    body = (await res.json()) as GatewayResponse;
  } catch {
    throw new VtopError('VTOP_UNAVAILABLE', 'VTOP is temporarily unavailable. Try again.');
  }
  return body;
}

/**
 * A CAPTCHA challenge as the gateway served it: the image plus the gateway's own
 * reading of it. `captchaText` is empty whenever the gateway made no reading, and
 * carries low-confidence guesses too, so callers must go through
 * `autoFillCaptcha()` rather than trusting the field.
 */
export interface CaptchaChallenge {
  imageBase64: string;
  captchaText: string;
  captchaConfidence: number;
}

function readCaptchaChallenge(res: GatewayResponse): CaptchaChallenge {
  return {
    imageBase64: res.captchaImageBase64 || '',
    captchaText: res.captchaText || '',
    captchaConfidence: typeof res.captchaConfidence === 'number' ? res.captchaConfidence : 0,
  };
}

/**
 * The mobile VTOP client. A single instance lives in the app's session state;
 * its token is memory-only, so a process restart clears the session.
 */
export class VtopGatewayClient {
  private sessionToken: string | null = null;
  private authenticated = false;
  private campus: Campus;

  constructor(campus: Campus = 'chennai') {
    this.campus = campus;
  }

  setCampus(campus: Campus): void {
    this.campus = campus;
  }

  isAuthenticated(): boolean {
    return this.authenticated && !!this.sessionToken;
  }

  async initializeSession(): Promise<CaptchaChallenge> {
    const res = await callGateway({ action: 'INITIALIZE_SESSION', campus: this.campus });
    if (!res.ok || !res.sessionToken) {
      throw new VtopError('CAPTCHA_FAILED', res.error || 'Could not initialize VTOP session. VTOP may be down or unreachable.');
    }
    this.sessionToken = res.sessionToken;
    this.authenticated = false;
    return readCaptchaChallenge(res);
  }

  async getCaptcha(): Promise<CaptchaChallenge> {
    if (!this.sessionToken) await this.initializeSession();
    const res = await callGateway({ action: 'FETCH_CAPTCHA', sessionToken: this.sessionToken! });
    if (!res.ok) throw new VtopError('CAPTCHA_FAILED', res.error || 'Could not retrieve the VTOP CAPTCHA image.');
    if (res.sessionToken) this.sessionToken = res.sessionToken;
    return readCaptchaChallenge(res);
  }

  async login(regNo: string, password: string, captchaText: string): Promise<{ success: boolean; message: string }> {
    if (!this.sessionToken) {
      throw new VtopError('CAPTCHA_FAILED', 'No active VTOP session. Call initializeSession() first.');
    }
    const res = await callGateway({
      action: 'DO_LOGIN',
      sessionToken: this.sessionToken,
      credentials: { regNo, password, captchaText },
    });
    if (res.sessionToken) this.sessionToken = res.sessionToken;

    if (res.loginSuccess) {
      this.authenticated = true;
      return { success: true, message: 'Successfully authenticated with VTOP.' };
    }
    if (res.captchaMismatch) {
      throw new VtopError('CAPTCHA_FAILED', res.loginError || 'VTOP rejected the CAPTCHA. Refresh and re-enter.');
    }
    if (res.sessionExpired) {
      this.sessionToken = null;
      this.authenticated = false;
      throw new VtopError('SESSION_EXPIRED', 'VTOP session expired. Please refresh the CAPTCHA and try again.');
    }
    throw new VtopError('LOGIN_FAILED', res.loginError || 'VTOP login failed. Check registration number, password, and CAPTCHA.');
  }

  async logout(): Promise<void> {
    if (this.sessionToken) {
      try {
        await callGateway({ action: 'LOGOUT', sessionToken: this.sessionToken });
      } catch {
        // Logout is best-effort; the token is discarded either way.
      }
    }
    this.sessionToken = null;
    this.authenticated = false;
  }

  private async fetchData<T>(dataTarget: string, semesterId?: string): Promise<T> {
    const res = await callGateway({
      action: 'FETCH_DATA',
      sessionToken: this.sessionToken ?? undefined,
      dataTarget,
      semesterId,
      campus: this.campus,
    });
    if (res.sessionToken) this.sessionToken = res.sessionToken;
    if (res.sessionExpired) {
      this.sessionToken = null;
      this.authenticated = false;
      throw new VtopError('SESSION_EXPIRED', 'Your VTOP session has expired. Sign in again.');
    }
    if (res.notAvailable) {
      // This dataset simply is not on the account — not a session failure.
      return (res.data as T) ?? ([] as unknown as T);
    }
    if (!res.ok || res.unavailable || res.parseFailed) {
      throw new VtopError('VTOP_UNAVAILABLE', res.error || 'VTOP could not load this data right now.');
    }
    return res.data as T;
  }

  getSemesters(): Promise<SemesterInfo[]> {
    return this.fetchData<SemesterInfo[]>('semesters');
  }

  getProfile(): Promise<StudentProfile> {
    return this.fetchData<StudentProfile>('profile');
  }

  getAttendance(semesterId?: string): Promise<AttendanceRecord[]> {
    return this.fetchData<AttendanceRecord[]>('attendance', semesterId);
  }

  async getTimetable(semesterId?: string): Promise<TimetableSlot[]> {
    const slots = await this.fetchData<TimetableSlot[]>('timetable', semesterId);
    return combineLabSessions(slots);
  }

  getMarks(semesterId?: string): Promise<CourseMarksRecord[]> {
    return this.fetchData<CourseMarksRecord[]>('marks', semesterId);
  }

  getExams(semesterId?: string): Promise<ExamRecord[]> {
    return this.fetchData<ExamRecord[]>('exams', semesterId);
  }

  async getAssignments(semesterId?: string): Promise<AssignmentRecord[]> {
    const data = await this.fetchData<
      { courseCode: string; courseTitle: string; title: string; dueDate: string; weightage: number | null; status: string; id?: string }[]
    >('assignments', semesterId);
    return (data ?? []).map((a, i) => {
      const raw = (a.status || '').toLowerCase();
      const status: AssignmentRecord['status'] =
        /submit/i.test(raw) && !/not/i.test(raw) ? 'Submitted'
        : /grade/i.test(raw) ? 'Graded'
        : 'Pending';
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

  getSemesterGrades(semesterId?: string): Promise<SemesterGrades> {
    return this.fetchData<SemesterGrades>('semesterGrades', semesterId);
  }

  getOd(semesterId?: string): Promise<OdSummary> {
    return this.fetchData<OdSummary>('od', semesterId);
  }

  getCalendar(semesterId?: string): Promise<AcademicCalendar> {
    return this.fetchData<AcademicCalendar>('calendar', semesterId);
  }

  getTransport(): Promise<TransportInfo> {
    return this.fetchData<TransportInfo>('transport');
  }
}
