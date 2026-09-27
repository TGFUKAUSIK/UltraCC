/**
 * qbankStudy.ts — pure study-workflow helpers for the question-paper bank.
 *
 * Honesty rule: papers carry only the metadata students actually uploaded
 * (course code/title, exam type, title, link, uploader, timestamp). These
 * helpers never fabricate semester, difficulty, unit or question-count data
 * that the community has not provided — the UI only renders known fields.
 *
 * The synced archive shelf follows the same rule from the other direction: an
 * ArchivePaper row shows exactly what the source published, and a field the
 * source never had (difficulty, tags, an answer-key link) stays absent instead
 * of being inferred.
 *
 * Bookmarks and solved flags are per-device study state (localStorage);
 * they describe the student, not the paper.
 */

import type { QnPaper } from '../lib/supabaseCommunity';
import type { ArchivePaper } from '../lib/qbankArchive';

export interface PaperFilters {
  query: string;
  courseFilter: string;
  examType: string;
  /** null = all; true = bookmarked only; false = not bookmarked. */
  bookmarked: boolean | null;
  /** null = all; true = marked solved; false = unsolved. */
  solved: boolean | null;
  bookmarks: ReadonlySet<number>;
  solvedSet: ReadonlySet<number>;
}

/** Exam-type chips derived from the data actually present (sorted, unique). */
export function knownExamTypes(papers: QnPaper[]): string[] {
  return Array.from(new Set(papers.map((p) => p.exam_type.trim()).filter(Boolean))).sort();
}

export function applyPaperFilters(papers: QnPaper[], filters: PaperFilters): QnPaper[] {
  const q = filters.query.trim().toLowerCase();
  return papers.filter((p) => {
    if (filters.courseFilter && p.course_code.toLowerCase() !== filters.courseFilter.toLowerCase()) return false;
    if (filters.examType && (p.exam_type || '').trim() !== filters.examType) return false;
    if (filters.bookmarked !== null && filters.bookmarks.has(p.id) !== filters.bookmarked) return false;
    if (filters.solved !== null && filters.solvedSet.has(p.id) !== filters.solved) return false;
    if (!q) return true;
    return (
      p.course_code.toLowerCase().includes(q) ||
      p.course_title.toLowerCase().includes(q) ||
      p.title.toLowerCase().includes(q) ||
      p.exam_type.toLowerCase().includes(q) ||
      p.uploaded_by.toLowerCase().includes(q)
    );
  });
}

/** Newest-first recency ordering (upload timestamp is the only honest recency signal). */
export function sortByRecent(papers: QnPaper[]): QnPaper[] {
  return [...papers].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

/** Papers uploaded in the last 30 days, newest first. */
export function recentPapers(papers: QnPaper[], now = Date.now(), windowMs = 30 * 24 * 60 * 60 * 1000): QnPaper[] {
  return sortByRecent(papers).filter((p) => {
    const t = new Date(p.created_at).getTime();
    return Number.isFinite(t) && now - t <= windowMs;
  });
}

export interface PracticeItem {
  paper: QnPaper;
  solved: boolean;
}

export interface PracticeSet {
  courseCode: string;
  courseTitle: string;
  items: PracticeItem[];
}

/** Group one course's papers into a practice set with solved state. */
export function buildPracticeSet(courseCode: string, papers: QnPaper[], solvedSet: ReadonlySet<number>): PracticeSet | null {
  const items = sortByRecent(papers.filter((p) => p.course_code.toLowerCase() === courseCode.toLowerCase()))
    .map((paper) => ({ paper, solved: solvedSet.has(paper.id) }));
  if (!items.length) return null;
  return {
    courseCode: items[0].paper.course_code,
    courseTitle: items[0].paper.course_title,
    items,
  };
}

/** Share of the set the student has marked solved (null when nothing to practice). */
export function practiceProgress(set: { items: readonly { solved: boolean }[] }): { done: number; total: number; percent: number } | null {
  const total = set.items.length;
  if (!total) return null;
  const done = set.items.filter((i) => i.solved).length;
  return { done, total, percent: Math.round((done / total) * 100) };
}

/** "CAT 1 · 3 papers · 1 solved" style honest summary — only known facts. */
export function paperMetaLine(paper: QnPaper): string[] {
  const parts: string[] = [];
  const exam = (paper.exam_type || '').trim();
  if (exam) parts.push(exam);
  const uploaded = new Date(paper.created_at);
  if (Number.isFinite(uploaded.getTime())) parts.push(`shared ${uploaded.toLocaleDateString()}`);
  return parts;
}

// ---------------------------------------------------------------------------
// Per-device study state (localStorage)
// ---------------------------------------------------------------------------

const BOOKMARKS_KEY = 'ultracc.qbank.bookmarks';
const SOLVED_KEY = 'ultracc.qbank.solved';

function readIdSet(key: string): Set<number> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((n): n is number => typeof n === 'number' && Number.isFinite(n)));
  } catch {
    return new Set();
  }
}

