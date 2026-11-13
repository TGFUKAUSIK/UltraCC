/**
 * Headless automatic VTOP sign-in: arm the session, read VTOP's CAPTCHA, submit.
 *
 * One home for the automatic-login policy, so the two places that need it can
 * never disagree — the login sheet (which renders each step) and a manual
 * refresh (which signs in silently and only falls back to the sheet when VTOP
 * refuses the saved pair). Every rejected attempt is a real failed login on the
 * student's VTOP account, so the retry budget and the confidence floor live
 * here, are deliberately conservative, and are shared.
 */

import { getLiveClient, resetLiveClient } from './liveSession';
import { isVtopError, type VtopErrorCode } from './errors';

/**
 * How many times the automatic sign-in may re-arm and guess again. One, not
 * three: each wrong CAPTCHA is a failed login recorded against the student's
 * real VTOP account, and the portal locks accounts after repeated failures.
 * One confident guess, one re-arm, then the CAPTCHA is handed to the student,
 * who reads it far more reliably than any local solver.
 */
export const MAX_AUTO_RETRIES = 1;

/**
 * Minimum OCR confidence worth spending a real login attempt on. A wrong
 * CAPTCHA is not a free guess: VTOP answers it with a failed login on the
 * student's actual account, so a shaky read is handed over untouched rather
 * than submitted. Kept equal to the mobile app's floor — see
 * `mobile/src/lib/captcha.ts`.
 */
export const MIN_AUTO_SUBMIT_CONFIDENCE = 0.5;

export type AutoSignInStep = 'initializing' | 'solving-captcha' | 'submitting' | 'retrying';

export interface AutoSignInProgress {
  step: AutoSignInStep;
  /** Human copy a caller with UI can render verbatim. */
  message: string;
  /** The CAPTCHA image armed right now ('' before one is fetched). */
  captchaBase64: string;
}

/** Why the automatic flow handed control back to the student. */
export type AutoSignInHandover =
  | 'no-captcha'        // VTOP served no CAPTCHA image
  | 'unreadable'        // the local reader returned nothing usable
  | 'low-confidence'    // the read was too shaky to submit safely
  | 'rejected'          // VTOP refused the login id / password pair
  | 'captcha-exhausted' // out of attempts without getting past the CAPTCHA
  | 'unavailable';      // VTOP or the network could not be reached

/**
 * Discriminated on a STRING tag, not a boolean.
 *
 * This project runs without `strict` (so `strictNullChecks` is off), and under
 * that setting TypeScript will not narrow a union on a boolean literal
 * discriminant: `if (!result.ok)` leaves `result` as the whole union. A string
 * literal narrows correctly everywhere, so `if (result.status !== 'ok')` gives
 * callers the failure members without a cast.
 */
export type AutoSignInResult =
  | { status: 'ok' }
  | {
      status: 'handover';
      handover: AutoSignInHandover;
      /** VTOP's own message when it answered; '' for the local reader handovers. */
      message: string;
      /** The CAPTCHA image in hand for the manual fallback ('' when none). */
      captchaBase64: string;
      /** The VtopError code that produced the handover, when there was one. */
      code: VtopErrorCode | null;
      /** The thrown error, so a caller can run humanErrorCopy on transport noise. */
      error?: unknown;
    };

/** A CAPTCHA reader, injectable so the flow can be tested without tesseract. */
export type CaptchaReader = (imageBase64: string) => Promise<{ text: string; confidence: number }>;

/**
 * The local reader, imported lazily: the OCR/template payload is large and must
 * not sit in the chunk a signed-out student downloads to sign in. Never throws
 * — it returns '' when nothing usable was read.
 */
export async function readVtopCaptcha(imageBase64: string): Promise<{ text: string; confidence: number }> {
  const { ocrCaptchaWithConfidence } = await import('./ocrCaptcha');
  return ocrCaptchaWithConfidence(imageBase64);
}

