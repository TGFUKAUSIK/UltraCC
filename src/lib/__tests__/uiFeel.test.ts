/**
 * The feel layer keeps its promises.
 *
 * Depth, motion and number typography now live in one section of `index.css` and
 * every route inherits them, which is exactly the danger: a layer that applies
 * everywhere can also break everywhere. The three things this guards are the ones
 * a later polish pass is most likely to undo by accident.
 *
 *   1. It never paints a label. A fill's text belongs to `--acc-on` and to the
 *      accent pin at the very end of the file; a hover that "helpfully" sets
 *      `color:` here would reproduce the erasure fillContrast.test.ts exists for.
 *   2. It never transforms the route container. The view fades and the blocks
 *      inside it rise; a transform on the container would capture every fixed
 *      sheet opened from that view and pin it to an animating box.
 *   3. It never takes height from a measured box. The sync bar is painted fixed
 *      to the window edge, because the phone shell was measured, not guessed.
 *
 * Everything else is a typo trap: keyframes named but never defined, tokens dark
 * canvas forgot to re-declare, classes no component renders any more.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
// index.css is CRLF; a regex that crosses a newline has to be written against
// one ending, or it silently stops matching and the guard passes on nothing.
const CSS = readFileSync(join(ROOT, 'src', 'index.css'), 'utf8').replace(/\r\n/g, '\n');

const FEEL_START = CSS.indexOf(' * UltraCC feel:');
const PIN = CSS.indexOf(' * Accent fills keep their own label colour');
const FEEL = CSS.slice(FEEL_START, PIN);

/** Comments are prose, not declarations — strip before reading rules. */
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '');
const FEEL_CODE = code(FEEL);

/**
 * Innermost rules only. A selector match can carry the closing brace of the
 * block it follows, so the selector is read from after the last `}` or `;`.
 */
function rules(source: string): Array<{ selector: string; body: string }> {
  const out: Array<{ selector: string; body: string }> = [];
  for (const m of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const head = m[1];
    const selector = head.slice(Math.max(head.lastIndexOf('}'), head.lastIndexOf(';')) + 1).trim().replace(/\s+/g, ' ');
    if (!selector || selector.startsWith('@') || !/[.[]/.test(selector)) continue;
    out.push({ selector, body: m[2].trim() });
  }
  return out;
}

const FEEL_RULES = rules(FEEL_CODE);

/** Every .tsx in the client, so "used by a component" means really used. */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    if (entry === '__tests__') continue;
    const full = join(ROOT, dir, entry);
    if (statSync(full).isDirectory()) out.push(...sources(`${dir}/${entry}`));
    else if (/\.tsx$/.test(entry)) out.push(full);
  }
  return out;
}
const COMPONENT_SOURCE = [...sources('src/components'), join(ROOT, 'src', 'App.tsx')]
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n');

describe('the feel layer is where it says it is', () => {
  it('sits between the design system and the accent pin, not after it', () => {
    expect(FEEL_START).toBeGreaterThan(-1);
    expect(PIN).toBeGreaterThan(FEEL_START);
    // The pin wins by being last. This layer has to stay above it, or a rule here
    // could out-order the only label colour that is right in all three themes.
    expect(FEEL).toContain('It never sets a label');
  });

  it('is a real layer, not one rule that stopped matching', () => {
    expect(FEEL_RULES.length).toBeGreaterThan(30);
    expect(CSS).toContain('@keyframes ucRise ');
  });
});

