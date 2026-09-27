import { parseDocument, parseOutcome, ParseOutcome, isLikelyLoginPage } from './helpers';

/**
 * Parsers for the CURRENT VTOP Chennai pre-authentication pages.
 *
 * Verified live on 2026-08-10 (structure captured anonymously, no credentials):
 *   - GET  /vtop/login                       -> role chooser (stdForm/empForm/parentForm)
 *   - POST /vtop/prelogin/setup (_csrf,flag) -> 302 /vtop/init/page -> 302 /vtop/login
 *   - GET  /vtop/login (after flag)          -> student login form (vtopLoginForm)
 *        action=/vtop/login, fields: username, password, captchaStr, _csrf
 *        CAPTCHA embedded as base64 JPEG inside #captchaBlock
 *   - GET  /vtop/get/new/captcha             -> <img src="data:image/jpeg;base64,..."> fragment
 *   - POST /vtop/login (bad creds)           -> 302 /vtop/login/error ("Invalid Captcha" + form)
 */

export interface VtopLoginForm {
  action: string;
  csrfToken: string;
  usernameField: string;
  passwordField: string;
  captchaField: string;
  captchaImageBase64: string;
  usesBuiltInCaptcha: boolean;
}

export interface VtopRoleChooser {
  csrfToken: string;
  /** e.g. ['VTOP', 'alumni', 'parent'] */
  flags: string[];
}

export function parseRoleChooserHtml(html: string): VtopRoleChooser | null {
  const doc = parseDocument(html);
  const csrfInput = doc.querySelector('input[name="_csrf"]');
  if (!csrfInput) return null;
  const flags = Array.from(doc.querySelectorAll('input[name="flag"]'))
    .map((el) => (el.getAttribute('value') || '').trim())
    .filter(Boolean);
  return { csrfToken: (csrfInput.getAttribute('value') || '').trim(), flags };
}

export function parseLoginFormHtml(htmlString: string): VtopLoginForm | null;
export function parseLoginFormHtml(htmlString: string, withOutcome: true): ParseOutcome<VtopLoginForm | null>;
export function parseLoginFormHtml(htmlString: string, withOutcome?: true) {
  const warnings: ParseOutcome<VtopLoginForm | null>['warnings'] = [];
  const doc = parseDocument(htmlString);

  const form = doc.querySelector('form[id="vtopLoginForm"], form[name="vtopLoginForm"]');
  if (!form) {
    const outcome = parseOutcome<VtopLoginForm | null>(
      null,
      [{ code: 'login-form-missing', detail: 'The VTOP student login form (vtopLoginForm) was not found.' }],
      true
    );
    return withOutcome ? outcome : outcome.data;
  }

  const csrfInput = form.querySelector('input[name="_csrf"]');
  const usernameInput = form.querySelector('input[name="username"]');
  const passwordInput = form.querySelector('input[name="password"]');
  const captchaInput = form.querySelector('input[name="captchaStr"]');
  const captchaImg = form.querySelector('#captchaBlock img[src^="data:image"]');

  const csrfToken = csrfInput?.getAttribute('value')?.trim() || '';
  if (!csrfToken) {
    warnings.push({ code: 'csrf-missing', detail: 'Login form found but _csrf value is missing.' });
  }
  if (!usernameInput || !passwordInput || !captchaInput) {
    warnings.push({
      code: 'login-fields-changed',
      detail: 'Login form found but username/password/captchaStr fields are missing — VTOP structure changed.',
    });
  }

  return withOutcome
    ? parseOutcome<VtopLoginForm | null>(
        {
          action: form.getAttribute('action') || '/vtop/login',
          csrfToken,
          usernameField: usernameInput?.getAttribute('name') || 'username',
          passwordField: passwordInput?.getAttribute('name') || 'password',
          captchaField: captchaInput?.getAttribute('name') || 'captchaStr',
          captchaImageBase64: captchaImg?.getAttribute('src') || '',
          usesBuiltInCaptcha: !htmlString.includes('g-recaptcha-response'),
        },
        warnings
      )
    : {
        action: form.getAttribute('action') || '/vtop/login',
        csrfToken,
        usernameField: usernameInput?.getAttribute('name') || 'username',
        passwordField: passwordInput?.getAttribute('name') || 'password',
        captchaField: captchaInput?.getAttribute('name') || 'captchaStr',
        captchaImageBase64: captchaImg?.getAttribute('src') || '',
        usesBuiltInCaptcha: !htmlString.includes('g-recaptcha-response'),
      };
}

/** Extract the CAPTCHA image (data URI) from the /vtop/get/new/captcha fragment. */
export function parseCaptchaFragmentHtml(htmlString: string): string {
  const doc = parseDocument(htmlString);
  const img = doc.querySelector('img[src^="data:image"]');
  return img?.getAttribute('src') || '';
}

/**
 * Login failures redirect to /vtop/login/error which re-renders the login form
 * with an "Invalid Captcha" message. Returns true when the page is a login
 * failure page.
 */
export function isLoginErrorPage(htmlString: string): boolean {
  const lower = htmlString.toLowerCase();
  const hasMarker = lower.includes('invalid captcha');
  const hasForm = htmlString.includes('vtopLoginForm');
  const hasRedirect = lower.includes('/login/error');
  return hasMarker || (hasForm && hasRedirect);
}

/** True when the page is a role chooser (pre-flag) login landing page. */
export function isRoleChooserPage(htmlString: string): boolean {
  return parseRoleChooserHtml(htmlString) !== null && !htmlString.includes('vtopLoginForm');
}

export { isLikelyLoginPage };
