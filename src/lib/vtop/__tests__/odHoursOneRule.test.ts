/**
 * One OD cap, one name for the hours it is spent against.
 *
 * Two rules used to live in two places each. The 40-hour semester cap is the
 * gateway's (`OD_LIMIT_HOURS`), yet the client restated it as `limitHours ?? 40`,
 * so a response that carried no cap still printed a denominator nobody had
 * supplied — and if VIT ever changed the number, the app would disagree with
 * itself on the same screen. The figure `totalOdHours` is hours *used*, yet the
 * dashboard called it an "OD balance", which a student reads as the hours left
 * before their next on-duty request runs them out.
 *
 * The cap now arrives or it does not (`number | null`), every surface that
 * prints a fraction proves it first, and one word — used — names the quantity on
 * every panel and in the AI advisor's context. The old copies are quoted in
 * `DELETED_COPIES` so no rule below is allowed to match nothing.
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

const WEB = sourceFiles('src');
const webCode = new Map(WEB.map((p) => [rel(p), codeOnly(p)]));

/** Every file that reads the cap, so a new reader has to be guarded too. */
const CAP_READERS = [...webCode.entries()]
  .filter(([, code]) => /limitHours/.test(code))
  .map(([name]) => name)
  .sort();

describe('the on-duty cap has one owner', () => {
  it('lets the gateway state 40 and the client carry whatever arrived', () => {
    expect(CAP_READERS.sort()).toEqual([
      'src/components/AcademicsView.tsx',
      'src/components/AiAdvisorView.tsx',
      'src/components/MeridianDashboard.tsx',
      'src/lib/vtop/realClient.ts',
      'src/lib/vtop/types.ts',
    ]);

    const ownDefault = [...webCode.entries()]
      .filter(([, code]) => /limitHours[^;\n]*\?\?\s*\d+/.test(code))
      .map(([name]) => name);
    expect(ownDefault, `the client restates the cap in: ${ownDefault.join(', ')}`).toEqual([]);

    const gateway = readFileSync(join(ROOT, 'supabase', 'functions', 'vtop-gateway', 'index.ts'), 'utf8');
    expect((gateway.match(/const OD_LIMIT_HOURS = \d+;/g) || []).length).toBe(1);
  });

  it('proves the cap exists before printing a fraction of it', () => {
    const unguarded = CAP_READERS.filter((name) => {
      if (name === 'src/lib/vtop/types.ts') return false;
      const code = webCode.get(name) ?? '';
      return !/limitHours !== null/.test(code) && !/typeof data\.limitHours === 'number'/.test(code);
    });
    expect(unguarded, `surfaces that print a cap they never proved: ${unguarded.join(', ')}`).toEqual([]);

    // And the promise is in the type, not just in the screens.
    expect(webCode.get('src/lib/vtop/types.ts')).toMatch(/limitHours: number \| null;/);
  });
});

describe('the hours figure is never called a balance', () => {
  it('names the quantity the same way on every surface', () => {
    const balances = [...webCode.entries()]
      .filter(([, code]) => /OD balance/i.test(code))
      .map(([name]) => name);
    expect(balances, `"OD balance" still printed by: ${balances.join(', ')}`).toEqual([]);

    // Each of the three readers says "used" instead.
    expect(webCode.get('src/components/MeridianDashboard.tsx')).toMatch(/OD hours used/);
    expect(webCode.get('src/components/AcademicsView.tsx')).toMatch(/On-duty hours used/);
    expect(webCode.get('src/components/AcademicsView.tsx')).toMatch(/OD hours used/);
    // The AI advisor gets the same word, or it will answer with the old one.
    expect(webCode.get('src/components/AiAdvisorView.tsx')).toMatch(/hoursUsed/);
  });
});

describe('no rule above is watching an empty room', () => {
  const DELETED_COPIES = [
    "      limitHours: data.limitHours ?? 40,",
    "        <div className=\"portal-panel-footer\"><span>{od?.available ? `OD balance: ${display(od.totalOdHours)} hours` : 'OD information not available'}</span></div>",
    '        odHours: od?.available ? { total: od.totalOdHours, limit: od.limitHours } : null,',
    '  limitHours: number;',
  ];

  it('still catches the client that restated the cap', () => {
    expect(DELETED_COPIES.some((copy) => /limitHours[^;\n]*\?\?\s*\d+/.test(copy))).toBe(true);
  });

  it('still catches the dashboard that called spent hours a balance', () => {
    expect(DELETED_COPIES.some((copy) => /OD balance/i.test(copy))).toBe(true);
  });

  it('still catches the context that handed the model a bare total and limit', () => {
    expect(DELETED_COPIES.some((copy) => /total: od\.totalOdHours, limit: od\.limitHours/.test(copy))).toBe(true);
  });

  it('still catches a type that promised a cap it could not supply', () => {
    expect(DELETED_COPIES.some((copy) => /limitHours: number;/.test(copy))).toBe(true);
  });
});