describe('it paints depth, never ink', () => {
  const offenders = FEEL_RULES
    .filter(({ body }) => /(^|[;\s])color\s*:/.test(body))
    .map(({ selector, body }) => `${selector} { ${body} }`);

  it('sets no colour in any rule, so no fill can lose its label to a hover', () => {
    expect(offenders).toEqual([]);
  });

  it('never selects a theme-independent label as a hook', () => {
    // text-white / text-slate-950 are safe only because nothing translates them.
    expect(FEEL).not.toMatch(/\[class\*="text-(?:white|slate-950)"\]/);
    expect(FEEL).not.toMatch(/\.text-slate-950\b/);
  });

  it('declares the heights and the ones dark canvas cannot inherit', () => {
    for (const token of ['--uc-elev-1', '--uc-elev-2', '--uc-elev-3', '--uc-sheen', '--uc-accent-wash', '--uc-ease', '--uc-dur-1', '--uc-dur-2', '--uc-dur-3', '--uc-lift']) {
      expect(FEEL, token).toContain(`${token}:`);
    }
    const dark = FEEL.slice(FEEL.indexOf('html[data-theme="dark"], html[data-theme="midnight"] {\n  --uc-elev-1'));
    expect(dark.length).toBeGreaterThan(0);
    // A top sheen is daylight: on #0b1220 it would print a bright lip on cards.
    for (const token of ['--uc-elev-1', '--uc-elev-2', '--uc-sheen', '--uc-accent-wash']) {
      expect(dark.slice(0, 700), token).toContain(`${token}:`);
    }
    // elev-3 rides the theme’s own float shadow instead of duplicating it.
    expect(FEEL).toMatch(/--uc-elev-3:\s*var\(--uc-shadow-float\)/);
    // …and something wears it. A declared height nobody uses is documentation,
    // not design; the toast is the one object above a route already at rest.
    const floated = FEEL_RULES.filter(({ body }) => body.includes('var(--uc-elev-3)')).map(({ selector }) => selector);
    expect(floated).toContain('.uc-toast');
  });
});

