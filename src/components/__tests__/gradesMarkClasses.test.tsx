/**
 * The marks screen keeps an embedded course's two classes apart, on the list
 * and inside the sheet a row opens.
 *
 * VTOP serves an embedded course as a theory table and a lab table under one
 * code. The list prints one row per course with each class's own mark; the
 * detail sheet prints the two assessment tables separately and refuses a
 * /100 course total while the FAT is ungraded.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { GradesView } from '../GradesView';
import { SHARE_STORAGE_KEY } from '../../lib/gradeSharing';
import type { CourseMarks } from '../../types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const embedded: CourseMarks = {
  courseCode: 'BEEE2023',
  courseTitle: 'Electric Circuits and Systems',
  courseType: 'Embedded Theory',
  credits: 4,
  theoryCredits: 3,
  labCredits: 1,
  cat1: { scored: 42, max: 50, weightage: 15, status: 'Evaluated', part: 'T' },
  cat2: { scored: 0, max: 0, weightage: 0 },
  da1: { scored: 4, max: 5, weightage: 2.5, status: 'Evaluated', part: 'T' },
  da2: { scored: 0, max: 0, weightage: 0 },
  da3: { scored: 0, max: 0, weightage: 0 },
  quiz: { scored: 8, max: 10, weightage: 10, status: 'Evaluated', part: 'T' },
  extraComponents: [
    { title: 'Assessment - 1', scored: 2, max: 2, weightage: 20, status: 'Evaluated', part: 'L' },
    { title: 'Experiment', scored: 9, max: 10, weightage: 20, status: 'Evaluated', part: 'L' },
  ],
  fat: { scored: 0, max: 100, weightage: 40, status: 'Pending', part: 'T' },
  labFat: { scored: 40, max: 50, weightage: 60, status: 'Evaluated', part: 'L' },
  totalScoredSoFar: 27.5,
  currentEstimatedGrade: '',
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  // Sharing off, so the list's contribution effect never reaches the network,
  // and any cohort read the sheet starts fails at once instead of hanging.
  window.localStorage.clear();
  window.localStorage.setItem(SHARE_STORAGE_KEY, 'off');
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function render(marks: CourseMarks[] = [embedded]): Promise<void> {
  await act(async () => {
    root.render(createElement(GradesView, {
      courseMarks: marks,
      timetable: [],
      grades: null,
      semesterGrades: null,
      regNo: '25BEE0001',
      semesterId: 'CH20252605',
    }));
  });
}

function rows(): HTMLElement[] {
  return Array.from(host.querySelectorAll<HTMLElement>('.uc-course-row'));
}

function dialog(): HTMLElement | null {
  return host.querySelector<HTMLElement>('[role="dialog"]');
}

function figureText(row: HTMLElement): string[] {
  return Array.from(row.querySelectorAll('.uc-course-row-figs b')).map((b) => b.textContent ?? '');
}

function classTable(label: string): HTMLElement {
  const found = Array.from(host.querySelectorAll<HTMLElement>('.uc-course-class')).find(
    (s) => s.querySelector('h3')?.textContent === label,
  );
  expect(found, `${label} table`).toBeTruthy();
  return found!;
}

function tableLabels(el: HTMLElement): string[] {
  return Array.from(el.querySelectorAll('tbody th')).map((th) => th.textContent ?? '');
}

describe('marks list: one row per course', () => {
  it('lists a course with its code, title and kind, not an expanded sheet', async () => {
    await render();
    const [row] = rows();
    expect(rows()).toHaveLength(1);
    expect(row.querySelector('.uc-course-row-code')!.textContent).toBe('BEEE2023');
    expect(row.querySelector('.uc-course-row-title')!.textContent).toBe('Electric Circuits and Systems');
    expect(row.querySelector('.uc-course-kind')!.textContent).toBe('Theory + Lab');
    expect(row.querySelector('.uc-course-flag')!.textContent).toBe('Incomplete');
    // The assessments live behind the row, not inline.
    expect(host.querySelector('.uc-course-table')).toBeNull();
  });

  it('prints the pending theory FAT as an internal mark out of 60, not a course total', async () => {
    await render();
    // Theory: CAT 1 42/50×15 = 12.6, DA 1 2, Quiz 8 → 22.6 of 27.5 internal
    // weight, 82.18%, which is 49.3 of the 60-mark internal half. Its FAT is
    // pending, so there is no /100 course total yet.
    // Lab: internals 2/2×20 + 9/10×20 = 38/40 = 95% → 57/60, FAT 40/50 = 80%
    // of 40 → 32, so 89 of 100.
    expect(figureText(rows()[0])).toEqual(['49.3 / 60', '89.0 / 100']);
  });

  it('says a registered lab has no mark instead of inventing one', async () => {
    await render([{ ...embedded, extraComponents: [], labFat: undefined }]);
    expect(figureText(rows()[0])).toEqual(['49.3 / 60', 'Not published']);
  });

  it('heads a one-class course as Theory with a single figure', async () => {
    await render([{
      ...embedded,
      courseCode: 'BMAT1021',
      courseTitle: 'Calculus for Engineers',
      courseType: 'Theory Only',
      credits: 3,
      theoryCredits: 3,
      labCredits: 0,
      extraComponents: [],
      labFat: undefined,
    }]);
    const [row] = rows();
    expect(row.querySelector('.uc-course-kind')!.textContent).toBe('Theory');
    expect(figureText(row)).toEqual(['49.3 / 60']);
  });
});

describe('course details sheet', () => {
  it('opens from a row as a labelled dialog and shows the theory table', async () => {
    await render();
    await act(async () => rows()[0].click());

    const sheet = dialog();
    expect(sheet).toBeTruthy();
    expect(sheet!.getAttribute('aria-modal')).toBe('true');
    expect(sheet!.querySelector('.uc-course-code')!.textContent).toBe('BEEE2023');
    expect(sheet!.textContent).toContain('Faculty not synced');
    expect(sheet!.textContent).toContain('Slot not synced');
    expect(sheet!.textContent).toContain('Grade prediction');

    const headers = Array.from(classTable('Theory').querySelectorAll('thead th')).map((th) => th.textContent);
    expect(headers).toEqual(['Test', 'Max', 'Scored', 'Weight %', 'Weighted']);
    expect(tableLabels(classTable('Theory'))).toEqual(['CAT 1', 'Digital Assignment 1', 'Quiz / Online Assessment', 'FAT']);
    // The lab's paper must not reappear as a theory row.
    expect(tableLabels(classTable('Theory'))).not.toContain('Lab FAT');
  });

  it('keeps the lab table separate down to its own rows and mark', async () => {
    await render();
    await act(async () => rows()[0].click());

    const lab = classTable('Lab');
    expect(tableLabels(lab)).toEqual(['Assessment - 1', 'Experiment', 'Lab FAT']);
    expect(lab.querySelector('.uc-course-class-head .uc-num')!.textContent).toBe('89.0 / 100');
  });

  it('prints a pending FAT as Pending, not as a scored zero', async () => {
    await render();
    await act(async () => rows()[0].click());

    const fatRow = Array.from(classTable('Theory').querySelectorAll('tbody tr')).find(
      (tr) => tr.querySelector('th')!.textContent === 'FAT',
    )!;
    const cells = Array.from(fatRow.querySelectorAll('td')).map((td) => td.textContent);
    expect(cells[1]).toBe('Pending');
    expect(cells[3]).toBe('—');
  });

  it('does not invent a lab table for a theory-only course', async () => {
    await render([{
      ...embedded,
      courseType: 'Theory Only',
      credits: 3,
      theoryCredits: 3,
      labCredits: 0,
      extraComponents: [],
      labFat: undefined,
    }]);
    await act(async () => rows()[0].click());

    expect(Array.from(host.querySelectorAll('.uc-course-class h3')).map((h) => h.textContent)).toEqual(['Theory']);
  });

  it('shows the empty lab table when VTOP has published no lab marks', async () => {
    await render([{ ...embedded, extraComponents: [], labFat: undefined }]);
    await act(async () => rows()[0].click());

    const lab = classTable('Lab');
    expect(tableLabels(lab)).toEqual([]);
    expect(lab.textContent).toContain('VTOP has not published this lab’s marks yet.');
  });

  it('offers the share switch inside the prediction section, defaulting on', async () => {
    window.localStorage.removeItem(SHARE_STORAGE_KEY);
    await render();
    await act(async () => rows()[0].click());

    const toggle = host.querySelector<HTMLButtonElement>('.uc-predict-switch')!;
    expect(toggle.getAttribute('role')).toBe('switch');
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(host.textContent).toContain('Share my marks with UltraCC');
  });

  it('closes on Escape', async () => {
    await render();
    await act(async () => rows()[0].click());
    expect(dialog()).toBeTruthy();

    await act(async () => {
      document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(dialog()).toBeNull();
  });

  it('has a style rule for every element the list and sheet render', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
    for (const cls of [
      '.uc-course-row',
      '.uc-course-row-figs',
      '.uc-course-overlay',
      '.uc-course-sheet',
      '.uc-course-table',
      '.uc-course-summary',
      '.uc-predict-stats',
      '.uc-predict-switch',
    ]) {
      expect(css).toContain(cls);
    }
    // The blended course-level total the old card printed is gone.
    expect(css).not.toContain('.uc-mark-total');
  });
});
