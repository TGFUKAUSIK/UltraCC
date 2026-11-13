/**
 * The Academics slider and the course-intelligence cards in one screen.
 *
 * Both are rendered stacked on the Academics tab (App.tsx), and both quote the
 * student's attendance bar. They used to quote different numbers: the slider
 * kept its choice in component state while the cards measured headroom against
 * a hardcoded 75, so a course at 83.3% showed "2 safe bunks" and "attend 3 in a
 * row" on one screen at once. These tests drag the real slider and read the real
 * cards, because the bug only existed at the seam between them.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement, Fragment } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AcademicsView } from '../AcademicsView';
import { CourseIntelView } from '../CourseIntelView';
import { AttendanceRecord } from '../../types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TARGET_KEY = 'ultracc.targetAttendance';

/** 20 of 24 classes attended = 83.3%: clear of VTOP's 75%, short of a 85% bar. */
const attendance: AttendanceRecord[] = [{
  courseCode: 'CSE1001',
  courseTitle: 'Problem Solving',
  type: 'ETH',
  slot: 'A1',
  facultyName: 'Dr. X',
  attended: 20,
  totalHeld: 24,
  percentage: 83.3,
  lastUpdated: '2026-09-01',
  venue: 'SJT',
}];

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function renderBoth() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(createElement(
    Fragment,
    null,
    createElement(AcademicsView, { attendance, timetable: [] }),
    createElement(CourseIntelView, { attendance, marks: [] }),
  )));
}

function text(): string {
  return container?.textContent ?? '';
}

/** Range inputs report through the native setter, or React sees an empty change. */
function dragSliderTo(value: string) {
  const slider = container?.querySelector('input[type="range"]') as HTMLInputElement | null;
  expect(slider, 'the Academics target slider').not.toBeNull();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(slider, value);
  act(() => { slider!.dispatchEvent(new Event('input', { bubbles: true })); });
}

function sliderValue(): string {
  return ((container?.querySelector('input[type="range"]') as HTMLInputElement | null)?.value) ?? '';
}

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  container?.remove();
  container = null;
  localStorage.removeItem(TARGET_KEY);
  localStorage.removeItem('ultracc.courseIntel.targets');
});

describe('the Academics tab answers the attendance question once', () => {
  it('starts both surfaces on VTOP\'s 75% when the student has set no bar', () => {
    renderBoth();
    expect(sliderValue()).toBe('75');
    expect(text()).toContain('2 safe bunks at your 75%');
    expect(text()).not.toContain('in a row to reach');
  });

  it('reads the saved bar on the first paint, before any effect', () => {
    localStorage.setItem(TARGET_KEY, '85');
    renderBoth();
    expect(sliderValue()).toBe('85');
    // 83.3% against 85%: ceil((85*24 - 100*20) / (100-85)) = 3 classes in a row.
    expect(text()).toContain('Attend 3 in a row to reach 85%');
    expect(text()).not.toContain('safe bunks at your');
  });

  it('moves every card the moment the slider moves — no remount, no stale 75%', () => {
    renderBoth();
    expect(text()).toContain('2 safe bunks at your 75%');
    dragSliderTo('85');
    expect(sliderValue()).toBe('85');
    expect(text()).toContain('Attend 3 in a row to reach 85%');
    expect(text()).not.toContain('2 safe bunks');
    // The bar is a saved preference, not one render's scratch state.
    expect(localStorage.getItem(TARGET_KEY)).not.toBeNull();
  });

  it('never leaves the slider inside the range it offers', () => {
    localStorage.setItem(TARGET_KEY, '97');
    renderBoth();
    // A hand-edited value above the slider's ceiling is clamped everywhere, so
    // the cards cannot quote a bar the control cannot be dragged to.
    expect(sliderValue()).toBe('95');
    expect(text()).not.toContain('at your 97%');
    expect(text()).toContain('to reach 95%');
  });
});
