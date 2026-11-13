/**
 * The hostel page has to be honest about what it does not have.
 *
 * Four chips, and only three of them answer: the leave tracker and the laundry
 * record work on this device, the helpline list is a reference, and the mess
 * menu has no source at all. The page used to open on that empty panel by
 * default, under a header that promised a "standard catering schedule", with a
 * dashed box explaining it in pipeline words ("not available from the current
 * VTOP sync", "official hostel-feed integration"). A first-time student could
 * not tell a missing feature from a broken app, and the laundry field greeted
 * them with a `0` the app had never measured.
 *
 * Now the page opens where there is something to do, `?subtab=` works the way it
 * does on Academics and Grades, and every panel says which of them is a student
 * report rather than a published fact.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { HostelSubTabs } from '../HostelSubTabs';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BAGS_KEY = 'ultracc_laundry_bags';
const LEAVES_KEY = 'ultracc_student_logged_leaves';

let root: Root | null = null;
let host: HTMLElement | null = null;

function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(createElement(HostelSubTabs)));
}

const text = () => host?.textContent ?? '';

function setUrl(search: string) {
  act(() => window.history.replaceState({}, '', `${window.location.pathname}${search}`));
}

const query = () => new URL(window.location.href).searchParams;

function chip(label: string): HTMLButtonElement | undefined {
  const chips = host ? Array.from(host.querySelectorAll<HTMLButtonElement>('button[role="tab"]')) : [];
  return chips.find((b) => (b.textContent ?? '').trim() === label);
}

function click(label: string) {
  const button = chip(label) ?? Array.from(host?.querySelectorAll<HTMLButtonElement>('button') ?? [])
    .find((b) => (b.textContent ?? '').trim() === label);
  act(() => button!.click());
}

beforeEach(() => {
  setUrl('');
  localStorage.removeItem(BAGS_KEY);
  localStorage.removeItem(LEAVES_KEY);
});

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  host?.remove();
  host = null;
  setUrl('');
  localStorage.removeItem(BAGS_KEY);
  localStorage.removeItem(LEAVES_KEY);
});

describe('the hostel page opens where there is something to do', () => {
  it('lands on the leave tracker with no chip clicked and no parameter', () => {
    mount();
    expect(text()).toContain('Hostel Leave Tracker');
    expect(text()).not.toContain('Hostel Mess Menu');
    expect(query().get('subtab')).toBeNull();
  });

  it('opens the screen a shared link names', () => {
    setUrl('?tab=hostel&subtab=laundry');
    mount();
    expect(text()).toContain('My Active Laundry');
    expect(query().get('subtab')).toBe('laundry');
  });

  it('ignores a chip this page does not have, and cleans it out of the link', () => {
    setUrl('?tab=hostel&subtab=od');
    mount();
    expect(text()).toContain('Hostel Leave Tracker');
    expect(query().get('subtab')).toBeNull();
  });

  it('writes the chip the student picks, and drops the default one again', () => {
    mount();
    click('Laundry');
    expect(query().get('subtab')).toBe('laundry');
    click('Mess');
    expect(query().get('subtab')).toBe('mess');
    click('Leave');
    expect(query().get('subtab')).toBeNull();
  });

  it('says which chip is on, in the way a screen reader expects', () => {
    setUrl('?tab=hostel&subtab=laundry');
    mount();
    expect(chip('Laundry')?.getAttribute('aria-selected')).toBe('true');
    expect(chip('Leave')?.getAttribute('aria-selected')).toBe('false');
  });
});

describe('a panel with no source behind it says so', () => {
  it('names the missing mess menu instead of inventing one', () => {
    mount();
    click('Mess');
    expect(text()).toContain('There is no menu for UltraCC to read');
    expect(text()).not.toMatch(/Breakfast|Lunch|Dinner/);
  });

  it('carries the student from the empty panel to a panel that works', () => {
    mount();
    click('Mess');
    click('Open the leave tracker');
    expect(text()).toContain('Hostel Leave Tracker');
    expect(query().get('subtab')).toBeNull();
  });

  it('starts the laundry count empty, not at a number it never measured', () => {
    mount();
    click('Laundry');
    const bags = host?.querySelector<HTMLInputElement>('input[type="number"]');
    expect(bags?.value).toBe('');
  });

  it('marks the collection timings as student reports, and asks for the check', () => {
    mount();
    click('Laundry');
    expect(text()).toContain('Laundry timings as reported by students');
    expect(text()).toContain('notice board');
  });

  it('gives an emergency line that does not depend on a listing being current', () => {
    mount();
    click('Counselling & Wardens');
    expect(text()).toContain('112');
    expect(text()).not.toContain('Official VIT Chennai campus wellness');
  });
});
