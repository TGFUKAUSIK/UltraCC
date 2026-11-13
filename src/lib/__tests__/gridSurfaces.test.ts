/**
 * A grid that paints its own background and then leaves a cell empty shows that
 * background as a block. Two of them did exactly that:
 *
 *   - the dashboard's course cards — the grid carried
 *     `background: var(--uc-line)` so the 1px gaps read as hairlines, and with
 *     an odd number of courses the leftover cell showed `--uc-line` as a solid
 *     panel beside the last card;
 *   - the Grades mark cells — seven cells in a four-column grid left the
 *     eighth cell showing the same line colour inside the bordered frame.
 *
 * The fix is the same in both: the container paints nothing, the cells draw
 * their own hairlines, and a lone last cell takes the rest of its row so there
 * is no empty cell to paint. This guard keeps that shape. Every hairline grid
 * in the stylesheet must either paint nothing itself, collapse the cells it does
 * not use (`auto-fit` / `auto-fill`), be a flex column that cannot have an empty
 * cell, or carry a rule that completes its last row.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(join(process.cwd(), 'src', 'index.css'), 'utf8');

interface Block { selector: string; body: string; media: string }

/** Flat rule blocks, with the `@media` context each was written inside. */
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
      // Read the body up to the matching close, then record it.
      let depth = 1;
      let j = i + 1;
      while (j < clean.length && depth > 0) {
        if (clean[j] === '{') depth += 1;
        else if (clean[j] === '}') depth -= 1;
        j += 1;
      }
      out.push({ selector, body: clean.slice(i + 1, j - 1), media: stack.join(' ') });
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
const block = (selector: string): Block | undefined => BLOCKS.find((b) => b.selector === selector);

/** Every container that both lays out a grid and paints a line colour itself. */
const PAINTED_GRIDS = BLOCKS.filter(
  (b) => /display:\s*grid/.test(b.body) && /background:\s*var\(--uc-line\)/.test(b.body),
);

/** Containers that fill every cell by construction, and why. */
const COMPLETE_BY_CONSTRUCTION: Record<string, string> = {
  // Five shortcuts into five columns at desktop; below 700px two columns, and
  // the odd last one spans both (asserted below).
  '.uc-services': 'a span rule covers the odd last shortcut',
  // Four fixed tiles: 2×2 on a phone, four across from 700px. No cell is ever
  // left unattached at either width.
  '.uc-pred-tiles': 'four tiles fill both the two- and four-column layout',
};

describe('hairline grids never paint an empty cell', () => {
  it('parses the stylesheet it is guarding', () => {
    expect(BLOCKS.length).toBeGreaterThan(500);
    expect(PAINTED_GRIDS.length).toBeGreaterThan(0);
    expect(block('.uc-courses')).toBeDefined();
    expect(block('.uc-mark-cells')).toBeDefined();
  });

  it('knows every grid that paints its own line colour', () => {
    // A new one has to be added here on purpose: the point of the list is that
    // a painted grid is a decision, not an accident.
    expect(PAINTED_GRIDS.map((b) => b.selector).sort()).toEqual(['.uc-acad-stats', '.uc-pred-tiles', '.uc-services']);
  });

  it('leaves every painted grid complete or plainly exempt', () => {
    const unexplained: string[] = [];
    for (const grid of PAINTED_GRIDS) {
      if (/auto-fit|auto-fill/.test(grid.body)) continue;
      if (COMPLETE_BY_CONSTRUCTION[grid.selector]) continue;
      const completes = BLOCKS.some(
        (b) => b.selector.startsWith(grid.selector) && /:last-child/.test(b.selector) && /grid-column/.test(b.body),
      );
      if (!completes) unexplained.push(`${grid.selector} (${grid.media || 'all widths'})`);
    }
    expect(unexplained).toEqual([]);
  });

  it('still completes the shortcut rail’s odd last button', () => {
    const span = BLOCKS.find(
      (b) => b.selector.includes('.uc-service:last-child:nth-child(odd)') && /grid-column/.test(b.body),
    );
    expect(span?.body).toContain('1 / -1');
  });
});

describe('course cards own their hairlines', () => {
  it('paints no background on the grid itself', () => {
    const grid = block('.uc-courses');
    expect(grid?.body).not.toMatch(/background/);
    expect(grid?.body).toMatch(/gap:\s*0/);
  });

  it('draws the row rules and the column rule from the cards', () => {
    expect(block('.uc-courses > .uc-course')?.body).toMatch(/border-top:\s*1px solid var\(--uc-line\)/);
    expect(block('.uc-courses > .uc-course:first-child')?.body).toMatch(/border-top:\s*0/);
    expect(block('.uc-courses > .uc-course:nth-child(-n+2)')?.body).toMatch(/border-top:\s*0/);
    expect(block('.uc-courses > .uc-course:nth-child(even)')?.body).toMatch(/border-left:\s*1px solid var\(--uc-line\)/);
  });

  it('gives the lone last card the whole row instead of a hole', () => {
    const span = block('.uc-courses > .uc-course:last-child:nth-child(odd)');
    expect(span?.body).toMatch(/grid-column:\s*1 \/ -1/);
  });
});

describe('mark cells own their hairlines at both breakpoints', () => {
  it('paints no background on the grid itself, and keeps its frame', () => {
    const grid = block('.uc-mark-cells');
    expect(grid?.body).not.toMatch(/background/);
    expect(grid?.body).toMatch(/border:\s*1px solid var\(--uc-line\)/);
    expect(grid?.body).toMatch(/overflow:\s*hidden/);
  });

  it('draws the rules from the cells in the four-column layout', () => {
    const cell = block('.uc-mark-cell');
    expect(cell?.body).toMatch(/border-top:\s*1px solid var\(--uc-line\)/);
    expect(cell?.body).toMatch(/border-left:\s*1px solid var\(--uc-line\)/);
    expect(block('.uc-mark-cell:nth-child(-n+4)')?.body).toMatch(/border-top:\s*0/);
    expect(block('.uc-mark-cell:nth-child(4n+1)')?.body).toMatch(/border-left:\s*0/);
  });

  it('gives the seventh cell the rest of its row on a phone', () => {
    expect(block('.uc-mark-cell:last-child:nth-child(4n+3)')?.body).toMatch(/grid-column:\s*span 2/);
  });

  it('turns the seven-column desktop layout into one complete row', () => {
    const desktop = BLOCKS.filter((b) => /min-width:\s*700px/.test(b.media) && b.selector.startsWith('.uc-mark-'));
    const seven = desktop.find((b) => b.selector === '.uc-mark-cells');
    expect(seven?.body).toMatch(/grid-template-columns:\s*repeat\(7/);
    // One row: no rules above any cell, only the first cell sits on the edge,
    // and the phone-only span is released.
    expect(desktop.find((b) => b.selector === '.uc-mark-cell')?.body).toMatch(/border-top:\s*0/);
    expect(desktop.find((b) => b.selector === '.uc-mark-cell:first-child')?.body).toMatch(/border-left:\s*0/);
    expect(desktop.find((b) => b.selector === '.uc-mark-cell:last-child:nth-child(4n+3)')?.body).toMatch(/grid-column:\s*auto/);
  });
});
