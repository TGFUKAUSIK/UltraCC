/**
 * The deadlines timeline (production defect: every item whose moment had passed
 * was painted as an emergency and labelled "Due now", and a quiz was counted
 * down from the moment it *opened*, days before its real deadline).
 *
 * These mount the panel with instants placed around the current time and assert
 * the words a student reads, so a finished paper can never come back looking
 * like work still owed.
 *
 * The colour assertions below name the board's tone tokens (`uc-ink-critical` /
 * `uc-ink-warning`) rather than Tailwind's palette (`text-rose-700` / `amber`):
 * the redesign moved the countdown badge off fixed light-mode literals and onto
 * the `--uc-*` tokens the dark and midnight themes repaint. Same assertions,
 * new vocabulary — nothing was loosened.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DeadlinesView } from '../DeadlinesView';
import { ExamRecord } from '../../lib/vtop/types';
import { LmsAssignment, LmsCourse, LmsQuizWindow } from '../../lib/lms/types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const IST_OFFSET_MS = 5.5 * 3600 * 1000;
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

/** An instant written the way VTOP writes an exam date. */
const vtopDate = (ms: number) => {
  const d = new Date(ms + IST_OFFSET_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};

/** An instant written the way VTOP writes a clock time ("10:00"). */
const vtopTime = (ms: number) => {
  const d = new Date(ms + IST_OFFSET_MS);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};

const exam = (id: string, startMs: number, endMs: number | null): ExamRecord => ({
  id,
  slot: 'A1',
  courseCode: 'CSE2001',
  courseTitle: 'Data Structures',
  examType: 'CAT 2',
  date: vtopDate(startMs),
  time: endMs === null ? `${vtopTime(startMs)} AM` : `${vtopTime(startMs)} - ${vtopTime(endMs)}`,
  venue: 'SJT 402',
  seatNo: '',
  syllabusTopics: [],
});

const course: LmsCourse = { courseId: 7, name: 'Analog Electronics', shortName: 'BAEEE103', url: 'https://lms.vit.ac.in/course/7' };

const assignment = (name: string, dueMs: number): LmsAssignment => ({
  assignmentId: Math.round(dueMs),
  name,
  dueDate: new Date(dueMs).toISOString(),
  url: 'https://lms.vit.ac.in/assign/1',
  courseId: 7,
});

const quiz = (name: string, openMs: number, closeMs: number | null, submissionStatus: string | null = null): LmsQuizWindow => ({
  quizId: Math.round(openMs),
  name,
  openTime: new Date(openMs).toISOString(),
  closeTime: closeMs === null ? null : new Date(closeMs).toISOString(),
  attemptLimit: 1,
  timeLimitMins: 20,
  submissionStatus,
  url: 'https://lms.vit.ac.in/quiz/1',
  courseId: 7,
});

let host: HTMLElement;
let root: Root | null = null;

function mount(node: ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(node));
}

const panel = (props: Partial<Parameters<typeof DeadlinesView>[0]>) =>
  createElement(DeadlinesView, { exams: [], assignments: [], quizzes: [], courses: [course], ...props } as never);

/** The countdown badge belonging to the row whose title contains `text`. */
function badgeFor(text: string): HTMLElement {
  const heading = [...host.querySelectorAll('h4')].find((h) => (h.textContent || '').includes(text));
  const row = heading?.closest('div[class*="rounded-2xl"]');
  const spans = row ? row.querySelectorAll('span') : [];
  // The kind and source chips come first; the countdown is the row's last span.
  const badge = spans[spans.length - 1];
  if (!badge) throw new Error(`No countdown badge found for "${text}"`);
  return badge as HTMLElement;
}

// Every instant in this file is built by offsetting the clock, so the clock is
// pinned to a mid-morning India time. Run at 23:30 IST, the "paper still being
// written" window straddled midnight; examEndMs honestly refuses to put an end
// on the following day, the row lost its endsAt and read "Done" — a test that
// only passed between 09:00 and 22:00.
const IST_MORNING = Date.UTC(2026, 7, 18, 4, 30); // 10:00 on 2026-08-18 in India

beforeEach(() => {
  vi.useFakeTimers({ now: IST_MORNING, toFake: ['Date'] });
});

afterEach(() => {
  vi.useRealTimers();
  if (root) act(() => root!.unmount());
  root = null;
  host?.remove();
});

