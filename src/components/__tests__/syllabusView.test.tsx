/**
 * The Syllabus tab, rendered — a course code, a course name and one button.
 *
 * The brief's rule for this screen, asserted here: the student selects a COURSE
 * and nothing else. No slot, no faculty, no class id, no venue, no credits and
 * no "timetable" label may appear anywhere on the page or in the request the
 * gateway is handed; the semester is the gateway's problem, not the student's.
 *
 * The store is mocked (VTOP is not called from a test), so what is asserted is
 * exactly what the student reads and exactly what one tap sends.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { TimetableSlot } from '../../lib/vtop/types';
import { NO_COURSE_MESSAGE, NO_SESSION_MESSAGE, UNREACHABLE_MESSAGE } from '../../lib/syllabus';
import { SyllabusView } from '../SyllabusView';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** One timetable row, as the tab receives it from a sync. */
function slot(over: Partial<TimetableSlot>): TimetableSlot {
  return {
    id: over.id ?? Math.random().toString(36),
    slot: 'A1', courseCode: 'CSE1001', courseTitle: 'Problem Solving with Python',
    courseType: 'ETH', facultyName: 'Dr. R. Kanna', venue: 'TT-01', building: 'CSE Block 1',
    startTime: '09:00', endTime: '09:50', day: 'Monday', credits: 3, ...over,
  } as TimetableSlot;
}

/** The reported production course, alongside a second one. */
const TIMETABLE: TimetableSlot[] = [
  slot({
    courseCode: 'BAEEE203', courseTitle: 'Microcontrollers', courseType: 'ETH',
    slot: 'F1', venue: 'SJT 402', facultyName: 'Dr. K. Arul', credits: 4, day: 'Monday',
  }),
  slot({
    courseCode: 'CSE2009', courseTitle: 'Soft Computing', courseType: 'ETH',
    slot: 'A1', venue: 'TT-01', facultyName: 'S Subhani', credits: 3, day: 'Tuesday',
  }),
];

const DOC = {
  dataUrl: 'data:application/pdf;base64,JVBERi0=',
  contentType: 'application/pdf',
  fileName: 'BAEEE203-syllabus.pdf',
  bytes: 2048,
  origin: 'course-syllabus' as const,
};

type Answer = (deps: unknown) => Promise<{ status: unknown; cacheNote?: string }>;

/** The mocked module boundary: the tab's one call out, recorded verbatim. */
const state = vi.hoisted(() => ({
  sessionActive: true,
  calls: [] as unknown[],
  answer: null as null | ((deps: unknown) => Promise<{ status: unknown; cacheNote?: string }>),
}));

vi.mock('../../lib/syllabusStore', () => ({
  loadCourseSyllabus: async (deps: unknown) => {
    state.calls.push(deps);
    return state.answer ? state.answer(deps) : { status: { kind: 'idle' } };
  },
  clearCourseSyllabus: async () => undefined,
}));

vi.mock('../../lib/vtop/liveSession', () => ({
  getLiveClient: () => ({}),
  isLiveSessionActive: () => state.sessionActive,
}));

vi.mock('../../lib/vtop/useLiveSession', () => ({
  useLiveSessionActive: () => state.sessionActive,
}));

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let onLogin = vi.fn();

/** React's own whitespace, collapsed so a card's text can be compared exactly. */
function collapse(value: string | null): string {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function mount(timetable: TimetableSlot[] = TIMETABLE) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(createElement(SyllabusView, {
      timetable, onLogin, semesterId: 'CH2025261', semesterLabel: 'Fall Semester 2026-27',
      registrationNo: '21BCE9999',
    }));
  });
}

function text(): string {
  return collapse(host!.textContent);
}

function buttons(): HTMLButtonElement[] {
  return Array.from(host!.querySelectorAll('button'));
}

/** The one control a course card carries, found by the code in its label. */
function cardButton(code: string): HTMLButtonElement {
  const found = buttons().find((b) => (b.getAttribute('aria-label') || '').endsWith(`— ${code}`));
  if (!found) throw new Error(`no button rendered for ${code}`);
  return found;
}

function card(code: string): HTMLElement {
  const found = cardButton(code).parentElement;
  if (!found) throw new Error(`no card rendered for ${code}`);
  return found;
}

/** The sheet's own one-line outcome button, which is the last one rendered. */
function sheetAction(label: string): HTMLButtonElement {
  const found = buttons().filter((b) => collapse(b.textContent) === label).pop();
  if (!found) throw new Error(`no "${label}" action rendered`);
  return found;
}

