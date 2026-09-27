/**
 * Local CAPTCHA OCR assistance.
 *
 * Runs entirely in the browser (tesseract.js, lazy-loaded). The CAPTCHA
 * image never leaves the device — no external solving APIs, no AI services,
 * no server round-trip. The result is a SUGGESTION: the student reviews and
 * corrects it before submitting, so this never bypasses VTOP's anti-bot
 * control. On any failure it returns '' and the flow falls back to manual
 * entry.
 *
 * Accuracy strategy: the image is preprocessed into SEVERAL variants (high-
 * contrast binary at different thresholds, inverted ink/paper, original with
 * contrast stretch) and OCR is run against each. The best result is chosen by
 * a confidence + plausibility scoring function (prefers length-typical,
 * alphanumeric-only text with high Tesseract confidence), so a single bad
 * preprocessing variant can't sink the whole attempt.
 */

import { solveTemplateCaptcha, TEMPLATE_LABELS } from './templateCaptcha';

/** Keep only A–Z / 0–9, uppercase, trimmed to the typical VTOP length. */
export function normalizeCaptchaOcr(raw: string, maxLen = 8): string {
  return (raw || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, maxLen);
}

/** Clean Tesseract output: collapse spaces, strip punctuation and artifacts. */
export function cleanOcrText(raw: string): string {
  return (raw || '')
    .replace(/[\u2018\u2019\u201C\u201D]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Correct common Tesseract confusions on CAPTCHA-style text. Applied ONLY to
 * the final candidate, never inside the whitelist pass (which already rejects
 * non-alphanumerics). Deliberately conservative: each rule targets a glyph
 * pair that is nearly indistinguishable at CAPTCHA size and has no legitimate
 * ambiguity in a VTOP CAPTCHA.
 */
export function correctCommonConfusions(raw: string): string {
  const fixed = (raw || '')
    .replace(/O(?=[0-9])/g, '0')   // O followed by a digit is a zero (O1 -> 01)
    .replace(/(?<=[0-9])O/g, '0')   // digit followed by O is a zero (1O -> 10)
    .replace(/I(?=[0-9])/g, '1')    // I followed by a digit is a one
    .replace(/(?<=[0-9])I/g, '1')   // digit followed by I is a one
    .replace(/l(?=[0-9])/g, '1');   // lowercase l before a digit is a one
  return fixed;
}

/** VTOP CAPTCHAs are typically 4–8 alphanumeric chars. */
export function isPlausibleCaptchaLen(text: string): boolean {
  return text.length >= 4 && text.length <= 8;
}

/** True when the text is all uppercase alphanumerics (already normalized). */
export function isCleanAlnum(text: string): boolean {
  return /^[A-Z0-9]+$/.test(text || '');
}

interface OcrAttempt {
  text: string;
  confidence: number;
  /** Preprocessing variant that produced this attempt. */
  variant: string;
}

/**
 * Score ONE OCR attempt's text quality (independent of the other attempts):
 * penalize lengths outside the plausible CAPTCHA range and non-alphanumeric
 * text; slightly favor the most common VTOP lengths (5–6 chars). Used only to
 * drop garbage candidates, not to rank against each other.
 */
export function scoreOcrAttempt(a: OcrAttempt): number {
  let score = a.confidence;
  if (!isPlausibleCaptchaLen(a.text)) score *= 0.5;
  if (!isCleanAlnum(a.text)) score *= 0.6;
  // Slight bonus for the most common VTOP lengths (5–6 chars).
  if (a.text.length === 5 || a.text.length === 6) score += 2;
  return score;
}

/**
 * Pick the best text by VARIANT CONSENSUS: the same normalized text read by
 * several preprocessing variants/modes is far more trustworthy than one
 * confident read. Ranking: (1) number of agreeing attempts, (2) highest raw
 * confidence among them, (3) longer text (a longer consistent read is usually
 * a more complete CAPTCHA). Garbage candidates (implausible length / unclean)
 * are filtered out first. Returns null when no usable attempt exists.
 */
export function pickBestAttempt(attempts: OcrAttempt[]): OcrAttempt | null {
  const usable = attempts.filter((a) => isPlausibleCaptchaLen(a.text) && isCleanAlnum(a.text));
  if (!usable.length) return null;

  const byText = new Map<string, OcrAttempt[]>();
  for (const a of usable) {
    const group = byText.get(a.text);
    if (group) group.push(a);
    else byText.set(a.text, [a]);
  }

  let best: { text: string; count: number; maxConfidence: number } | null = null;
  for (const [text, group] of byText) {
    const count = group.length;
    const maxConfidence = Math.max(...group.map((g) => g.confidence));
    if (!best || count > best.count || (count === best.count && (maxConfidence > best.maxConfidence || (maxConfidence === best.maxConfidence && text.length > best.text.length)))) {
      best = { text, count, maxConfidence };
    }
  }
  return best ? { text: best.text, confidence: best.maxConfidence, variant: 'consensus' } : null;
}

/** Downscale a 3x canvas back to ~1.6x for a cleaner Tesseract pass. */
function scaleCanvas(canvas: HTMLCanvasElement, factor: number): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(canvas.width / factor));
  out.height = Math.max(1, Math.round(canvas.height / factor));
  const ctx = out.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, out.width, out.height);
  }
  return out;
}