describe('motion is applied where it cannot trap anything', () => {
  it('fades the route container and rises its blocks', () => {
    const container = FEEL_RULES.find(({ selector }) => selector.endsWith('.ultracc-route-frame > *'));
    const blocks = FEEL_RULES.find(({ selector }) => selector.endsWith('.ultracc-route-frame > * > *'));
    expect(container?.body).toContain('ucFade');
    expect(blocks?.body).toContain('ucRise');
    // A transform on the container makes it the containing block for every fixed
    // sheet opened from inside the view.
    expect(container?.body).not.toMatch(/transform|translate/);
  });

  it('names a keyframe that exists for every animation it runs', () => {
    const names = new Set<string>();
    for (const m of FEEL_CODE.matchAll(/animation:\s*([a-z][\w-]*)/g)) {
      if (m[1] !== 'none') names.add(m[1]);
    }
    expect(names.size).toBeGreaterThan(3);
    for (const name of names) {
      expect(CSS, `@keyframes ${name}`).toContain(`@keyframes ${name} `);
    }
  });

  it('stops the sync bar’s sweep, and nothing else keeps moving', () => {
    const reduced = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce) {\n  .uc-sync-bar > i'));
    expect(reduced.length).toBeGreaterThan(0);
    expect(reduced).toMatch(/\.uc-sync-bar\.is-on > i\s*\{\s*animation:\s*none/);
    // The app-wide promise: every duration collapses to a frame, so no new
    // animation added below this layer has to opt out by hand.
    expect(CSS).toMatch(/animation-duration:\s*0\.01ms !important/);
    expect(CSS).toMatch(/\.uc-skeleton\s*\{\s*animation:\s*none/);
  });

  it('presses a control instead of repainting it', () => {
    const press = FEEL_RULES.find(({ selector }) => selector.includes('button:active'));
    expect(press?.body).toMatch(/transform:\s*scale\(\.9/);
    expect(press?.body).not.toMatch(/(^|[;\s])color\s*:/);
  });

  it('draws focus with the student’s own accent', () => {
    expect(FEEL).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--uc-focus-ring\)/);
    const focus = FEEL_RULES.find(({ selector, body }) => selector.includes(':focus-visible') && body.includes('outline'));
    expect(focus?.selector).toContain('button');
    expect(focus?.selector).toContain('textarea');
  });

  it('gives the shell the same ring, drawn inside its own edge', () => {
    // The rail is 82px wide and the tab bar is flush with the viewport, so a ring
    // that sits outside the box is clipped and the control looks unselected.
    const chrome = FEEL_RULES.find(({ selector }) => selector.includes('.meridian-rail') && selector.includes('.mobile-tab-bar'));
    expect(chrome?.selector).toContain(':focus-visible');
    expect(chrome?.body).toContain('var(--uc-focus-ring)');
    expect(chrome?.body).toMatch(/outline-offset:\s*-2px/);
  });

  it('pins the sync bar to the window edge without taking layout height', () => {
    // Fixed, not a row in the header: the bar must never push the measured
    // phone shell or reserve space a quiet app would leave blank.
    const bar = FEEL_RULES.find(({ selector }) => selector === '.uc-sync-bar');
    expect(bar?.body).toMatch(/position:\s*fixed/);
    expect(bar?.body).toMatch(/top:\s*0/);
    expect(bar?.body).toMatch(/pointer-events:\s*none/);
    // …and it sweeps only while the app is actually working.
    expect(FEEL).toMatch(/\.uc-sync-bar\.is-on > i\s*\{[^}]*animation:\s*ucSync/);
  });
});

describe('the classes it defines are the classes components use', () => {
  const unique = [...new Set([...FEEL_CODE.matchAll(/\.((?:uc|meridian)-[\w-]+)/g)].map((m) => m[1]))];

  it('finds the shared vocabulary', () => {
    expect(unique.length).toBeGreaterThan(8);
    for (const name of ['uc-skeleton', 'uc-skeleton-page', 'uc-toast', 'uc-sync-bar']) {
      expect(unique, name).toContain(name);
    }
  });

  it('leaves no rule behind that nothing renders', () => {
    expect(unique.filter((name) => !COMPONENT_SOURCE.includes(name))).toEqual([]);
  });

  it('runs the sweep only while a sync is open', () => {
    expect(FEEL).toContain('.uc-sync-bar.is-on');
    // The quiet state is genuinely absent, not a dimmed idle track.
    expect(FEEL_RULES.find(({ selector }) => selector === '.uc-sync-bar')?.body).toMatch(/opacity:\s*0/);
  });
});

describe('the palette has one home', () => {
  /** Theme-token declarations, tagged with the selector block that owns them. */
  const decls = (() => {
    // Comments are stripped first: a selector is read from the text between the
    // previous `}` and this `{`, and the block headers are commented.
    const source = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    const out: Array<{ selector: string; token: string; value: string }> = [];
    for (const m of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const head = m[1];
      const selector = head.slice(Math.max(head.lastIndexOf('}'), head.lastIndexOf(';')) + 1).trim().replace(/\s+/g, ' ');
      if (!/^(?::root|html\[data-(?:theme|accent))/.test(selector)) continue;
      for (const d of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)) out.push({ selector, token: d[1], value: d[2].trim() });
    }
    return out;
  })();

  it('finds the token layer it is claiming to check', () => {
    expect(decls.filter((d) => d.selector === ':root' && d.token === '--uc-surface').length).toBe(1);
    expect(decls.filter((d) => d.selector === ':root').length).toBeGreaterThan(40);
  });

  it('declares no token twice for the same theme', () => {
    // A palette written in two places is one fix away from a theme that quietly
    // ignores the documented block: the surface tokens used to be repeated inside
    // the design-system layer, minus --uc-focus-ring and --uc-shadow-hover, and the
    // second copy is the one that won.
    const seen = new Map<string, string>();
    const dupes: string[] = [];
    for (const d of decls) {
      const key = `${d.selector} ${d.token}`;
      if (seen.has(key)) dupes.push(`${key}: "${seen.get(key)}" and "${d.value}"`);
      else seen.set(key, d.value);
    }
    expect(dupes).toEqual([]);
  });
});

describe('numbers are set as data', () => {
  it('aligns every figure that can change under the student’s eyes', () => {
    const covered = FEEL_RULES.filter(({ body }) => body.includes('tabular-nums')).map(({ selector }) => selector).join(', ');
    expect(FEEL_RULES.filter(({ body }) => body.includes('tabular-nums')).length).toBeGreaterThan(1);
    // The dashboard’s summary figures, the timetable clocks, and the meters that
    // fill from VTOP data.
    for (const needle of ['td', 'font-mono', 'portal-summary-card > strong', 'portal-course-meter > b']) {
      expect(covered, needle).toContain(needle);
    }
  });

  it('transitions a progress line instead of teleporting it', () => {
    expect(FEEL).toMatch(/\.portal-progress i[^{]*\{[^}]*transition:\s*width/);
  });
});