function clickButton(button: HTMLButtonElement) {
  return act(async () => {
    button.click();
    await Promise.resolve();
  });
}

/** Every interactive control the student could be asked to operate. */
function pickers(): Element[] {
  return Array.from(host!.querySelectorAll('select, input, [role="listbox"], [role="combobox"]'));
}

beforeEach(() => {
  state.calls.length = 0;
  state.sessionActive = true;
  state.answer = async () => ({ status: { kind: 'ready', document: DOC, cached: false } });
  onLogin = vi.fn();
});

afterEach(() => {
  act(() => { root?.unmount(); });
  host?.remove();
  root = null;
  host = null;
});

describe('the course list — a code, a name, and one button', () => {
  it('shows exactly the course code, the course name and [ Syllabus ] on each card', () => {
    mount();

    // The card's whole text: strip the three things it may show, and nothing
    // is left — no faculty, no slot, no venue, no credit count, no type tag.
    for (const [code, title] of [['BAEEE203', 'Microcontrollers'], ['CSE2009', 'Soft Computing']]) {
      const shown = collapse(card(code).textContent);
      expect(shown, code).toContain(code);
      expect(shown, code).toContain(title);
      expect(shown, code).toContain('Syllabus');
      expect(shown.replace(new RegExp(`${code}|${title}|Syllabus`, 'g'), ''), code).toBe('');
    }
    expect(collapse(cardButton('BAEEE203').textContent)).toBe('Syllabus');
  });

  it('prints none of the schedule or class placement the card used to show', () => {
    mount();
    const shown = text();

    // The removed labels, and the facts behind them.
    expect(shown).not.toMatch(/timetable|synced|faculty|slot|venue|credit/i);
    expect(shown).not.toContain('Dr. K. Arul');
    expect(shown).not.toContain('S Subhani');
    expect(shown).not.toContain('SJT 402');
    expect(shown).not.toContain('TT-01');
    expect(shown).not.toMatch(/ETH|ELA/);
  });

  it('titles itself with the semester and how many courses it holds', () => {
    mount();
    expect(text()).toContain('Fall Semester 2026-27 · 2 courses');

    act(() => { root?.render(createElement(SyllabusView, {
      timetable: [TIMETABLE[0]], onLogin, semesterId: 'CH2025261', semesterLabel: 'Fall Semester 2026-27',
      registrationNo: '21BCE9999',
    })); });
    expect(text()).toContain('Fall Semester 2026-27 · 1 course');
  });

  it('says there is nothing to show rather than showing nothing', () => {
    mount([]);
    expect(text()).toContain('No courses to show yet');
    expect(buttons()).toHaveLength(0);
  });
});

describe('one tap asks VTOP for that course — and nothing else', () => {
  it('sends the course identity, the term and the student, with no class placement', async () => {
    mount();
    await clickButton(cardButton('BAEEE203'));

    expect(state.calls).toHaveLength(1);
    const deps = state.calls[0] as Record<string, unknown>;
    // The whole argument list, so a field added later fails here.
    expect(Object.keys(deps).sort()).toEqual([
      'cache', 'client', 'course', 'force', 'registrationNo', 'sessionActive', 'term',
    ]);
    expect(deps.course).toEqual({ courseCode: 'BAEEE203', courseTitle: 'Microcontrollers' });
    expect(deps.term).toEqual({ semesterId: 'CH2025261', semesterLabel: 'Fall Semester 2026-27' });
    expect(deps.registrationNo).toBe('21BCE9999');
    expect(deps.force).toBe(false);
    expect(JSON.stringify({ course: deps.course, term: deps.term }))
      .not.toMatch(/slot|faculty|class|erp|option|venue|choice/i);
  });

  it('shows a fetch in progress and never asks a second question', async () => {
    // Never resolves: the tab stays in its loading state for the assertion.
    state.answer = () => new Promise(() => {});
    mount();
    await clickButton(cardButton('BAEEE203'));

    expect(text()).toContain('Fetching syllabus…');
    expect(cardButton('BAEEE203').disabled).toBe(true);
    expect(state.calls).toHaveLength(1);
    expect(pickers()).toHaveLength(0);
  });

  it('reports a failure in the prescribed sentence, with a retry and no picker', async () => {
    state.answer = async () => ({ status: { kind: 'unavailable', reason: 'no-course-match', message: NO_COURSE_MESSAGE } });
    mount();
    await clickButton(cardButton('BAEEE203'));

    expect(text()).toContain(NO_COURSE_MESSAGE);
    expect(text()).not.toMatch(/no such course|gateway|class|slot|faculty/i);
    expect(pickers()).toHaveLength(0);
    expect(text()).toContain('Try again');

    // The retry is a real second ask, and the student chose nothing but it.
    await clickButton(sheetAction('Try again'));
    expect(state.calls).toHaveLength(2);
  });

  it('offers Try again only after a real failure', async () => {
    mount();
    expect(text()).not.toContain('Try again');

    state.answer = async () => ({ status: { kind: 'error', message: UNREACHABLE_MESSAGE } });
    await clickButton(cardButton('CSE2009'));
    expect(collapse(cardButton('CSE2009').textContent)).toBe('Try again');
  });
});

