/**
 * The phone shell must be one PINNED box whose last row is the tab bar, and the
 * bar must stay clear of the on-screen keyboard.
 *
 * What happened: on iPhone 12 the bottom of the screen rendered as an unused
 * white strip, in Safari and in the installed home-screen app — and it survived
 * a first repair. Two lessons came out of that, and both are encoded below.
 *
 * 1. The shell was sized with a *unit* — `100%`, then `100dvh` — while the tab
 *    bar was `position: fixed; bottom: 0`. Units resolve against one viewport
 *    and fixed positioning resolves against the LAYOUT viewport, and on iOS
 *    those are different boxes; whichever one lost, the student saw either a
 *    clipped bar or bare canvas underneath it.
 * 2. The first repair sized the shell from `visualViewport.height`, published as
 *    `--uc-visible-height`. On iOS that number is SMALLER than the box the
 *    browser renders into, so the strip survived: no height a stylesheet can
 *    publish moves a box into the difference between the layout viewport and
 *    the window.
 *
 * The repair is structural, so the guards are structural. `#root` is pinned
 * with `position: fixed; inset: 0` and painted with the canvas token; the
 * document never scrolls (`html, body { height: 100%; overflow: hidden }`); the
 * shell is `height: 100%` inside it; and the tab bar is an IN-FLOW flex row, so
 * it can only ever sit where the shell ends. No viewport unit and no
 * measurement is allowed anywhere in that frame — the ONLY consumer of
 * `--uc-visible-height` is the keyboard override, which is gated on the class
 * the tracker raises while a text field holds the caret.
 * `src/utils/mobileScrollRefresh.test.ts` keeps the scroll side of the shell
 * honest.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = resolve(__dirname, '../..');
const CSS = readFileSync(resolve(SRC, 'index.css'), 'utf-8');
const MAIN = readFileSync(resolve(SRC, 'main.tsx'), 'utf-8');
// Comments would otherwise glue themselves onto the next declaration (and a
// comment mentioning a property could make an assertion pass vacuously).
const CLEAN = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

/** Every `prop: value` declared for `selector`, in source order. */
function declarations(selector: string, prop: string): string[] {
  const out: string[] = [];
  const rule = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'g');
  for (const match of CLEAN.matchAll(rule)) {
    for (const line of match[1].split(';')) {
      const [key, ...rest] = line.trim().split(':');
      if (key?.trim() === prop) out.push(rest.join(':').trim());
    }
  }
  return out;
}

const last = (selector: string, prop: string) => declarations(selector, prop).at(-1) ?? '';

/** The pinned `#root` document-frame rule (the box that replaced the measured
 *  shell height). */
function rootFrameRule(): string {
  const blocks = CLEAN.match(/#root\s*\{[^}]*\}/g) ?? [];
  const pinned = blocks.find((block) => /position:\s*fixed/.test(block));
  expect(pinned, 'the pinned #root document-frame rule was not found').toBeTruthy();
  return pinned!;
}

/** CSS with at-rule openers removed, so rules nested in `@media` can be scanned
 *  by a flat `selector { body }` regex. */
function flattened(css: string): string {
  return css.replace(/@[a-zA-Z-]+[^{}]*\{/g, '');
}

/** Every `selector { body }` pair, at-rules flattened away. */
function ruleList(css: string): Array<{ selector: string; body: string }> {
  const out: Array<{ selector: string; body: string }> = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(flattened(css))) !== null) {
    out.push({ selector: match[1].trim(), body: match[2] });
  }
  return out;
}

/** The boxes that make up the pinned frame. */
const FRAME = ['html', 'body', '#root', '.ultracc-app', '.ultracc-main'];

