/**
 * LmsRealClient — lms-gateway Edge Function transport.
 *
 * Mirrors RealVTOPClient exactly: the browser holds an opaque AES-GCM
 * encrypted sessionToken IN MEMORY ONLY; every call passes it back; the
 * gateway decrypts, acts, re-encrypts, and returns a fresh token.
 *
 * SECURITY:
 *   - LMS credentials (username/password) transit the gateway over HTTPS.
 *     NOT zero-knowledge — the Settings UI must state this.
 *   - MoodleSession / logintoken never reach this client in readable form.
 *   - No raw LMS HTML reaches the browser.
 *   - Every thrown message here is student-facing copy. Status lines, response
 *     bodies and deploy hints go to `debugErrorDetail`, which is dev-only, so
 *     the brief's "LMS is temporarily unavailable. Try again." is what a real
 *     student reads — and developers still get the raw half locally.
 */

import { VtopError } from '../vtop/errors';
import { debugErrorDetail, humanErrorCopy } from '../errorCopy';
import {
  LmsCourse,
  LmsAssignment,
  LmsQuizWindow,
  LmsGradeItem,
  LmsMaterial,
  LmsForumPost,
  LmsCalendarEvent,
} from './types';

// ---------------------------------------------------------------------------
// Gateway configuration
// ---------------------------------------------------------------------------

/**
 * REGRESSION GUARD: placeholder env values (e.g. from copying .env.example)
 * must not override the known-good fallbacks (see vtop/realClient.ts).
 */
