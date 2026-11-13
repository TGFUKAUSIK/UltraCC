/**
 * The phone tab bar must survive a route change, not blink through it.
 *
 * Reported from the phone as "the bottom tab bar disappears for a split second
 * when I switch tabs". The bar is rendered once, outside `<main>` and outside
 * every Suspense boundary, so nothing in the React tree replaces it on
 * navigation — and the element identity check below pins that. The blink came
 * from the compositor: App.tsx wraps each tab swap in
 * `document.startViewTransition`, the route frame is the only named element, and
 * every *unnamed* element is captured into the root group and cross-faded
 * against itself. Measured live, a route swap ran `-ua-view-transition-fade-out`
 * on `::view-transition-old(root)` and its `fade-in` twin on the new one for
 * 0.25s — and the root image is the shell, so the app bar, the rail and the tab
 * bar all faded with it on every tap.
 *
 * Two kinds of guard keep it dead. The runtime one drives navigation through the
 * header and asserts the bar is the same node, with the same own classes and no
 * inline paint properties, and that the class which hides it is never raised.
 * The CSS one asserts that only an explicit overlay or a keyboard may hide the
 * bar, and that the shell rows are named in (and the root pair silenced for) the
 * view transition. jsdom-class environments do no layout, so the animation
 * names quoted above come from a measured browser, not from this file.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MeridianHeader } from '../MeridianHeader';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CSS = readFileSync(join(process.cwd(), 'src', 'index.css'), 'utf8');

let container: HTMLElement | undefined;
let root: Root | undefined;

function render(activeTab: string, mode?: 'minimal' | 'complete') {
  act(() => {
    root!.render(createElement(MeridianHeader, {
      activeTab,
      setActiveTab: () => {},
      onOpenCommandCenter: () => {},
      onOpenLogin: () => {},
      onOpenSettings: () => {},
      mode,
      notificationData: { assignments: [], attendance: [], exams: [], marks: [], timetable: [] } as never,
    }));
  });
}

function mount(activeTab = 'dashboard', mode?: 'minimal' | 'complete') {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  render(activeTab, mode);
  return container;
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = undefined;
  root = undefined;
});

const TAB_SEQUENCE = ['timetable', 'academics', 'campus', 'my-info', 'dashboard'];

describe('navigation may not touch the phone tab bar', () => {
  it('keeps one tab bar element and one app bar through every destination', () => {
    const host = mount('dashboard');
    const bar = host.querySelector('.mobile-tab-bar');
    const header = host.querySelector('.meridian-header');
    expect(bar, 'the header must own the phone tab bar').toBeTruthy();
    expect(header).toBeTruthy();
    // A duplicate would also abort the view transition outright: a
    // `view-transition-name` may only appear once in the document.
    expect(host.querySelectorAll('.mobile-tab-bar').length).toBe(1);
    expect(host.querySelectorAll('.meridian-rail').length).toBe(1);

    for (const tab of TAB_SEQUENCE) {
      render(tab);
      expect(host.querySelector('.mobile-tab-bar'), `nav to ${tab} replaced the bar`).toBe(bar);
      expect(host.querySelector('.meridian-header'), `nav to ${tab} replaced the app bar`).toBe(header);
      expect(bar!.isConnected, `nav to ${tab} detached the bar`).toBe(true);
    }
  });

  it('leaves the bar’s own classes, inline paint and the hiding class alone', () => {
    const host = mount('dashboard');
    const bar = host.querySelector('.mobile-tab-bar') as HTMLElement;
    const ownClasses = bar.className;
    const inline = bar.getAttribute('style') ?? '';

    for (const tab of TAB_SEQUENCE) {
      render(tab);
      expect(bar.className, 'navigation must not add a class to the bar itself').toBe(ownClasses);
      expect(bar.getAttribute('style') ?? '', 'navigation must not paint the bar inline').toBe(inline);
      expect(
        document.documentElement.classList.contains('uc-keyboard-open'),
        'no route state may raise the class that hides the bar',
      ).toBe(false);
    }
    // Only the destination buttons may change state, and they must.
    expect(bar.querySelectorAll('button.active').length).toBe(1);
  });

  it('hides the bar only for an overlay or a keyboard, never for a route', () => {
    const clean = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    const hiding: string[] = [];
    for (const rule of clean.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const hides = rule[2].split(';').some((decl) => /^\s*display\s*:\s*none\s*$/.test(decl));
      if (!hides) continue;
      for (const selector of rule[1].split(',')) {
        const sel = selector.replace(/\s+/g, ' ').trim();
        // `.mobile-tab-bar button` styles a descendant; this guard is about the
        // bar's own box.
        if (!/(^|[^\w-])\.mobile-tab-bar$/.test(sel)) continue;
        hiding.push(sel);
      }
    }

    // The desktop default hides the bar; the phone block shows it. Everything
    // else that hides it must be an explicit full-screen overlay or the
    // keyboard.
    const allowed = (sel: string) =>
      sel === '.mobile-tab-bar'
      || /^html\s*\.uc-keyboard-open\s+\.mobile-tab-bar$/.test(sel)
      || /^html:has\(\.(mobile-search-shell|ultracc-settings-overlay|ultracc-login-overlay)\)\s+\.mobile-tab-bar$/.test(sel);

    for (const sel of hiding) {
      expect(allowed(sel), `an unexpected rule hides the phone tab bar: ${sel}`).toBe(true);
    }
    // …and the guard is not vacuous: the four documented triggers are the ones
    // that matched.
    expect(hiding.some((s) => s.includes('uc-keyboard-open')), 'the keyboard trigger must be present').toBe(true);
    expect(hiding.filter((s) => s.includes(':has(')).length, 'the three sheet triggers must be present').toBe(3);
  });
});

describe('a route change may not cross-fade the shell', () => {
  /** The declaration block of the rule whose selector list contains `fragment`. */
  function ruleBodyFor(fragment: string): string {
    const clean = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const rule of clean.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const selectors = rule[1].split(',').map((s) => s.replace(/\s+/g, ' ').trim());
      if (selectors.includes(fragment)) return rule[2];
    }
    return '';
  }

  it('names the shell rows so the root snapshot cannot capture them', () => {
    expect(CSS, 'the phone tab bar must leave the root snapshot').toMatch(/\.mobile-tab-bar\s*\{\s*view-transition-name:\s*uc-tab-bar\s*\}/);
    expect(CSS, 'the rail must leave the root snapshot').toMatch(/\.meridian-rail\s*\{\s*view-transition-name:\s*uc-rail\s*\}/);
    // The route frame keeps its own transition: this fix must not cost the
    // arrival animation it was written for.
    expect(CSS).toMatch(/\.ultracc-route-frame\[data-route\]\s*\{\s*view-transition-name:\s*ultracc-route\s*\}/);
    expect(ruleBodyFor('::view-transition-old(ultracc-route)')).toMatch(/animation:\s*ucVtOut/);
    expect(ruleBodyFor('::view-transition-new(ultracc-route)')).toMatch(/animation:\s*ucVtIn/);
  });

  it('silences the root pair, which is what faded the bar against itself', () => {
    for (const pseudo of ['old', 'new']) {
      const body = ruleBodyFor(`::view-transition-${pseudo}(root)`);
      expect(body, `::view-transition-${pseudo}(root) must not run the UA cross-fade`).toMatch(/animation:\s*none/);
      expect(body).not.toMatch(/fade/);
    }
    // The group's own animation carries the pseudo tree's lifetime; `none`
    // there is what keeps a 0.25s root image from being painted at all.
    expect(ruleBodyFor('::view-transition-group(root)')).toMatch(/animation:\s*none/);
    // The named shell rows are silenced the same way — they are identical
    // chrome, so there is nothing in them to cross-fade.
    expect(ruleBodyFor('::view-transition-old(uc-tab-bar)')).toMatch(/animation:\s*none/);
    expect(ruleBodyFor('::view-transition-new(uc-rail)')).toMatch(/animation:\s*none/);
  });
});

