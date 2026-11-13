/**
 * The "More" sheet has to open where the student is looking.
 *
 * Reported from a phone: tap More, nothing happens. The sheet was mounting, the
 * state flipped, `aria-expanded` went true — and 754px of menu drew itself at
 * `y: -767`, entirely above the viewport. The cause is not the menu at all. The
 * app bar paints with `backdrop-filter`, and a filtered ancestor becomes the
 * containing block for every `position: fixed` descendant, so index.css's
 * `bottom: calc(var(--uc-bar-h) + 2px)` measured from a 60px-tall box at the top
 * of the screen instead of from the bottom of the phone. The scrim was trapped
 * the same way and dimmed the app bar rather than the page.
 *
 * So the invariant is structural, and layout-free tools can still police it: the
 * sheet and its scrim must be portalled out of the header, and the portal layer
 * must clear the shell furniture on its own authority — inside the header the
 * menu inherited the app bar's stacking, but a body child sits in the root
 * stacking context, where `z-index: 2` would put it under the tab bar (59).
 *
 * jsdom/happy-dom do no layout, so the numbers quoted above come from a measured
 * browser, not from this file. What this file can guarantee is that they cannot
 * silently come back.
 *
 * The follow-up report was the same symptom on the same phone, so the sheet was
 * re-measured against every other fixed overlay in the app and it sat in the right
 * box. The remaining invariant that could still put it back is the frame the
 * coordinates are measured in: index.css pins `<html>`, `<body>` and `#root` and
 * forbids the document from scrolling, and this guard checks the sheet still leans
 * on that pin rather than on a viewport unit of its own.
 *
 * The third report said the same thing again, which settled the argument: a phone
 * that disagrees with itself about where its bottom edge is cannot be fixed by
 * picking better coordinates, because there is no coordinate that all four readings
 * of that edge agree on. So the sheet now measures where it landed and, if the
 * answer is "somewhere the student cannot see", re-hangs itself from the top of the
 * frame. Those tests stub a rect, because that is the one part of this file a DOM
 * harness cannot otherwise observe.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MeridianHeader } from '../MeridianHeader';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CSS = readFileSync(join(process.cwd(), 'src', 'index.css'), 'utf8');

/** The fixed furniture the sheet must beat, read from the CSS rather than remembered. */
const CHROME = Math.max(
  ...['meridian-header', 'mobile-tab-bar'].flatMap((name) =>
    (CSS.match(new RegExp(`\\.${name}[^{]*\\{[^}]*\\}`, 'g')) ?? [])
      .flatMap((rule) => [...rule.matchAll(/z-index:\s*(\d+)/g)].map((m) => Number(m[1]))),
  ),
);

let container: HTMLElement | undefined;
let root: Root | undefined;

function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(createElement(MeridianHeader, {
      activeTab: 'dashboard',
      setActiveTab: () => {},
      onOpenCommandCenter: () => {},
      onOpenLogin: () => {},
      onOpenSettings: () => {},
      notificationData: { assignments: [], attendance: [], exams: [], marks: [], timetable: [] } as never,
    }));
  });
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = undefined;
  root = undefined;
  // Nothing of the sheet may outlive the header that opened it: no stranded
  // layer over the page, and no scroll lock left on the document.
  expect(document.querySelector('.meridian-feature-layer')).toBeNull();
  expect(document.body.classList.contains('ultracc-modal-open')).toBe(false);
});

const moreButton = () =>
  [...(container?.querySelectorAll('.mobile-tab-bar button') ?? [])].find((b) =>
    /More|Close more/i.test(b.getAttribute('aria-label') || ''),
  ) as HTMLButtonElement | undefined;

const open = () => {
  const trigger = moreButton();
  expect(trigger, 'the phone tab bar must own a More control').toBeTruthy();
  act(() => trigger!.click());
  // Looked up by id, because the sheet is allowed to wear a different class when it
  // has to move itself somewhere visible.
  return document.getElementById('ultracc-services-menu') as HTMLElement | null;
};

