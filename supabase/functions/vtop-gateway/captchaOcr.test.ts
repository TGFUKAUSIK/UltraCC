/**
 * The gateway's CAPTCHA reader, tested against a CAPTCHA VTOP actually served.
 *
 * `src/lib/vtop/__fixtures__/vtop-captcha-86zjyd.jpg` is a live capture from
 * `GET /vtop/get/new/captcha` (200×40 baseline JPEG, 3 components), and the
 * code on it was read by eye before it was committed. That matters because
 * every other test in this area feeds the solver a synthetic pixel buffer: a
 * synthetic buffer proves the arithmetic, but only a real VTOP image proves the
 * whole server path — data URI → base64 → JPEG decode → geometry → template —
 * still lands on what a student sees on screen.
 *
 * The rest of the file is the promise that a failure is silent and safe: any
 * image the reader cannot trust yields no prediction, so the student types the
 * code instead of the app burning a single-use CAPTCHA on a guess.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decode } from 'jpeg-js';
import {
  captchaBase64,
  decodeBase64,
  NO_PREDICTION,
  solveCaptchaImage,
} from './captchaOcr';

const JPEG = readFileSync(resolve(__dirname, '../../../src/lib/vtop/__fixtures__/vtop-captcha-86zjyd.jpg'));
const BASE64 = JPEG.toString('base64');
const DATA_URI = `data:image/jpeg;base64,${BASE64}`;

const decodeJpeg = (bytes: Uint8Array) => decode(bytes, true);

describe('solveCaptchaImage on a real VTOP CAPTCHA', () => {
  it('reads the code a student would type', () => {
    const prediction = solveCaptchaImage(DATA_URI, decodeJpeg);
    expect(prediction.text).toBe('86ZJYD');
  });

  it('is confident enough to submit automatically', () => {
    // The web client's own auto-submit floor is 0.5; a real capture must clear
    // it by a wide margin or the phone gets no better than a coin flip.
    const prediction = solveCaptchaImage(DATA_URI, decodeJpeg);
    expect(prediction.confidence).toBeGreaterThan(0.9);
  });

  it('accepts the bare base64 body too', () => {
    expect(solveCaptchaImage(BASE64, decodeJpeg).text).toBe('86ZJYD');
  });
});

describe('solveCaptchaImage refuses to guess', () => {
  it('returns no prediction for an empty or unusable image', () => {
    expect(solveCaptchaImage('', decodeJpeg)).toEqual(NO_PREDICTION);
    expect(solveCaptchaImage('data:image/jpeg;base64,', decodeJpeg)).toEqual(NO_PREDICTION);
    expect(solveCaptchaImage('not base64 at all!!!', decodeJpeg)).toEqual(NO_PREDICTION);
  });

  it('returns no prediction for bytes that are not a JPEG', () => {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
    expect(solveCaptchaImage(`data:image/png;base64,${png}`, decodeJpeg)).toEqual(NO_PREDICTION);
  });

  it('returns no prediction when the decoder throws', () => {
    expect(solveCaptchaImage(DATA_URI, () => { throw new Error('progressive JPEG'); })).toEqual(NO_PREDICTION);
  });

  it('returns no prediction for an image that is not CAPTCHA geometry', () => {
    // A decoder that answers with something else means VTOP changed the image,
    // and the template would be matching noise.
    const wrongShape = { data: new Uint8Array(320 * 40 * 4), width: 320, height: 40 };
    expect(solveCaptchaImage(DATA_URI, () => wrongShape)).toEqual(NO_PREDICTION);
  });

  it('refuses an absurdly large decode instead of working through it', () => {
    const huge = { data: [], width: 5000, height: 5000 };
    expect(solveCaptchaImage(DATA_URI, () => huge)).toEqual(NO_PREDICTION);
  });
});

describe('captchaBase64', () => {
  it('takes the payload after the data-URI prefix, even a doubled one', () => {
    // Seen in the wild once: the prefix applied twice. Peeling every `data:`
    // header keeps the bytes intact instead of feeding the decoder a string
    // that starts with text.
    expect(captchaBase64(`data:image/jpeg;base64,data:image/jpeg;base64,${BASE64}`)).toBe(BASE64);
  });

  it('strips the newlines VTOP wraps its fragments in', () => {
    const wrapped = `${BASE64.slice(0, 40)}\n  ${BASE64.slice(40)}`;
    expect(captchaBase64(wrapped)).toBe(BASE64);
    expect(solveCaptchaImage(`data:image/jpeg;base64,${wrapped}`, decodeJpeg).text).toBe('86ZJYD');
  });
});

describe('decodeBase64', () => {
  it('round-trips the fixture bytes', () => {
    const bytes = decodeBase64(BASE64);
    expect(bytes).not.toBeNull();
    expect(Array.from(bytes!.subarray(0, 3))).toEqual([0xff, 0xd8, 0xff]);
    expect(bytes!.length).toBe(JPEG.length);
  });

  it('returns null instead of throwing on ragged input', () => {
    expect(decodeBase64('')).toBeNull();
    expect(decodeBase64('!!!!')).toBeNull();
  });
});
