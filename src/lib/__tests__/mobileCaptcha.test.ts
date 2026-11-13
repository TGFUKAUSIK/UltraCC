/**
 * The mobile sign-in screen has no CAPTCHA reader of its own: vtop-gateway reads
 * the image and the app decides what to trust. That decision has to be the same
 * decision the web app makes, or the same student gets an automatic code in one
 * client and a typed one in the other — and, worse, an unsafe guess somewhere.
 *
 * `autoFillCaptcha` lives in mobile/src/lib/captcha.ts and is imported directly
 * (the same way eventPoster.test.ts reads the mobile poster helper), so a change
 * to either client is checked here rather than discovered on a phone.
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { autoFillCaptcha, MIN_AUTO_FILL_CONFIDENCE } from '../../../mobile/src/lib/captcha';

const ROOT = resolve(__dirname, '../../..');

/** A reading at or above the floor is worth pre-filling. */
const SAFE = { captchaText: '86ZJYD', captchaConfidence: 0.947 };

describe('the mobile app only auto-fills a CAPTCHA the web app would trust', () => {
  it('pre-fills a confident reading', () => {
    expect(autoFillCaptcha(SAFE)).toBe('86ZJYD');
    expect(autoFillCaptcha({ captchaText: 'AB23CD', captchaConfidence: MIN_AUTO_FILL_CONFIDENCE })).toBe('AB23CD');
  });

  it('leaves the box empty below the floor, and when there is no reading', () => {
    expect(autoFillCaptcha({ captchaText: 'AB23CD', captchaConfidence: MIN_AUTO_FILL_CONFIDENCE - 0.001 })).toBe('');
    expect(autoFillCaptcha({ captchaText: '', captchaConfidence: 1 })).toBe('');
    expect(autoFillCaptcha({ captchaText: '   ', captchaConfidence: 1 })).toBe('');
    expect(autoFillCaptcha({})).toBe('');
    expect(autoFillCaptcha({ captchaText: 'AB23CD', captchaConfidence: undefined })).toBe('');
  });

  it('trims the code it hands to the form', () => {
    expect(autoFillCaptcha({ captchaText: '  86ZJYD  ', captchaConfidence: 0.9 })).toBe('86ZJYD');
  });

  it('uses the same confidence floor as the web login', () => {
    // The floor moved out of ExtensionSyncModal into the shared auto-sign-in
    // policy when a manual refresh began signing in silently with the same
    // reader; the assertion is unchanged, only where the constant lives. See
    // src/lib/vtop/autoSignIn.ts.
    const webCopy = readFileSync(join(ROOT, 'src/lib/vtop/autoSignIn.ts'), 'utf8');
    const match = webCopy.match(/MIN_AUTO_SUBMIT_CONFIDENCE\s*=\s*([0-9.]+)/);
    expect(match, 'the web app must keep its named confidence floor').not.toBeNull();
    expect(Number(match?.[1])).toBe(MIN_AUTO_FILL_CONFIDENCE);
  });
});
