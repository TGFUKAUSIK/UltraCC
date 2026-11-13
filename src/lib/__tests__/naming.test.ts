/**
 * Naming regression tests — product terminology.
 *
 * Two rules the app had already drifted on:
 * 1. "Club Hub" is now "Student Communities" (clubs, chapters, special teams and
 *    student communities — the old name described a third of the feature).
 * 2. `serviceGroups` in the header is the authoritative feature naming. The
 *    desktop rail and the ⌘K palette must show the SAME label for the same tab,
 *    and must not drop destinations. Before this test existed, the rail called
 *    'academics' "Overview" while the menu called it "Attendance" and ⌘K called
 *    it "Attendance & Academics", and hostel / placements / communities / fresher
 *    guide had no rail entry at all.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { navGroups, serviceGroups } from '../../components/MeridianHeader';
import { buildPaletteIndex } from '../commandPalette';

const ROOT = process.cwd();

/** Every component source file, comments stripped — what can reach a screen. */
function renderFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    if (entry === '__tests__') continue;
    const full = join(ROOT, dir, entry);
    if (statSync(full).isDirectory()) out.push(...renderFiles(`${dir}/${entry}`));
    else if (/\.tsx$/.test(entry)) out.push(full);
  }
  return out;
}

const codeOnly = (path: string) =>
  readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const COMPONENTS = renderFiles('src/components');
const relative = (p: string) => p.slice(ROOT.length + 1).split('\\').join('/');

/** Tabs that are actions in the services menu rather than destinations. */
const MENU_ACTIONS = new Set(['settings', 'sync-refresh']);

/** tab → authoritative label. */
const authoritative = new Map<string, string>();
for (const group of serviceGroups) {
  for (const [tab, label] of group.items) authoritative.set(tab, label);
}

const paletteDestinations = buildPaletteIndex({
  timetable: [], attendance: [], exams: [], marks: [],
}).filter((item) => item.category === 'Go to');

describe('Student Communities naming', () => {
  it('names the clubs tab "Student Communities" in the services menu', () => {
    const services = serviceGroups.find((g) => g.title === 'Student services');
    const clubs = services?.items.find(([tab]) => tab === 'clubs');
    expect(clubs?.[1]).toBe('Student Communities');
  });

  it('never uses "Club Hub" or a bare "Clubs" label', () => {
    for (const group of serviceGroups) {
      for (const [, label] of group.items) {
        expect(String(label).toLowerCase()).not.toContain('club hub');
        expect(String(label)).not.toBe('Clubs');
      }
    }
  });
});

describe('Question Bank naming', () => {
  it('calls the past-paper feature what the menu calls it, inside the feature too', () => {
    const label = authoritative.get('qbank');
    expect(label).toBe('Question Bank');
    const screens = COMPONENTS.filter((f) => /QbankView|ToolsHub/.test(f));
    expect(screens.length).toBe(2);
    for (const file of screens) {
      expect(codeOnly(file), `${relative(file)} never says the feature's name`).toContain(label);
    }
  });

  it('has retired the rival two-word name', () => {
    const stragglers = COMPONENTS.filter((f) => codeOnly(f).includes('Question Paper Bank')).map(relative);
    expect(stragglers).toEqual([]);
  });
});

describe('Navigation naming parity', () => {
  it('the desktop rail offers every destination the services menu offers', () => {
    const railTabs = navGroups.flatMap((group) => group.items.map(([tab]) => tab));
    for (const tab of authoritative.keys()) {
      if (MENU_ACTIONS.has(tab)) continue;
      expect(railTabs, `the rail has no entry for "${tab}"`).toContain(tab);
    }
  });

  it('the rail uses the services menu label for every shared tab', () => {
    for (const group of navGroups) {
      for (const [tab, , label] of group.items) {
        const expected = authoritative.get(tab);
        if (!expected) continue;
        expect(label, `"${tab}" is "${label}" on the rail but "${expected}" in the menu`).toBe(expected);
      }
    }
  });

  it('⌘K uses the services menu label for every shared tab', () => {
    for (const item of paletteDestinations) {
      const expected = authoritative.get(item.tab);
      if (!expected) continue;
      expect(item.title, `"${item.tab}" is "${item.title}" in ⌘K but "${expected}" in the menu`).toBe(expected);
    }
  });

  it('⌘K can reach every destination, once', () => {
    const tabs = paletteDestinations.map((item) => item.tab);
    expect(new Set(tabs).size, 'a destination appears twice under two names').toBe(tabs.length);
    for (const tab of authoritative.keys()) {
      if (MENU_ACTIONS.has(tab)) continue;
      expect(tabs, `⌘K cannot search for "${tab}"`).toContain(tab);
    }
  });
});