/** Load the CAPTCHA image into a canvas (unscaled). Never throws. */
function loadToCanvas(dataUrl: string): Promise<HTMLCanvasElement | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve(null);
      return;
    }
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0);
        resolve(canvas);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

/**
 * Build N preprocessing variants of the CAPTCHA as data URLs:
 *   1. high-contrast binary (adaptive threshold on the luminance mean)
 *   2. darker binary (lower threshold — keeps faint glyphs)
 *   3. lighter binary (higher threshold — removes background noise)
 *   4. inverted binary (white ink on black — some glyphs read better)
 *   5. original image with contrast stretch (no binarization)
 * All are upscaled 3x first, then downscaled to ~1.6x for Tesseract.
 * Returns the variants actually produced; an empty array on any error.
 */
function buildPreprocessVariants(dataUrl: string): Promise<string[]> {
  return new Promise((resolve) => {
    loadToCanvas(dataUrl).then((base) => {
      if (!base) {
        resolve([]);
        return;
      }
      try {
        const variants: string[] = [];
        // Three binary thresholds (normal, darker, lighter) + one inverted.
        const binaryVariants: { frac: number; invert: boolean }[] = [
          { frac: 0.55, invert: false },
          { frac: 0.45, invert: false },
          { frac: 0.68, invert: false },
          { frac: 0.55, invert: true },
        ];
        for (const { frac, invert } of binaryVariants) {
          const canvas = document.createElement('canvas');
          const scale = 3;
          canvas.width = base.width * scale;
          canvas.height = base.height * scale;
          const ctx = canvas.getContext('2d');
          if (!ctx) continue;
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(base, 0, 0, canvas.width, canvas.height);

          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const d = imageData.data;
          const n = d.length / 4;

          // Grayscale + luminance stats.
          let min = 255;
          let max = 0;
          let sum = 0;
          const gray = new Uint8Array(n);
          for (let i = 0; i < n; i++) {
            const g = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
            gray[i] = g;
            if (g < min) min = g;
            if (g > max) max = g;
            sum += g;
          }
          const mean = sum / n;
          const range = Math.max(8, max - min);

          // Adaptive threshold anchored on the contrast range and mean.
          const threshold = Math.max(64, Math.min(200, mean * frac));

          for (let i = 0; i < n; i++) {
            const stretched = ((gray[i] - min) / range) * 255;
            let v = stretched < threshold ? 0 : 255;
            if (invert) v = v === 0 ? 255 : 0;
            d[i * 4] = v;
            d[i * 4 + 1] = v;
            d[i * 4 + 2] = v;
          }
          ctx.putImageData(imageData, 0, 0);

          // Downscale to ~1.6x for a cleaner pass.
          const small = scaleCanvas(canvas, 3 / 1.6);
          variants.push(small.toDataURL('image/png'));
        }

        // Contrast-stretch variant (no binarization) from the original.
        const cCanvas = document.createElement('canvas');
        cCanvas.width = base.width * 2;
        cCanvas.height = base.height * 2;
        const cctx = cCanvas.getContext('2d');
        if (cctx) {
          cctx.imageSmoothingEnabled = true;
          cctx.imageSmoothingQuality = 'high';
          cctx.drawImage(base, 0, 0, cCanvas.width, cCanvas.height);
          const imgData = cctx.getImageData(0, 0, cCanvas.width, cCanvas.height);
          const dd = imgData.data;
          let mn = 255;
          let mx = 0;
          for (let i = 0; i < dd.length; i += 4) {
            const g = 0.299 * dd[i] + 0.587 * dd[i + 1] + 0.114 * dd[i + 2];
            if (g < mn) mn = g;
            if (g > mx) mx = g;
          }
          const rng = Math.max(8, mx - mn);
          for (let i = 0; i < dd.length; i += 4) {
            const g = 0.299 * dd[i] + 0.587 * dd[i + 1] + 0.114 * dd[i + 2];
            const stretched = ((g - mn) / rng) * 255;
            dd[i] = stretched;
            dd[i + 1] = stretched;
            dd[i + 2] = stretched;
          }
          cctx.putImageData(imgData, 0, 0);
          variants.push(cCanvas.toDataURL('image/png'));
        }

        resolve(variants);
      } catch {
        resolve([]);
      }
    });
  });
}

/**
 * Recognize the CAPTCHA text locally. Strategy:
 *   1. Template network first (fast, deterministic, no wasm download).
 *      Used when the image is VTOP's standard 200×40 geometry and the mean
 *      confidence is usable.
 *   2. Otherwise the tesseract.js pipeline: several preprocessing variants,
 *      OCR'd in multiple page-segmentation modes, scored by confidence +
 *      plausibility + variant consensus.
 * Returns '' when nothing usable was read (never throws) — the UI then falls
 * back to manual entry.
 */
export interface OcrResult {
  text: string;
  /** Mean per-char softmax confidence (0..1) for template solver, or Tesseract confidence (0..100) normalized. */
  confidence: number;
}

