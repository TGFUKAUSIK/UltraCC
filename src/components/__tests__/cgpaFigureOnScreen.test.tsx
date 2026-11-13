/**
 * The CGPA a student actually sees, on the screens that show it.
 *
 * `gpaFigurePrecision.test.ts` proves no surface reshapes the number on the way
 * to the screen. These tests prove the screens agree once they get there: the
 * placements card and the CGPA simulator both answer "what is my CGPA" from one
 * VTOP record, and both used to answer differently — `8.925` here, `8.92` there,
 * and a `0` on the dashboard when VTOP had posted nothing at all.
 *
 * The second half is the one that bites: a student at 5.999 is not at 6.0, and
 * the tier card directly underneath says so. A label that rounded up would put
 * "6.00" next to "Below ≥ 6.00" on the same card.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CgpaSimulator } from '../CgpaSimulator';
import { PlacementPortalView } from '../PlacementPortalView';
import { CourseMarks, StudentProfile } from '../../types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const GOAL_KEY = 'ultracc_cgpa_goal';

function course(courseCode: string, courseTitle: string): CourseMarks {
  const none = { scored: 0, max: 0, weightage: 0, status: 'Pending' };
  return {
    courseCode,
    courseTitle,
    cat1: none, cat2: none, da1: none, da2: none, da3: none, quiz: none,
    fat: { max: 100, weightage: 100 },
    labFat: undefined,
    totalScoredSoFar: 0,
    currentEstimatedGrade: '',
  };
}

function profile(cgpa: number | null): StudentProfile {
  return {
    name: 'Test Student', regNo: '21BEC', branch: 'ECE', program: 'UG',
    school: 'School of Electrical Engineering', groupStudied: 'Computer with Maths',
    semester: 6, cgpa, totalCreditsCompleted: 60, totalCreditsRequired: 80,
    proctorName: 'Dr. Y', proctorContact: '', proctorAvailable: true,
    hostelBlock: 'G', roomNo: '101', dayScholar: false,
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function mount(element: ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(element));
}

function text(): string {
  return container?.textContent ?? '';
}

/** The figure under a tile heading, read from the tile that carries it. */
function figureUnder(heading: string): string {
  const label = Array.from(container?.querySelectorAll('p') ?? [])
    .find((p) => p.textContent?.trim() === heading);
  expect(label, `the “${heading}” label`).not.toBeUndefined();
  return label?.nextElementSibling?.textContent?.trim() ?? '';
}

/** Range inputs report through the native setter, or React sees an empty change. */
function setValue(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  // Only the key this file's own Save button writes.
  localStorage.removeItem(GOAL_KEY);
});

describe('the CGPA simulator prints what VTOP posted, one way', () => {
  // A 60-credit record at 8.925 and a seven-credit semester of straight A’s.
  const marks = [course('CSE1001', 'Problem Solving'), course('MAT2001', 'Calculus')];
  const credits = { CSE1001: 3, MAT2001: 4 };

  it('writes the stored CGPA to two decimals, truncated', () => {
    mount(createElement(CgpaSimulator, {
      marks, creditsByCourse: credits, cumulativeCgpa: 8.925, cumulativeCreditsEarned: 60,
    }));
    expect(figureUnder('Current CGPA')).toBe('8.92');
    expect(text()).not.toContain('8.925');
  });

  it('says so when VTOP has not posted a CGPA, instead of printing a zero', () => {
    mount(createElement(CgpaSimulator, {
      marks, creditsByCourse: credits, cumulativeCgpa: null, cumulativeCreditsEarned: null,
    }));
    expect(figureUnder('Current CGPA')).toBe('Not available');
  });

  it('predicts the semester and the new CGPA at the same precision', () => {
    mount(createElement(CgpaSimulator, {
      marks, creditsByCourse: credits, cumulativeCgpa: 8.925, cumulativeCreditsEarned: 60,
    }));
    // 63 points over 7 credits, then (535.5 + 63) / 67.
    expect(figureUnder('Predicted SGPA')).toBe('9.00');
    expect(figureUnder('Predicted CGPA')).toBe('8.93');
  });

  it('rounds the SGPA it asks for up, never down', () => {
    mount(createElement(CgpaSimulator, {
      marks, creditsByCourse: credits, cumulativeCgpa: 8.925, cumulativeCreditsEarned: 60,
    }));
    const target = container?.querySelector('input[aria-label="Target CGPA"]') as HTMLInputElement;
    expect(target, 'the target CGPA field').not.toBeNull();
    // A 9.00 CGPA needs 9.642857… SGPA. Telling the student 9.64 would send them
    // 0.003 short of the goal they just typed in.
    setValue(target, '9');
    expect(figureUnder('Required SGPA this semester')).toBe('9.65');
    expect(text()).not.toContain('9.64');
  });

  it('repeats the saved goal back in the same two decimals', () => {
    mount(createElement(CgpaSimulator, {
      marks, creditsByCourse: credits, cumulativeCgpa: 8.925, cumulativeCreditsEarned: 60,
    }));
    const target = container?.querySelector('input[aria-label="Target CGPA"]') as HTMLInputElement;
    setValue(target, '9');
    const save = Array.from(container?.querySelectorAll('button') ?? [])
      .find((b) => b.textContent?.trim() === 'Save');
    expect(save, 'the Save button').not.toBeUndefined();
    act(() => save?.click());
    expect(text()).toContain('9.00 CGPA');
    expect(text()).toContain('9.65');
  });
});

describe('the placements portal agrees with it', () => {
  it('shows the same CGPA the simulator shows', () => {
    mount(createElement(PlacementPortalView, { student: profile(8.925) }));
    expect(figureUnder('Your CGPA')).toBe('8.92');
    expect(text()).not.toContain('8.925');
  });

  it('does not round a student onto a cut-off it then fails them on', () => {
    mount(createElement(PlacementPortalView, { student: profile(5.999) }));
    expect(figureUnder('Your CGPA')).toBe('5.99');
    expect(text()).toContain('Below ≥6.00');
    expect(text()).not.toMatch(/Your CGPA[^0-9]*6\.00/);
  });

  it('writes every benchmark cut-off to two decimals', () => {
    mount(createElement(PlacementPortalView, { student: profile(8.0) }));
    expect(text()).toContain('Benchmark CGPA: ≥ 8.50');
    expect(text()).toContain('Benchmark CGPA: ≥ 7.50');
    expect(text()).toContain('Benchmark CGPA: ≥ 6.00');
    // The one-decimal benchmark next to the tier badge is what made the card
    // disagree with itself: “Below ≥8.5” beside “Benchmark CGPA: ≥ 8.50”.
    expect(text()).not.toMatch(/≥8\.5(?!0)/);
  });

  it('says not synced rather than showing an invented CGPA', () => {
    mount(createElement(PlacementPortalView, { student: profile(0) }));
    expect(figureUnder('Your CGPA')).toBe('Not synced');
  });
});
