/**
 * Template-matching CAPTCHA solver — browser-based local recognition for
 * VTOP's default 6-character CAPTCHA.
 *
 * The network is a single trained layer: the 200×40 CAPTCHA is split into six
 * fixed 25px-wide character blocks (with VTOP's alternating vertical offset),
 * each block is binarized to a 0/1 vector, and a 529→32 softmax layer maps it
 * to one of the 32 CAPTCHA characters. The trained weights/biases live in
 * `captchaBitmaps.ts`.
 *
 * This runs 100% locally — the CAPTCHA image never leaves the device, nothing
 * is sent to any external OCR or CAPTCHA-solving service. The result is a
 * SUGGESTION that prefills the field; the student reviews/submits it.
 *
 * If the image is not VTOP's standard 200×40 geometry (VTOP changed the
 * CAPTCHA), the solver returns null and the caller falls back to the
 * tesseract.js pipeline or manual entry.
 */

import { bitmaps } from './captchaBitmaps.ts';

/** The 32 CAPTCHA characters (no I/O/0/1 — VTOP never uses them). */
export const TEMPLATE_LABELS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const TEMPLATE_WIDTH = 200;
export const TEMPLATE_HEIGHT = 40;

type Matrix = number[][];

/**
 * Per-pixel "saturation" used to separate ink from the background.
 * Purely local color math — no DOM involved, unit-testable.
 */
export function saturation(pixelData: Uint8ClampedArray): number[] {
  const out = new Array<number>(pixelData.length / 4);
  for (let i = 0; i < pixelData.length; i += 4) {
    const r = pixelData[i]!;
    const g = pixelData[i + 1]!;
    const b = pixelData[i + 2]!;
    const min = Math.min(r, g, b);
    const max = Math.max(r, g, b);
    out[i / 4] = max === 0 ? 0 : Math.round(((max - min) * 255) / max);
  }
  return out;
}

/**
 * Split the 200×40 saturation map into the six fixed character blocks using
 * VTOP's alternating vertical offset. Returns null when the image is not
 * VTOP's geometry.
 */
export function getImageBlocks(
  pixelData: Uint8ClampedArray,
  width: number,
  height: number,
): Matrix[] | null {
  if (width !== TEMPLATE_WIDTH || height !== TEMPLATE_HEIGHT) return null;

  const saturate = saturation(pixelData);
  const img: Matrix = Array.from({ length: TEMPLATE_HEIGHT }, () =>
    Array(TEMPLATE_WIDTH).fill(0),
  );
  for (let i = 0; i < TEMPLATE_HEIGHT; i++) {
    for (let j = 0; j < TEMPLATE_WIDTH; j++) {
      img[i]![j] = saturate[i * TEMPLATE_WIDTH + j] ?? 0;
    }
  }

  const blocks: Matrix[] = new Array(6);
  for (let i = 0; i < 6; i++) {
    const x1 = (i + 1) * 25 + 2;
    const y1 = 7 + 5 * (i % 2) + 1;
    const x2 = (i + 2) * 25 + 1;
    const y2 = 35 - 5 * ((i + 1) % 2);
    blocks[i] = img.slice(y1, y2).map((row) => row.slice(x1, x2));
  }
  return blocks;
}

/** Binarize one character block: 1 = above the block's mean, 0 = below. */
export function binarizeImage(charImg: Matrix): Matrix {
  let avg = 0;
  charImg.forEach((row) => row.forEach((pixel) => (avg += pixel)));
  const cols = charImg[0]?.length ?? 0;
  avg /= charImg.length * cols || 1;
  return charImg.map((row) =>
    row.map((pixel) => ((pixel ?? 0) > avg ? 1 : 0)),
  );
}

export function matMul(a: Matrix, b: Matrix): Matrix {
  const x = a.length;
  const z = a[0]?.length ?? 0;
  const y = b[0]?.length ?? 0;
  const product: Matrix = Array.from({ length: x }, () => Array(y).fill(0));
  for (let i = 0; i < x; i++) {
    for (let j = 0; j < y; j++) {
      let sum = 0;
      for (let k = 0; k < z; k++) {
        sum += (a[i]![k] ?? 0) * (b[k]![j] ?? 0);
      }
      product[i]![j] = sum;
    }
  }
  return product;
}

export function matAdd(a: number[], b: number[]): number[] {
  return a.map((val, i) => val + (b[i] ?? 0));
}

export function softmax(vec: number[]): number[] {
  const exps = vec.map((x) => Math.exp(x));
  const sumExps = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sumExps);
}

