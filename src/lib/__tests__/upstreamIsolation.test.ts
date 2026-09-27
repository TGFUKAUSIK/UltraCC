/**
 * Upstream-isolation scan — the core data-layer acceptance criterion.
 *
 * The frontend must contain ZERO direct requests to upstream data hosts;
 * all upstream access lives server-side inside the campus-data edge
 * function. This test scans the frontend source tree and fails the build if
 * an upstream URL or host reference ever reappears in frontend code.
 *
 * Allowed locations for upstream URLs:
 *   - supabase/functions/** (server-side ingest — never shipped to browsers)
 *   - documentation (README, THIRD_PARTY_NOTICES.md)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const PROJECT_ROOT = join(__dirname, '..', '..', '..');

const UPSTREAM_PATTERNS: RegExp[] = [
  // CodeChef-VIT's Papers API: the Q-Bank archive is imported server-side by
  // supabase/functions/pyq-sync into Postgres, so the browser must never name
  // this host — it reads pyq_papers through PostgREST instead.
  /papers\.codechefvit\.com/i,
  // Add future upstream data hosts here; they must only ever appear inside
  // supabase/functions (server-side) or docs — never in frontend code.
];

const FORBIDDEN_DIRS = ['src', 'public', 'extension'];

const SKIP_DIR_NAMES = new Set(['node_modules', 'dist', '.git', '__tests__']);

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (!SKIP_DIR_NAMES.has(entry)) walk(full, out);
      continue;
    }
    if (/\.(ts|tsx|js|jsx|json|html|css|svg)$/.test(entry)) out.push(full);
  }
}

describe('frontend upstream isolation', () => {
  it('frontend source contains zero direct upstream API calls', () => {
    const files: string[] = [];
    for (const dir of FORBIDDEN_DIRS) {
      const abs = join(PROJECT_ROOT, dir);
      try {
        statSync(abs);
        walk(abs, files);
      } catch {
        // Directory absent — nothing to scan.
      }
    }

    const offenders: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      for (const pattern of UPSTREAM_PATTERNS) {
        if (pattern.test(content)) offenders.push(`${file} :: ${pattern.source}`);
      }
    }

    expect(
      offenders,
      `Direct upstream references found in frontend code (move them into supabase/functions/campus-data):\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('server-side ingest is the ONLY place upstream URLs live', () => {
    const importer = readFileSync(join(PROJECT_ROOT, 'supabase/functions/pyq-sync/sync.ts'), 'utf8');
    expect(importer).toMatch(/papers\.codechefvit\.com/);

    // The campus-data function has no hardcoded third-party host; its upstream
    // endpoints come from deploy-time environment variables.
    const campusData = readFileSync(join(PROJECT_ROOT, 'supabase/functions/campus-data/index.ts'), 'utf8');
    expect(campusData).toMatch(/Deno\.env\.get/);
  });
});
