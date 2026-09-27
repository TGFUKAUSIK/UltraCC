/**
 * Campus navigation regression tests.
 *
 * Two rules the UI must not drift away from:
 *
 *  1. Campus Facilities offers only categories UltraCC can back with a source.
 *     The old "Labs & spaces" tab derived a room list from the student's OWN
 *     timetable, which can never prove a room is free for anyone else — it was
 *     removed, and Rooms & Labs (the FFCS-grid engine) is the honest source for
 *     free rooms. A tab list that silently regrows a labs/spaces entry is a bug.
 *
 *  2. The desktop rail is compact by default, expands on demand, and collapses
 *     again as soon as a destination is chosen.
 */

import { describe, it, expect } from 'vitest';
import { campusUtilityTabs } from '../../components/CampusUtilitiesView';
import { railStateAfter, serviceGroups } from '../../components/MeridianHeader';

describe('Campus Facilities tabs', () => {
  it('never offers a labs or spaces category', () => {
    for (const tab of campusUtilityTabs) {
      expect(tab.id).not.toBe('spaces');
      expect(tab.label.toLowerCase()).not.toMatch(/labs|laborator|spaces/);
    }
  });

  it('no longer offers a Wi-Fi spots category', () => {
    // UltraCC has no authoritative campus Wi-Fi data, so the tab was removed:
    // the UI must not imply a hotspot exists when it cannot be proven.
    for (const tab of campusUtilityTabs) {
      expect(tab.id).not.toBe('wifi');
      expect(tab.label.toLowerCase()).not.toMatch(/wi-?fi/);
    }
    expect(campusUtilityTabs.some((tab) => tab.id === 'printing')).toBe(true);
  });

  it('keeps a labelled tab for every category it does offer', () => {
    expect(campusUtilityTabs.length).toBeGreaterThan(0);
    for (const tab of campusUtilityTabs) {
      expect(tab.label.trim().length).toBeGreaterThan(0);
    }
    // Ids drive selection state, so a duplicate would silently merge two tabs.
    expect(new Set(campusUtilityTabs.map((tab) => tab.id)).size).toBe(campusUtilityTabs.length);
  });

  it('still routes free rooms and labs to the FFCS-board engine', () => {
    const campus = serviceGroups.find((group) => group.title === 'Campus');
    const rooms = campus?.items.find(([tab]) => tab === 'freeClassrooms');
    const facilities = campus?.items.find(([tab]) => tab === 'campus-utils');
    expect(rooms?.[1]).toBe('Rooms & Labs');
    // Facilities and Rooms & Labs are different screens: dropping the spaces tab
    // must not have collapsed them into one.
    expect(facilities?.[1]).toBe('Campus Facilities');
    expect(facilities?.[0]).not.toBe(rooms?.[0]);
  });
});

describe('desktop rail', () => {
  it('flips when the toggle is used', () => {
    expect(railStateAfter(false, 'toggle')).toBe(true);
    expect(railStateAfter(true, 'toggle')).toBe(false);
  });

  it('collapses on every destination choice', () => {
    expect(railStateAfter(true, 'navigate')).toBe(false);
    // Idempotent: already compact, still compact.
    expect(railStateAfter(false, 'navigate')).toBe(false);
  });
});
