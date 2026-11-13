/**
 * Security-hardening guard.
 *
 * The rules below are cheap to break by a well-meaning edit and invisible from
 * the UI, so they are pinned against the files that carry them:
 *
 *  - the marks capability token is hashed at rest behind an explicit marker,
 *    and the flow stays anonymous (no auth.uid() requirement was introduced);
 *  - grade_stats groups by the real class identity and carries the 15-row
 *    privacy floor itself;
 *  - the dead anonymous write path into grade_predictions stays closed;
 *  - the cabshare date check uses one backslash, matching real dates;
 *  - lms-gateway validates courseId at runtime, not just in its type;
 *  - no AI proxy endpoint exists to protect with a static token: the advisor
 *    calls Gemini from the browser with the student's own key;
 *  - VTOP-sourced receipt fields are escaped before they reach a HTML sink.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { escapeHtml, receiptHtml } from '../../utils/receiptHtml';

const ROOT = process.cwd();
const SQL = readFileSync(
  join(ROOT, 'supabase', 'migrations', '20261114000001_security_hardening.sql'),
  'utf8',
);
/** The header comments name the old defects; the negative scans read the code only. */
const CODE = SQL.replace(/--[^\n]*/g, '');
const LMS = readFileSync(join(ROOT, 'supabase', 'functions', 'lms-gateway', 'index.ts'), 'utf8');
const SERVER = readFileSync(join(ROOT, 'server.ts'), 'utf8');
const ADVISOR = readFileSync(join(ROOT, 'src', 'components', 'AiAdvisorView.tsx'), 'utf8');
const VERCEL = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8')) as {
  headers: { source: string; headers: { key: string; value: string }[] }[];
};

describe('shared_marks token hashing', () => {
  it('hashes the device token behind a marker before it is stored or matched', () => {
    const marker = /'sha256:' \|\| encode\(sha256\(convert_to\(v_device, 'UTF8'\)\), 'hex'\)/g;
    // One for the stored hash, one for the backfill of legacy rows.
    expect((SQL.match(marker) ?? []).length).toBe(2);
    expect(SQL).toContain('convert_to(device_code,');
  });

  it('decides "already hashed" from the marker, not from a hex-shaped guess', () => {
    expect(SQL).toMatch(/where device_code !~ '\^sha256:\[0-9a-f\]\{64\}\$'/);
    // The old skip left a 64-character lowercase-hex plaintext in the clear.
    expect(CODE).not.toMatch(/!~ '\^\[0-9a-f\]\{64\}\$'/);
    expect(SQL).toMatch(/check \(device_code ~ '\^sha256:/);
  });

  it('stays anonymous — no login identity was introduced', () => {
    expect(CODE).not.toMatch(/auth\.uid\(\)/);
    expect(CODE).not.toMatch(/auth\.role\(\)/);
    // Hashing is built in; no extension has to be installed to apply this.
    expect(CODE).not.toMatch(/pgcrypto|extensions\.digest/);
  });

  it('keeps the server-side cohort guard and the per-device dedupe', () => {
    expect(SQL).toContain('MARKS_INVALID_TERM');
    expect(SQL).toContain('MARKS_INVALID_REGULATION');
    expect(SQL).toContain('on conflict on constraint shared_marks_one_per_device');
    expect(SQL).toMatch(/security definer/i);
    expect(SQL).toMatch(/set search_path = public/i);
  });
});

describe('grade_stats', () => {
  it('groups by the class identity shared_marks actually stores', () => {
    expect(SQL).toMatch(
      /group by course_code, term, regulation, faculty, slot, component, stage/i,
    );
    expect(SQL).not.toMatch(/from public\.grade_predictions/i);
    expect(CODE).not.toMatch(/\bcourse_id\b/);
  });

  it('carries the privacy floor per group and is the only granted read', () => {
    expect(SQL).toMatch(/having count\(\*\) >= 15/i);
    expect(SQL).toMatch(/grant select on public\.grade_stats to anon, authenticated/i);
    expect(SQL).not.toMatch(/grant select .* on public\.grade_predictions/i);
  });

  it('closes the unused anonymous write path', () => {
    expect(SQL).toMatch(/drop policy if exists "anon can submit anonymous grades"/i);
    expect(SQL).toMatch(/revoke all on public\.grade_predictions from anon, authenticated/i);
  });

  it('retires the only reader of the retired view', () => {
    expect(() =>
      readFileSync(join(ROOT, 'supabase', 'functions', 'compute_grade_stats', 'index.ts')),
    ).toThrow();
  });
});

describe('cabshare date check', () => {
  it('uses single backslashes so real dates match', () => {
    expect(SQL).toContain(String.raw`travel_date ~ '^\d{4}-\d{2}-\d{2}$'`);
    expect(SQL).toContain(String.raw`travel_time ~ '^([01]\d|2[0-3]):[0-5]\d$'`);
    // A doubled backslash under standard_conforming_strings requires a literal
    // backslash in the value, which no real date has.
    expect(CODE).not.toMatch(/\\\\d/);
  });
});

describe('lms-gateway input validation', () => {
  it('checks courseId at runtime before it reaches a URL', () => {
    expect(LMS).toContain('Number.isInteger(courseId)');
    expect(LMS).toContain('courseId <= 0');
  });
});

describe('AI advisor', () => {
  it('has no server endpoint, so no static bearer token exists to leak', () => {
    // UltraCC has no server-verified user identity: identity is anonymous
    // capability tokens checked inside the RPCs. A shared static token cannot
    // authenticate a student, so the uncalled proxy was removed instead.
    expect(SERVER).not.toContain('/api/ai/advisor');
    expect(SERVER).not.toContain('ADVISOR_TOKEN');
    expect(SERVER).not.toContain('GoogleGenAI');
  });

  it('calls Gemini from the browser with the key the student saved', () => {
    expect(ADVISOR).toContain('generativelanguage.googleapis.com');
    expect(ADVISOR).toContain('getGeminiApiKey');
    expect(ADVISOR).not.toContain('ADVISOR_TOKEN');
  });
});

describe('response headers', () => {
  it('ships the standard browser hardening headers', () => {
    const keys = VERCEL.headers.flatMap((entry) => entry.headers.map((h) => h.key));
    expect(keys).toEqual(expect.arrayContaining([
      'X-Content-Type-Options',
      'Referrer-Policy',
      'X-Frame-Options',
      'Permissions-Policy',
    ]));
  });
});

describe('receipt output encoding', () => {
  it('escapes every markup character', () => {
    expect(escapeHtml(`<script>alert("x")</script> & 'quoted'`)).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;quoted&#39;',
    );
  });

  it('renders an injected receipt field as text, not markup', () => {
    const html = receiptHtml({
      receiptNumber: '<img src=x onerror=alert(1)>',
      date: '<script>steal()</script>',
      amount: '₹1',
      campusCode: 'CH',
      viewKey: null,
      applno: 'A1',
      regno: '25BEE0001',
    });
    expect(html).not.toContain('<script>steal()');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;steal()&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});
