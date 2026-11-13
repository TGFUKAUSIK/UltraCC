/**
 * A date the app cannot vouch for is not a date.
 *
 * `normalizeDate` used to reshape any three groups of digits it recognised into
 * an ISO string and never asked whether that day existed. "08/18/2026" became
 * "2026-18-08" — month eighteen — and downstream `examStartMs` fed that to
 * `Date.UTC`, which does not complain about impossible days: it rolls them
 * forward. So an exam VTOP never dated got a real instant eight months on, a
 * countdown pointed at it, an alert was scheduled for it, and the ICS export
 * wrote it into the student's own calendar. The same shape sat in three places —
 * the client parser, the client's exam clock, and the vtop-gateway parser whose
 * output both clients read — with a fourth (the LMS gateway's Moodle dates)
 * rolling "31 February" into March.
 *
 * The rule is now: a day that does not exist is no day. The parsers hand back
 * VTOP's own text, `examStartMs` / `vtopDateDayStartMs` return null, and every
 * surface that already knows how to say "Not released yet" says it. Then the
 * first run of this guard found the same shape in three more places that had
 * never been asked: the academic-calendar event overlay (`eventDateKey`), the
 * .ics writer (`normalizeExamDate` — which hands the day to the student's *own*
 * calendar app) and the Event Hub's date normaliser. They are fixed the same
 * way, and inside `src/` they import the one rule instead of copying it.
 *
 * Because the gateway, the LMS gateway and the Event Hub deploy as standalone
 * Deno assets and cannot import from `src/`, the check is *copied* into each.
 * That is only safe while the copies agree, so the scan below reads every file
 * in both trees and fails if one names a day from digits without proving that
 * day exists. The old code is quoted in `DELETED_COPIES` so no rule here is
 * allowed to match nothing.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    if (entry === '__tests__' || entry === 'node_modules') continue;
    const full = join(ROOT, dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(`${dir}/${entry}`));
    else if (/\.(tsx|ts)$/.test(entry) && !entry.endsWith('.test.ts') && !entry.endsWith('.test.tsx')) out.push(full);
  }
  return out;
}

/** Source with comments removed — the guard is about what actually runs. */
function codeOnly(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const rel = (path: string) => path.slice(ROOT.length + 1).replace(/\\/g, '/');

/**
 * A file that turns digits into a day: an instant built from parts, or an ISO
 * string assembled from capture groups.
 */
const IDENT = '[A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)*';
const NAMES_A_DAY = new RegExp(
  [
    // Date.UTC(year, month - 1, day) and Date.UTC(year, month, day) — the parts
    // have to be *names*: `Date.UTC(d.getUTCFullYear(), ...)` is a day that
    // already existed being re-assembled, which this is not in a position to
    // question.
    `Date\\.UTC\\(\\s*${IDENT}\\s*,\\s*${IDENT}\\s*(?:-\\s*1\\s*)?,`,
    // an ISO string assembled out of capture groups: `${yyyy}-${mm.padStart(...)}-${dd}`
    String.raw`\$\{[A-Za-z0-9_[\]]+\}-\$\{[^}]*padStart\(2, '0'\)\}-\$\{`,
  ].join('|')
);

/** The proof: either the shared day-existence helper, or its round trip in place. */
const PROVES_THE_DAY = /isRealCalendarDate\(|getUTCDate\(\)\s*[=!]==?\s*day/;

/**
 * The other half of the family: a day assembled by the local `Date` constructor,
 * which rolls an impossible one forward just like `Date.UTC` does. Kept separate
 * from NAMES_A_DAY because plenty of honest grid maths (`new Date(year, month, 0)`)
 * is shaped this way and is not in a position to be questioned here.
 */
const DATES_FROM_PARTS =
  /new Date\(\s*[A-Za-z_$][\w$]*(?:\s*-\s*1)?\s*,\s*[A-Za-z_$][\w$]*(?:\s*-\s*1)?\s*,/;

const TREES = ['src', 'supabase/functions'];
const files = TREES.flatMap((tree) => sourceFiles(tree).map((f) => ({ path: rel(f), code: codeOnly(f) })));

describe('a date has to be a real day before the app uses it', () => {
  it('finds the files that name a day from digits', () => {
    // The guard is only worth something if it is actually watching them.
    const naming = files.filter((f) => NAMES_A_DAY.test(f.code)).map((f) => f.path);
    for (const expected of [
      'src/utils/examUtils.ts',
      'src/utils/calendarOverlay.ts',
      'src/utils/icalExport.ts',
      'src/lib/vtop/parsers/helpers.ts',
      'supabase/functions/vtop-gateway/parsers.ts',
      'supabase/functions/lms-gateway/parsers.ts',
      'supabase/functions/event-hub/index.ts',
    ]) {
      expect(naming, `${expected} is guarded`).toContain(expected);
    }
  });

  it('lets no file build a day it never proved exists', () => {
    const offenders = files
      .filter((f) => NAMES_A_DAY.test(f.code) && !PROVES_THE_DAY.test(f.code))
      .map((f) => `${f.path}`);
    expect(offenders, `invented a day: ${offenders.join(', ')}`).toEqual([]);
  });

  it('keeps the copied check in agreement across the trees', () => {
    // The copies ship apart, so they are one rule only while they agree. The
    // round trip is the whole check; require the same three comparisons in
    // wherever a copy lives.
    const roundTrip =
      /getUTCFullYear\(\)\s*===\s*(?:year|d\.getUTCFullYear\(\))[\s\S]{0,80}getUTCMonth\(\)[\s\S]{0,80}getUTCDate\(\)\s*===\s*day/;
    const copies = [
      'src/lib/vtop/parsers/helpers.ts',
      'src/utils/examUtils.ts',
      'supabase/functions/vtop-gateway/parsers.ts',
      'supabase/functions/event-hub/index.ts',
    ];
    for (const path of copies) {
      const code = codeOnly(join(ROOT, ...path.split('/')));
      expect(code, `${path} defines the day check`).toMatch(/function isRealCalendarDate\(/);
      expect(code, `${path} proves the day by round trip`).toMatch(roundTrip);
      expect(code, `${path} rejects a month that is not 1-12`).toMatch(/month < 1 \|\| month > 12/);
    }

    // The LMS gateway has no 1-based month to hand a helper, so it does the same
    // round trip inline; require it rather than pretend it imports the rule.
    const lms = codeOnly(join(ROOT, 'supabase', 'functions', 'lms-gateway', 'parsers.ts'));
    expect(lms).toMatch(/getUTCMonth\(\)\s*!==\s*month\s*\|\|\s*\w+\.getUTCDate\(\)\s*!==\s*day/);
  });

  it('gives the web app one day rule to import, not one per surface', () => {
    // Inside `src/` the copies above are the only two allowed, and everything
    // else that assembles a day must ask examUtils — a fifth hand-written check
    // is how this family got here in the first place.
    const defining = files
      .filter((f) => f.path.startsWith('src/') && /function isRealCalendarDate\(/.test(f.code))
      .map((f) => f.path)
      .sort();
    expect(defining, 'only the parser and the exam clock define the rule').toEqual([
      'src/lib/vtop/parsers/helpers.ts',
      'src/utils/examUtils.ts',
    ]);

    const exported = codeOnly(join(ROOT, 'src', 'utils', 'examUtils.ts'));
    expect(exported).toMatch(/export function isRealCalendarDate\(/);
    for (const path of ['src/utils/calendarOverlay.ts', 'src/utils/icalExport.ts']) {
      const code = codeOnly(join(ROOT, ...path.split('/')));
      expect(code, `${path} imports the shared day rule`).toMatch(
        /import\s*\{[^}]*\bisRealCalendarDate\b[^}]*\}\s*from\s*'\.\/examUtils'/
      );
    }
  });

  it('validates before either parser writes an ISO', () => {
    for (const path of ['src/lib/vtop/parsers/helpers.ts', 'supabase/functions/vtop-gateway/parsers.ts']) {
      const code = codeOnly(join(ROOT, ...path.split('/')));
      const body = code.slice(code.indexOf('function normalizeDate'));
      const firstReturn = body.slice(0, body.indexOf('}', body.indexOf('const dmy')) + 1);
      expect(firstReturn, `${path} checks the day it assembles`).toMatch(/isRealCalendarDate\(/);
    }

    // The academic-calendar grid builds its day keys out of a (year, month) and
    // whatever number the cell held, so the same proof has to be on that loop.
    const gateway = codeOnly(join(ROOT, 'supabase', 'functions', 'vtop-gateway', 'parsers.ts'));
    expect(gateway, 'the calendar grid rejects a day its month never had')
      .toMatch(/if \(!isRealCalendarDate\(year, month, day\)\) continue;/);
  });

  it('proves the day inside every function that assembles one', () => {
    // A file-wide check is not enough: one guarded return would excuse an
    // unguarded return ten lines below it. These three surfaces each own a
    // date-reshaping function, so ask that function, not the file.
    const fn = (path: string, name: string): string => {
      const code = codeOnly(join(ROOT, ...path.split('/')));
      const start = code.indexOf(`function ${name}(`);
      expect(start, `${path} still has ${name}`).toBeGreaterThan(-1);
      const rest = code.slice(start);
      const end = rest.search(/\n\}/);
      expect(end, `${name} is a top-level function`).toBeGreaterThan(-1);
      return rest.slice(0, end + 2);
    };
    for (const [path, name] of [
      ['src/utils/calendarOverlay.ts', 'eventDateKey'],
      ['src/utils/icalExport.ts', 'normalizeExamDate'],
      ['supabase/functions/event-hub/index.ts', 'isoDate'],
    ] as const) {
      const body = fn(path, name);
      expect(body, `${path}::${name} builds a day`).toMatch(NAMES_A_DAY);
      // Either an early `if (!isRealCalendarDate(...)) return ...`, or the day
      // handed back only as the chosen branch of that test.
      expect(body, `${path}::${name} proves the day before using it`)
        .toMatch(/if \(!isRealCalendarDate\(|isRealCalendarDate\([^\n]*\)\s*\?/);
    }
  });

  it('lets the Event Hub button ask the writer whether there is anything to add', () => {
    // Two surfaces, one rule: the view must not keep its own date regex, or it
    // can offer a calendar entry the exporter then refuses to write.
    const view = codeOnly(join(ROOT, 'src', 'components', 'EventHubView.tsx'));
    expect(view).toMatch(/import\s*\{[^}]*\bisEventCalendarReady\b[^}]*\}\s*from '\.\.\/utils\/icalExport'/);
    expect(view).toMatch(/disabled=\{!calendarReady\}/);
    expect(view, 'the view keeps no second date rule').not.toMatch(/ISO_DATE_RE/);
  });

  it('leaves the Event Hub view with no date maths of its own', () => {
    // The view used to build `new Date(y, m - 1, d)` twice to print a card's day
    // and weekday. February 30th came back as "2 Mar 2026, Mon" — a date the
    // source never wrote, printed with total confidence. Now the view asks
    // eventSchedule, which proves the day before it names one.
    const view = codeOnly(join(ROOT, 'src', 'components', 'EventHubView.tsx'));
    expect(view, 'the view builds no day out of parts').not.toMatch(DATES_FROM_PARTS);
    expect(view, 'the view asks the rule for both printers').toMatch(
      /import\s*\{[^}]*\beventDateLabel\b[^}]*\beventWeekday\b[^}]*\}\s*from '\.\.\/utils\/eventSchedule'/
    );

    const schedule = codeOnly(join(ROOT, 'src', 'utils', 'eventSchedule.ts'));
    expect(schedule, 'eventSchedule owns the listing-date rule').toMatch(/export function isEventDate\(/);
    expect(schedule, 'and proves the day before printing it').toMatch(/isRealCalendarDate\(/);
    expect(schedule, 'the weekday printer refuses a day it cannot name').toMatch(/if \(!iso\) return '';/);

    // Non-vacuity for this rule: the deleted helper did build an instant and
    // proved nothing, so the `new Date(` ban above is not watching an empty room.
    const DELETED_VIEW_HELPER =
      "function weekdayOf(iso: string): string {\n  const [y, m, d] = iso.split('-').map(Number);\n  const dt = new Date(y, m - 1, d);\n  return Number.isNaN(dt.getTime()) ? '' : dt.toLocaleDateString('en-US', { weekday: 'short' });\n}";
    expect(DELETED_VIEW_HELPER).toMatch(DATES_FROM_PARTS);
  });

  it('proves the day where a dd-MMM-yyyy cell becomes an instant', () => {
    // Academics reads VTOP's own "08-SEP-2026" marks rows. A Date built from
    // those parts answers March 2nd for a "30-FEB" cell and the NaN test below
    // it never fires, so the day has to be checked as it comes back.
    const view = codeOnly(join(ROOT, 'src', 'components', 'AcademicsView.tsx'));
    const at = view.indexOf('new Date(year, monthIdx, day)');
    expect(at, 'the row still builds its date from parts').toBeGreaterThan(-1);
    expect(view.slice(at, at + 300), 'and rejects a day that moved under it')
      .toMatch(/dt\.getDate\(\)\s*!==\s*day\s*\|\|\s*dt\.getMonth\(\)\s*!==\s*monthIdx/);
  });

  it('is watching code that actually existed', () => {
    // Non-vacuity: every copy this batch replaced, verbatim. Each one names
    // a day and proves nothing, which is exactly what the scans above reject.
    const DELETED_COPIES: Record<string, string> = {
      'the client parser assembling month eighteen':
        "  const dmy = value.match(/^(\\d{1,2})[/.-](\\d{1,2})[/.-](\\d{4})$/);\n  if (dmy) {\n    const [, dd, mm, yyyy] = dmy;\n    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;\n  }",
      'the gateway parser assembling the same day':
        "  const dmy = value.match(/^(\\d{1,2})[/.-](\\d{1,2})[/.-](\\d{4})$/);\n  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;",
      'the exam clock rolling February 30th into March':
        '  return Date.UTC(year, month - 1, day, hour, minute) - IST_OFFSET_MS;',
      'the LMS clock doing the same to a deadline':
        '  const utcMs = Date.UTC(year, month, day, hour, minute) - 5.5 * 3600 * 1000;',
      'the calendar overlay dropping an event on a day the grid never had':
        "  const dmy = raw.trim().match(/^(\\d{1,2})[/-](\\d{1,2})[/-](\\d{4})$/);\n  if (dmy) {\n    const [, d, m, y] = dmy;\n    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;\n  }",
      'the .ics writer putting that day into the student\'s own calendar':
        "  const dmy = dateStr.trim().match(/^(\\d{1,2})[\\/-](\\d{1,2})[\\/-](\\d{4})$/);\n  if (!dmy) return null;\n  return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;",
      'the Event Hub re-dating a card that had asked for an impossible day':
        "  const dmy = s.match(/^(\\d{1,2})[/-](\\d{1,2})[/-](\\d{4})$/);\n  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;",
    };
    const tripped = new Set<string>();
    for (const [name, code] of Object.entries(DELETED_COPIES)) {
      if (NAMES_A_DAY.test(code) && !PROVES_THE_DAY.test(code)) tripped.add(name);
    }
    expect([...tripped].sort()).toEqual(Object.keys(DELETED_COPIES).sort());
  });
});
