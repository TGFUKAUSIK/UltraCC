/**
 * The exam board's own countdown — regression guard.
 *
 * A ledger row carried a date stamp and nothing else, so answering "how long
 * have I got?" meant reading the stamp, finding today in your head, and
 * subtracting: the one question the screen exists for was left as homework.
 * Each dated row now names its distance, from the same India-day gap the hero
 * counts with, so the two surfaces cannot print two answers.
 *
 * The gap is read from VTOP's own date labels rather than from a difference of
 * instants — which is what let a paper tomorrow at 14:00 round up into "2 days"
 * in the old hero.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ExamsView } from '../ExamsView';
import { istClock } from '../../utils/examUtils';
import type { ExamSchedule } from '../../types';
import type { MakeupExamRecord } from '../../lib/vtop/types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pad = (n: number) => String(n).padStart(2, '0');

/** A VTOP date + time exactly `days` India calendar days from now. */
function istInDays(days: number): { date: string; time: string } {
  const c = istClock(Date.now() + days * 86_400_000)!;
  return { date: `${c.year}-${pad(c.month + 1)}-${pad(c.day)}`, time: `${pad(c.hour)}:${pad(c.minute)}` };
}

function exam(id: string, code: string, over: Partial<ExamSchedule> = {}): ExamSchedule {
  return {
    id, courseCode: code, courseTitle: `${code} lecture`, examType: 'CAT 2',
    slot: 'A1', venue: 'SJT 402', seatNo: 'S-14', time: '', date: '',
    syllabusTopics: [], topicsCompleted: 0, studyPriority: 'Medium', ...over,
  };
}

const makeup = (over: Partial<MakeupExamRecord> = {}): MakeupExamRecord => ({
  id: 'm1', slot: '', courseCode: '', courseTitle: '', examType: 'Other',
  date: '2026-09-01', time: '', venue: '', seatNo: '', syllabusTopics: [],
  semesterId: 's1', semesterName: 'Fall 2025-26', ...over,
});

let host: HTMLElement;
let root: Root | null = null;

function render(exams: ExamSchedule[], makeupExams?: MakeupExamRecord[]) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(createElement(ExamsView, { exams, makeupExams, onNavigateMap: () => {} })));
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host?.remove();
});

const heroText = () => host.querySelector('[aria-label="Next examination"]')?.textContent ?? '';
const rows = () => Array.from(host.querySelectorAll<HTMLElement>('.uc-exams-row'));
const rowText = (i: number) => rows()[i]?.textContent ?? '';

describe('the exam board counts the distance to each paper', () => {
  it('leads with the nearest paper, dated in words', () => {
    render([exam('far', 'MAT2002', { ...istInDays(5) }), exam('near', 'CSE2004', { ...istInDays(1) })]);
    expect(heroText()).toContain('CSE2004');
    expect(heroText()).toContain('Tomorrow');
  });

  it('names how long each remaining paper is away, and repeats the lead nowhere', () => {
    render([
      exam('near', 'CSE2004', { ...istInDays(1) }),
      exam('mid', 'MAT2002', { ...istInDays(3) }),
      exam('far', 'PHY1001', { ...istInDays(5) }),
    ]);
    // The lead is the hero; the other two are ledger rows, each with its gap.
    expect(rows()).toHaveLength(2);
    expect(rowText(0)).toContain('in 3 days');
    expect(rowText(1)).toContain('in 5 days');
  });

  it('draws a codeless makeup row with a real name and no invented countdown', () => {
    render([], [makeup()]);
    expect(rowText(0)).toContain('Examination');
    expect(rowText(0)).not.toContain('—');
    expect(rowText(0)).not.toMatch(/in \d+ days|Today|Tomorrow/);
  });

  it('lists a paper VTOP has not dated without inventing a distance', () => {
    render([exam('pending', 'CSE2009', { date: '' })]);
    expect(rowText(0)).toContain('CSE2009');
    expect(rowText(0)).toContain('TBD');
    expect(rowText(0)).not.toMatch(/in \d+ days|Today|Tomorrow/);
  });

  it('says what is missing when VTOP has published nothing at all', () => {
    render([]);
    expect(host.textContent).toContain("VTOP has not published this semester's exam schedule yet.");
  });
});
