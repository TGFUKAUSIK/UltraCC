/**
 * Academic calendar day sheet — behaviour + CSS contract (production bug: the
 * date popup was mostly off-screen on a phone).
 *
 * The old popover was `fixed inset-0 z-50` with an unsized panel, so the
 * global bottom-sheet skin dropped it behind the fixed tab bar (z-59) and app
 * bar (z-60) with no internal scroll. Measured live before the fix:
 * `document.elementFromPoint` on the sheet's bottom rows returned
 * `NAV.mobile-tab-bar`. These tests pin the replacement: real dialog
 * semantics, Escape/backdrop dismissal, a scrollable body, and a layer that is
 * above the app chrome.
 *
 * Focus movement is deliberately NOT asserted here — happy-dom reports every
 * element as 0x0, so useDialog's visible-focus filter can only be exercised in
 * a real browser (see src/hooks/__tests__/useDialog.test.tsx).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../../lib/edgeFetch', () => ({
  edgeFetch: vi.fn(async () => { throw new Error('no network in tests'); }),
}));

import { AcademicCalendarView } from '../../components/AcademicCalendarView';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CSS_PATH = resolve(__dirname, '../../index.css');
const CSS = readFileSync(CSS_PATH, 'utf-8');

const DAY = (date: string, label: string) => ({
  date, instructional: false, dayOrder: null, label,
});

const CALENDAR = {
  months: [{ token: 'tok', monthKey: '2026-01' }],
  days: [
    DAY('2026-01-05', 'Republic Day Holiday'),
    DAY('2026-01-15', 'Mid Semester Examination'),
    DAY('2026-01-16', 'Week 4 classes'),
  ],
  available: true,
};

/** A day with far more events than a phone screen holds — the old popover
 *  overflowed the viewport with nothing to scroll, so its tail was lost. */
const BUSY_DAY = '2026-02-12';
const BUSY_CALENDAR = {
  months: [{ token: 'tok', monthKey: '2026-02' }],
  days: [
    ...Array.from({ length: 14 }, (_, i) => DAY(BUSY_DAY, `Assessment window ${i + 1}`)),
  ],
  available: true,
};

let host: HTMLElement;
let root: Root | null = null;

function mount(node: ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(node));
}

function unmount() {
  if (root) act(() => root!.unmount());
  root = null;
  host?.remove();
}

function click(el: Element | null | undefined) {
  expect(el, 'expected element to be present').toBeTruthy();
  act(() => { (el as HTMLElement).click(); });
}

function dayCell(day: number) {
  const cells = Array.from(host.querySelectorAll<HTMLButtonElement>('.calendar-day-cell'));
  return cells.find((c) => c.innerText.trim().startsWith(String(day)));
}

beforeEach(() => { host = document.createElement('div'); });
afterEach(unmount);

describe('day sheet opens as a dialog', () => {
  it('clicking a day with events opens an aria-modal dialog with a name', () => {
    mount(createElement(AcademicCalendarView, { calendar: CALENDAR }));
    expect(document.querySelector('[role="dialog"]')).toBe(null);

    click(dayCell(15));
    const sheet = document.querySelector<HTMLElement>('.calendar-day-sheet');
    expect(sheet).toBeTruthy();
    expect(sheet!.getAttribute('role')).toBe('dialog');
    expect(sheet!.getAttribute('aria-modal')).toBe('true');

    const labelId = sheet!.getAttribute('aria-labelledby');
    expect(labelId, 'sheet must be labelled by its own heading').toBeTruthy();
    const heading = document.getElementById(labelId!);
    expect(heading?.textContent).toMatch(/15 January/);
  });

  it('renders every event of a busy day inside the scrollable body', () => {
    mount(createElement(AcademicCalendarView, { calendar: BUSY_CALENDAR }));
    click(dayCell(12));
    const rows = document.querySelectorAll('.calendar-day-sheet-body .calendar-day-row');
    expect(rows.length).toBe(14);
    expect(rows[0].textContent).toContain('Assessment window 1');
    expect(rows[13].textContent).toContain('Assessment window 14');
  });

  it('closes on Escape, on the close button and on the backdrop', () => {
    mount(createElement(AcademicCalendarView, { calendar: CALENDAR }));
    const trigger = dayCell(5);
    click(trigger);
    expect(document.querySelector('.calendar-day-sheet')).toBeTruthy();

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(document.querySelector('.calendar-day-sheet')).toBe(null);

    click(dayCell(5));
    click(document.querySelector('.calendar-day-sheet-close'));
    expect(document.querySelector('.calendar-day-sheet')).toBe(null);

    click(dayCell(5));
    click(document.querySelector('.calendar-day-overlay'));
    expect(document.querySelector('.calendar-day-sheet')).toBe(null);
  });

  it('the close control has an accessible name', () => {
    mount(createElement(AcademicCalendarView, { calendar: CALENDAR }));
    click(dayCell(16));
    const close = document.querySelector('.calendar-day-sheet-close');
    expect(close?.getAttribute('aria-label')).toMatch(/close/i);
  });

  it('locks the document behind the sheet and unlocks it on close', () => {
    mount(createElement(AcademicCalendarView, { calendar: CALENDAR }));
    expect(document.body.classList.contains('ultracc-modal-open')).toBe(false);
    click(dayCell(15));
    expect(document.body.classList.contains('ultracc-modal-open')).toBe(true);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(document.body.classList.contains('ultracc-modal-open')).toBe(false);
  });
});

