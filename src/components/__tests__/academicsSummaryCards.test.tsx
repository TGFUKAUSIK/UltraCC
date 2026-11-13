/**
 * The three attendance cards, rendered, with the slider in the student's hand.
 *
 * The unit tests prove the band copy is generated from the thresholds. These
 * prove the Academics screen actually prints it: that the number and the
 * sentence under it are produced in the same render, and that dragging the bar
 * rewrites the sentence instead of leaving yesterday's rule on the card.
 *
 * The fixture is built so each card has something to count at both bars:
 *  - CSE1001  20/24 (83.3%) — safe at 75, short of target at 85
 *  - CSE2001  32/40 (80%)   — safe at 75, short of target at 85
 *  - MAT2001  20/30 (66.7%) — under VTOP's line either way
 *  - BAB1001  0/0           — VTOP has posted nothing, so it is not a verdict
 */

import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AcademicsView } from '../AcademicsView';
import { AttendanceRecord } from '../../types';
import { saveTargetAttendance } from '../../lib/settings';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TARGET_KEY = 'ultracc.targetAttendance';

const attendance: AttendanceRecord[] = [
  { courseCode: 'CSE1001', courseTitle: 'Programming Fundamentals', type: 'ETH', slot: 'A1', facultyName: 'Dr. A', attended: 20, totalHeld: 24, percentage: 83.3, lastUpdated: '2026-09-01', venue: 'SJT' },
  { courseCode: 'CSE2001', courseTitle: 'Data Structures', type: 'ETH', slot: 'B2', facultyName: 'Dr. B', attended: 32, totalHeld: 40, percentage: 80, lastUpdated: '2026-09-01', venue: 'SJT' },
  { courseCode: 'MAT2001', courseTitle: 'Linear Algebra', type: 'ETH', slot: 'C3', facultyName: 'Dr. C', attended: 20, totalHeld: 30, percentage: 66.7, lastUpdated: '2026-09-01', venue: 'MMRS' },
  { courseCode: 'BAB1001', courseTitle: 'Ideology and Constitution', type: 'ETH', slot: 'D1', facultyName: 'Dr. D', attended: 0, totalHeld: 0, percentage: 0, lastUpdated: '2026-09-01', venue: '—' },
];

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function render() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(createElement(AcademicsView, { attendance, timetable: [] })));
}

function card(label: string): string {
  const match = Array.from(container?.querySelectorAll('.academics-summary-grid > div') ?? [])
    .find((card) => card.textContent?.includes(label));
  return match?.textContent ?? '';
}

function dragSliderTo(value: string) {
  const slider = container?.querySelector('input[type="range"]') as HTMLInputElement | null;
  expect(slider, 'the Academics target slider').not.toBeNull();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(slider, value);
  act(() => { slider!.dispatchEvent(new Event('input', { bubbles: true })); });
}

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  container?.remove();
  container = null;
  localStorage.removeItem(TARGET_KEY);
});

describe('the summary cards state the line they were counted against', () => {
  it('prints one card per band, each with its rule', () => {
    render();
    // Three <p> siblings, so textContent joins them with no separator.
    expect(card('Safe')).toMatch(/^2Safe/);
    expect(card('Safe')).toContain('at or above your 75%');
    expect(card('Warning')).toMatch(/^1Warning/);
    expect(card('Warning')).toContain('nothing recorded by VTOP yet');
    expect(card('At Risk')).toMatch(/^1At Risk/);
    expect(card('At Risk')).toContain('under VTOP’s 75% line');
  });

  it('quotes the saved bar on the first paint', () => {
    localStorage.setItem(TARGET_KEY, '85');
    render();
    expect(card('Safe')).toContain('at or above your 85%');
    expect(card('Warning')).toContain('75–84%');
  });

  it('rewrites the cards the moment the slider moves', () => {
    render();
    expect(card('Safe')).toContain('your 75%');
    dragSliderTo('85');
    // Two courses drop out of Safe, into a band that now has a range to name.
    expect(card('Safe')).toContain('at or above your 85%');
    expect(card('Warning')).toContain('75–84% · or nothing recorded');
    expect(card('Warning')).not.toContain('nothing recorded by VTOP yet');
    // The risk card is VTOP's line, so the student's bar cannot move it.
    expect(card('At Risk')).toContain('under VTOP’s 75% line');
  });

  it('counts the debared course by VTOP’s rule even at the highest bar', () => {
    dragAfterMount('95');
    expect(card('At Risk')).toContain('1At Risk');
    expect(card('Safe')).toContain('at or above your 95%');
  });

  it('keeps the counts honest: every course is in exactly one card', () => {
    render();
    const numbers = Array.from(container?.querySelectorAll('.academics-summary-grid > div p:first-child') ?? [])
      .map((p) => Number(p.textContent));
    expect(numbers.reduce((sum, n) => sum + n, 0)).toBe(4);
  });
});

/** Drag after the first render, so the test reads as one interaction. */
function dragAfterMount(value: string) {
  render();
  dragSliderTo(value);
}
