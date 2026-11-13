/**
 * Overlay chrome guard.
 *
 * UltraCC's mobile shell is fixed furniture: the app bar sits at z-index 60 and
 * the tab bar at 59 (index.css). A modal written as `fixed inset-0 z-50` is
 * therefore *underneath* both on a phone — the student opens "Log Hostel Leave"
 * or "Share timetable", and the bottom of the form is covered by the tab bar
 * with no way to scroll it into view. Six of the app's eleven overlays were
 * authored that way, because z-50 is what Tailwind suggests and nothing in the
 * desktop layout ever contradicted it.
 *
 * The same six were also bare divs: no `role="dialog"`, no `aria-modal`, no
 * Escape handler, and Tab walking straight out of the sheet into the page
 * behind it. `useDialog` exists for exactly this, and AcademicCalendarView,
 * SettingsModal, CommandCenterModal, ExtensionSyncModal, SyllabusView and
 * AttendancePredictorSheet already use it — so this is a consistency rule the
 * codebase has already agreed to, not a new preference.
 *
 * Two ways an overlay clears the chrome: a Tailwind step at or above 70, or a
 * shell class that index.css raises with `z-index: 70 !important` inside the
 * mobile media query. Both lists are read from the CSS where possible, so a
 * future bump of the tab bar above these values fails here instead of on a
 * student's phone.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const CSS = readFileSync(join(ROOT, 'src', 'index.css'), 'utf8');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    if (entry === '__tests__') continue;
    const full = join(ROOT, dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(`${dir}/${entry}`));
    else if (/\.tsx$/.test(entry)) out.push(full);
  }
  return out;
}

const RENDER = [...sourceFiles('src/components'), join(ROOT, 'src', 'App.tsx')];
const relative = (p: string) => p.slice(ROOT.length + 1);

/** Comments explain old overlays; only live markup can be one. */
function codeOnly(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * Every full-screen overlay literal in the rendered surface, plus the opening
 * tag it lives in. The tag is read on *both* sides of the className because
 * half of these sheets write `role="dialog"` first (SyllabusView) and half
 * write it after (TimetableView) — either order is valid JSX, so judging only
 * the tail would fail correct markup and passing a window that runs into the
 * next overlay would let a later sheet vouch for an earlier one.
 */
const OVERLAYS = RENDER.flatMap((file) => {
  const code = codeOnly(file);
  return [...code.matchAll(/className=(["'`])([^"'`\n]*fixed inset-0[^"'`\n]*)\1/g)]
    .map((m) => {
      const open = code.slice(Math.max(0, code.lastIndexOf('<', m.index!)), m.index!);
      const tail = code.slice(m.index! + m[0].length, m.index! + m[0].length + 1400).split('fixed inset-0')[0];
      return { file: relative(file), cls: m[2], tag: open + tail };
    });
});

/** Shell classes index.css pins above the chrome — read, not remembered. */
const PINNED = (() => {
  const rule = CSS.match(/([^{}]+)\{[^{}]*z-index:\s*70\s*!important/g) ?? [];
  return rule.flatMap((r) => [...r.matchAll(/\.([a-z][a-z0-9-]*)\b/g)].map((m) => m[1]));
})();

/**
 * The fixed furniture a modal must beat: the app bar and the mobile tab bar.
 * Read from index.css so raising either above the modal layer fails here.
 */
const CHROME_Z = ['meridian-header', 'mobile-tab-bar'].flatMap((name) => {
  const rules = CSS.match(new RegExp(`\\.${name}[^{]*\\{[^}]*\\}`, 'g')) ?? [];
  return rules.flatMap((r) => [...r.matchAll(/z-index:\s*(\d+)/g)].map((m) => Number(m[1])));
});
const CHROME = Math.max(...CHROME_Z);

describe('full-screen overlays clear the mobile chrome', () => {
  it('finds the overlays it is claiming to check', () => {
    expect(OVERLAYS.length).toBeGreaterThanOrEqual(10);
    expect(PINNED.length).toBeGreaterThanOrEqual(3);
    // 60 (app bar) and 59 (tab bar) is the whole mobile ceiling.
    expect(CHROME).toBe(60);
  });

  it('stacks every one above the app bar and tab bar', () => {
    const low = OVERLAYS.filter(({ cls }) => {
      const steps = [...cls.matchAll(/(?:^|\s)z-\[?(\d+)\]?/g)].map((m) => Number(m[1]));
      const pinned = PINNED.some((name) => cls.includes(name));
      return !pinned && (steps.length === 0 || Math.min(...steps) <= CHROME);
    }).map(({ file, cls }) => `${file}: ${cls.slice(0, 90)}`);
    expect(low).toEqual([]);
  });
});

describe('overlays behave like dialogs', () => {
  it('announces itself as a dialog to a screen reader', () => {
    const bare = OVERLAYS
      .filter(({ tag }) => !/role="dialog"/.test(tag))
      .map(({ file, cls }) => `${file}: ${cls.slice(0, 70)}`);
    expect(bare).toEqual([]);
  });

  it('lets the student out with Escape through the shared hook', () => {
    // Every file that owns an overlay must reach for useDialog; the hook is
    // what traps Tab and returns focus to the trigger. Call sites are written
    // as `useDialog<HTMLDivElement>({ … })`, so match the generic form too.
    const users = RENDER.filter((f) => /useDialog\s*[<(]/.test(codeOnly(f))).map(relative);
    const owners = [...new Set(OVERLAYS.map((o) => o.file))];
    const missing = owners.filter((o) => !users.includes(o)).map((o) => `${o} owns an overlay but never calls useDialog`);
    expect(missing).toEqual([]);
    expect(users.length).toBeGreaterThanOrEqual(8);
  });
});
