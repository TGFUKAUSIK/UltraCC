/**
 * The predictor and the simulator both work on a course whose FAT weight VTOP
 * has not published yet — the exact shape a student sees after the first CAT.
 *
 * Every expectation is computed from `gradeProjection` in the test itself, so
 * this asserts "the screen and the engine agree", not "the screen says the
 * number I typed into this file".
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { GradePredictor } from '../GradePredictor';
import { WhatIfMarksSimulator } from '../WhatIfMarksSimulator';
import type { CourseMarks } from '../../types';
import {
  DEFAULT_FAT_WEIGHT,
  TARGET_SCORES,
  buildCourseModel,
  projectCoursePercent,
  projectedPercentLabel,
  solveTargetFAT,
  withAssumedFat,
} from '../../utils/gradeModel';
import { projectCourse } from '../../utils/gradeProjection';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** One internal graded at a 12% pace, the rest declared, no FAT row at all. */
function courseWithoutFat(): CourseMarks {
  return {
    courseCode: 'BAEEE103',
    courseTitle: 'Analog Electronics',
    cat1: { scored: 6, max: 50, weightage: 15, status: 'Evaluated' },
    cat2: { scored: 0, max: 0, weightage: 15, status: 'Pending' },
    da1: { scored: 0, max: 0, weightage: 5, status: 'Pending' },
    da2: { scored: 0, max: 0, weightage: 5, status: 'Pending' },
    da3: { scored: 0, max: 0, weightage: 0, status: 'Pending' },
    quiz: { scored: 0, max: 0, weightage: 10, status: 'Pending' },
    fat: { scored: 0, max: 0, weightage: 0, status: 'Pending' },
    totalScoredSoFar: 0,
    currentEstimatedGrade: '',
  };
}

const FAT_WEIGHT = DEFAULT_FAT_WEIGHT; // 40 — VIT's published final exam.
const assumedModel = withAssumedFat(buildCourseModel(courseWithoutFat()), FAT_WEIGHT);

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function mount(Component: ComponentType<{ marks: CourseMarks[] }>) {
  // The predictor asks the community-stats endpoint on mount; answer "nobody has
  // submitted yet" so the test runs on VIT's published bands and never hits the net.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }) as Response));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(Component, { marks: [courseWithoutFat()] }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function text(): string {
  return container?.textContent ?? '';
}

function ranges(): HTMLInputElement[] {
  return [...(container?.querySelectorAll('input[type="range"]') ?? [])] as HTMLInputElement[];
}

/** The per-assessment sliders only — not the course select, μ/σ or FAT-weight knobs. */
function rowSliders(): HTMLInputElement[] {
  return ranges().filter((r) => {
    const label = r.getAttribute('aria-label') ?? '';
    return label.includes('score, out of') || label.includes('share of this assessment');
  });
}

function figureUnder(heading: string): string {
  const label = [...(container?.querySelectorAll('p') ?? [])]
    .find((p) => p.textContent?.trim() === heading);
  const raw = (label?.nextElementSibling?.textContent ?? '').trim();
  return raw.endsWith('/100') ? raw.slice(0, -'/100'.length) : raw;
}

function rangeByLabel(needle: string): HTMLInputElement {
  const el = ranges().find((r) => (r.getAttribute('aria-label') ?? '').includes(needle));
  expect(el, `range with label "${needle}"`).toBeDefined();
  return el!;
}

function drag(slider: HTMLInputElement, value: string) {
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

/** The projected total the open course's detail body prints. */
function projectedTotal(): string {
  const term = [...(container?.querySelectorAll('dt') ?? [])]
    .find((dt) => (dt.textContent ?? '').startsWith('Projected total'));
  return (term?.nextElementSibling?.textContent ?? '').trim().replace(/\s*\/\s*100$/, '');
}

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  container?.remove();
  container = null;
  vi.unstubAllGlobals();
  try { localStorage.removeItem('gradeStats:BAEEE103'); } catch { /* ignore */ }
});

