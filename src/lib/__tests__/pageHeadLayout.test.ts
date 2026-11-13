/**
 * The heads and rows that hold a text block beside an action rail.
 *
 * The layout audit at 390px found the same defect three times: a flex row where
 * the rail is `flex: none` and the text block is left with whatever remains.
 *
 *   - the dashboard's "Due next" empty state, where the copy fell to 159px;
 *   - the Q-Bank and LMS mast heads, where the block's note fell to 129px and
 *     168px (231px at 700px) beside a 150-400px action rail;
 *   - a directory row's service line, 102px wide at 320px beside its button.
 *
 * In each case the copy was narrower than a ~43-character line at 11px, so it
 * wrapped into a column instead of reading as a sentence. The fix is one shape,
 * already used by `.uc-dir-head`/`.uc-dir-rail`: the row wraps, the text block
 * keeps a floor, and the rail takes a line of its own when there is no room.
 *
 * This guard keeps that shape — and keeps the hero band (`.uc-dir-mast` and its
 * `.uc-dir-id`) spanning the grid with its own floor, which is the earlier fix
 * for the same collapse. A head that drops its floor or its wrap has to be
 * changed here on purpose.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(join(process.cwd(), 'src', 'index.css'), 'utf8');

interface Block { selector: string; body: string; media: string }

/** Split a selector list on the commas that separate selectors — not on the
 *  commas inside `:is(...)`, `[role="a,b"]` and the like. */
function splitSelectors(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let buf = '';
  for (const ch of list) {
    if (ch === '(' || ch === '[') depth += 1;
    else if (ch === ')' || ch === ']') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(buf.trim());
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts;
}

/** Flat rule blocks, one per selector, with the `@media` context of each. */
function ruleBlocks(css: string): Block[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Block[] = [];
  const stack: string[] = [];
  let buf = '';
  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    if (ch === '{') {
      const selector = buf.trim().replace(/\s+/g, ' ');
      buf = '';
      if (selector.startsWith('@')) {
        stack.push(selector);
        continue;
      }
      let depth = 1;
      let j = i + 1;
      while (j < clean.length && depth > 0) {
        if (clean[j] === '{') depth += 1;
        else if (clean[j] === '}') depth -= 1;
        j += 1;
      }
      const body = clean.slice(i + 1, j - 1);
      for (const one of splitSelectors(selector)) {
        out.push({ selector: one, body, media: stack.join(' ') });
      }
      i = j - 1;
      continue;
    }
    if (ch === '}') {
      stack.pop();
      buf = '';
      continue;
    }
    buf += ch;
  }
  return out;
}

const BLOCKS = ruleBlocks(CSS);
const flat = (selector: string): Block | undefined => BLOCKS.find((b) => b.selector === selector && !b.media);
/** The phone-scoped rule for a selector, inside any `max-width` query. */
const phone = (selector: string): Block[] =>
  BLOCKS.filter((b) => b.selector === selector && /max-width/.test(b.media));

describe('the hero band stays a band', () => {
  it('parses the stylesheet it is guarding', () => {
    expect(BLOCKS.length).toBeGreaterThan(500);
    expect(flat('.uc-dir-mast')).toBeDefined();
    expect(flat('.uc-dir-id')).toBeDefined();
  });

  it('spans the index grid instead of sitting in one column', () => {
    expect(flat('.uc-dir-mast')?.body).toMatch(/grid-column:\s*1 \/ -1/);
  });

  it('keeps the id block\u2019s 320px basis so the actions cannot crowd it', () => {
    expect(flat('.uc-dir-id')?.body).toMatch(/flex:\s*1 1 320px/);
    expect(flat('.uc-dir-head')?.body).toMatch(/flex-wrap:\s*wrap/);
    expect(flat('.uc-dir-rail')?.body).toMatch(/flex:\s*1 0 100%/);
  });
});

describe('a mast head wraps its action rail on a phone', () => {
  it('wraps the Q-Bank and LMS heads', () => {
    const qb = phone('.uc-qb-mast .uc-plate-head');
    const lms = phone('.uc-lms-mast .uc-plate-head');
    expect(qb.length).toBeGreaterThan(0);
    expect(lms.length).toBeGreaterThan(0);
    expect(qb.every((b) => /flex-wrap:\s*wrap/.test(b.body))).toBe(true);
    expect(lms.every((b) => /flex-wrap:\s*wrap/.test(b.body))).toBe(true);
  });

  it('gives each mast block a 240px floor at that width', () => {
    for (const selector of ['.uc-qb-mast .uc-qb-id', '.uc-lms-mast .uc-lms-id']) {
      const blocks = phone(selector);
      expect(blocks.length, selector).toBeGreaterThan(0);
      expect(blocks.some((b) => /flex:\s*1 1 240px/.test(b.body)), selector).toBe(true);
    }
  });

  it('freezes the head in the desktop row at every width above the reset', () => {
    // The wrap is a phone correction: the desktop heads keep `nowrap`.
    for (const selector of ['.uc-qb-mast .uc-plate-head', '.uc-lms-mast .uc-plate-head']) {
      const desktop = BLOCKS.filter((b) => b.selector === selector && !b.media);
      expect(desktop.length, selector).toBe(0);
    }
  });
});