describe('the phone shell is pinned, not measured', () => {
  it('pins #root to the visible box instead of sizing a shell from a unit', () => {
    const rule = rootFrameRule();
    expect(rule, 'a fixed root resolves against the box the browser renders into').toMatch(/position:\s*fixed/);
    // Longhands first, so an engine without `inset` still gets a pinned box.
    expect(rule).toMatch(/top:\s*0/);
    expect(rule).toMatch(/right:\s*0/);
    expect(rule).toMatch(/bottom:\s*0/);
    expect(rule).toMatch(/left:\s*0/);
    expect(rule, '`inset: 0` is the shorthand form of the four longhands').toMatch(/inset:\s*0/);
    expect(rule, 'the shell is a flex column inside the root').toMatch(/display:\s*flex/);
    expect(rule).toMatch(/flex-direction:\s*column/);
    expect(rule, 'no measurement may size the frame').not.toMatch(/--uc-visible-height/);
  });

  it('never lets the document scroll', () => {
    const block = CLEAN.match(/html,\s*body\s*\{[^}]*\}/)?.[0] ?? '';
    expect(block, 'the html/body document-frame rule was not found').toBeTruthy();
    expect(block, 'height:100% (never a viewport unit) chain-sizes the frame').toMatch(/height:\s*100%/);
    expect(block, 'a scrolling document grows the root box by the home-indicator inset').toMatch(/overflow:\s*hidden/);
    expect(block).toMatch(/overscroll-behavior:\s*none/);
  });

  it('paints every box that could be the bottom edge with the canvas token', () => {
    expect(CSS, 'html must paint the canvas so no strip can render browser-default white')
      .toMatch(/html \{ background: var\(--uc-bg\) !important; \}/);
    expect(rootFrameRule(), 'the root must not be transparent').toMatch(/background:\s*var\(--uc-bg\)\s*!important/);
    const shell = CLEAN.match(/\.ultracc-app\s*\{[^}]*\}/g) ?? [];
    expect(shell.some((rule) => /height:\s*100%/.test(rule)), 'the shell is 100% of the pinned root').toBe(true);
    expect(shell.some((rule) => /background:\s*var\(--uc-bg\)/.test(rule)), 'the shell paints the same canvas').toBe(true);
  });

  it('does not derive any shell height from a viewport unit or a measurement', () => {
    // This is the regression guard for the whole repair: reintroducing
    // `100dvh`/`100svh`/`-webkit-fill-available` or `--uc-visible-height` into a
    // frame rule re-opens the iOS band. The keyboard override is the one
    // legitimate consumer and is exempt by its `uc-keyboard-open` gate.
    const banned = /(100vh|100dvh|100svh|-webkit-fill-available|--uc-visible-height)/;
    const offenders: string[] = [];
    for (const { selector, body } of ruleList(CLEAN)) {
      if (/uc-keyboard-open/.test(selector)) continue;
      const touchesFrame = selector
        .split(',')
        .some((part) => FRAME.includes(part.trim().split(/[\s>+~]+/).pop() ?? ''));
      if (!touchesFrame) continue;
      for (const decl of body.split(';')) {
        const [prop, ...rest] = decl.split(':');
        if (!['height', 'min-height', 'max-height', '--uc-visible-height'].includes(prop.trim())) continue;
        if (banned.test(rest.join(':'))) offenders.push(`${selector} { ${decl.trim()} }`);
      }
    }
    expect(offenders, 'the frame is pinned; a unit or a measurement in its height re-opens the iOS band').toEqual([]);
  });

  it('installs the keyboard tracker before the first render', () => {
    expect(MAIN, 'main.tsx must import the keyboard viewport tracker').toMatch(/from '\.\/utils\/visibleViewport'/);
    expect(MAIN.indexOf('trackVisibleViewportHeight(document.documentElement)'))
      .toBeLessThan(MAIN.indexOf('createRoot('));
  });

  it('lets .ultracc-main fill the shell instead of claiming its own viewport height', () => {
    expect(declarations('.ultracc-main', 'flex'), 'scroller must flex-fill the shell').toContain('1 1 auto');
    expect(declarations('.ultracc-main', 'min-height'), 'min-height:0 is what lets a flex child scroll').toContain('0');
    for (const height of declarations('.ultracc-main', 'height')) {
      expect(height, 'a second independent viewport height desyncs from the shell').not.toMatch(/100(dvh|vh|svh)/);
    }
  });
});

