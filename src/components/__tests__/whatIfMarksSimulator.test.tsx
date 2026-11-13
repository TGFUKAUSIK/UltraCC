/**
 * The Marks Simulator answers with the model's numbers, not its own.
 *
 * This card used to keep a second copy of the grading rules: its own seven
 * bands, its own letter lookup, and a total that read every assessment VTOP has
 * not returned yet as a zero. A student with CAT1, CAT2 and the DAs back and the
 * FAT still open saw "35.0 / F" here while the predictor two cards above said
 * "38.9% · B" for the very same course, and the solver promised an S reachable
 * with a 30/100 FAT that VIT's 40% rule would fail anyway.
 *
 * Every expectation below is computed from `gradeModel` in the test itself, so
 * the assertion is "the screen and the model agree", not "the screen says the
 * number I typed into this file".
 */

import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { WhatIfMarksSimulator } from '../WhatIfMarksSimulator';
import type { CourseMarks } from '../../types';
import {
  TARGET_SCORES,
  buildCourseModel,
  projectCoursePercent,
  solveTargetFAT,
} from '../../utils/gradeModel';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Internals 35.5 of 50 → a 71% pace; the FAT (40 weight) is still open. */
function course(over: Partial<CourseMarks> = {}): CourseMarks {
  return {
    courseCode: 'CSE2008',
    courseTitle: 'Problem Solving and Programming',
    cat1: { scored: 15, max: 20, weightage: 15, status: 'Evaluated' },
    cat2: { scored: 15, max: 20, weightage: 15, status: 'Evaluated' },
    da1: { scored: 5, max: 10, weightage: 5, status: 'Evaluated' },
    da2: { scored: 5, max: 10, weightage: 5, status: 'Evaluated' },
    da3: { scored: 0, max: 0, weightage: 0, status: 'Pending' },
    quiz: { scored: 8, max: 10, weightage: 10, status: 'Evaluated' },
    fat: { scored: 0, max: 100, weightage: 40, status: 'Pending' },
    totalScoredSoFar: 0,
    currentEstimatedGrade: '',
    ...over,
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function mount(over: Partial<CourseMarks> = {}) {
  const marks = [course(over)];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(createElement(WhatIfMarksSimulator, { marks })));
  return marks[0];
}

function text(): string {
  return container?.textContent ?? '';
}

/** The figure under a tile heading ("Projected now" / "In this what-if"). */
function figureUnder(heading: string): string {
  const label = [...(container?.querySelectorAll('p') ?? [])]
    .find((p) => p.textContent?.trim() === heading);
  return label?.nextElementSibling?.textContent?.trim() ?? '';
}

/** Range inputs report through the native setter, or React sees an empty change. */
function dragSlider(index: number, value: string) {
  const sliders = [...(container?.querySelectorAll('input[type="range"]') ?? [])] as HTMLInputElement[];
  const slider = sliders[index];
  expect(slider, `slider ${index}`).toBeDefined();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(slider, value);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function click(needle: string) {
  const button = [...(container?.querySelectorAll('button') ?? [])]
    .find((b) => (b.textContent ?? '').includes(needle));
  expect(button, `button "${needle}"`).toBeDefined();
  act(() => { button!.click(); });
}

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  container?.remove();
  container = null;
});

describe('the marks simulator and the grade model say the same thing', () => {
  it('projects the open FAT at the student\'s pace instead of grading it zero', () => {
    const c = mount();
    const model = buildCourseModel(c);
    const percent = projectCoursePercent(model);

    expect(percent).toBeCloseTo(71, 1);
    expect(figureUnder('Projected now')).toBe(percent!.toFixed(1));
    // The figure this card used to print: internals only, FAT counted as 0.
    expect(text()).not.toContain('35.0');
    expect(text()).not.toMatch(/\bF\b/);
  });

  it('opens on the same target the reverse simulator solves', () => {
    const c = mount();
    const model = buildCourseModel(c);
    const target = solveTargetFAT(model, TARGET_SCORES.A);

    click('A');
    expect(text()).toContain(`Need ${target.requiredRaw} / ${target.fatMax} in the FAT`);
    expect(target.requiredRaw).toBeGreaterThan(0);
  });

  it('names VIT\'s 40% FAT floor when the target would land under it', () => {
    // Internals at a 60% pace: an E needs only 15 marks off the FAT paper, and
    // scoring them would still fail the course under VIT's 40%-of-FAT rule.
    const c = mount({
      cat1: { scored: 12, max: 20, weightage: 15, status: 'Evaluated' },
      cat2: { scored: 12, max: 20, weightage: 15, status: 'Evaluated' },
      da1: { scored: 6, max: 10, weightage: 5, status: 'Evaluated' },
      da2: { scored: 6, max: 10, weightage: 5, status: 'Evaluated' },
      quiz: { scored: 6, max: 10, weightage: 10, status: 'Evaluated' },
    });
    const model = buildCourseModel(c);
    const target = solveTargetFAT(model, TARGET_SCORES.E);
    expect(target.isAchievable).toBe(true);
    expect(target.meetsVITMinimumCutoff).toBe(false);

    click('E');
    expect(text()).toContain(`Need ${target.requiredRaw} / ${target.fatMax} in the FAT`);
    expect(text()).toContain(`at least ${target.vitFatMinimumRaw} / ${target.fatMax} in the FAT to pass`);
  });

  it('keeps a graded mark when the student simulates the rest', () => {
    mount();
    click('90');

    const cat1 = [...(container?.querySelectorAll('input[type="range"]') ?? [])][0] as HTMLInputElement;
    // CAT1 is already returned at 15/20: a "what if the rest goes well" must not
    // rewrite the marks the student actually has.
    expect(cat1.value).toBe('15');
    const fat = [...(container?.querySelectorAll('input[type="range"]') ?? [])].pop() as HTMLInputElement;
    expect(fat.value).toBe('90');
  });
});

describe('moving a slider is a what-if, not a new record', () => {
  it('moves only the row the student touched', () => {
    const c = mount();
    const model = buildCourseModel(c);
    const now = projectCoursePercent(model)!;

    // CAT1 → 20/20 lifts a 15-weight row from 11.25 to the full 15, and every
    // other row keeps its mark or its pace.
    const expected = projectCoursePercent(model, { rowPercents: { cat1: 100 } })!;
    dragSlider(0, '20');
    expect(figureUnder('In this what-if')).toBe(expected.toFixed(1));
    expect(expected).toBeGreaterThan(now);
    expect(text()).toContain('vs projected now');
    expect(figureUnder('Projected now')).toBe(now.toFixed(1));
  });

  it('lets a what-if raise a returned mark without changing the real one', () => {
    const c = mount();
    const model = buildCourseModel(c);
    const now = projectCoursePercent(model)!;

    dragSlider(0, '0');
    expect(figureUnder('In this what-if')).not.toBe(figureUnder('Projected now'));
    // The untouched projection is still VTOP's marks at VTOP's pace.
    expect(figureUnder('Projected now')).toBe(now.toFixed(1));
    expect(text()).toContain('What-if');
  });
});