describe('the shared empty state wraps instead of squeezing its copy', () => {
  it('leaves the desktop row alone', () => {
    const base = flat('.uc-empty');
    expect(base?.body).toMatch(/display:\s*flex/);
    expect(base?.body).not.toMatch(/flex-wrap/);
    expect(flat('.uc-empty > span')?.body).toBeDefined();
  });

  it('wraps the row on a phone and keeps the copy\u2019s 240px floor', () => {
    const row = phone('.uc-empty');
    const copy = phone('.uc-empty > span');
    expect(row.length).toBeGreaterThan(0);
    expect(copy.length).toBeGreaterThan(0);
    expect(row.every((b) => /flex-wrap:\s*wrap/.test(b.body))).toBe(true);
    expect(copy.some((b) => /flex:\s*1 1 240px/.test(b.body))).toBe(true);
    expect(flat('.uc-empty > button')?.body).toMatch(/flex:\s*none/);
  });
});

describe('a directory row drops its action rail on a phone', () => {
  it('resets the three-column row to two columns and spans the rail', () => {
    const row = phone('.uc-dir-row--acts');
    const mediaRow = phone('.uc-dir-row--media.uc-dir-row--acts');
    const rail = phone('.uc-dir-row--acts > .uc-dir-acts');
    expect(row.length).toBeGreaterThan(0);
    expect(row.some((b) => /grid-template-columns:\s*34px minmax\(0, 1fr\)/.test(b.body))).toBe(true);
    expect(mediaRow.some((b) => /grid-template-columns:\s*auto minmax\(0, 1fr\)/.test(b.body))).toBe(true);
    expect(rail.some((b) => /grid-column:\s*1 \/ -1/.test(b.body))).toBe(true);
  });
});

/** The horizontal value of a `padding: a` / `padding: a b` / `padding: a b c`
 *  shorthand — the gutter a band sets, whatever its top and bottom are. */
function padX(body: string): string | undefined {
  const m = body.match(/padding:\s*([^;}]+)/);
  if (!m) return undefined;
  const parts = m[1].trim().split(/\s+/);
  return parts.length === 1 ? parts[0] : parts[1];
}

describe('the mast head is a band, not a stack, once there is width', () => {
  it('leaves the phone rule as the base — the rail still takes its own row', () => {
    // The wrap is a phone correction and has to stay the base rule, or the
    // desktop override would be the only rule and phones would break with it.
    expect(flat('.uc-dir-head')?.body).toMatch(/flex-wrap:\s*wrap/);
    expect(flat('.uc-dir-rail')?.body).toMatch(/flex:\s*1 0 100%/);
  });

  it('stops the rail claiming the whole line in a min-width rule', () => {
    // `flex-grow` on `.uc-dir-id` already pushes a content-width rail to the
    // plate's right gutter, so the rail only has to give up the 100% basis.
    const wide = BLOCKS.filter((b) => b.selector === '.uc-dir-rail' && /min-width/.test(b.media));
    expect(wide.length, 'no desktop rule for .uc-dir-rail').toBeGreaterThan(0);
    expect(wide.some((b) => /flex:\s*0 1 auto/.test(b.body))).toBe(true);
  });

  it('gives every band of a plate one inner gutter', () => {
    // The head, the tools, the detail and the ledger rows all sit inside the
    // same plate. Three different gutters read as a crooked left edge across a
    // 1400px column, so they are pinned to the one value here.
    for (const selector of [
      '.uc-dir-head', '.uc-dir-tools', '.uc-dir-detail',
      '.uc-plate-head', '.uc-dir-row', '.uc-dir-blank', '.uc-free-metric',
    ]) {
      const body = flat(selector)?.body;
      expect(body, selector).toBeDefined();
      expect(padX(body as string), selector).toBe('14px');
    }
  });

  it('pins the free-classrooms chooser on desktop instead of leaving a dead column', () => {
    const sticky = BLOCKS.filter((b) => b.selector === '.uc-free-cols > .uc-plate' && /min-width/.test(b.media));
    expect(sticky.length, 'no desktop rule for the chooser column').toBeGreaterThan(0);
    expect(sticky.some((b) => /position:\s*sticky/.test(b.body))).toBe(true);
  });
});