describe('the tab bar is the shell\'s last row, not a viewport overlay', () => {
  it('is in the flow and ordered below the content', () => {
    expect(last('.mobile-tab-bar', 'position'), 'a fixed bar anchors to the layout viewport, not the visible one').toBe('relative');
    expect(last('.mobile-tab-bar', 'order'), 'the bar must be the last flex row').toBe('3');
    expect(last('.mobile-tab-bar', 'flex'), 'the bar must never stretch or shrink').toBe('0 0 auto');
    expect(last('.ultracc-main', 'order'), 'content must sit above the bar').toBe('2');
  });

  it('reserves no dead clearance under the content', () => {
    const pad = last('.ultracc-main', 'padding-bottom');
    expect(pad, 'main bottom padding not found').toBeTruthy();
    expect(pad, 'the bar is in the flow, so padding cannot be used to dodge it').not.toMatch(/safe-area|82px|100px/);
    const px = Number(/(\d+)px/.exec(pad)?.[1] ?? NaN);
    expect(px, 'a gutter is still needed so the last card is not flush against the bar').toBeGreaterThan(0);
    expect(px, 'any larger gutter is unused space the student cannot scroll away').toBeLessThanOrEqual(24);
  });

  it('paints itself opaquely across the home-indicator inset', () => {
    expect(last('.mobile-tab-bar', 'background'), 'a translucent bar over canvas reads as a blank band').toBe('var(--uc-surface)');
    expect(declarations('.mobile-tab-bar', 'padding').at(-1), 'the inset belongs to the bar, not to the page')
      .toMatch(/calc\(6px \+ env\(safe-area-inset-bottom\)\)/);
  });

  it('derives its box from one variable that overlays also use', () => {
    expect(CLEAN, 'the bar height must have a single source of truth').toMatch(/--uc-bar-h:\s*calc\(70px \+ env\(safe-area-inset-bottom\)\)/);
    expect(last('.mobile-tab-bar', 'height')).toBe('var(--uc-bar-h)');
    expect(last('.meridian-feature-menu', 'bottom'), 'the services sheet must sit on the measured bar').toMatch(/var\(--uc-bar-h\)/);
  });

  it('paints the strip under the bar as the bar, never as bare canvas', () => {
    const filler = /body::after\s*\{([^}]*)\}/.exec(CLEAN)?.[1] ?? '';
    expect(filler, 'the bar footprint must be replicated against the layout viewport bottom').toMatch(/position:\s*fixed/);
    expect(filler).toMatch(/bottom:\s*0/);
    expect(filler, 'no deeper than the bar, so it can never rise above it and hide content').toMatch(/height:\s*var\(--uc-bar-h\)/);
    expect(filler, 'it must match the bar, not the page canvas').toMatch(/background:\s*var\(--uc-surface\)/);
    expect(filler, 'a decorative strip must not swallow taps meant for the bar').toMatch(/pointer-events:\s*none/);
    // This guard used to assert `z-index: 58` here, noted "it sits below the bar
    // and above the page". The number was right and the claim was wrong — the
    // strip is a sibling of `#root`, not of the bar, so 58 only beats the shell
    // when the shell's own rank is lower, and it was `auto` (0). The strip
    // painted the tab bar out on the phone, icons and labels included, and the
    // bar only showed through while a View Transition hoisted its snapshot into
    // the top layer — the flash the student reported. The invariant is the
    // ranking, so that is what is asserted: the shell out-ranks the strip.
    const net = Number(/z-index:\s*(\d+)/.exec(filler)?.[1] ?? NaN);
    const shell = Number(last('#root', 'z-index'));
    expect(net, 'the safety net keeps an explicit rank').toBeGreaterThan(0);
    expect(shell, `the shell (z-index ${shell}) must out-rank the net (${net}) that covers the bar footprint`)
      .toBeGreaterThan(net);
  });

  it('lifts for the keyboard by shrinking the shell, never by offsetting the bar', () => {
    // A focused field shrinks `visualViewport.height`; while the `uc-keyboard-open`
    // gate is up the pinned #root is sized to that measurement, and the in-flow
    // bar rides the shell's bottom edge above the keyboard. A translateY or a
    // keyboard-inset hack on the bar would instead leave a canvas strip under it
    // — the bug this file exists to keep dead.
    expect(last('.mobile-tab-bar', 'bottom'), 'the bar must stay glued to the shell, not the viewport').toBe('auto');
    for (const transform of declarations('.mobile-tab-bar', 'transform')) {
      expect(transform, 'no viewport-slide compensation on the bar').not.toMatch(/translate/);
    }
    expect(CSS, 'no keyboard inset may be reintroduced').not.toMatch(/--uc-keyboard-inset/);
    expect(CSS, 'the keyboard override is gated on the tracker\'s class')
      .toMatch(/html\.uc-keyboard-open #root\s*\{[^}]*height:\s*var\(--uc-visible-height/);
  });
});