function writeIdSet(key: string, set: ReadonlySet<number>): void {
  try {
    localStorage.setItem(key, JSON.stringify(Array.from(set)));
  } catch {
    // storage unavailable — study state just doesn't persist
  }
}

export const getBookmarks = (): Set<number> => readIdSet(BOOKMARKS_KEY);
export const getSolved = (): Set<number> => readIdSet(SOLVED_KEY);

export function toggleBookmark(id: number): Set<number> {
  const set = getBookmarks();
  if (set.has(id)) set.delete(id); else set.add(id);
  writeIdSet(BOOKMARKS_KEY, set);
  return set;
}

export function toggleSolved(id: number): Set<number> {
  const set = getSolved();
  if (set.has(id)) set.delete(id); else set.add(id);
  writeIdSet(SOLVED_KEY, set);
  return set;
}

// ---------------------------------------------------------------------------
// Archive study state
//
// The synced PYQ archive is keyed by the source's own immutable id (a string),
// NOT by pyq_papers.id. That row number is a local identity: it changes if the
// archive is ever rebuilt, and it shares a number space with the community
// shelf's `id`, so a bookmark on community paper 7 could otherwise light up
// archive paper 7. Separate keys, separate storage, separate truth.
// ---------------------------------------------------------------------------

const ARCHIVE_BOOKMARKS_KEY = 'ultracc.qbank.archive.bookmarks';
const ARCHIVE_SOLVED_KEY = 'ultracc.qbank.archive.solved';

function readKeySet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.filter((v): v is string => typeof v === 'string' && v.trim().length > 0),
    );
  } catch {
    return new Set();
  }
}

function writeKeySet(key: string, set: ReadonlySet<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify(Array.from(set)));
  } catch {
    // storage unavailable — study state just doesn't persist
  }
}

export const getArchiveBookmarks = (): Set<string> => readKeySet(ARCHIVE_BOOKMARKS_KEY);
export const getArchiveSolved = (): Set<string> => readKeySet(ARCHIVE_SOLVED_KEY);

export function toggleArchiveBookmark(key: string): Set<string> {
  const set = getArchiveBookmarks();
  if (set.has(key)) set.delete(key); else set.add(key);
  writeKeySet(ARCHIVE_BOOKMARKS_KEY, set);
  return set;
}

export function toggleArchiveSolved(key: string): Set<string> {
  const set = getArchiveSolved();
  if (set.has(key)) set.delete(key); else set.add(key);
  writeKeySet(ARCHIVE_SOLVED_KEY, set);
  return set;
}

/** An archive paper's study key — the source id, or null if the row has none. */
export function archiveStudyKey(paper: { external_paper_id?: unknown }): string | null {
  const key = paper.external_paper_id;
  return typeof key === 'string' && key.trim() ? key : null;
}

/**
 * A course's papers as a practice set: newest first, with this device's solved
 * state applied through the key rule above rather than a caller-supplied
 * accessor — one place decides what identifies a paper, so a set and a badge
 * can never disagree about it.
 *
 * Concrete on ArchivePaper on purpose: an earlier generic version inferred its
 * row type from a callback parameter and quietly widened every field access
 * downstream to `unknown`.
 */
export function buildArchivePracticeSet(
  courseCode: string,
  papers: readonly ArchivePaper[],
  solvedKeys: ReadonlySet<string>,
): { courseCode: string; items: { paper: ArchivePaper; solved: boolean }[] } {
  const items = [...papers]
    .sort((a, b) => {
      const at = Date.parse(a.source_created_at ?? '') || 0;
      const bt = Date.parse(b.source_created_at ?? '') || 0;
      return bt - at;
    })
    .map((paper) => {
      const key = archiveStudyKey(paper);
      return { paper, solved: key !== null && solvedKeys.has(key) };
    });
  return { courseCode, items };
}

/** Solved-first-free ordering for a practice list: unsolved work leads. */
export function unsolvedFirst(items: readonly { paper: ArchivePaper; solved: boolean }[]): { paper: ArchivePaper; solved: boolean }[] {
  return [...items].sort((a, b) => Number(a.solved) - Number(b.solved));
}