describe('a moment that has already passed', () => {
  it('calls work still owed overdue, in the urgent colour', () => {
    const now = Date.now();
    mount(panel({ assignments: [assignment('Lab record', now - DAY)] }));
    const badge = badgeFor('Lab record');
    expect(badge.textContent).toBe('Overdue');
    expect(badge.className).toContain('uc-ink-critical');
  });

  it('calls a finished exam done, in a calm colour', () => {
    const now = Date.now();
    mount(panel({ exams: [exam('done', now - 3 * HOUR, now - HOUR)] }));
    const badge = badgeFor('CSE2001');
    expect(badge.textContent).toBe('Done');
    expect(badge.className).not.toContain('critical');
  });

  it('says when the paper is still being written', () => {
    const now = Date.now();
    mount(panel({ exams: [exam('running', now - 30 * 60 * 1000, now + HOUR)] }));
    expect(badgeFor('CSE2001').textContent).toBe('Running');
  });

  it('never claims something is due now because its clock simply went by', () => {
    const now = Date.now();
    mount(panel({
      exams: [exam('done', now - 3 * HOUR, now - HOUR)],
      assignments: [assignment('Lab record', now - DAY)],
      quizzes: [quiz('Closed quiz', now - 2 * DAY, now - HOUR)],
    }));
    expect(host.textContent).not.toMatch(/Due now/);
  });
});

describe('a quiz window', () => {
  it('counts down to the close, not the open', () => {
    const now = Date.now();
    mount(panel({ quizzes: [quiz('Open quiz', now - 2 * DAY, now + 3 * HOUR)] }));
    const badge = badgeFor('Open quiz');
    // Two days past its opening but three hours from its deadline.
    expect(badge.textContent).toMatch(/^\d+h \d+m$/);
    expect(badge.className).toContain('uc-ink-warning');
  });

  it('names both ends of the window it is showing', () => {
    const now = Date.now();
    mount(panel({ quizzes: [quiz('Open quiz', now - 2 * DAY, now + 3 * HOUR)] }));
    const text = host.textContent || '';
    expect(text).toMatch(/Opens /);
    expect(text).toMatch(/Until /);
  });

  it('calls a shut window closed rather than overdue', () => {
    const now = Date.now();
    mount(panel({ quizzes: [quiz('Closed quiz', now - 2 * DAY, now - HOUR)] }));
    const badge = badgeFor('Closed quiz');
    expect(badge.textContent).toBe('Closed');
    expect(badge.className).not.toContain('critical');
  });
});

describe('the exam clock face', () => {
  it('prints the India hour VTOP wrote, whatever the device thinks', () => {
    // 09:00 in India today is 03:30 UTC — a device west of Greenwich would
    // otherwise print the same exam as a quarter past three.
    const start = istMorning(9, 0);
    mount(panel({ exams: [exam('ist', start, start + 150 * 60 * 1000)] }));
    const text = host.textContent || '';
    expect(text).toMatch(/Starts (Today|Yesterday|Tomorrow) • 9:00 AM/);
    expect(text).toMatch(/11:30 AM/);
    expect(text).not.toMatch(/3:30 AM/);
  });
});

/** An India-morning instant on today's India date. */
function istMorning(hour: number, minute: number): number {
  const ist = new Date(Date.now() + IST_OFFSET_MS);
  return Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - IST_OFFSET_MS + hour * HOUR + minute * 60 * 1000;
}

describe('reaching a course from a deadline', () => {
  it('gives the drill-down a real control a keyboard can stop on', () => {
    const now = Date.now();
    let opened = '';
    mount(panel({
      exams: [exam('ist', now + DAY, now + DAY + HOUR)],
      onOpenCourse: (code) => { opened = code; },
    }));
    const button = host.querySelector<HTMLButtonElement>('button[aria-label*="Open"]');
    expect(button).toBeTruthy();
    expect(button!.getAttribute('aria-label')).toContain('Data Structures');
    act(() => button!.click());
    expect(opened).toBe('CSE2001');
  });

  it('does not offer a control for a row with nowhere to go', () => {
    const now = Date.now();
    mount(panel({ assignments: [assignment('Lab record', now + DAY)] }));
    expect(host.querySelector('button[aria-label*="Open"]')).toBeNull();
  });
});
