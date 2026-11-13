/**
 * Heading-cascade guard.
 *
 * `src/index.css` has two heading layers: the legacy element-qualified shell
 * rules (`.ultracc-route-frame h1/h2/h3`) written before the redesign, and the
 * `.uc-*` design vocabulary the screens now use. Because those shell rules are
 * element-qualified they outrank every single-class `.uc-*` heading rule — so
 * `.uc-cap` (a 9.5px, muted, letter-spaced caption) rendered at 21px in ink on
 * the Tools Hub, `.uc-hero` came back a size too small, and the new screen
 * titles (`.uc-tt-title`, `.uc-lms-title`, `.uc-ev-title`, `.uc-ev-page-name`,
 * `.uc-ev-name`, `.uc-grades-title`) all silently wore the shell's size instead
 * of their own. The ≤700px block made it worse with `!important`.
 *
 * The rule this file enforces: a route-frame heading rule that sizes or colours
 * a heading must exclude anything carrying a `uc-` class, so the design system
 * owns its own headings. Two rules legitimately set no size or colour (the
 * `text-wrap: balance` line) and are left alone.
 *
 * The selectors that did the clobbering are quoted in `DELETED`, so this guard
 * can never pass by watching an empty room.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(join(process.cwd(), 'src', 'index.css'), 'utf8');

/** One `<selector>{<decls>}` block whose selector starts `.ultracc-route-frame hN`. */
const HITS = [...CSS.matchAll(/\.ultracc-route-frame h[1-4]([^{}]*)\{([^{}]*)\}/g)].map((m) => ({
  selector: m[0].slice(0, m[0].indexOf('{')).trim(),
  decls: m[2],
}));

/** A rule that decides how big or what colour a heading is. */
const SIZES_OR_COLOURS = /(?:font-size|line-height|letter-spacing|color)\s*:/;

/** The exclusion that hands a heading back to the `.uc-*` layer. */
const YIELDS_TO_UC = /h[1-4]:not\(\[class\*="uc-"\]\)/;

describe('the legacy route-frame heading rules yield to the uc- design system', () => {
  it('finds the rules it is claiming to guard', () => {
    expect(HITS.length).toBeGreaterThanOrEqual(6);
    // Both halves have to be present or the scan proves nothing.
    expect(HITS.filter((h) => SIZES_OR_COLOURS.test(h.decls)).length).toBeGreaterThanOrEqual(5);
    expect(HITS.some((h) => !SIZES_OR_COLOURS.test(h.decls))).toBe(true);
  });

  it('excludes a uc- heading from every rule that sizes or colours one', () => {
    const offenders = HITS
      .filter((h) => SIZES_OR_COLOURS.test(h.decls) && !YIELDS_TO_UC.test(h.selector))
      .map((h) => h.selector);
    expect(offenders, `a uc- heading would be clobbered: ${offenders.join(' | ')}`).toEqual([]);
  });

  it('catches the selectors that were doing the clobbering', () => {
    // DELETED — the shipped selectors before this fix, quoted rather than read
    // back out of git so the guard cannot drift with the branch.
    const DELETED = [
      '.ultracc-route-frame h1 { font-size: clamp(1.6rem, 2vw, 2.15rem); line-height: 1.15; }',
      '.ultracc-route-frame h2 { font-size: clamp(1.3rem, 1.65vw, 1.75rem); line-height: 1.2; }',
      '.ultracc-route-frame h3 { font-size: 1rem; line-height: 1.3; }',
      '.ultracc-route-frame h1,.ultracc-route-frame h2,.ultracc-route-frame h3,.ultracc-route-frame h4{color:var(--uc-ink)!important;letter-spacing:-.025em}',
      '.ultracc-route-frame h1{font-size:clamp(1.45rem,7vw,1.8rem)!important}.ultracc-route-frame h2{font-size:clamp(1.15rem,5.5vw,1.45rem)!important}',
    ];
    for (const rule of DELETED) {
      const [block] = rule.match(/\.ultracc-route-frame h[1-4]([^{}]*)\{([^{}]*)\}/g) ?? [];
      expect(block, `${rule.slice(0, 48)} is a heading rule`).toBeTruthy();
      const selector = block.slice(0, block.indexOf('{'));
      expect(SIZES_OR_COLOURS.test(rule)).toBe(true);
      expect(YIELDS_TO_UC.test(selector), 'the old selector did not yield').toBe(false);
    }
  });
});