function isPlaceholder(value: string | undefined | null): boolean {
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

function gatewayUrl(): string {
  // Set VITE_LMS_GATEWAY_URL to your own deployed function; the public build
  // ships a placeholder rather than a project URL.
  return envOr('VITE_LMS_GATEWAY_URL', 'https://your-project.supabase.co/functions/v1/lms-gateway');
}

function anonKey(): string {
  return envOr('VITE_SUPABASE_ANON_KEY', 'your_supabase_anon_key');
}

// ---------------------------------------------------------------------------
// Gateway call helper
// ---------------------------------------------------------------------------

/**
 * The one sentence every transport-level LMS failure shows. Moodle and our
 * gateway fail for many reasons (downtime, TLS rotation, a 502, a stuck
 * redirect loop); none of them are things a student can act on, and the brief
 * is explicit that "HTTP 502 Bad Gateway" must not appear in the UI.
 */
const LMS_UNAVAILABLE = 'LMS is temporarily unavailable. Try again.';

interface GatewayPayload {
  action: string;
  sessionToken?: string;
  credentials?: { username: string; password: string };
  dataTarget?: string;
  courseId?: number;
}

interface GatewayResponse {
  ok: boolean;
  action: string;
  sessionToken?: string;
  readyForAuth?: boolean;
  loginSuccess?: boolean;
  loginError?: string;
  sessionExpired?: boolean;
  data?: unknown;
  parseFailed?: boolean;
  unavailable?: boolean;
  error?: string;
}

async function callGateway(payload: GatewayPayload): Promise<GatewayResponse> {
  let res: Response;
  try {
    res = await fetch(gatewayUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${anonKey()}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (networkErr: unknown) {
    // "Failed to fetch" here almost always means the CORS preflight failed —
    // i.e. the lms-gateway Edge Function is not deployed (a 404 from the
    // Supabase gateway carries no access-control-allow-methods, so the browser
    // rejects the preflight and surfaces a bare network error). That diagnosis
    // names our own function and a CLI command, so it stays in the dev console;
    // the student just needs to know the LMS did not answer.
    debugErrorDetail('lms-gateway unreachable (not deployed? CORS?)', networkErr);
    throw new VtopError('VTOP_UNAVAILABLE', LMS_UNAVAILABLE);
  }

  if (!res.ok) {
    let errorBody = '';
    try { errorBody = await res.text(); } catch { /* ignore */ }
    debugErrorDetail(`lms-gateway HTTP ${res.status}`, errorBody);
    throw new VtopError('VTOP_UNAVAILABLE', LMS_UNAVAILABLE);
  }

  let body: GatewayResponse;
  try {
    body = await res.json();
  } catch (parseErr: unknown) {
    debugErrorDetail('lms-gateway non-JSON response', parseErr);
    throw new VtopError('VTOP_UNAVAILABLE', LMS_UNAVAILABLE);
  }
  return body;
}

// ---------------------------------------------------------------------------
// LmsRealClient
// ---------------------------------------------------------------------------

/**
 * `dataTarget` is the gateway's internal key ("quiz-windows"). Sentences shown
 * to a student spell the dataset out instead, so the UI never reads like an API
 * contract.
 */
const TARGET_LABELS: Record<string, string> = {
  courses: 'your LMS courses',
  assignments: 'the assignment list',
  'quiz-windows': 'the quiz windows',
  gradebook: 'the gradebook',
  materials: 'the course materials',
  forum: 'the announcements',
  calendar: 'the LMS calendar',
};

function targetLabel(dataTarget: string): string {
  return TARGET_LABELS[dataTarget] ?? 'LMS data';
}

export class LmsRealClient {
  /** In-memory encrypted session token — never persisted. */
  private sessionToken: string | null = null;

  hasSessionToken(): boolean {
    return !!this.sessionToken;
  }

  /** GET /login/index.php -> logintoken + MoodleSession jar (encrypted). */
  async initializeSession(): Promise<void> {
    const res = await callGateway({ action: 'INITIALIZE_SESSION' });
    if (!res.ok || !res.sessionToken) {
      throw new VtopError('VTOP_UNAVAILABLE',
        humanErrorCopy(res.error, 'LMS is temporarily unavailable. Try again.'));
    }
    this.sessionToken = res.sessionToken;
  }

  /** POST /login/index.php with logintoken + credentials. */
  async login(username: string, password: string): Promise<{ success: boolean; message: string }> {
    if (!this.sessionToken) await this.initializeSession();
    const res = await callGateway({
      action: 'DO_LOGIN',
      sessionToken: this.sessionToken!,
      credentials: { username, password },
    });
    if (res.sessionToken) this.sessionToken = res.sessionToken;

    if (res.loginSuccess) {
      return { success: true, message: 'Successfully authenticated with the VIT LMS (Moodle).' };
    }
    // Moodle's own rejection text is a page fragment; only keep it when it
    // already reads like a sentence, and never when it leaks internals.
    throw new VtopError('LOGIN_FAILED',
      humanErrorCopy(res.loginError, 'LMS did not accept those credentials. Check the username and password shown in VTOP under My Credentials.'));
  }

  async getSessionStatus(): Promise<{ authenticated: boolean }> {
    if (!this.sessionToken) return { authenticated: false };
    const res = await callGateway({ action: 'GET_SESSION_STATUS', sessionToken: this.sessionToken });
    if (res.sessionToken) this.sessionToken = res.sessionToken;
    if (res.sessionExpired) {
      this.sessionToken = null;
      throw new VtopError('SESSION_EXPIRED', 'Your LMS sign-in has expired. Please connect to the LMS again.');
    }
    const data = res.data as { authenticated: boolean } | undefined;
    return { authenticated: data?.authenticated ?? false };
  }

  async getCourses(): Promise<LmsCourse[]> {
    return this.fetchData<LmsCourse[]>('courses');
  }

  async getAssignments(courseId: number): Promise<LmsAssignment[]> {
    return this.fetchData<LmsAssignment[]>('assignments', courseId);
  }

  async getQuizWindows(courseId: number): Promise<LmsQuizWindow[]> {
    return this.fetchData<LmsQuizWindow[]>('quiz-windows', courseId);
  }

  async getGradebook(courseId: number): Promise<LmsGradeItem[]> {
    return this.fetchData<LmsGradeItem[]>('gradebook', courseId);
  }

  async getMaterials(courseId: number): Promise<LmsMaterial[]> {
    return this.fetchData<LmsMaterial[]>('materials', courseId);
  }

  async getForumAnnouncements(courseId: number): Promise<LmsForumPost[]> {
    return this.fetchData<LmsForumPost[]>('forum', courseId);
  }

  async getCalendarEvents(): Promise<LmsCalendarEvent[]> {
    return this.fetchData<LmsCalendarEvent[]>('calendar');
  }

  async logout(): Promise<void> {
    if (this.sessionToken) {
      try {
        await callGateway({ action: 'LOGOUT', sessionToken: this.sessionToken });
      } catch { /* best effort */ }
      this.sessionToken = null;
    }
  }

  // ------------------------------------------------------------------
  // Private
  // ------------------------------------------------------------------
  private async fetchData<T>(dataTarget: string, courseId?: number): Promise<T> {
    if (!this.sessionToken) {
      throw new VtopError('SESSION_EXPIRED', 'You are not connected to the LMS yet. Save your LMS credentials in Settings and sync again.');
    }
    const res = await callGateway({
      action: 'FETCH_DATA',
      sessionToken: this.sessionToken,
      dataTarget,
      courseId,
    });
    if (res.sessionToken) this.sessionToken = res.sessionToken;

    if (res.sessionExpired) {
      this.sessionToken = null;
      throw new VtopError('SESSION_EXPIRED', `Your LMS sign-in expired while loading ${targetLabel(dataTarget)}. Please connect to the LMS again.`);
    }
    if (res.parseFailed) {
      throw new VtopError('PARSE_FAILED',
        humanErrorCopy(res.error, `The LMS page for ${targetLabel(dataTarget)} has changed, so it could not be read.`));
    }
    if (!res.ok) {
      throw new VtopError('VTOP_UNAVAILABLE',
        humanErrorCopy(res.error, `Could not load ${targetLabel(dataTarget)}. Your other data is unaffected.`));
    }
    /*
     * A 200 with `ok: true` but no array is a malformed answer, not an empty
     * one. Handing `undefined` back looked harmless until it reached
     * `for (const x of …)` in syncLms and surfaced as a bare "TypeError: … is
     * not iterable" in the UI — with the whole course wiped from the cache on
     * the way past it. Reject it as its own dataset failure instead, which
     * keeps the last good cache and names the dataset that broke.
     */
    if (!Array.isArray(res.data)) {
      debugErrorDetail(`lms-gateway malformed payload for ${dataTarget}`,
        res.data === null ? 'null' : typeof res.data);
      throw new VtopError('PARSE_FAILED', `The LMS sent an unreadable answer for ${targetLabel(dataTarget)}, so it was not saved.`);
    }
    return res.data as T;
  }
}