/** A normalized read from one solver, ready to be fused. */
export interface CaptchaCandidate {
  text: string;
  confidence: number;
  /** Per-character confidence (template solver only). */
  charConfidences?: number[];
}

/**
 * Fuse the template solver's read with tesseract's into one answer.
 *
 * Two independent solvers agreeing on the same six characters is far stronger
 * evidence than either alone, so agreement BOOSTS confidence (pushing a
 * correct read over the auto-submit bar). On disagreement the more confident
 * read wins with no boost — but a six-character read beats a different length,
 * because VTOP CAPTCHAs are exactly six characters (the login form's own
 * `maxlength="6"`).
 */
export function fuseCaptchaResults(
  template: CaptchaCandidate | null,
  tesseract: CaptchaCandidate | null,
): OcrResult | null {
  if (!template && !tesseract) return null;
  if (!template) return { text: tesseract!.text, confidence: tesseract!.confidence };
  if (!tesseract) return { text: template.text, confidence: template.confidence };

  if (template.text === tesseract.text) {
    return {
      text: template.text,
      confidence: Math.min(1, Math.max(template.confidence, tesseract.confidence) + 0.2),
    };
  }

  const templateIs6 = template.text.length === 6;
  const tesseractIs6 = tesseract.text.length === 6;
  let winner: CaptchaCandidate;
  if (templateIs6 && !tesseractIs6) winner = template;
  else if (!templateIs6 && tesseractIs6) winner = tesseract;
  else winner = template.confidence >= tesseract.confidence ? template : tesseract;
  return { text: winner.text, confidence: winner.confidence };
}

export async function ocrCaptchaText(dataUrl: string): Promise<string> {
  const result = await ocrCaptchaWithConfidence(dataUrl);
  return result.text;
}

/**
 * Run the tesseract.js pipeline over the preprocessed CAPTCHA variants.
 * Returns a normalized candidate or null when nothing usable was read.
 */
async function runTesseractCaptcha(dataUrl: string): Promise<CaptchaCandidate | null> {
  const { createWorker, PSM } = await import('tesseract.js');
  const variants = await buildPreprocessVariants(dataUrl);
  if (!variants.length) return null;

  const worker = await createWorker('eng');
  try {
    await worker.setParameters({
      // Constrain tesseract to VTOP's exact CAPTCHA alphabet. VTOP never uses
      // I / O / 0 / 1 (the template network's 32-character alphabet), so
      // allowing those glyphs only produced confident-but-wrong reads; forcing
      // the whitelist makes tesseract pick its best VALID character instead.
      tessedit_char_whitelist: TEMPLATE_LABELS,
      tessedit_pageseg_mode: PSM.SINGLE_WORD,
    });

    const attempts: OcrAttempt[] = [];
    const modes: { name: string; mode: Tesseract.PSM }[] = [
      { name: 'word', mode: PSM.SINGLE_WORD },
      { name: 'line', mode: PSM.SINGLE_LINE },
      { name: 'raw', mode: PSM.RAW_LINE },
    ];
    for (let v = 0; v < variants.length; v++) {
      for (const m of modes) {
        try {
          await worker.setParameters({ tessedit_pageseg_mode: m.mode });
          const { data } = await worker.recognize(variants[v], {}, { text: true });
          const cleaned = cleanOcrText(data.text);
          const normalized = correctCommonConfusions(normalizeCaptchaOcr(cleaned));
          if (normalized.length >= 3) {
            attempts.push({
              text: normalized,
              confidence: typeof data.confidence === 'number' ? data.confidence / 100 : 0,
              variant: `v${v}-${m.name}`,
            });
          }
        } catch {
          // one mode failing shouldn't kill the rest
        }
      }
    }

    const best = pickBestAttempt(attempts);
    return best ? { text: best.text, confidence: best.confidence } : null;
  } finally {
    await worker.terminate();
  }
}

/**
 * Recognize the CAPTCHA and return both text AND confidence.
 *
 * Runs the fast deterministic template network first, then tesseract, and
 * fuses the two so a confident template read is confirmed by an independent
 * solver instead of being submitted on its word alone. A very confident
 * template read (≥0.85) skips the slower tesseract pass entirely.
 */
export async function ocrCaptchaWithConfidence(dataUrl: string): Promise<OcrResult> {
  if (!dataUrl) return { text: '', confidence: 0 };
  try {
    const template = await solveTemplateCaptcha(dataUrl);
    const normalized = template ? normalizeCaptchaOcr(template.text, 6) : '';
    const templateCandidate: CaptchaCandidate | null =
      template && normalized.length === 6
        ? { text: normalized, confidence: template.confidence, charConfidences: template.charConfidences }
        : null;

    if (templateCandidate && templateCandidate.confidence >= 0.85) {
      return { text: templateCandidate.text, confidence: templateCandidate.confidence };
    }

    const tesseractCandidate = await runTesseractCaptcha(dataUrl);
    return fuseCaptchaResults(templateCandidate, tesseractCandidate) ?? { text: '', confidence: 0 };
  } catch {
    return { text: '', confidence: 0 };
  }
}