describe('the grade predictor with no FAT weight from VTOP', () => {
  it('opens a course onto the one control that decides it', async () => {
    await mount(GradePredictor);
    expect(text()).toContain('Predicted SGPA');
    expect(text()).toContain('Predicted CGPA');
    expect(text()).toContain('Prediction confidence');
    click('BAEEE103');
    expect(text()).toContain('What do you expect in the theory FAT?');
    // The final exam is a fixed 40% of the course; there is no weight knob a
    // student could use to talk the paper down.
    expect(text()).not.toContain('Final-exam weight');
    expect(projectCourse(courseWithoutFat()).fat.weight).toBe(FAT_WEIGHT);
  });

  it('prints the projection the engine computes', async () => {
    await mount(GradePredictor);
    click('BAEEE103');
    const expected = projectCourse(courseWithoutFat()).scenarios.expected.percent;
    expect(projectedTotal()).toBe(projectedPercentLabel(expected));
  });

  it('makes the FAT slider actually move the projected total', async () => {
    await mount(GradePredictor);
    click('BAEEE103');
    const fatSlider = ranges()[0];
    // The anchor is the student's internal pace — 6 of an internal 15 — and the
    // slider is a percentage of the paper, so it starts at 12, not at 60.
    expect(fatSlider.value).toBe('12');

    drag(fatSlider, '100');
    const atHundred = projectCourse(courseWithoutFat(), { fatPercent: 100 }).scenarios.expected.percent;
    expect(projectedTotal()).toBe(projectedPercentLabel(atHundred));
    expect(projectedTotal()).not.toBe(
      projectedPercentLabel(projectCourse(courseWithoutFat()).scenarios.expected.percent),
    );
  });

  it('warns when the scenario it draws puts the paper under 40%', async () => {
    await mount(GradePredictor);
    click('BAEEE103');
    // The pace starts at 12, so the conservative reading is 2% of the paper.
    expect(text()).toContain('Under 40% on the FAT paper is an F course');
    drag(ranges()[0], '90');
    expect(text()).not.toContain('Under 40% on the FAT paper is an F course');
  });

  it('moves the reading with one scenario control', async () => {
    await mount(GradePredictor);
    click('BAEEE103');
    const expected = projectedPercentLabel(projectCourse(courseWithoutFat()).scenarios.expected.percent);
    click('Conservative');
    const conservative = projectCourse(courseWithoutFat()).scenarios.conservative.percent;
    expect(projectedTotal()).toBe(projectedPercentLabel(conservative));
    expect(projectedTotal()).not.toBe(expected);
  });

  it('names the VIT band rule when no class data exists', async () => {
    await mount(GradePredictor);
    click('BAEEE103');
    expect(text()).toContain('VIT’s published bands decide the letter');
  });
});

describe('the marks simulator with no FAT weight from VTOP', () => {
  it('gives the declared-but-unsized rows a slider instead of hiding them', async () => {
    await mount(WhatIfMarksSimulator);
    // CAT 1, CAT 2, DA 1, DA 2, Quiz and the assumed FAT: six rows, six sliders.
    // (The FAT-weight knob is a seventh range but not an assessment row.)
    expect(rowSliders()).toHaveLength(6);
    expect(ranges()).toHaveLength(7);
    const cat2 = rangeByLabel('CAT 2');
    expect(cat2.getAttribute('aria-label')).toContain('share of this assessment');
    expect(cat2.max).toBe('100');
    expect(text()).toContain('assumed');
  });

  it('batch-fills the rows VTOP never sized, in percent', async () => {
    await mount(WhatIfMarksSimulator);
    click('80%');
    expect(rangeByLabel('CAT 2').value).toBe('80');

    const rowPercents = { cat2: 80, da1: 80, da2: 80, quiz: 80, fat: 80 };
    expect(figureUnder('In this what-if')).toBe(
      projectCoursePercent(assumedModel, { rowPercents })!.toFixed(1),
    );
  });

  it('solves a target from the assumed FAT weight', async () => {
    await mount(WhatIfMarksSimulator);
    click('E');
    const target = solveTargetFAT(assumedModel, TARGET_SCORES.E);
    expect(target.isUnknown).toBe(false);
    expect(target.requiredRaw).toBeGreaterThan(0);
    expect(text()).toContain(`Need ${target.requiredRaw} / ${target.fatMax} in the FAT`);
    expect(text()).toContain('final-exam weight yet');
  });
});
