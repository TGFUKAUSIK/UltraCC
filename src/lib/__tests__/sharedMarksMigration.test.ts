/**
 * shared_marks migration guard.
 *
 * The opt-in marks pool is the only place UltraCC writes one student's marks
 * somewhere another student's browser can influence a number. Four properties
 * hold the whole privacy story together, and none of them are visible from the
 * UI, so they are pinned against the SQL and the client that calls it:
 *
 *  1. The table is unreachable from a browser: RLS on, no policy, no table or
 *     sequence grant. Reads and writes go through SECURITY DEFINER functions.
 *  2. No reader can ever see a row — the stats function returns count/mean/sd
 *     only, and withholds the figures under 15 contributors.
 *  3. One device holds one row per (course, term, component); a re-sync
 *     updates it, so repeated syncs cannot inflate a cohort.
 *  4. Opt-out really deletes the device's rows, and the client only ever calls
 *     the three approved RPCs — never the table.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const SQL = readFileSync(
  join(ROOT, 'supabase', 'migrations', '20261113000001_shared_marks.sql'),
  'utf8',
);
const CLIENT = readFileSync(join(ROOT, 'src', 'lib', 'gradeSharing.ts'), 'utf8');

/** Body of one `create or replace function public.<name>( … ) … $$;` block. */
function functionBody(name: string): string {
  const start = SQL.indexOf(`function public.${name}(`);
  expect(start, `${name} exists`).toBeGreaterThan(-1);
  const end = SQL.indexOf('$$;', SQL.indexOf('as $$', start));
  expect(end, `${name} closes`).toBeGreaterThan(start);
  return SQL.slice(start, end);
}

describe('shared_marks migration', () => {
  it('leaves the table deny-all with no policy and no client grant', () => {
    expect(SQL).toContain('enable row level security');
    expect(SQL).not.toMatch(/create\s+policy/i);
    expect(SQL).toMatch(/revoke all on public\.shared_marks from anon, authenticated/i);
    expect(SQL).toMatch(/revoke all on sequence public\.shared_marks_id_seq/i);
    // A granted table would let a browser select every row by hand.
    expect(SQL).not.toMatch(/grant\s+(select|insert|update|delete).*on\s+public\.shared_marks/i);
  });

  it('never reaches for the service-role key in SQL the client can see', () => {
    expect(SQL).not.toMatch(/service_role/i);
    expect(CLIENT).not.toMatch(/service_role|SUPABASE_SERVICE/i);
  });

  it('reaches the table only through SECURITY DEFINER functions on a fixed path', () => {
    const bodies = ['share_marks', 'withdraw_marks', 'shared_marks_stats'].map((name) => ({
      name,
      body: SQL.slice(SQL.indexOf(`function public.${name}(`) - 200, SQL.indexOf('$$;', SQL.indexOf(`function public.${name}(`)) + 3),
    }));
    for (const { name, body } of bodies) {
      expect(body, `${name} security definer`).toMatch(/security definer/i);
      expect(body, `${name} search_path`).toMatch(/set search_path = public/i);
    }
    // Only execute on the three functions is handed to the client.
    for (const name of ['share_marks', 'withdraw_marks', 'shared_marks_stats']) {
      expect(SQL).toMatch(new RegExp(`grant execute on function public\\.${name}\\([^)]*\\)\\s*\\n?\\s*to anon, authenticated`, 'i'));
    }
  });

  it('keeps one row per device per course per term per component', () => {
    const unique = SQL.match(/unique\s*\(([^)]*)\)/i);
    expect(unique, 'unique key exists').toBeTruthy();
    const cols = unique![1].split(',').map((c) => c.trim());
    expect(cols).toEqual(['device_code', 'course_code', 'term', 'component']);
    // The upsert targets that constraint by name, so a re-sync updates.
    expect(functionBody('share_marks')).toContain('on conflict on constraint shared_marks_one_per_device');
    expect(functionBody('share_marks')).toMatch(/do update set/i);
  });

  it('validates every field the client sends before storing it', () => {
    const body = functionBody('share_marks');
    for (const guard of [
      'MARKS_INVALID_DEVICE',
      'MARKS_INVALID_COURSE',
      'MARKS_INVALID_COMPONENT',
      'MARKS_INVALID_STAGE',
      'MARKS_INVALID_PERCENT',
      'MARKS_INVALID_WEIGHT',
    ]) {
      expect(body, guard).toContain(guard);
    }
    // Numeric range checks, not just presence checks.
    expect(body).toMatch(/p_percent\s*>\s*100/);
    expect(body).toMatch(/p_weight\s*<=\s*0/);
  });

  it('withholds figures under the 15-contributor floor and returns no rows', () => {
    const body = functionBody('shared_marks_stats');
    expect(body).toMatch(/v_count\s*<\s*15/);
    expect(body).toMatch(/'suppressed',\s*true/);
    // Aggregates only — the function must not return a rowset.
    expect(body).toMatch(/returns jsonb/i);
    expect(body).not.toMatch(/returns\s+setof/i);
    expect(body).toMatch(/jsonb_build_object\(\s*'count'/);
    // Every cohort column is part of the filter, or classes would be pooled.
    for (const col of ['course_code', 'term', 'regulation', 'faculty', 'slot', 'component', 'stage']) {
      expect(body, col).toMatch(new RegExp(`\\b${col}\\s*=`));
    }
  });

  it('deletes the device’s rows on opt-out', () => {
    expect(functionBody('withdraw_marks')).toMatch(/delete from public\.shared_marks\s+where device_code = v_device/i);
  });

  it('lets the client call only the three RPCs, never the table endpoint', () => {
    const rpcCalls = [...CLIENT.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).filter((s) => /_marks/.test(s));
    for (const call of ['share_marks', 'withdraw_marks', 'shared_marks_stats']) {
      expect(rpcCalls, call).toContain(call);
    }
    // A direct `/rest/v1/shared_marks` query would bypass RLS-less grants and
    // the privacy floor; RPC is the only door.
    expect(CLIENT).not.toMatch(/\/rest\/v1\/shared_marks/);
  });
});
