/**
 * captcha.ts — how the app decides to use the gateway's CAPTCHA reading.
 *
 * vtop-gateway already solves VTOP's image CAPTCHA and reports the text with a
 * 0..1 confidence, so the student normally just types a registration number and
 * a password. But a wrong CAPTCHA is not a free guess: VTOP records it as a
 * failed login on the student's real account and locks the account after
 * repeated failures. A shaky read is therefore discarded and the image is
 * handed over for manual entry instead.
 *
 * The threshold deliberately matches the web app's MIN_AUTO_SUBMIT_CONFIDENCE
 * (src/components/ExtensionSyncModal.tsx); a regression test asserts the two
 * stay equal so the same student never gets an automatic read in one client and
 * a manual one in the other.
 */

export const MIN_AUTO_FILL_CONFIDENCE = 0.5;

/** The gateway's answer to a CAPTCHA challenge. */
export interface CaptchaReading {
  captchaText?: string;
  captchaConfidence?: number;
}

/**
 * The text worth pre-filling the login form with, or '' when the student has to
 * read the image themselves.
 */
export function autoFillCaptcha(reading: CaptchaReading): string {
  const text = (reading.captchaText ?? '').trim();
  const confidence = reading.captchaConfidence ?? 0;
  if (!text) return '';
  return confidence >= MIN_AUTO_FILL_CONFIDENCE ? text : '';
}
