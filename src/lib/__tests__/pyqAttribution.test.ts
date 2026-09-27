/**
 * Attribution contract for the Q-Bank previous-year-paper archive.
 *
 * UltraCC mirrors CodeChef-VIT's paper *metadata* and links to PDFs CodeChef-VIT
 * hosts. The credit is therefore part of the licensing posture rather than
 * decoration: it has to stay in the documents a reader actually opens, the
 * upstream licence has to be reproduced the way MIT asks for, and no paper file
 * may ever be vendored into this repository. These assertions keep a later
 * refactor from quietly dropping any of the three.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const PROJECT_ROOT = join(__dirname, '..', '..', '..');

const notices = readFileSync(join(PROJECT_ROOT, 'THIRD_PARTY_NOTICES.md'), 'utf8');
const readme = readFileSync(join(PROJECT_ROOT, 'README.md'), 'utf8');

/** The `## 3. CodeChef-VIT …` block, up to the next `## ` heading. */
const CODECHEF_SECTION =
  notices.split(/^## /m).find((block) => /^3\.\s+CodeChef-VIT/.test(block)) ?? '';

describe('CodeChef-VIT archive attribution', () => {
  it('documents the source, its repository and its public site', () => {
    expect(CODECHEF_SECTION, 'THIRD_PARTY_NOTICES.md lost its CodeChef-VIT section').toContain(
      'CodeChef-VIT Papers',
    );
    expect(CODECHEF_SECTION).toContain('github.com/CodeChefVIT/papers-codechef');
    expect(CODECHEF_SECTION).toContain('papers.codechefvit.com');
  });

  it('names the upstream licence and its copyright line', () => {
    expect(CODECHEF_SECTION).toMatch(/MIT License/);
    expect(CODECHEF_SECTION).toContain('Copyright (c) 2025 CodeChef-VIT');
  });

  it('reproduces the permission notice that MIT conditions redistribution on', () => {
    expect(CODECHEF_SECTION).toContain('Permission is hereby granted, free of charge');
    expect(CODECHEF_SECTION).toContain(
      'The above copyright notice and this permission notice shall be included',
    );
  });

  it('says plainly that the papers are not UltraCC’s and were not copied', () => {
    expect(CODECHEF_SECTION).toMatch(/does not take/);
    expect(CODECHEF_SECTION).toMatch(/remain/);
  });

  it('is listed in the README references, not only buried in deployment notes', () => {
    const references = readme.split(/^## /m).find((b) => /^References/m.test(b)) ?? '';
    expect(references).toContain('CodeChef-VIT Papers');
    expect(references).toContain('Copyright (c) 2025 CodeChef-VIT');
  });

  it('vendors no paper file — the PDFs stay on CodeChef-VIT’s host', () => {
    const skipped = new Set(['node_modules', 'dist', 'build', 'coverage', '.git']);
    const blobs: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) {
          if (!skipped.has(entry)) walk(full);
          continue;
        }
        if (/\.(pdf|zip|rar|7z|tar|gz)$/i.test(entry)) blobs.push(full);
      }
    };
    for (const dir of ['src', 'public', 'supabase', 'assets']) {
      try {
        walk(join(PROJECT_ROOT, dir));
      } catch {
        // Directory absent — nothing to scan.
      }
    }
    expect(blobs, `paper blobs must not be vendored: ${blobs.join(', ')}`).toEqual([]);
  });
});
