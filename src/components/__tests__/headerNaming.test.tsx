/**
 * The header names things the same way, and stops truncating the term.
 *
 * Two reports off one screen. The desktop bar printed the wordmark a second time
 * (the rail already owns it), and the term switcher cut "Fall Semester 2026-27"
 * down to "Fall Semester 202" — a pill that names every term except which one is
 * selected. `compactTermLabel` is the fix and this file pins what it must do, so
 * a later "fuller" label cannot reintroduce the clip.
 *
 * The rest is the shape of the new bar: the wordmark, the term pill, the services
 * toggle and the refresh button leave the header markup, the sync chip becomes a
 * lamp, and the account menu carries what left. Every one of those is checked by
 * rendering the header rather than by reading the file, because the point is what
 * a student sees.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MeridianHeader, compactTermLabel, pageTitleFor, serviceGroups } from '../MeridianHeader';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SEMESTERS = [
  { id: 's1', name: 'Fall Semester 2026-27', isCurrent: true },
  { id: 's2', name: 'Winter Semester 2025-26' },
];

let container: HTMLElement | undefined;
let root: Root | undefined;

function mount(overrides: Record<string, unknown> = {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(createElement(MeridianHeader, {
      activeTab: 'dashboard',
      setActiveTab: () => {},
      onOpenCommandCenter: () => {},
      onOpenLogin: () => {},
      onOpenSettings: () => {},
      semesters: SEMESTERS,
      selectedSemesterId: 's1',
      onSemesterChange: () => {},
      ...overrides,
    }));
  });
  return container;
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = undefined;
  root = undefined;
});

describe('the term label never truncates', () => {
  it('compacts the year range and drops the word every term carries', () => {
    expect(compactTermLabel('Fall Semester 2026-27')).toBe('Fall 26-27');
    expect(compactTermLabel('Winter Semester 2025-26')).toBe('Winter 25-26');
  });

  it('handles a four-digit end year and a name with no year at all', () => {
    expect(compactTermLabel('Fall Semester 2025-2026')).toBe('Fall 25-26');
    expect(compactTermLabel('Summer Term')).toBe('Summer Term');
  });

  it('is always shorter than the name VTOP wrote', () => {
    for (const { name } of SEMESTERS) {
      expect(compactTermLabel(name).length).toBeLessThan(name.length);
      expect(compactTermLabel(name).toLowerCase()).not.toContain('semester');
    }
  });

  it('keeps the full name in the option’s accessible name, so nothing is lost', () => {
    mount({ profileName: 'A Student' });
    const trigger = container!.querySelector<HTMLButtonElement>('.meridian-profile')!;
    act(() => trigger.click());
    const menu = container!.querySelector('.meridian-account-menu')!;
    const select = menu.querySelector<HTMLSelectElement>('.meridian-account-term select')!;
    expect(select.getAttribute('aria-label')).toContain('Fall Semester 2026-27');
    expect([...select.options].map((o) => o.textContent)).toContain('Fall 26-27 · Active');
  });
});

describe('the phone header names the page it is showing', () => {
  it('uses the services menu’s own label for every destination', () => {
    for (const group of serviceGroups) {
      for (const [tab, label] of group.items) expect(pageTitleFor(tab), tab).toBe(label);
    }
    expect(pageTitleFor('dashboard')).toBe('Dashboard');
  });

  it('falls back to a readable name for an unknown tab', () => {
    expect(pageTitleFor('first-run')).toBe('First Run');
  });

  it('renders that title in the bar, and no wordmark', () => {
    const header = mount({ activeTab: 'clubs' }).querySelector('.meridian-header')!;
    expect(header.querySelector('.meridian-brand')?.textContent).toBe('Student Communities');
    expect(header.textContent).not.toContain('UltraCC');
  });
});

describe('the desktop bar is search, a lamp, the bell and the avatar', () => {
  it('drops the wordmark, the term pill, the services toggle and the refresh button', () => {
    const header = mount({ profileName: 'A Student' }).querySelector('.meridian-header')!;
    for (const gone of ['.meridian-semester', '.meridian-term', '.meridian-more-button', '.meridian-sync-button', '.meridian-divider']) {
      expect(header.querySelector(gone), `${gone} is still in the header`).toBeNull();
    }
  });

  it('states the sync condition as a lamp with a spoken label', () => {
    const header = mount({ profileName: 'A Student' }).querySelector('.meridian-header')!;
    const lamp = header.querySelector('.meridian-status')!;
    expect(lamp.querySelector('.meridian-status-dot')).toBeTruthy();
    expect(lamp.getAttribute('aria-label')).toBeTruthy();
    // The state is a data attribute the shell colours; there is no sentence in
    // the bar any more.
    expect(lamp.getAttribute('data-state')).toBeTruthy();
  });

  it('moves services, refresh, the profile and settings into the account menu', () => {
    const header = mount({ profileName: 'A Student' }).querySelector('.meridian-header')!;
    act(() => header.querySelector<HTMLButtonElement>('.meridian-profile')!.click());
    const items = [...header.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent);
    expect(items).toEqual(['Student services', 'Sync & refresh', 'Your profile', 'Settings']);
  });

  it('offers the term switcher inside the menu, not in the bar', () => {
    const header = mount({ profileName: 'A Student' }).querySelector('.meridian-header')!;
    act(() => header.querySelector<HTMLButtonElement>('.meridian-profile')!.click());
    expect(header.querySelector('.meridian-account-menu .meridian-account-term select')).toBeTruthy();
  });

  it('closes the menu and hands focus back to the avatar on Escape', () => {
    const header = mount({ profileName: 'A Student' }).querySelector('.meridian-header')!;
    const trigger = header.querySelector<HTMLButtonElement>('.meridian-profile')!;
    act(() => trigger.click());
    expect(header.querySelector('.meridian-account-menu')).toBeTruthy();
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(header.querySelector('.meridian-account-menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('shows an explicit sign-in action instead of an avatar when signed out', () => {
    const header = mount().querySelector('.meridian-header')!;
    expect(header.querySelector('.meridian-signin')).toBeTruthy();
    expect(header.querySelector('.meridian-profile')).toBeNull();
    expect(header.querySelector('.meridian-account-menu')).toBeNull();
  });
});
