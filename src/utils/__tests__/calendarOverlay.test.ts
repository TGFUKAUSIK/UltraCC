import { describe, it, expect } from 'vitest';
import {
  classifyEvent, eventDateKey, buildEventOverlay, presentCategories, categoryMatches,
  CalendarEventLike, CalendarCategoryFilter,
} from '../calendarOverlay';

const ev = (eid: string, title: string, type: string, date = '', location = ''): CalendarEventLike =>
  ({ eid, title, type, date, location });

describe('classifyEvent', () => {
  it('classifies club/chapter/team events as club', () => {
    expect(classifyEvent(ev('1', 'Robotics Club orientation', 'workshop'))).toBe('club');
    expect(classifyEvent(ev('2', 'IEEE Chapter meet', 'meeting'))).toBe('club');
    expect(classifyEvent(ev('3', 'Society AGM', 'agm'))).toBe('club');
  });

  it('classifies everything else as campus', () => {
    expect(classifyEvent(ev('4', 'Tech fest 2026', 'festival'))).toBe('campus');
    expect(classifyEvent(ev('5', 'Placement drive', 'placement'))).toBe('campus');
  });

  it('matches on type as well as title', () => {
    expect(classifyEvent(ev('6', 'September meet', 'club'))).toBe('club');
  });
});

describe('eventDateKey', () => {
  it('parses ISO dates', () => {
    expect(eventDateKey('2026-09-14')).toBe('2026-09-14');
    expect(eventDateKey('2026-09-14T18:00:00Z')).toBe('2026-09-14');
  });

  it('parses DD-MM-YYYY and DD/MM/YYYY', () => {
    expect(eventDateKey('14-09-2026')).toBe('2026-09-14');
    expect(eventDateKey('3/10/2026')).toBe('2026-10-03');
  });

  it('parses human-readable dates', () => {
    const key = eventDateKey('Sep 14, 2026');
    expect(key).toBe('2026-09-14');
  });

  it('refuses a day the month never had', () => {
    // Shaped like a date is not a date: 30 February exists in no calendar, and
    // letting it through would park the event on a grid cell that cannot hold it.
    expect(eventDateKey('30-02-2026')).toBeNull();
    expect(eventDateKey('31/04/2026')).toBeNull();
    expect(eventDateKey('2026-02-30')).toBeNull();
    expect(eventDateKey('2026-13-05')).toBeNull();
    expect(eventDateKey('2026-02-30T18:00:00Z')).toBeNull();
  });

  it('still accepts the days that only look impossible', () => {
    expect(eventDateKey('29-02-2028')).toBe('2028-02-29');
    expect(eventDateKey('31-12-2026')).toBe('2026-12-31');
  });

  it('returns null for garbage — never guesses a day', () => {
    expect(eventDateKey('')).toBeNull();
    expect(eventDateKey('TBD')).toBeNull();
    expect(eventDateKey('not a date')).toBeNull();
  });
});

describe('buildEventOverlay', () => {
  it('groups events by ISO date', () => {
    const overlay = buildEventOverlay([
      ev('1', 'Hackathon kickoff', 'hackathon', '2026-09-14'),
      ev('2', 'Club AGM', 'club', '2026-09-14'),
      ev('3', 'Placement talk', 'placement', '2026-09-20'),
    ]);
    expect(overlay.get('2026-09-14')!.length).toBe(2);
    expect(overlay.get('2026-09-20')!.length).toBe(1);
  });

  it('skips unparseable dates honestly', () => {
    const overlay = buildEventOverlay([ev('1', 'TBD event', 'fest', 'TBD')]);
    expect(overlay.size).toBe(0);
  });

  it('skips a date that names a day which never happened', () => {
    const overlay = buildEventOverlay([
      ev('1', 'Impossible fest', 'fest', '31-02-2026'),
      ev('2', 'Real fest', 'fest', '14-09-2026'),
    ]);
    expect([...overlay.keys()]).toEqual(['2026-09-14']);
  });

  it('carries the category through', () => {
    const overlay = buildEventOverlay([ev('1', 'Coding club meetup', 'meetup', '2026-09-14')]);
    expect(overlay.get('2026-09-14')![0].category).toBe('club');
  });
});

describe('presentCategories', () => {
  it('reports only categories that actually appear', () => {
    const overlay = buildEventOverlay([
      ev('1', 'Club meet', 'club', '2026-09-14'),
      ev('2', 'Fest', 'fest', '2026-09-15'),
    ]);
    expect(presentCategories(overlay)).toEqual(['campus', 'club']);
  });

  it('is empty for an empty overlay', () => {
    expect(presentCategories(buildEventOverlay([]))).toEqual([]);
  });
});

describe('categoryMatches', () => {
  const cases: [string, CalendarCategoryFilter, boolean][] = [
    ['holiday', 'all', true],
    ['exam', 'academic', true],
    ['class', 'academic', true],
    ['campus', 'academic', false],
    ['club', 'academic', false],
    ['campus', 'campus', true],
    ['club', 'campus', false],
    ['club', 'club', true],
  ];
  for (const [type, filter, expected] of cases) {
    it(`type=${type} filter=${filter} → ${expected}`, () => {
      expect(categoryMatches(type, filter)).toBe(expected);
    });
  }
});
