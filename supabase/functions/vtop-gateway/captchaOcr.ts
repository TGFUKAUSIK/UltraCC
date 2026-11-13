/**
 * captchaOcr.ts — reads VTOP's login CAPTCHA on the server.
 *
 * The recognition itself is `captchaTemplate.ts`, the same single engine the
 * browser uses (Vite imports it out of this directory, so the two clients
 * cannot drift). What is gateway-only is getting the image to pixels:
 *
 *   - In a browser the CAPTCHA is painted onto a canvas and read back.
 *   - There is no canvas here, so the base64 JPEG VTOP embeds in the login form
 *     is decoded directly. VTOP's CAPTCHA is a 200×40 baseline JPEG — verified
 *     against a live capture, and the geometry the template expects.
 *
 * Why the server does this at all: the web app can run tesseract.js as a
 * second opinion, but tesseract is a Web Worker over WASM and cannot run inside
 * React Native. Solving here means the phone app logs in with the same
 * automatic CAPTCHA the web app has, with no image decoding, weights or
 * 400 KB of bitmaps shipped to the device.
 *
 * Failure is always `{ text: '', confidence: 0 }`. Callers treat that as "no
 * prediction" and the student types the code, so a decode problem can never
 * block a login.
 */

import {
  downscaleToTemplate,
  predictCaptchaWithConfidence,
  TEMPLATE_HEIGHT,
  TEMPLATE_WIDTH,
} from './captchaTemplate.ts';

export interface CaptchaPrediction {
  text: string;
  confidence: number;
}

/** What to return when nothing could be read: manual entry, no guess. */
export const NO_PREDICTION: CaptchaPrediction = { text: '', confidence: 0 };

/** Whatever shape the platform's JPEG decoder has, this is the part we use. */
export interface DecodedImage {
  data: Uint8Array | Uint8ClampedArray | number[];
  width: number;
  height: number;
}

export type JpegDecoder = (bytes: Uint8Array) => DecodedImage;

/** A CAPTCHA is 200×40. Anything past this is not a CAPTCHA and is not decoded
 *  — a hostile or changed upstream must not be able to size the work. */
const MAX_PIXELS = 2_000_000;

/** Base64 payload of a data URI, or the string itself when it is already bare
 *  base64. VTOP serves `data:image/jpeg;base64,…`; the gateway has also seen a
 *  doubled prefix, so every `data:` header is peeled off before the bytes. */
export function captchaBase64(image: string): string {
  let payload = (image || '').trim();
  for (let guard = 0; guard < 4 && payload.startsWith('data:'); guard++) {
    const comma = payload.indexOf(',');
    if (comma < 0) return '';
    payload = payload.slice(comma + 1);
  }
  return payload.replace(/\s+/g, '');
}

/** base64 → bytes. `atob` exists in Deno and in Node, and neither is allowed to
 *  throw on the ragged tail a truncated response could carry. */
export function decodeBase64(base64: string): Uint8Array | null {
  if (!base64) return null;
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i) & 0xff;
    return bytes;
  } catch {
    return null;
  }
}

/**
 * Read one CAPTCHA image. `decodeJpeg` is injected so this module stays free of
 * platform imports and the real JPEG fixture can be tested against the same
 * code the deployed function runs.
 */
export function solveCaptchaImage(image: string, decodeJpeg: JpegDecoder): CaptchaPrediction {
  const bytes = decodeBase64(captchaBase64(image));
  if (!bytes || bytes.length < 32) return NO_PREDICTION;

  let decoded: DecodedImage;
  try {
    decoded = decodeJpeg(bytes);
  } catch {
    // Not a baseline JPEG, a truncated body, or a format VTOP has moved to.
    return NO_PREDICTION;
  }
  const { width, height } = decoded;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return NO_PREDICTION;
  if (width * height > MAX_PIXELS) return NO_PREDICTION;
  if (!decoded.data || decoded.data.length < width * height * 4) return NO_PREDICTION;

  // Only the CAPTCHA's own geometry (or a clean multiple of it) is worth
  // reading; anything else means VTOP changed the image and a guess would be a
  // coin flip rather than a recognition.
  const isCaptchaShape =
    (width % TEMPLATE_WIDTH === 0 && height % TEMPLATE_HEIGHT === 0 && width / TEMPLATE_WIDTH === height / TEMPLATE_HEIGHT);
  if (!isCaptchaShape) return NO_PREDICTION;

  const pixels = new Uint8ClampedArray(decoded.data as ArrayLike<number>);
  const scaled = downscaleToTemplate(pixels, width, height);
  if (!scaled) return NO_PREDICTION;
  const prediction = predictCaptchaWithConfidence(scaled.data, scaled.width, scaled.height);
  return prediction ? { text: prediction.text, confidence: prediction.confidence } : NO_PREDICTION;
}
