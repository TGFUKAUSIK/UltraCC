import { describe, it, expect } from 'vitest';
import {
  realLoginFormHtml,
  realRoleChooserHtml,
  realCaptchaFragmentHtml,
  realLoginErrorExcerptHtml,
} from '../__fixtures__/realLoginFixtures';
import {
  parseLoginFormHtml,
  parseRoleChooserHtml,
  parseCaptchaFragmentHtml,
  isLoginErrorPage,
  isRoleChooserPage,
} from '../parsers/login';
import { loginPageHtml } from '../__fixtures__';

/**
 * These tests run against SANITIZED REAL HTML captured from vtopcc.vit.ac.in
 * (2026-08-10). If VTOP changes its login structure, these will fail and the
 * parsers + extension bridge must be updated.
 */
describe('login parsers against REAL VTOP HTML', () => {
  it('extracts the real student login form fields from the live page', () => {
    const form = parseLoginFormHtml(realLoginFormHtml);
    expect(form).not.toBeNull();
    expect(form!.action).toBe('/vtop/login');
    expect(form!.usernameField).toBe('username');
    expect(form!.passwordField).toBe('password');
    expect(form!.captchaField).toBe('captchaStr');
    // Redacted in the fixture but the parser must still surface it as present.
    expect(form!.csrfToken).toContain('REDACTED');
    // The real page embeds the CAPTCHA as a base64 data URI in #captchaBlock.
    expect(form!.captchaImageBase64.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(form!.usesBuiltInCaptcha).toBe(true);
  });

  it('detects the role chooser and its flag values', () => {
    const chooser = parseRoleChooserHtml(realRoleChooserHtml);
    expect(chooser).not.toBeNull();
    expect(chooser!.flags).toContain('VTOP');
    expect(chooser!.csrfToken).toContain('REDACTED');
    expect(isRoleChooserPage(realRoleChooserHtml)).toBe(true);
    expect(isRoleChooserPage(realLoginFormHtml)).toBe(false);
  });

  it('extracts the captcha image from the /vtop/get/new/captcha fragment', () => {
    const dataUri = parseCaptchaFragmentHtml(realCaptchaFragmentHtml);
    expect(dataUri.startsWith('data:image/jpeg;base64,')).toBe(true);
  });

  it('detects the login error page (invalid captcha / re-rendered form)', () => {
    expect(isLoginErrorPage(realLoginErrorExcerptHtml)).toBe(true);
    expect(isLoginErrorPage(realLoginFormHtml)).toBe(false);
  });

  it('returns null for pages without the login form', () => {
    const outcome = parseLoginFormHtml(loginPageHtml, true);
    expect(outcome.data).toBeNull();
    expect(outcome.structuralMismatch).toBe(true);
    expect(outcome.warnings.some((w) => w.code === 'login-form-missing')).toBe(true);
  });
});
