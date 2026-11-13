/**
 * Student-facing copy guard.
 *
 * UltraCC leaked its own plumbing to students for as long as those strings
 * existed: the deployed commit SHA in the login dialog header, a "What VTOP
 * served (last sync)" dump under the marks table, "Not configured on this
 * deployment yet", "Syncing datasets…", "Polling fallback", and a ride-board
 * panel that told a student to run a SQL migration in Supabase. None of it was
 * actionable for the person looking at it — it was the developer's debugging
 * surface rendered into the product.
 *
 * The rule this enforces: developer telemetry belongs in the dev console
 * (`debugErrorDetail`) or in the sync record, never in a component. Each phrase
 * below is one that used to reach the screen, so the list is a regression guard
 * rather than a style opinion. Comments are stripped before scanning, because
 * explaining an old phrase is allowed — rendering it is not.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

/** Every source file under `dir`, excluding test folders. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    if (entry === '__tests__') continue;
    const full = join(ROOT, dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(`${dir}/${entry}`));
    else if (/\.(tsx|ts)$/.test(entry)) out.push(full);
  }
  return out;
}

const SCREENS = sourceFiles('src/components');
/** What can render. `src/lib` may hold operator strings for the dev console,
 *  so it is deliberately not scanned — a component reaching for one is. */
const RENDER = [...SCREENS, join(ROOT, 'src/App.tsx')];

/** Source with comments removed — the guard is about what can render. */
function codeOnly(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const relative = (p: string) => p.slice(ROOT.length + 1);
const offenders = (files: string[], phrase: string) =>
  files.filter((f) => codeOnly(f).includes(phrase)).map(relative);

/** Phrase → why a student must never see it. */
const BANNED: Record<string, string> = {
  'What VTOP served': 'a parse diagnostic, not a grade',
  '· build ': 'a commit SHA means nothing to a student',
  'gateway deploy': 'our deploy is not the student\'s action',
  'Not configured on this deployment': 'deployment configuration is ours, not theirs',
  'behind this app version': 'version skew is a maintainer concern',
  'needs a backend update': 'the student cannot update a backend',
  'SQL editor': 'the ride-board migration instruction is operator-only text (src/lib/phoneIdentity.ts)',
  'Polling fallback': 'transport plumbing; say what the student gets instead',
  'Supabase board': 'names our database, not the feature',
  'Syncing datasets': '"datasets" is internal vocabulary',
  'datasets synced': '"datasets" is internal vocabulary',
  'raw VTOP details': 'VTOP\'s own fields are already shown under their labels',
  'VAPID public key': 'a key name is not a reason a student can act on',
  'push_notifications migration': 'the migration is ours to apply',
  'not yet live-verified': 'how ready our parsers are is not the student\'s problem — say "not available yet"',
  'Submission failed': 'passive voice about our insert; say it stayed on the device and what to do',
  'campus-data service': 'names our hosting where the student is being told what the list is',
  // Batch A: the signed-out and static screens explained themselves as pipeline
  // states. Each of these was on a student's screen once.
  'official hostel-feed integration': 'the mess menu has no source; saying which feed is missing is ours to know',
  'from the current VTOP sync': 'a sync is our mechanism; the student needs to know there is nothing to read',
  'authoritative campus feed': 'a feed is our word for data we do not have',
  'STATIC / VERIFIED ONLY': 'how a row is stored is not how a student decides to trust it',
  'USER-PROVIDED REFERENCE': 'the same row labelled twice in pipeline words',
  'USER-GENERATED · OPT-IN': 'opt-in describes our table, not the groups on screen',
  'Verified print references': 'we have not verified these; they are what students reported',
  'voluntarily entered': 'legal-shaped phrasing for "what someone chose to post"',
};

/**
 * Native browser dialogs are banned as a class, not for their wording.
 *
 * `window.prompt` and `window.confirm` return null with no dialog at all in an
 * iOS home-screen PWA (and `alert` renders that ugly OS sheet over an app that
 * otherwise looks native). UltraCC is installed on phones by most of its users,
 * so a prompt was a silently dead button there: the ride board's four poster
 * actions and the FFCS plan rename all did nothing on an iPhone. Feedback
 * belongs in `showToast`; an answer belongs in an inline field.
 */
const NATIVE_DIALOG = [
  /window\s*\.\s*prompt\s*\(/,
  /window\s*\.\s*alert\s*\(/,
  /window\s*\.\s*confirm\s*\(/,
  /(^|[^.\w])prompt\s*\(\s*['"`]/,
  /(^|[^.\w])alert\s*\(\s*['"`]/,
  /(^|[^.\w])confirm\s*\(\s*['"`]/,
];

describe('student-facing copy carries no developer telemetry', () => {
  it('scans the rendered surface, not a stub list', () => {
    // Guards against this test silently checking nothing.
    expect(SCREENS.length).toBeGreaterThan(40);
    expect(RENDER.length).toBeGreaterThan(SCREENS.length);
    expect(SCREENS.some((f) => f.endsWith('MeridianDashboard.tsx'))).toBe(true);
  });

  for (const [phrase, reason] of Object.entries(BANNED)) {
    it(`never renders "${phrase}" — ${reason}`, () => {
      expect(offenders(RENDER, phrase)).toEqual([]);
    });
  }

  it('uses no native browser dialog anywhere a student can click', () => {
    const found = RENDER
      .map((f) => ({ f, hits: NATIVE_DIALOG.filter((re) => re.test(codeOnly(f))).length }))
      .filter((x) => x.hits > 0)
      .map((x) => `${relative(x.f)} (${x.hits})`);
    expect(found).toEqual([]);
  });

  it('keeps the build identity out of every component', () => {
    // It still exists — main.tsx version-stamps the service worker with it —
    // but no screen may print it.
    expect(offenders(SCREENS, 'BUILD_ID')).toEqual([]);
    expect(codeOnly(join(ROOT, 'src/main.tsx'))).toContain('/sw.js?v=${BUILD_ID}');
  });

  it('keeps the maintainer-only remedies reachable from a dev console', () => {
    // Deleting these would be the wrong fix: the information stays available
    // where debugging actually happens, it just no longer renders.
    expect(codeOnly(join(ROOT, 'src/lib/push.ts'))).toContain("debugErrorDetail('push-backend'");
    expect(codeOnly(join(ROOT, 'src/components/CabShareView.tsx'))).toContain('debugErrorDetail');
    expect(codeOnly(join(ROOT, 'src/lib/vtop/syncSemester.ts'))).toContain("debugErrorDetail('marks-sync'");
  });
});