describe('the session states — a sign-in, never an accusation', () => {
  it('a tab that never signed in asks for a sign-in', async () => {
    state.sessionActive = false;
    state.answer = async () => ({ status: { kind: 'no-session', message: NO_SESSION_MESSAGE } });
    mount();
    await clickButton(cardButton('BAEEE203'));

    expect(text()).toContain(NO_SESSION_MESSAGE);
    expect(text()).not.toMatch(/expired/i);
    expect(pickers()).toHaveLength(0);

    await clickButton(sheetAction('Login with VTOP'));
    expect(onLogin).toHaveBeenCalledTimes(1);
  });

  it('a session VTOP ended says the same sentence and asks for the same thing', async () => {
    state.answer = async () => ({ status: { kind: 'session-expired', message: NO_SESSION_MESSAGE } });
    mount();
    await clickButton(cardButton('CSE2009'));

    expect(text()).toContain(NO_SESSION_MESSAGE);
    await clickButton(sheetAction('Login with VTOP'));
    expect(onLogin).toHaveBeenCalledTimes(1);
  });
});

describe('the file VTOP served', () => {
  it('is shown in the page, with the actions a student needs', async () => {
    mount();
    await clickButton(cardButton('BAEEE203'));

    expect(text()).toContain('BAEEE203 — Syllabus');
    expect(text()).toContain('BAEEE203-syllabus.pdf');
    expect(text()).toContain('2 KB');
    expect(host!.querySelector('iframe[title="Course syllabus from VTOP"]')).toBeTruthy();
    const links = Array.from(host!.querySelectorAll('a'));
    expect(links.map((a) => collapse(a.textContent))).toEqual(['Open paper', 'Download']);
    expect(links.every((a) => a.getAttribute('href') === DOC.dataUrl)).toBe(true);
    expect(pickers()).toHaveLength(0);
    // Nothing in this view names VTOP's class placement, in any state.
    expect(text()).not.toMatch(/class id|erp|slot|faculty/i);
  });

  it('is re-read from this device on the second open, without asking VTOP again', async () => {
    state.answer = async () => ({ status: { kind: 'ready', document: DOC, cached: true } });
    mount();
    await clickButton(cardButton('BAEEE203'));
    expect(text()).toContain('saved on this device');

    // Closing and reopening shows the same file; one ask, one answer.
    await clickButton(buttons().find((b) => (b.getAttribute('aria-label') || '').startsWith('Close'))!);
    await clickButton(cardButton('BAEEE203'));
    expect(state.calls).toHaveLength(1);
  });
});

/**
 * The reported production case, end to end at the screen: BAEEE203 must open
 * with one click and no question asked of the student — no slot to choose, no
 * faculty to choose, nothing typed.
 */
describe('BAEEE203 — one click, one request, no picker ever', () => {
  it('walks from the card to VTOP\'s file without the student answering anything', async () => {
    mount();
    const interactions = { clicks: 0, selections: 0 };
    host!.addEventListener('click', () => { interactions.clicks += 1; });
    host!.addEventListener('change', () => { interactions.selections += 1; });

    await clickButton(cardButton('BAEEE203'));

    expect(state.calls).toHaveLength(1);
    expect((state.calls[0] as Record<string, unknown>).course).toEqual({
      courseCode: 'BAEEE203', courseTitle: 'Microcontrollers',
    });
    // One click, no change event, and no control that could raise one.
    expect(interactions).toEqual({ clicks: 1, selections: 0 });
    expect(pickers()).toHaveLength(0);
    expect(cardButton('BAEEE203').textContent).toBe('View syllabus');
    expect(host!.querySelector('iframe[title="Course syllabus from VTOP"]')).toBeTruthy();
  });
});
