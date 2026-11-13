/**
 * Minimal mode at the surface: the rail, the phone tab bar and the services
 * sheet must offer only the destinations the mode promises — the Dashboard,
 * Attendance, Marks & Grades, the proctor and Settings.
 *
 * The pure-function test (src/lib/__tests__/minimalMode.test.ts) pins the rule
 * `resolveTabForMode`, but the rule only means anything if every navigation
 * surface actually routes its buttons through it. Three surfaces can each drift
 * on its own:
 *
 *  - the desktop rail, whose standalone Dashboard button is *not* in the group
 *    lists and so is easy to forget;
 *  - the phone tab bar, whose five buttons are written out by hand;
 *  - the services sheet, built from `visibleServiceGroups`.
 *
 * This file renders the header in both modes and reads the buttons back, so a
 * surface that quietly keeps a destination the mode dropped fails here rather
 * than on a phone. The names are asserted exactly — "only these" is the product
 * promise, not "at most these". The Dashboard counts as one of the destinations
 * because the phone bar lays its buttons out as a full-width row: a set of four
 * left a bare column where the fifth belonged and read as a broken bar, and the
 * Dashboard is the screen every mode opens on, so a mode flip no longer moves a
 * student off their home screen.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MeridianHeader } from '../MeridianHeader';
import type { FeatureMode } from '../../lib/navVisibility';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The names the minimal phone bar prints, Home first. */
const MINIMAL_BAR_NAMES = ['Home', 'Attendance', 'Marks & Grades', 'Faculty & Proctor', 'Settings'];
/** The rail rows minimal mode keeps: its Dashboard row, then the two surviving groups. */
const MINIMAL_RAIL_NAMES = ['Dashboard', 'Attendance', 'Marks & Grades', 'Faculty & Proctor'];
/** The services sheet narrows to its access list. Dashboard is a screen, not a
 *  service, so it was never in this sheet in either mode. */
const MINIMAL_SERVICE_NAMES = ['Attendance', 'Marks & Grades', 'Faculty & Proctor', 'Settings'];

let container: HTMLElement | undefined;
let root: Root | undefined;
let setActiveTab: ReturnType<typeof vi.fn>;

function mount(mode: FeatureMode, activeTab = 'academics', signedIn = false) {
  setActiveTab = vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(createElement(MeridianHeader, {
      activeTab,
      setActiveTab,
      onOpenCommandCenter: () => {},
      onOpenLogin: () => {},
      onOpenSettings: () => {},
      mode,
      profileName: signedIn ? 'Test Student' : undefined,
      notificationData: { assignments: [], attendance: [], exams: [], marks: [], timetable: [] } as never,
    }));
  });
  return container;
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  // Portal children (the services layer) render into <body>; unmount should
  // take them, but a stray node here would leak into the next test's queries.
  document.querySelectorAll('.meridian-feature-layer, .meridian-rail-tip').forEach((node) => node.remove());
  container = undefined;
  root = undefined;
});

/** The phone tab bar, by accessible name. */
function tabBarLabels(): string[] {
  return Array.from(container!.querySelectorAll('.mobile-tab-bar button')).map((b) => b.getAttribute('aria-label') || '');
}

/** The desktop rail's destination list (not its bottom row). */
function railNavLabels(): string[] {
  return Array.from(container!.querySelectorAll('.portal-sidebar-nav button')).map((b) => b.getAttribute('aria-label') || '');
}

/** The More sheet, which is portalled into <body>. */
function servicesMenuLabels(): string[] {
  return Array.from(document.querySelectorAll('.meridian-feature-menu .feature-menu-groups button'))
    .map((b) => (b.textContent || '').replace('→', '').trim());
}

/** Minimal mode reaches the sheet through the account menu — there is no More. */
function openServicesFromAccount() {
  act(() => (container!.querySelector('.meridian-profile') as HTMLButtonElement).click());
  const item = Array.from(container!.querySelectorAll('.meridian-account-menu [role="menuitem"]'))
    .find((el) => (el.textContent || '').includes('Student services')) as HTMLButtonElement;
  act(() => item.click());
}

function openServicesFromMore() {
  act(() => (container!.querySelector('.mobile-tab-bar [aria-label="More"]') as HTMLButtonElement).click());
}

