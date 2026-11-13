/**
 * Minimal mode — the five-destination promise, checked at the data layer.
 *
 * The mode is a claim about what a student can reach: the Dashboard, Attendance,
 * Marks & Grades, the proctor and Settings, and nothing else. Three places can
 * quietly break that claim, and all three are silent:
 *
 *  - the landing screen, so the app boots onto a screen its own navigation
 *    does not offer (and the previously-visited tab left in sessionStorage is
 *    the usual way in);
 *  - a deep link or a PWA shortcut, so `?tab=qbank` walks straight past the
 *    mode;
 *  - the command centre, whose *records* are navigation too — a course row
 *    opens the timetable and an exam row opens the seating chart, so filtering
 *    only the "Go to" block leaves a removed screen one keystroke away.
 *
 * The redirect rule is `resolveTabForMode`, which is the single function behind
 * all three, so these tests pin it rather than each call site.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { MINIMAL_LANDING, MINIMAL_TABS, resolveTabForMode } from '../navVisibility';
import { getFeatureMode, saveFeatureMode } from '../settings';
import { buildPaletteIndex } from '../commandPalette';

const src = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

/** The five the mode promises, as routes: the Dashboard, Attendance, Marks &
 *  Grades, the proctor and Settings. */
const MINIMAL_FIVE = ['dashboard', 'academics', 'grades', 'faculty', 'settings'];

describe('minimal mode resolves every tab it does not offer to the Dashboard', () => {
  it('names exactly the five destinations, and lands on one of them', () => {
    expect([...MINIMAL_TABS].sort()).toEqual([...MINIMAL_FIVE].sort());
    expect(MINIMAL_LANDING).toBe('dashboard');
    expect(MINIMAL_TABS.has(MINIMAL_LANDING)).toBe(true);
  });

  it('leaves the five alone', () => {
    for (const tab of MINIMAL_FIVE) expect(resolveTabForMode(tab, 'minimal')).toBe(tab);
  });

  it('redirects every other destination to the Dashboard', () => {
    for (const tab of ['timetable', 'exams', 'lms', 'campus', 'qbank', 'my-info', 'syllabus']) {
      expect(resolveTabForMode(tab, 'minimal'), `minimal mode kept "${tab}"`).toBe(MINIMAL_LANDING);
    }
  });

  it('changes nothing in complete mode — including a withdrawn deep link', () => {
    // Complete mode is a preference about what the nav points at, so a student
    // who knows the syllabus URL still lands on the syllabus page.
    for (const tab of ['dashboard', 'timetable', 'exams', 'qbank', 'syllabus']) {
      expect(resolveTabForMode(tab, 'complete')).toBe(tab);
    }
  });
});

describe('minimal mode persists as a device preference', () => {
  beforeEach(() => { localStorage.removeItem('ultracc.featureMode'); });

  it('defaults to complete', () => {
    expect(getFeatureMode()).toBe('complete');
  });

  it('round-trips minimal and back', () => {
    saveFeatureMode('minimal');
    expect(getFeatureMode()).toBe('minimal');
    saveFeatureMode('complete');
    expect(getFeatureMode()).toBe('complete');
  });

  it('treats an unknown stored value as complete rather than guessing', () => {
    localStorage.setItem('ultracc.featureMode', '"everything"');
    expect(getFeatureMode()).toBe('complete');
  });
});

describe('the command centre only reaches the five', () => {
  it('keeps no item — synced record or destination — pointing outside them', () => {
    const items = buildPaletteIndex({
      timetable: [{ courseCode: 'CSE2009', courseTitle: 'Calculus', venue: 'AB1 101', slot: 'A1', facultyName: 'Dr Rao', isLab: false }],
      attendance: [{ courseCode: 'CSE2009', type: 'ETH', percentage: 82, attended: 9, totalHeld: 11 }],
      exams: [{ courseCode: 'CSE2009', examType: 'CAT-1', date: '2026-10-20', id: 'x' }],
      marks: [{ courseCode: 'MAT1011', courseTitle: 'Maths' }],
    } as unknown as Parameters<typeof buildPaletteIndex>[0], 'minimal');

    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(MINIMAL_TABS.has(item.tab), `${item.id} still points at "${item.tab}"`).toBe(true);
    }
    // And complete mode still offers the records it always did, so the filter
    // is scoped to the mode and not to the index.
    const complete = buildPaletteIndex({
      timetable: [{ courseCode: 'CSE2009', courseTitle: 'Calculus', venue: 'AB1 101', slot: 'A1', facultyName: 'Dr Rao', isLab: false }],
      attendance: [],
      exams: [],
      marks: [],
    } as unknown as Parameters<typeof buildPaletteIndex>[0], 'complete');
    expect(complete.some((item) => item.tab === 'timetable')).toBe(true);
  });
});

describe('the shell applies the rule at both entrances', () => {
  const app = src('src/App.tsx');

  it('resolves the first tab — URL and session — through the mode', () => {
    expect(app).toMatch(/function initialTab\(mode: FeatureMode\)/);
    expect(app).toMatch(/return resolveTabForMode\(fromUrl, mode\)/);
    expect(app).toMatch(/useState<string>\(\(\) => initialTab\(getFeatureMode\(\)\)\)/);
  });

  it('redirects a live session out of a tab the mode dropped', () => {
    // Guarded on the mode itself, so complete mode keeps its withdrawn deep
    // links rather than bouncing every one of them to Attendance.
    expect(app).toMatch(/if \(featureMode !== 'minimal'\) return;/);
    expect(app).toMatch(/const resolved = resolveTabForMode\(activeTab, featureMode\)/);
  });
});
