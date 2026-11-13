/**
 * The dashboard answers "what is my next exam" once — regression guard.
 *
 * The banner and the examinations panel used to compute the answer twice: the
 * panel filtered VTOP's rows on `localTodayIso(today)` and only on the date,
 * while the banner asked the IST-safe helper, which also honours the published
 * hour. A paper written that morning therefore still read as
 * "Next scheduled examination" in the panel below a banner that had moved on to
 * the next one, and the two could disagree for the rest of the day.
 *
 * These assertions are about the shape of the source: the exam list is allowed
 * to be rendered in more than one place, it is not allowed to be *decided* in
 * more than one place.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

/** POSIX-style path relative to the repo, so assertions read the same on Windows. */
const repoPath = (file: string) => relative(ROOT, file).replace(/\\/g, '/');

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

/** Source with comments removed — the guard is about what actually runs. */
function codeOnly(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const dashboard = codeOnly(join(ROOT, 'src/components/MeridianDashboard.tsx'));
const examUtils = codeOnly(join(ROOT, 'src/utils/examUtils.ts'));
const styles = readFileSync(join(ROOT, 'src/index.css'), 'utf8');

describe('one rule decides which exams are still ahead', () => {
  it('the dashboard asks the shared list and nothing else', () => {
    expect(dashboard).toContain('upcomingExams(exams, now.getTime())');
    expect((dashboard.match(/upcomingExams\(exams/g) || []).length).toBe(1);
    // A second, privately-computed "next exam" is exactly how the two panels
    // started disagreeing in the first place.
    expect(dashboard).not.toMatch(/nextUpcomingExam/);
    expect(dashboard).not.toMatch(/localTodayIso/);
    expect(dashboard).not.toMatch(/\.date\s*>=/);
  });

  it('both render sites read from that one list', () => {
    // The plate leads with the head of the list; the rows under it read the same
    // list. Neither decides for itself which exams are ahead.
    expect(dashboard).toContain('upcoming[0] ?? null');
    expect(dashboard).toMatch(/upcoming\.slice\(1, 3\)/);
    expect(dashboard).not.toMatch(/nextExam\b/);
  });

  it('no other surface re-implements the rule', () => {
    // Comparing VTOP's own date label against a "today" the file computed itself
    // is how a second answer gets born. examUtils owns that comparison.
    const rewriters = sourceFiles('src').filter((file) => {
      if (repoPath(file) === 'src/utils/examUtils.ts') return false;
      const source = codeOnly(file);
      return /\.date\s*(?:>=|<=|>|<)\s*(?:today|todayIso|localTodayIso|new Date|Date\.now)/.test(source)
        || /\.sort\(\(a, b\) => a\.date\.localeCompare\(b\.date\)\)/.test(source);
    });
    expect(rewriters.map(repoPath)).toEqual([]);
  });

  it('the retired single-exam card is gone from markup and styles', () => {
    expect(dashboard).not.toContain('portal-exam-card');
    expect(styles).not.toContain('portal-exam-card');
  });
});

describe('examUtils keeps the rule in one function', () => {
  it('nextUpcomingExam is the head of upcomingExams, not a second filter', () => {
    const body = examUtils.slice(examUtils.indexOf('export function nextUpcomingExam'));
    expect(body.slice(0, 240)).toMatch(/return upcomingExams\(exams, nowMs\)\[0\] \?\? null;/);
  });

  it('the day-versus-instant decision is written once', () => {
    expect((examUtils.match(/timeKnown \? startsAtMs >= nowMs : date >= todayIst/g) || []).length).toBe(1);
    expect(examUtils).toContain('TIME_TOKEN.test(exam.time)');
  });
});
