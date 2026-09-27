/**
 * qbankStudy tests — pure study workflow for the question-paper bank.
 * Covers filters (exam type, bookmarks, solved), recency, practice sets,
 * and the honesty rule (no invented metadata).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  applyPaperFilters, knownExamTypes, recentPapers, sortByRecent,
  buildPracticeSet, practiceProgress, paperMetaLine,
  getBookmarks, getSolved, toggleBookmark, toggleSolved,
  archiveStudyKey, buildArchivePracticeSet, getArchiveBookmarks, getArchiveSolved,
  toggleArchiveBookmark, toggleArchiveSolved, unsolvedFirst,
} from '../qbankStudy';
import type { QnPaper } from '../../lib/supabaseCommunity';
import type { ArchivePaper } from '../../lib/qbankArchive';

function paper(overrides: Partial<QnPaper> & { id: number }): QnPaper {
  const now = '2026-09-01T10:00:00Z';
  return {
    course_code: 'CSE1001',
    course_title: 'Problem Solving',
    exam_type: 'CAT-1',
    title: `Paper ${overrides.id}`,
    url: 'https://example.test/paper.pdf',
    uploaded_by: 'anonymous',
    created_at: now,
    ...overrides,
  };
}

const papers: QnPaper[] = [
  paper({ id: 1, course_code: 'CSE1001', exam_type: 'CAT-1', created_at: '2026-08-30T10:00:00Z' }),
  paper({ id: 2, course_code: 'CSE1001', exam_type: 'FAT', created_at: '2026-09-05T10:00:00Z' }),
  paper({ id: 3, course_code: 'MAT1001', exam_type: 'CAT-2', created_at: '2025-01-01T10:00:00Z' }),
  paper({ id: 4, course_code: 'MAT1001', exam_type: '', title: 'Misc set' }),
];

const bookmarks = new Set([2]);
const solvedSet = new Set([1]);

describe('knownExamTypes', () => {
  it('derives chips only from data that exists', () => {
    expect(knownExamTypes(papers)).toEqual(['CAT-1', 'CAT-2', 'FAT']);
  });

  it('never invents exam types for empty exam_type fields', () => {
    const types = knownExamTypes([paper({ id: 9, exam_type: '' })]);
    expect(types).toEqual([]);
  });
});

describe('applyPaperFilters', () => {
  const base = { query: '', courseFilter: '', bookmarked: null, solved: null, bookmarks, solvedSet: solvedSet } as const;

  it('filters by exam type', () => {
    const out = applyPaperFilters(papers, { ...base, examType: 'FAT' });
    expect(out.map((p) => p.id)).toEqual([2]);
  });

  it('filters bookmarked and solved states', () => {
    expect(applyPaperFilters(papers, { ...base, examType: '', bookmarked: true }).map((p) => p.id)).toEqual([2]);
    expect(applyPaperFilters(papers, { ...base, examType: '', bookmarked: false }).map((p) => p.id)).toEqual([1, 3, 4]);
    expect(applyPaperFilters(papers, { ...base, examType: '', solved: true }).map((p) => p.id)).toEqual([1]);
  });

  it('combines filters and search', () => {
    const out = applyPaperFilters(papers, { ...base, examType: 'CAT-1', query: 'cse' });
    expect(out.map((p) => p.id)).toEqual([1]);
  });
});

describe('recency', () => {
  it('sorts newest first using the real upload timestamp', () => {
    // Sep 5 → Sep 1 (default) → Aug 30 → Jan 2025.
    expect(sortByRecent(papers).map((p) => p.id)).toEqual([2, 4, 1, 3]);
  });

  it('limits recent papers to the 30-day window', () => {
    const now = new Date('2026-09-06T00:00:00Z').getTime();
    expect(recentPapers(papers, now).map((p) => p.id)).toEqual([2, 4, 1]);
  });
});

describe('practice sets', () => {
  it('groups one course with solved state', () => {
    const set = buildPracticeSet('cse1001', papers, solvedSet);
    expect(set?.courseCode).toBe('CSE1001');
    expect(set?.items.map((i) => [i.paper.id, i.solved])).toEqual([[2, false], [1, true]]);
  });

  it('returns null for courses without papers', () => {
    expect(buildPracticeSet('NOPE', papers, solvedSet)).toBeNull();
  });

  it('computes honest progress', () => {
    const set = buildPracticeSet('CSE1001', papers, solvedSet)!;
    expect(practiceProgress(set)).toEqual({ done: 1, total: 2, percent: 50 });
  });
});

describe('paperMetaLine', () => {
  it('renders only known metadata', () => {
    const line = paperMetaLine(paper({ id: 5, exam_type: 'FAT', created_at: '2026-09-05T10:00:00Z' }));
    expect(line).toHaveLength(2);
    expect(line[0]).toBe('FAT');
    expect(line[1]).toMatch(/^shared /);
  });

  it('omits the exam type when the uploader never set one', () => {
    const line = paperMetaLine(paper({ id: 6, exam_type: '   ' }));
    expect(line).toHaveLength(1);
    expect(line[0]).toMatch(/^shared /);
  });
});

describe('per-device study state', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('toggles bookmarks and persists them', () => {
    expect(toggleBookmark(7).has(7)).toBe(true);
    expect(getBookmarks().has(7)).toBe(true);
    expect(toggleBookmark(7).has(7)).toBe(false);
    expect(getBookmarks().has(7)).toBe(false);
  });

  it('toggles solved independently of bookmarks', () => {
    toggleBookmark(8);
    toggleSolved(8);
    expect(getBookmarks().has(8)).toBe(true);
    expect(getSolved().has(8)).toBe(true);
    toggleSolved(8);
    expect(getSolved().has(8)).toBe(false);
    expect(getBookmarks().has(8)).toBe(true);
  });

  it('ignores corrupt persisted data', () => {
    localStorage.setItem('ultracc.qbank.bookmarks', 'not-json');
    expect(getBookmarks().size).toBe(0);
  });
});

describe('archive study state', () => {
  function archiveRow(overrides: Partial<ArchivePaper> = {}): ArchivePaper {
    return {
      id: 7,
      external_paper_id: 'aaa1',
      course_code: 'CSE2009',
      course_title: 'Python for Data Science',
      title: 'Python for Data Science [CSE2009]',
      exam_type: 'CAT-1',
      academic_year: '2024-2025',
      semester: 'Fall',
      slot: 'B2',
      campus: 'Chennai',
      paper_url: 'https://storage.example.test/p.pdf',
      answer_key_url: null,
      answer_key_included: false,
      thumbnail_url: null,
      file_type: 'pdf',
      source_created_at: '2025-08-05T00:00:00.000Z',
      imported_at: '2026-09-20T00:00:00.000Z',
      ...overrides,
    };
  }

  beforeEach(() => {
    localStorage.clear();
  });

  it('keys archive study state by the source id, not the row number', () => {
    toggleArchiveBookmark('aaa1');
    toggleArchiveSolved('aaa1');
    expect(getArchiveBookmarks()).toEqual(new Set(['aaa1']));
    expect(getArchiveSolved()).toEqual(new Set(['aaa1']));
    // A local row id is not an identity: rebuilding the archive would move it.
    expect(archiveStudyKey(archiveRow({ id: 999 }))).toBe('aaa1');
  });

  it('cannot collide with the community shelf’s numeric ids', () => {
    toggleBookmark(7);
    toggleArchiveSolved('7');
    expect(getSolved().has(7)).toBe(false);
    expect(getArchiveBookmarks().size).toBe(0);
    expect(getBookmarks().has(7)).toBe(true);
    toggleArchiveBookmark('7');
    expect(getArchiveBookmarks()).toEqual(new Set(['7']));
  });

  it('drops blank and non-string entries from persisted keys', () => {
    localStorage.setItem('ultracc.qbank.archive.bookmarks', JSON.stringify(['ok', '', '  ', 5, null, {}]));
    // Only a real, non-blank key survives — whitespace is not an identity.
    expect(getArchiveBookmarks()).toEqual(new Set(['ok']));
    localStorage.setItem('ultracc.qbank.archive.bookmarks', 'not json');
    expect(getArchiveBookmarks()).toEqual(new Set());
  });

  it('orders a practice set newest-first and marks solved from the key set', () => {
    const older = archiveRow({ id: 1, external_paper_id: 'old', source_created_at: '2024-01-02T00:00:00.000Z' });
    const newer = archiveRow({ id: 2, external_paper_id: 'new', source_created_at: '2026-01-02T00:00:00.000Z' });
    const undated = archiveRow({ id: 3, external_paper_id: 'none', source_created_at: null });
    const set = buildArchivePracticeSet('CSE2009', [older, newer, undated], new Set(['old']));
    expect(set.items.map((i) => i.paper.external_paper_id)).toEqual(['new', 'old', 'none']);
    expect(set.items.map((i) => i.solved)).toEqual([false, true, false]);
  });

  it('counts progress over the whole set, including rows the list hides', () => {
    const rows = [
      archiveRow({ id: 1, external_paper_id: 'a' }),
      archiveRow({ id: 2, external_paper_id: 'b' }),
      archiveRow({ id: 3, external_paper_id: 'c' }),
      archiveRow({ id: 4, external_paper_id: 'd' }),
    ];
    const set = buildArchivePracticeSet('CSE2009', rows, new Set(['a', 'b']));
    expect(practiceProgress(set)).toEqual({ done: 2, total: 4, percent: 50 });
    // Unresolved work leads; within each group the newest-first order holds,
    // because the sort is stable and only flips the solved flag.
    const visible = unsolvedFirst(set.items).map((i) => i.paper.external_paper_id);
    expect(visible).toEqual(['c', 'd', 'a', 'b']);
    expect(practiceProgress({ items: [] })).toBeNull();
  });

  it('gives a row without a usable id no solved state', () => {
    const keyless = { ...archiveRow({ external_paper_id: '  ' }) } as unknown as ArchivePaper;
    const set = buildArchivePracticeSet('CSE2009', [keyless], new Set(['  ']));
    expect(archiveStudyKey({ external_paper_id: '  ' })).toBeNull();
    expect(set.items[0].solved).toBe(false);
  });
});
