import { describe, it, expect } from 'vitest';
import {
  TEMPLATE_LABELS,
  TEMPLATE_WIDTH,
  TEMPLATE_HEIGHT,
  saturation,
  getImageBlocks,
  binarizeImage,
  matMul,
  matAdd,
  softmax,
  predictCaptcha,
  predictCaptchaWithConfidence,
  downscaleToTemplate,
} from '../templateCaptcha';

/** Build an RGBA pixel buffer of the given size filled with one color. */
function solidPixels(width: number, height: number, rgb: [number, number, number]): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    buf[i * 4] = rgb[0];
    buf[i * 4 + 1] = rgb[1];
    buf[i * 4 + 2] = rgb[2];
    buf[i * 4 + 3] = 255;
  }
  return buf;
}

describe('saturation', () => {
  it('produces one value per pixel', () => {
    const px = solidPixels(10, 10, [255, 0, 0]);
    expect(saturation(px)).toHaveLength(100);
  });

  it('is 0 for pure black and high for pure colors', () => {
    expect(saturation(solidPixels(2, 2, [0, 0, 0]))[0]).toBe(0);
    expect(saturation(solidPixels(2, 2, [255, 0, 0]))[0]).toBe(255);
    // Gray has no saturation
    expect(saturation(solidPixels(2, 2, [128, 128, 128]))[0]).toBe(0);
  });
});

describe('getImageBlocks', () => {
  it('returns null for non-200x40 geometry (VTOP changed the CAPTCHA)', () => {
    expect(getImageBlocks(solidPixels(120, 40, [255, 255, 255]), 120, 40)).toBeNull();
    expect(getImageBlocks(solidPixels(200, 80, [255, 255, 255]), 200, 80)).toBeNull();
  });

  it('splits a 200x40 image into exactly six character blocks', () => {
    const blocks = getImageBlocks(solidPixels(TEMPLATE_WIDTH, TEMPLATE_HEIGHT, [255, 255, 255]), TEMPLATE_WIDTH, TEMPLATE_HEIGHT);
    expect(blocks).not.toBeNull();
    expect(blocks).toHaveLength(6);
    for (const block of blocks!) {
      // Each block has the alternating vertical geometry the solver relies on.
      expect(block.length).toBeGreaterThan(0);
      expect(block.length).toBeLessThanOrEqual(30);
      expect(block[0]!.length).toBe(24);
    }
  });
});

describe('binarizeImage / matMul / matAdd / softmax', () => {
  it('binarizes to 0/1 against the block mean', () => {
    const block = [
      [100, 100],
      [0, 0],
    ];
    const bits = binarizeImage(block);
    expect(bits[0]).toEqual([1, 1]);
    expect(bits[1]).toEqual([0, 0]);
  });

  it('matMul produces the right output dimensions', () => {
    const out = matMul([[1, 2]], [[1, 2, 3], [4, 5, 6]]);
    expect(out).toEqual([[9, 12, 15]]);
  });

  it('matAdd adds elementwise', () => {
    expect(matAdd([1, 2], [10, 20])).toEqual([11, 22]);
  });

  it('softmax outputs probabilities summing to 1', () => {
    const probs = softmax([1, 2, 3]);
    const sum = probs.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
    expect(probs[2]).toBeGreaterThan(probs[0]);
  });
});

describe('predictCaptcha', () => {
  it('returns null for a non-standard geometry', () => {
    expect(predictCaptcha(solidPixels(100, 30, [0, 0, 0]), 100, 30)).toBeNull();
  });

  it('always yields exactly six characters from the valid CAPTCHA alphabet', () => {
    // Even a degenerate input maps to a deterministic 6-char string.
    const text = predictCaptcha(
      solidPixels(TEMPLATE_WIDTH, TEMPLATE_HEIGHT, [255, 255, 255]),
      TEMPLATE_WIDTH,
      TEMPLATE_HEIGHT,
    );
    expect(text).toHaveLength(6);
    for (const ch of text!) {
      expect(TEMPLATE_LABELS).toContain(ch);
    }
  });

  it('returns confidence in [0,1] and a deterministic result', () => {
    const a = predictCaptchaWithConfidence(
      solidPixels(TEMPLATE_WIDTH, TEMPLATE_HEIGHT, [0, 0, 0]),
      TEMPLATE_WIDTH,
      TEMPLATE_HEIGHT,
    );
    const b = predictCaptchaWithConfidence(
      solidPixels(TEMPLATE_WIDTH, TEMPLATE_HEIGHT, [0, 0, 0]),
      TEMPLATE_WIDTH,
      TEMPLATE_HEIGHT,
    );
    expect(a).not.toBeNull();
    expect(a!.text).toHaveLength(6);
    expect(a!.confidence).toBeGreaterThanOrEqual(0);
    expect(a!.confidence).toBeLessThanOrEqual(1);
    expect(a!.text).toBe(b!.text);
  });

  it('exposes per-character confidence alongside the text', () => {
    const pred = predictCaptchaWithConfidence(
      solidPixels(TEMPLATE_WIDTH, TEMPLATE_HEIGHT, [0, 0, 0]),
      TEMPLATE_WIDTH,
      TEMPLATE_HEIGHT,
    );
    expect(pred).not.toBeNull();
    expect(pred!.charConfidences).toHaveLength(6);
    for (const c of pred!.charConfidences) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });
});

describe('downscaleToTemplate', () => {
  it('returns the buffer unchanged when it is already 200×40', () => {
    const px = solidPixels(TEMPLATE_WIDTH, TEMPLATE_HEIGHT, [255, 0, 0]);
    const out = downscaleToTemplate(px, TEMPLATE_WIDTH, TEMPLATE_HEIGHT);
    expect(out).not.toBeNull();
    expect(out!.width).toBe(TEMPLATE_WIDTH);
    expect(out!.height).toBe(TEMPLATE_HEIGHT);
    expect(out!.data).toBe(px);
  });

  it('downscales an exact 2× image back to 200×40 by nearest-neighbour', () => {
    const w = TEMPLATE_WIDTH;
    const h = TEMPLATE_HEIGHT;
    const src = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      src[i * 4] = (i * 7) % 256;
      src[i * 4 + 1] = (i * 13) % 256;
      src[i * 4 + 2] = (i * 29) % 256;
      src[i * 4 + 3] = 255;
    }
    // 2× nearest-neighbour expansion of the source.
    const big = new Uint8ClampedArray(w * 2 * h * 2 * 4);
    for (let y = 0; y < h * 2; y++) {
      for (let x = 0; x < w * 2; x++) {
        const si = (Math.floor(y / 2) * w + Math.floor(x / 2)) * 4;
        const bi = (y * (w * 2) + x) * 4;
        big[bi] = src[si]!;
        big[bi + 1] = src[si + 1]!;
        big[bi + 2] = src[si + 2]!;
        big[bi + 3] = src[si + 3]!;
      }
    }
    const out = downscaleToTemplate(big, w * 2, h * 2);
    expect(out).not.toBeNull();
    expect(out!.width).toBe(TEMPLATE_WIDTH);
    expect(out!.height).toBe(TEMPLATE_HEIGHT);
    expect(Array.from(out!.data)).toEqual(Array.from(src));
  });

  it('rejects non-integer or non-uniform scales', () => {
    expect(downscaleToTemplate(solidPixels(300, 40, [0, 0, 0]), 300, 40)).toBeNull();
    expect(downscaleToTemplate(solidPixels(400, 40, [0, 0, 0]), 400, 40)).toBeNull();
    expect(downscaleToTemplate(solidPixels(400, 80, [0, 0, 0]), 400, 80)).not.toBeNull();
  });
});
