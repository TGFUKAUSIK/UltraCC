/**
 * Syllabus withdrawal regression tests.
 *
 * The Syllabus feature is temporarily out of normal navigation (see
 * src/lib/navVisibility.ts) while the page itself stays built. Two failure
 * directions matter, and both are silent:
 *  - a surface that keeps pointing at the feature, so the withdrawal is partial;
 *  - a surface that removes the feature's CODE, so re-appearing it means
 *    rewriting the gateway, the parser, the cache and the page.
 * The first group asserts every navigation path is closed. The second group
 * asserts the implementation is still there, reachable by deep link.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { NAV_HIDDEN_TABS, isNavHidden, isNavHiddenInMode, MINIMAL_TABS } from '../navVisibility';
import { navGroups, serviceGroups } from '../../components/MeridianHeader';
import { buildPaletteIndex } from '../commandPalette';

const src = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

describe('Syllabus is withdrawn from navigation', () => {
  it('lists syllabus as hidden', () => {
    expect(NAV_HIDDEN_TABS.has('syllabus')).toBe(true);
    expect(isNavHidden('syllabus')).toBe(true);
    // And only filters what it names — a normal tab still passes.
    expect(isNavHidden('grades')).toBe(false);
  });

  it('keeps the desktop rail free of it', () => {
    const railTabs = navGroups.flatMap((group) => group.items.map(([tab]) => tab));
    expect(railTabs).not.toContain('syllabus');
  });

  it('keeps the services menu and the mobile "More" sheet free of it', () => {
    const serviceTabs = serviceGroups.flatMap((group) => group.items.map(([tab]) => tab));
    expect(serviceTabs).not.toContain('syllabus');
  });

  it('keeps ⌘K from offering it — the palette is navigation too', () => {
    const destTabs = buildPaletteIndex({ timetable: [], attendance: [], exams: [], marks: [] })
      .filter((item) => item.category === 'Go to')
      .map((item) => item.tab);
    expect(destTabs).not.toContain('syllabus');
  });

  it('gates both Student Tools entry points on the flag', () => {
    const tools = src('src/components/ToolsHub.tsx');
    // The ToolCard and the Quick Access chip are separate lists; either one
    // leaking would put the feature back in sight.
    expect(tools).toMatch(/\{!isNavHidden\('syllabus'\) && \(/);
    expect(tools).toMatch(/\.filter\(\(item\) => !isNavHidden\(item\.tab\)\)/);
  });

  it('gates the per-course Syllabus button on the course hub', () => {
    const hub = src('src/components/CourseHubView.tsx');
    expect(hub).toMatch(/!isNavHidden\('syllabus'\) && onOpenSyllabus/);
  });
});

describe('The Syllabus implementation stays in the build', () => {
  it('still routes ?tab=syllabus to the page', () => {
    const app = src('src/App.tsx');
    expect(app).toMatch(/'syllabus'/);
    expect(app).toMatch(/activeTab === 'syllabus'/);
    expect(app).toMatch(/const SyllabusView = lazy\(/);
  });

  it('keeps the view, the store, the gateway target and the parser', () => {
    for (const rel of [
      'src/components/SyllabusView.tsx',
      'src/lib/syllabusStore.ts',
      'src/lib/syllabus.ts',
      'src/lib/vtop/parsers/timetable.ts',
      'supabase/functions/vtop-gateway/index.ts',
    ]) {
      expect(() => src(rel), `${rel} was deleted instead of hidden`).not.toThrow();
    }
    expect(src('src/lib/vtop/realClient.ts')).toMatch(/'syllabus',/);
    expect(src('src/lib/vtop/parsers/timetable.ts')).toMatch(/function parseCourseList\(/);
    expect(src('src/lib/db/vtopDatabase.ts')).toMatch(/const SYLLABUS_STORE = 'syllabusCache'/);
  });

  it('leaves the destination table intact, so re-appearing is a one-word change', () => {
    // naming.test.ts reads DESTINATIONS for label parity; the filter belongs at
    // the consumption site, not in the table.
    expect(src('src/lib/commandPalette.ts')).toMatch(/\{ label: 'Syllabus',.*tab: 'syllabus'/);
    expect(src('src/components/MeridianHeader.tsx')).toMatch(/\['syllabus', BookOpen, 'Syllabus'\]/);
    expect(src('src/components/MeridianHeader.tsx')).toMatch(/\['syllabus', 'Syllabus'\]/);
  });
});

describe('Feature modes (minimal vs complete)', () => {
  // Complete mode surfaces every destination the services menu declares (its
  // source list is every non-withdrawn tab). Minimal mode collapses that to the
  // daily essentials, keeping a clear path back to Settings for re-enabling.
  const everyServiceTab = serviceGroups.flatMap((group) => group.items.map(([tab]) => tab));
  const destinationsFor = (mode: 'minimal' | 'complete') =>
    buildPaletteIndex({ timetable: [], attendance: [], exams: [], marks: [] }, mode)
      .filter((item) => item.category === 'Go to')
      .map((item) => item.tab);

  it('complete mode keeps every destination the services menu offers', () => {
    for (const tab of everyServiceTab) {
      expect(isNavHiddenInMode(tab, 'complete'), `complete mode hid "${tab}"`).toBe(false);
    }
  });

  it('minimal mode hides everything except the daily essentials', () => {
    for (const tab of everyServiceTab) {
      expect(isNavHiddenInMode(tab, 'minimal'), `minimal mode mis-handled "${tab}"`).toBe(!MINIMAL_TABS.has(tab));
    }
  });

  it('minimal mode keeps the daily essentials a student needs', () => {
    for (const tab of ['dashboard', 'timetable', 'academics', 'exams', 'grades', 'settings']) {
      expect(isNavHiddenInMode(tab, 'minimal'), `minimal mode hid "${tab}"`).toBe(false);
    }
  });

  it('minimal mode strips extras from ⌘K, complete restores them', () => {
    const minimal = destinationsFor('minimal');
    const complete = destinationsFor('complete');
    expect(minimal).toContain('timetable');
    expect(minimal).toContain('exams');
    expect(minimal).not.toContain('ffcs');
    expect(minimal).not.toContain('clubs');
    expect(minimal).not.toContain('transport');
    expect(complete).toContain('ffcs');
    expect(complete).toContain('clubs');
    expect(complete).toContain('transport');
  });

  it('syllabus stays withdrawn in both modes', () => {
    expect(isNavHiddenInMode('syllabus', 'minimal')).toBe(true);
    expect(isNavHiddenInMode('syllabus', 'complete')).toBe(true);
  });
});