describe('the phone bar sizes itself from its buttons', () => {
  /** Every declaration block whose selector list contains exactly `fragment`. */
  function ruleBodiesFor(fragment: string): string[] {
    const clean = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    const bodies: string[] = [];
    for (const rule of clean.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const selectors = rule[1].split(',').map((s) => s.replace(/\s+/g, ' ').trim());
      if (selectors.includes(fragment)) bodies.push(rule[2]);
    }
    return bodies;
  }

  it('derives the bar’s columns from its children, never from a typed count', () => {
    const bodies = ruleBodiesFor('.mobile-tab-bar');
    expect(bodies.length, 'the phone bar must have a layout rule').toBeGreaterThan(0);
    const layout = bodies.join(';');
    // A counted column track is exactly what left a bare column when minimal mode
    // briefly offered four buttons: the fifth track stayed as empty surface under
    // the row, and the bar read as broken rather than as a smaller app. The row
    // must therefore be built from the buttons that exist, so the hole is
    // structurally impossible however many destinations a mode holds.
    expect(layout, 'the phone bar may not type its column count').not.toMatch(/grid-template-columns\s*:\s*repeat\(\s*\d/);
    expect(layout, 'the phone bar must lay its buttons out as a row').toMatch(/grid-auto-flow\s*:\s*column/);
    expect(layout, 'the phone bar must give every button an equal, flexible track')
      .toMatch(/grid-auto-columns\s*:\s*minmax\(0\s*,\s*1fr\)/);
  });

  it('draws the same number of buttons whichever mode is on', () => {
    // The CSS fix and the product fix have to agree: a bar built to fill its row
    // still leaves a hole if one mode hands it one button fewer than the other.
    const host = mount('dashboard', 'complete');
    const complete = host.querySelectorAll('.mobile-tab-bar button').length;
    render('dashboard', 'minimal');
    const minimal = host.querySelectorAll('.mobile-tab-bar button').length;
    expect(complete, 'complete mode must fill the phone bar').toBe(5);
    expect(minimal, 'minimal mode must fill the same row the complete bar fills').toBe(complete);
  });
});