export interface TemplatePrediction {
  text: string;
  /** Mean softmax confidence across the six character blocks (0..1). */
  confidence: number;
  /**
   * Per-character softmax confidence (0..1), aligned with `text`. A single
   * low-confidence character usually means that ONE glyph was misread even
   * though the mean looks fine — the caller can use this to decide whether the
   * whole read is trustworthy or to cross-check against another solver.
   */
  charConfidences: number[];
}

/**
 * Full prediction pipeline over raw pixels (no DOM). Returns the 6-character
 * CAPTCHA guess plus the mean per-character softmax confidence, or null when
 * the geometry is not VTOP's standard 200×40. Deterministic and testable
 * without a canvas.
 */
export function predictCaptchaWithConfidence(
  pixelData: Uint8ClampedArray,
  width: number,
  height: number,
): TemplatePrediction | null {
  const blocks = getImageBlocks(pixelData, width, height);
  if (!blocks) return null;

  let result = '';
  let confidenceSum = 0;
  const charConfidences: number[] = [];
  for (const block of blocks) {
    const inputVector = [binarizeImage(block).flat()];
    const output = matMul(inputVector, bitmaps.weights);
    const logits = matAdd(output[0] ?? [], bitmaps.biases);
    const probabilities = softmax(logits);
    const maxProbIndex = probabilities.indexOf(Math.max(...probabilities));
    const charConf = probabilities[maxProbIndex] ?? 0;
    result += TEMPLATE_LABELS[maxProbIndex] ?? '';
    confidenceSum += charConf;
    charConfidences.push(charConf);
  }
  return { text: result, confidence: confidenceSum / 6, charConfidences };
}

/** Convenience wrapper returning just the text (kept for tests). */
export function predictCaptcha(
  pixelData: Uint8ClampedArray,
  width: number,
  height: number,
): string | null {
  return predictCaptchaWithConfidence(pixelData, width, height)?.text ?? null;
}

/** Load a CAPTCHA data URL into raw RGBA pixels. Returns null on failure. */
export function loadImageToPixels(
  dataUrl: string,
): Promise<{ data: Uint8ClampedArray; width: number; height: number } | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined' || !dataUrl) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0);
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        resolve({ data, width: canvas.width, height: canvas.height });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

/**
 * Downscale a pixel buffer to the template network's 200×40 geometry using
 * nearest-neighbour sampling, but ONLY when the source is an exact integer
 * multiple (2×, 3×, …) of that size. Nearest-neighbour is deliberate: the
 * template separates ink by colour saturation, and averaging a coloured glyph
 * with its white background would wash the saturation to grey and erase the
 * signal. This lets the fast deterministic solver still fire when VTOP serves
 * the same CAPTCHA at a retina/2× size instead of giving up and paying for a
 * full tesseract pass.
 */
export function downscaleToTemplate(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): { data: Uint8ClampedArray; width: number; height: number } | null {
  if (width === TEMPLATE_WIDTH && height === TEMPLATE_HEIGHT) {
    return { data, width, height };
  }
  const sx = width / TEMPLATE_WIDTH;
  const sy = height / TEMPLATE_HEIGHT;
  if (!Number.isInteger(sx) || !Number.isInteger(sy) || sx !== sy || sx < 2) {
    return null;
  }
  const f = sx;
  const out = new Uint8ClampedArray(TEMPLATE_WIDTH * TEMPLATE_HEIGHT * 4);
  for (let y = 0; y < TEMPLATE_HEIGHT; y++) {
    for (let x = 0; x < TEMPLATE_WIDTH; x++) {
      const si = ((y * f) * width + (x * f)) * 4;
      const oi = (y * TEMPLATE_WIDTH + x) * 4;
      out[oi] = data[si]!;
      out[oi + 1] = data[si + 1]!;
      out[oi + 2] = data[si + 2]!;
      out[oi + 3] = data[si + 3]!;
    }
  }
  return { data: out, width: TEMPLATE_WIDTH, height: TEMPLATE_HEIGHT };
}

/**
 * Solve a VTOP CAPTCHA image with the template network. Returns the guess
 * plus confidence, or null when the image isn't the supported geometry (or an
 * integer scale of it) or pixels can't be read (caller then falls back to
 * tesseract / manual entry).
 */
export async function solveTemplateCaptcha(
  dataUrl: string,
): Promise<TemplatePrediction | null> {
  const pixels = await loadImageToPixels(dataUrl);
  if (!pixels) return null;
  const scaled = downscaleToTemplate(pixels.data, pixels.width, pixels.height);
  if (!scaled) return null;
  return predictCaptchaWithConfidence(scaled.data, scaled.width, scaled.height);
}