export interface AutoSignInOptions {
  regNo: string;
  password: string;
  /** Re-arm-and-retry budget after a wrong CAPTCHA. Default MAX_AUTO_RETRIES. */
  maxRetries?: number;
  /** Confidence floor below which a read is not submitted. Default MIN_AUTO_SUBMIT_CONFIDENCE. */
  minConfidence?: number;
  /** Called as the flow advances, so a caller with UI can render each step. */
  onProgress?: (progress: AutoSignInProgress) => void;
  /** Override the CAPTCHA reader (tests). Defaults to the lazy local OCR. */
  readCaptcha?: CaptchaReader;
}

/**
 * Ensure VTOP is signed in with the given credentials, reading and submitting
 * the CAPTCHA automatically. Resolves `{ ok: true }` on a live authenticated
 * session; otherwise returns the handover that lets the caller show the login
 * form (with the reason) instead of guessing again. Never rejects.
 */
export async function attemptAutoSignIn(opts: AutoSignInOptions): Promise<AutoSignInResult> {
  const maxRetries = opts.maxRetries ?? MAX_AUTO_RETRIES;
  const minConfidence = opts.minConfidence ?? MIN_AUTO_SUBMIT_CONFIDENCE;
  const readCaptcha = opts.readCaptcha ?? readVtopCaptcha;

  let captchaBase64 = '';
  const report = (step: AutoSignInStep, message: string) =>
    opts.onProgress?.({ step, message, captchaBase64 });

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    report(
      'initializing',
      attempt === 0 ? 'Connecting to VTOP…' : `Retry ${attempt}/${maxRetries} — fetching new CAPTCHA…`,
    );
    // A fresh arm each attempt: a VTOP CAPTCHA is single-use, so a retry needs a
    // new image (and the token that goes with it).
    resetLiveClient();
    const client = getLiveClient();

    try {
      const res = await client.initializeSession();
      captchaBase64 = res.captchaImageBase64 || '';
    } catch (err) {
      return {
        status: 'handover',
        handover: 'unavailable',
        message: err instanceof Error ? err.message : String(err),
        captchaBase64,
        code: isVtopError(err) ? err.code : null,
        error: err,
      };
    }

    if (!captchaBase64) {
      return { status: 'handover', handover: 'no-captcha', message: '', captchaBase64: '', code: null };
    }

    report('solving-captcha', 'Reading CAPTCHA…');
    const read = await readCaptcha(captchaBase64);
    if (!read.text) {
      return { status: 'handover', handover: 'unreadable', message: '', captchaBase64, code: null };
    }
    if (read.confidence < minConfidence) {
      return { status: 'handover', handover: 'low-confidence', message: '', captchaBase64, code: null };
    }

    report('submitting', 'Signing in…');
    try {
      await client.login(opts.regNo, opts.password, read.text);
      return { status: 'ok' };
    } catch (err) {
      const code = isVtopError(err) ? err.code : null;
      const message = err instanceof Error ? err.message : String(err);
      // VTOP answers a wrong registration number or password with
      // "Invalid Credentials" (LOGIN_FAILED). Retrying that with a fresh CAPTCHA
      // burns sessions and tells the student to retype a code that was never the
      // problem, so it is handed straight back for correction.
      if (code === 'LOGIN_FAILED') {
        return { status: 'handover', handover: 'rejected', message, captchaBase64, code, error: err };
      }
      // A CAPTCHA/session failure is worth one more arm — typed codes only:
      // matching on the words in VTOP's message is how a credentials rejection
      // used to be retried as a CAPTCHA problem.
      if (code === 'CAPTCHA_FAILED' || code === 'SESSION_EXPIRED') {
        if (attempt < maxRetries) {
          report('retrying', `CAPTCHA incorrect — retrying (${attempt + 1}/${maxRetries})…`);
          continue;
        }
        return { status: 'handover', handover: 'captcha-exhausted', message, captchaBase64, code, error: err };
      }
      // Anything else (network, an unexpected gateway answer) — do not retry.
      return { status: 'handover', handover: 'unavailable', message, captchaBase64, code, error: err };
    }
  }

  // Unreachable: the loop returns on its last iteration. Kept for the compiler.
  return { status: 'handover', handover: 'captcha-exhausted', message: '', captchaBase64, code: null };
}