/**
 * Give the harness the one thing it does not do — layout. `box` is the rect the
 * sheet reports, in the same pixels a measured browser prints.
 */
function withLayout<T>(box: { top: number; height: number }, run: () => T): T {
  const original = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
    return {
      top: box.top, bottom: box.top + box.height, height: box.height,
      left: 0, right: 390, width: 390, x: 0, y: box.top, toJSON() { return {}; },
    } as DOMRect;
  };
  try {
    return run();
  } finally {
    HTMLElement.prototype.getBoundingClientRect = original;
  }
}

describe('the More sheet escapes the app bar’s containing block', () => {
  it('mounts the sheet outside the header that paints it', () => {
    mount();
    const header = container!.querySelector('.meridian-header')!;
    const sheet = open();
    expect(sheet).not.toBeNull();
    expect(header.contains(sheet)).toBe(false);
    expect(sheet.closest('.meridian-header')).toBeNull();
    expect(document.body.contains(sheet)).toBe(true);
  });

  it('portals the scrim too, so it dims the screen instead of the app bar', () => {
    mount();
    open();
    const scrim = document.querySelector('.meridian-feature-scrim') as HTMLElement;
    const header = container!.querySelector('.meridian-header')!;
    expect(scrim).toBeTruthy();
    expect(header.contains(scrim)).toBe(false);
    // One layer holds both: the scrim cannot be left behind in the header while
    // the sheet travels, or the tap that closes it stops covering the page.
    expect(scrim.parentElement?.className).toBe('meridian-feature-layer');
    expect(scrim.parentElement).toBe(document.getElementById('ultracc-services-menu')?.parentElement);
  });

  it('stacks the portal layer above the shell furniture it now shares a context with', () => {
    expect(CHROME, 'the mobile ceiling is the app bar at 60').toBe(60);
    mount();
    open();
    const layer = document.querySelector('.meridian-feature-layer') as HTMLElement;
    const z = Number(layer.style.zIndex);
    expect(z).toBeGreaterThan(CHROME);
    // index.css pins the real overlays at 70; the sheet belongs on that shelf.
    expect(z).toBe(70);
  });

  it('sizes the layer by pinning it, the way the phone shell pins its frame', () => {
    mount();
    open();
    const layer = document.querySelector('.meridian-feature-layer') as HTMLElement;
    expect(layer.style.position).toBe('fixed');
    // Normalised to `0px` by a browser, kept as `0` by happy-dom; either way the
    // layer is stretched over the whole pinned frame rather than measured in units.
    expect(layer.style.inset).toMatch(/^0(px)?$/);
    // A viewport unit here would re-measure the layer against a different box than
    // the one #root is pinned to, which is how this sheet lost the screen once.
    const source = readFileSync(join(process.cwd(), 'src', 'components', 'MeridianHeader.tsx'), 'utf8');
    const portal = source.match(/createPortal\(<div className="meridian-feature-layer"[^>]*style=\{\{[^}]*\}\}/);
    expect(portal, 'the portal layer must stay a single inline-styled div').toBeTruthy();
    expect(portal![0]).not.toMatch(/\b(100)?(dvh|svh|lvh|vh)\b/);
    // And index.css must keep anchoring the sheet with viewport-relative coordinates
    // against the tab bar, which is what the pinned layer makes meaningful.
    expect(CSS).toMatch(/\.meridian-feature-menu[^{}]*\{[^}]*position:\s*fixed\s*!important/);
    expect(CSS).toMatch(/\.meridian-feature-menu[^{}]*\{[^}]*bottom:\s*calc\(var\(--uc-bar-h\)/);
  });

  it('keeps the student able to get out: scrim, tab, and Escape all close it', () => {
    mount();
    open();
    act(() => (document.querySelector('.meridian-feature-scrim') as HTMLElement).click());
    expect(document.getElementById('ultracc-services-menu')).toBeNull();

    open();
    act(() => moreButton()!.click());
    expect(document.getElementById('ultracc-services-menu')).toBeNull();

    open();
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.getElementById('ultracc-services-menu')).toBeNull();
  });

  it('hands the destination it opened for to the tab bar', () => {
    mount();
    const sheet = open();
    const labels = [...sheet.querySelectorAll('.feature-menu-groups button')].map((b) => b.textContent.trim());
    expect(labels.length).toBeGreaterThan(4);
    expect(labels.some((l) => /Attendance/.test(l))).toBe(true);
    expect(sheet.querySelector('.feature-menu-close')).toBeTruthy();
    // Portalling must not cost the sheet the scroll lock the header applies.
    expect(document.body.classList.contains('ultracc-modal-open')).toBe(true);
  });

  it('cannot reopen parked where an unfinished drag left it', () => {
    mount();
    const sheet = open();
    const title = sheet.querySelector<HTMLElement>('.feature-menu-title')!;
    // A thumb that slides down is a dismiss gesture; iOS may then swallow the
    // pointerup entirely, leaving the offset behind in the header.
    const fire = (type: string, clientY: number) => title.dispatchEvent(
      new MouseEvent(type, { bubbles: true, clientY, cancelable: true }),
    );
    act(() => {
      fire('pointerdown', 500);
      fire('pointermove', 700);
    });
    expect(sheet.style.transform, 'the sheet follows the finger while the drag is live').toContain('translateY');

    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.getElementById('ultracc-services-menu')).toBeNull();

    const again = open();
    expect(again.style.transform, 'a stale drag offset must not move the next opening').toBe('');
  });

  /**
   * The third report of the same symptom, measured instead of guessed. Portalling
   * the sheet fixed the frame it was measured in, and the drag guard fixed the state
   * that could move it, but both still end with the sheet leaning on the *bottom* of
   * a frame whose bottom edge index.css documents as unreadable on an installed
   * iPhone. So the component now measures its own landing and, when the phone put
   * that edge under the glass, hangs the same menu from the top instead.
   */
  it('hangs the sheet from the top when it lands below the glass', () => {
    withLayout({ top: 900, height: 754 }, () => {
      mount();
      const sheet = open()!;
      expect(sheet, 'the sheet must still exist when it is rescued').toBeTruthy();
      expect(sheet.className).toContain('meridian-feature-rescue');
      expect(sheet.style.position).toBe('fixed');
      expect(sheet.style.top).toMatch(/^56(px)?$/);
      // The bottom is the edge that failed; the rescue must not mention it.
      expect(sheet.style.bottom).toBe('');
      expect(sheet.style.overflowY).toBe('auto');
      expect(sheet.style.transform, 'a rescue is a place to be, not a drag in progress').toBe('');
      // Rescued, but still the same menu the student came for.
      expect([...sheet.querySelectorAll('.feature-menu-groups button')].length).toBeGreaterThan(4);
      act(() => (document.querySelector('.meridian-feature-scrim') as HTMLElement).click());
      expect(document.getElementById('ultracc-services-menu')).toBeNull();
    });
  });

  it('rescues the sheet drawn above the screen too, the failure it was first reported as', () => {
    withLayout({ top: -767, height: 754 }, () => {
      mount();
      expect(open()!.className).toContain('meridian-feature-rescue');
    });
  });

  it('leaves the bottom-sheet anchoring alone when the sheet measurably lands on the glass', () => {
    withLayout({ top: 18, height: 754 }, () => {
      mount();
      const sheet = open()!;
      expect(sheet.className).toContain('meridian-feature-menu');
      expect(sheet.className).not.toContain('meridian-feature-rescue');
      expect(sheet.style.top, 'no inline box when index.css already put it on screen').toBe('');
    });
  });

  it('owes the rescue box nothing that a viewport unit measures', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'components', 'MeridianHeader.tsx'), 'utf8');
    const box = source.match(/const SHEET_RESCUE_BOX: React\.CSSProperties = \{[\s\S]*?\};/);
    expect(box, 'the rescue box must stay one literal so this guard can read it').toBeTruthy();
    expect(box![0]).not.toMatch(/\b(100)?(dvh|svh|lvh|vh)\b/);
    expect(box![0]).toMatch(/top:\s*56/);
  });
});