describe('minimal mode narrows every navigation surface', () => {
  it('shows the five phone tabs and no More', () => {
    mount('minimal');
    expect(tabBarLabels()).toEqual(MINIMAL_BAR_NAMES);
    expect(container!.querySelector('.mobile-tab-bar [aria-label="More"]'), 'a More button has nothing left to hold').toBeNull();
  });

  it('keeps the rail Dashboard row and the three route rows, with Settings still on the bottom row', () => {
    mount('minimal');
    expect(railNavLabels()).toEqual(MINIMAL_RAIL_NAMES);
    expect(container!.querySelector('.meridian-rail-bottom [aria-label="Settings"]'), 'Settings must stay reachable').toBeTruthy();
  });

  it('sends the wordmark to the Dashboard, the screen every mode opens on', () => {
    mount('minimal');
    act(() => (container!.querySelector('.meridian-logo') as HTMLButtonElement).click());
    expect(setActiveTab).toHaveBeenCalledWith('dashboard');
  });

  it('holds only the mode’s services in the sheet', () => {
    mount('minimal', 'academics', true);
    openServicesFromAccount();
    expect(servicesMenuLabels().sort()).toEqual([...MINIMAL_SERVICE_NAMES].sort());
  });
});

describe('complete mode restores every destination', () => {
  it('brings the five phone tabs back', () => {
    mount('complete', 'dashboard');
    // The fourth slot is Marks & Grades, not Campus: the product decision on
    // 2026-10-08 swapped them, and Campus fell through to the More sheet.
    expect(tabBarLabels()).toEqual(['Home', 'Timetable', 'Academics', 'Marks & Grades', 'More']);
  });

  it('brings the rail dashboard back alongside the full list', () => {
    mount('complete', 'dashboard');
    const labels = railNavLabels();
    expect(labels).toContain('Dashboard');
    expect(labels).toContain('Timetable');
    expect(labels.length, 'complete mode is more than minimal mode').toBeGreaterThan(MINIMAL_BAR_NAMES.length);
  });

  it('sends the wordmark to the dashboard again', () => {
    mount('complete', 'dashboard');
    act(() => (container!.querySelector('.meridian-logo') as HTMLButtonElement).click());
    expect(setActiveTab).toHaveBeenCalledWith('dashboard');
  });

  it('shows the full services list again', () => {
    mount('complete', 'dashboard');
    openServicesFromMore();
    const labels = servicesMenuLabels();
    expect(labels).toContain('Timetable');
    expect(labels).toContain('Settings');
    expect(labels.length).toBeGreaterThan(MINIMAL_BAR_NAMES.length);
  });
});

describe('the header reads the mode from its prop, not the saved preference', () => {
  it('never shows a Minimal-mode-only surface while the prop says complete', () => {
    // The prop is the source of truth for a render; the stored preference is
    // only read once, at App's mount, to seed the prop. A stale localStorage
    // value must not reach a surface on its own.
    localStorage.setItem('ultracc.featureMode', '"minimal"');
    try {
      mount('complete', 'dashboard');
      expect(railNavLabels()).toContain('Dashboard');
      expect(tabBarLabels()).toContain('Home');
    } finally {
      localStorage.removeItem('ultracc.featureMode');
    }
  });

  it('pins the two hand-written surfaces in the header source', () => {
    const src = readFileSync(join(process.cwd(), 'src', 'components', 'MeridianHeader.tsx'), 'utf8');
    // The rail's Dashboard row and the tab-bar split are the two hand-written
    // places the tests above read back, so a refactor cannot silently collapse
    // them. The rail row is deliberately *not* gated on the mode: minimal mode
    // keeps the Dashboard among its destinations, and a `mode !== 'minimal' &&`
    // guard creeping back onto it would empty a rail slot — and, on the phone, a
    // whole bar column.
    expect(src, 'the rail Dashboard row must be drawn in both modes').toMatch(/aria-label="Dashboard"/);
    expect(src).not.toMatch(/mode !== 'minimal' && <button/);
    // One home for "where the wordmark goes": the mode's landing screen, which is
    // the Dashboard in both modes.
    expect(src).toMatch(/const homeTab = MINIMAL_LANDING/);
    // Minimal mode's bar leads with Home, so the row is five wide in both modes.
    expect(src).toMatch(/aria-label="Home">/);
  });
});
