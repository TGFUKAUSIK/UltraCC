/**
 * A grades screen the app can link to.
 *
 * Four chips sit on one page here, and they answer four different questions:
 * what VTOP has marked so far, what a future mark would do, what has already
 * been awarded, and what a grade is likely to be. Until now only a click could
 * choose between them, so the most useful thing a student could do with a
 * working answer — send it to a friend — was impossible. A link to `?tab=grades`
 * always landed on the marks table, and a refresh after opening the predictor
 * threw the choice away.
 *
 * The chips now take part in the URL the way the Academics chips already do
 * (`?subtab=`), so a page can be opened on the screen it was named for, and a
 * value that matches no chip falls back to the marks table rather than showing
 * an empty page.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createElement, type ReactElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { GradesView } from '../GradesView';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const noMarks: never[] = [];

let root: Root | null = null;
let host: HTMLElement | null = null;

function mount(node: ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
}

const text = () => host?.textContent ?? '';

/** Put the address bar where the app would have put it, before the page mounts. */
function setUrl(search: string) {
  act(() => window.history.replaceState({}, '', `${window.location.pathname}${search}`));
}

const query = () => new URL(window.location.href).searchParams;

function chip(label: string): HTMLButtonElement | undefined {
  const chips = host ? Array.from(host.querySelectorAll<HTMLButtonElement>('button[role="tab"]')) : [];
  return chips.find((b) => (b.textContent ?? '').trim() === label);
}

const view = createElement(GradesView, {
  courseMarks: noMarks as never,
  timetable: noMarks as never,
  grades: null,
  gradeHistory: null,
  semesterGrades: null,
  curriculum: null,
  arrears: noMarks,
  lmsGradebook: noMarks,
});

beforeEach(() => setUrl(''));

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  host?.remove();
  host = null;
  setUrl('');
});

describe('Grades opens on the chip the link names', () => {
  it('shows the predictor with no click at all', () => {
    setUrl('?tab=grades&subtab=predictor');
    mount(view);
    expect(text()).toContain('A planning estimate from your marks');
    // The marks table is behind the chip, not on screen as well.
    expect(text()).not.toContain('Course marks');
  });

  it('shows the what-if simulator when the link names that chip', () => {
    setUrl('?tab=grades&subtab=simulator');
    mount(view);
    expect(text()).toContain('Marks Simulator');
    expect(text()).not.toContain('A planning estimate from your marks');
  });

  it('shows the grade history when the link names that chip', () => {
    setUrl('?tab=grades&subtab=history');
    mount(view);
    expect(text()).toContain('Final letter grades from VTOP');
    expect(text()).not.toContain('Course marks');
  });

  it('falls back to the marks table for a chip that does not exist', () => {
    setUrl('?tab=grades&subtab=od');
    mount(view);
    expect(text()).toContain('Course marks');
    expect(text()).not.toContain('A planning estimate from your marks');
    // And the bad parameter is corrected rather than left in the address bar.
    expect(query().get('subtab')).toBeNull();
  });
});

describe('the chosen chip is written into the address bar', () => {
  it('keeps a non-default chip and drops the default one', () => {
    mount(view);
    expect(query().get('subtab')).toBeNull();
    act(() => chip('Grade Predictor')!.click());
    expect(query().get('subtab')).toBe('predictor');
    act(() => chip('Simulator')!.click());
    expect(query().get('subtab')).toBe('simulator');
    act(() => chip('Marks')!.click());
    expect(query().get('subtab')).toBeNull();
  });

  it('leaves the rest of the link alone, including ?tab=', () => {
    setUrl('?tab=grades&subtab=predictor');
    mount(view);
    act(() => chip('Grade History')!.click());
    expect(query().get('tab')).toBe('grades');
    expect(query().get('subtab')).toBe('history');
  });
});

describe('the chip row says which screen is on', () => {
  it('is a tablist whose selected tab matches the view on screen', () => {
    setUrl('?tab=grades&subtab=predictor');
    mount(view);
    const row = host?.querySelector('[role="tablist"]');
    expect(row, 'the chip row').not.toBeNull();
    expect(row?.getAttribute('aria-label')).toBe('Grades screen');
    const selected = Array.from(host?.querySelectorAll('[role="tab"][aria-selected="true"]') ?? [])
      .map((b) => (b.textContent ?? '').trim());
    // Exactly one chip claims to be showing, and it is the one the URL named.
    expect(selected).toEqual(['Grade Predictor']);
  });

  it('moves the claim when the student changes chip', () => {
    mount(view);
    act(() => chip('Simulator')!.click());
    expect(chip('Simulator')?.getAttribute('aria-selected')).toBe('true');
    expect(chip('Marks')?.getAttribute('aria-selected')).toBe('false');
  });
});