describe('day sheet CSS contract (mobile reachability)', () => {
  const overlay = CSS.match(/\.calendar-day-overlay \{([\s\S]*?)\}/)![1];
  const sheet = CSS.match(/\.calendar-day-sheet \{([\s\S]*?)\n\}/)![1];
  const body = CSS.match(/\.calendar-day-sheet-body \{([\s\S]*?)\n\}/)![1];

  it('paints above the fixed app bar (60) and tab bar (59)', () => {
    expect(overlay).toMatch(/z-index: 80/);
    expect(overlay).toMatch(/position: fixed/);
  });

  it('caps its own height and scrolls INSIDE the sheet', () => {
    expect(sheet).toMatch(/max-height:/);
    expect(sheet).toMatch(/overflow: hidden/);
    expect(body).toMatch(/overflow-y: auto/);
    expect(body).toMatch(/min-height: 0/);
    expect(body).toMatch(/overscroll-behavior: contain/);
  });

  it('never cancels touch scrolling on the scrim', () => {
    // touch-action is inherited by INTERSECTION: `none` on the scrim cancelled
    // the `pan-y` that lets the event list answer a finger, so a day with more
    // events than a screen held showed its header and nothing else. The
    // app-wide pull-to-refresh guard lives on html/body, not here.
    expect(overlay).not.toMatch(/touch-action:\s*none/);
    expect(body).toMatch(/touch-action: pan-y/);
  });

  it('keeps the close target at least 44px', () => {
    const close = CSS.match(/\.calendar-day-sheet-close \{([\s\S]*?)\n\}/)![1];
    expect(close).toMatch(/width: 44px/);
    expect(close).toMatch(/height: 44px/);
  });

  it('becomes a bottom sheet on phones, clear of the tab bar and safe area', () => {
    const mobile = CSS.match(/@media \(max-width: 700px\) \{[\s\S]*?\.calendar-day-overlay[\s\S]*?\n\}/);
    expect(mobile, 'no mobile block for the day sheet').toBeTruthy();
    expect(mobile![0]).toMatch(/align-items: flex-end/);
    // The clearance is PAD on the scrim, not a subtraction from the sheet's
    // height: a bottom-aligned item ends at the scrim's edge whatever its
    // max-height says, so only padding actually lifts it above the tab bar.
    expect(mobile![0]).toMatch(/padding: 0 0 calc\(70px \+ env\(safe-area-inset-bottom\)\)/);
    expect(mobile![0]).toMatch(/max-height: 100%/);
  });

  it('anchors the scrim to the same pinned box as the app shell', () => {
    // `inset: 0` used to size to the LAYOUT viewport, taller on a phone than
    // what is visible while the browser toolbar is up — the tail of the sheet
    // landed behind that toolbar — so the scrim compensated with an explicit
    // `height: 100vh/100dvh`. `#root` is pinned with `position: fixed;
    // inset: 0` now and the shell is 100% of it, so the scrim is anchored to
    // that same box by construction and the viewport unit is gone. Re-adding one
    // is the regression the shell guard exists to catch.
    expect(overlay).toMatch(/position: fixed/);
    expect(overlay).toMatch(/inset: 0/);
    expect(overlay, 'a viewport unit here re-opens the iOS band').not.toMatch(/height:\s*100(vh|dvh|svh)/);
  });

  it('does not depend on the generic fixed/inset-0 sheet skin', () => {
    // That selector forced align-items:flex-end + max-height:92dvh on this
    // popover while its own classes asked for something else — the coupling
    // that made the sheet un-scrollable. Named classes own it now.
    const jsx = readFileSync(resolve(__dirname, '../../components/AcademicCalendarView.tsx'), 'utf-8');
    expect(jsx).not.toMatch(/className="fixed inset-0/);
  });
});

describe('month navigation is unaffected', () => {
  it('still renders the VTOP month grid and its labels', () => {
    mount(createElement(AcademicCalendarView, { calendar: CALENDAR }));
    expect(host.querySelector('.calendar-grid')).toBeTruthy();
    expect(host.textContent).toContain('Mid Semester Examination');
    expect(host.textContent).toContain('Republic Day Holiday');
  });
});
