/**
 * qbankArchive.ts — the browser's only window onto the PYQ archive.
 *
 * Reads public.pyq_papers / pyq_sync_runs through PostgREST with the public
 * anon key. Every column behind those grants is SELECT-only and contains no
 * student data, so nothing here needs (or gets) a session, a token or a
 * credential.
 *
 * WHY NOT TALK TO CODECHEF-VIT FROM HERE: the app is deliberately silent about
 * that host — src/lib/__tests__/upstreamIsolation.test.ts fails if its name
 * appears in frontend code. supabase/functions/pyq-sync pulls upstream on a
 * schedule and normalises it into Postgres, so a student opening Q-Bank pays
 * one indexed page of Postgres results instead of scraping a third party's site
 * on every request. If the importer is behind, pyq_status() says so; the
 * archive does not.
 *
 * PDFs are never fetched here either. CodeChef-VIT's storage whitelists CORS to
 * their own origin, so a browser fetch of a paper would fail — the archive
 * therefore only ever *links* or embeds the URL it was given (see the paper
 * frame in QbankView).
 */

import { SUPABASE_URL, backendHeaders } from './communityBackend';

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/** One paper as stored by the importer. Nullable fields are gaps upstream, and
 *  stay null here: nothing in this module invents a subject, a year or an
 *  answer key that CodeChef-VIT did not publish. */
export interface ArchivePaper {
  id: number;
  /** Upstream Mongo `_id` — the stable identity used for study state. */
  external_paper_id: string;
  course_code: string | null;
  course_title: string | null;
  /** Full subject string as published, e.g. "Probability And Statistics [BMAT202L]". */
  title: string | null;
  exam_type: string | null;
  academic_year: string | null;
  semester: string | null;
  slot: string | null;
  campus: string | null;
  paper_url: string;
  /** Always null today: upstream publishes a boolean, not a key document. */
  answer_key_url: string | null;
  answer_key_included: boolean | null;
  thumbnail_url: string | null;
  file_type: string | null;
  /** When CodeChef-VIT added the paper, derived from the ObjectId. */
  source_created_at: string | null;
  imported_at: string;
}

/** Explicit column list: url_fingerprint and subject_raw are importer
 *  bookkeeping and have no business in a browser payload. */
export const PAPER_COLUMNS = [
  'id', 'external_paper_id', 'course_code', 'course_title', 'title',
  'exam_type', 'academic_year', 'semester', 'slot', 'campus',
  'paper_url', 'answer_key_url', 'answer_key_included', 'thumbnail_url',
  'file_type', 'source_created_at', 'imported_at',
].join(',');

// ---------------------------------------------------------------------------
// Query building (pure — tested without a network)
// ---------------------------------------------------------------------------

/** How many papers one request returns. The archive is 3.1k rows; a student
 *  browsing needs one screen, so the page stays small and "Load more" fetches
 *  the next one. */
export const ARCHIVE_PAGE_SIZE = 40;

/** The facet chip value standing for "upstream did not say". */
export const UNSPECIFIED = 'Unspecified';

export interface ArchiveFilters {
  /** Free text: course code, course name or the published subject string. */
  search: string;
  /** Exact course code (the Course → Papers step). */
  courseCode: string;
  examType: string;
  year: string;
  semester: string;
  slot: string;
  campus: string;
}

export const EMPTY_FILTERS: ArchiveFilters = {
  search: '', courseCode: '', examType: '', year: '', semester: '', slot: '', campus: '',
};

export function filtersAreEmpty(f: ArchiveFilters): boolean {
  return !f.search.trim() && !f.courseCode && !f.examType && !f.year
    && !f.semester && !f.slot && !f.campus;
}

export type ArchiveSort = 'recent' | 'code';

export interface ArchivePageRequest {
  filters: ArchiveFilters;
  sort: ArchiveSort;
  limit: number;
  offset: number;
}

/**
 * PostgREST query string for one page.
 *
 * Facet values are exact `eq.` comparisons against normalised columns, which is
 * why they need no escaping and why the importer uppercases course_code before
 * storing it.
 *
 * Search and "Unspecified" both need an `or=(…)` list, where `,` and `)` would
 * close the list early — so those values go through sanitizeSearchTerm(), which
 * drops them (and `*`, PostgREST's wildcard that a student typing it expects to
 * be literal) instead of escaping them. A term that cannot be expressed
 * honestly is not worth expressing.
 */
export function buildArchivePageQuery(req: ArchivePageRequest): string {
  const params = new URLSearchParams();
  params.set('select', PAPER_COLUMNS);
  const f = req.filters;

  const term = sanitizeSearchTerm(f.search);
  if (term) {
    const like = `ilike.*${term}*`;
    params.set('or', `(course_code.${like},course_title.${like},title.${like})`);
  }
  if (f.courseCode.trim()) {
    params.set('course_code', `eq.${f.courseCode.trim().toUpperCase()}`);
  }
  facetClause('exam_type', f.examType, params);
  facetClause('academic_year', f.year, params);
  facetClause('semester', f.semester, params);
  facetClause('slot', f.slot, params);
  facetClause('campus', f.campus, params);

  params.set(
    'order',
    req.sort === 'code'
      ? 'course_code.asc,source_created_at.desc.nullslast'
      : 'source_created_at.desc.nullslast',
  );
  params.set('limit', String(Math.max(1, Math.min(Math.trunc(req.limit), 200))));
  params.set('offset', String(Math.max(0, Math.trunc(req.offset))));
  return params.toString();
}

/**
 * pyq_facets() reports a missing value as UNSPECIFIED, so that chip has to
 * select the rows that really are missing it: `is.null`, the one operator that
 * needs no value, because the importer writes NULL rather than an empty string.
 *
 * It is deliberately NOT an `or=(…)` clause. Free text already owns that key,
 * and two filters that quietly overwrite each other would make "Chennai papers
 * with no slot" come back unfiltered — which is worse than no filter at all.
 */
function facetClause(column: string, value: string, params: URLSearchParams): void {
  const v = value.trim();
  if (!v) return;
  params.set(column, v === UNSPECIFIED ? 'is.null' : `eq.${v}`);
}

export function sanitizeSearchTerm(raw: string): string {
  return raw.replace(/[,()*"\\]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** A search worth sending: below two characters the archive has nothing useful
 *  to say and the result would read like a bug. */
export function searchIsUsable(raw: string): boolean {
  return sanitizeSearchTerm(raw).length >= 2;
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export interface ArchivePage {
  papers: ArchivePaper[];
  /** Total matching papers, or null when PostgREST did not report it. The UI
   *  says "Showing N" instead of making up a denominator. */
  total: number | null;
  hasMore: boolean;
}

/** Raised for "the archive could not be reached right now" — retryable, and
 *  never worded as if the student did something wrong. */
export class ArchiveUnavailableError extends Error {
  status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'ArchiveUnavailableError';
    this.status = status;
  }
}

export async function fetchArchivePage(req: ArchivePageRequest, signal?: AbortSignal): Promise<ArchivePage> {
  const query = buildArchivePageQuery(req);
  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/pyq_papers?${query}`, {
      // count=exact asks PostgREST to report the matching total in
      // Content-Range; the page itself stays capped at `limit`.
      headers: backendHeaders({ Prefer: 'count=exact' }),
      signal,
    });
  } catch {
    throw new ArchiveUnavailableError('Could not reach the question-paper archive.');
  }
  if (!res.ok) throw new ArchiveUnavailableError('Could not load the question-paper archive.', res.status);

  const rows = (await res.json().catch((): unknown[] => [])) as unknown;
  const papers = Array.isArray(rows) ? rows.filter(isArchivePaper) : [];
  const total = readContentRangeTotal(res.headers.get('content-range'), papers.length);
  const loaded = req.offset + papers.length;
  return {
    papers,
    total,
    hasMore: total === null ? papers.length >= req.limit : loaded < total,
  };
}

/** "0-39/3154" → 3154. Missing or malformed means no honest total exists. */
export function readContentRangeTotal(header: string | null, returned: number): number | null {
  if (!header) return null;
  const total = Number(header.split('/')[1]?.trim());
  if (!Number.isFinite(total) || total < 0) return null;
  return Math.max(total, returned);
}

/** Narrows whatever PostgREST sent into a row this UI can render. A record
 *  without a usable link is not a paper, so it is dropped rather than linked
 *  nowhere — and a non-HTTPS URL is exactly what the importer refuses to store,
 *  so seeing one here would mean the table was written around that check. */
export function isArchivePaper(value: unknown): value is ArchivePaper {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === 'number' &&
    typeof row.external_paper_id === 'string' &&
    row.external_paper_id.trim() !== '' &&
    typeof row.paper_url === 'string' &&
    row.paper_url.startsWith('https://')
  );
}

export async function fetchArchivePaper(id: number, signal?: AbortSignal): Promise<ArchivePaper | null> {
  if (!Number.isFinite(id) || id <= 0) return null;
  const params = new URLSearchParams();
  params.set('select', PAPER_COLUMNS);
  params.set('id', `eq.${Math.trunc(id)}`);
  params.set('limit', '1');
  const res = await fetch(`${SUPABASE_URL}/rest/v1/pyq_papers?${params.toString()}`, {
    headers: backendHeaders(),
    signal,
  }).catch((): null => null);
  if (!res || !res.ok) return null;
  const rows = (await res.json().catch((): unknown[] => [])) as unknown;
  const first = Array.isArray(rows) ? rows.find(isArchivePaper) : undefined;
  return first ?? null;
}

/** Other papers of the same course, newest first — "related papers".
 *  An exact `eq.` on an indexed column, so one small query, not a scan. */
export async function fetchRelatedPapers(
  courseCode: string,
  excludeId: number,
  limit = 6,
  signal?: AbortSignal,
): Promise<ArchivePaper[]> {
  const code = courseCode.trim().toUpperCase();
  if (!code) return [];
  const params = new URLSearchParams();
  params.set('select', PAPER_COLUMNS);
  params.set('course_code', `eq.${code}`);
  params.set('id', `neq.${Math.trunc(excludeId)}`);
  params.set('order', 'source_created_at.desc.nullslast');
  params.set('limit', String(Math.max(1, Math.min(limit, 20))));
  const res = await fetch(`${SUPABASE_URL}/rest/v1/pyq_papers?${params.toString()}`, {
    headers: backendHeaders(),
    signal,
  }).catch((): null => null);
  if (!res || !res.ok) return [];
  const rows = (await res.json().catch((): unknown[] => [])) as unknown;
  return Array.isArray(rows) ? rows.filter(isArchivePaper) : [];
}

/**
 * Every paper of one course, for the practice view.
 *
 * Unlike the browse list this is deliberately unpaged: a practice set has to be
 * complete before "4 of 12 solved" means anything, and a single course holds
 * tens of papers, not thousands. `course_code` is indexed, so the read is a
 * few blocks; the cap only exists so an absurd upstream record cannot hang the
 * page, and hitting it is reported rather than hidden.
 */
export async function fetchArchiveCoursePapers(
  courseCode: string,
  signal?: AbortSignal,
): Promise<{ papers: ArchivePaper[]; capped: boolean }> {
  const code = courseCode.trim().toUpperCase();
  if (!code) return { papers: [], capped: false };
  const params = new URLSearchParams();
  params.set('select', PAPER_COLUMNS);
  params.set('course_code', `eq.${code}`);
  params.set('order', 'source_created_at.desc.nullslast');
  params.set('limit', String(COURSE_PAPER_CAP + 1));
  const res = await fetch(`${SUPABASE_URL}/rest/v1/pyq_papers?${params.toString()}`, {
    headers: backendHeaders(),
    signal,
  });
  if (!res.ok) throw new ArchiveUnavailableError(`Could not load the papers for ${code}.`, res.status);
  const rows = (await res.json().catch((): unknown[] => [])) as unknown;
  const all = Array.isArray(rows) ? rows.filter(isArchivePaper) : [];
  return { papers: all.slice(0, COURSE_PAPER_CAP), capped: all.length > COURSE_PAPER_CAP };
}

export const COURSE_PAPER_CAP = 200;

/**
 * The saved-papers list: bookmark keys are upstream `_id`s, so they can go
 * straight into an `in.()` filter and be answered by Postgres instead of
 * loading the archive and picking through it in the browser.
 *
 * Keys are re-checked against the strict `external_paper_id` shape before going
 * into the query — they came from this device's storage, which is untrusted
 * input by definition, and a stray quote must not be able to break the filter.
 */
export const EXTERNAL_ID_SAFE = /^[A-Za-z0-9_-]{1,64}$/;

export function isUsablePaperKey(value: unknown): value is string {
  return typeof value === 'string' && EXTERNAL_ID_SAFE.test(value);
}

export async function fetchArchivePapersByKeys(
  keys: Iterable<unknown>,
  limit = SAVED_PAPER_CAP,
  signal?: AbortSignal,
): Promise<ArchivePaper[]> {
  const safe = Array.from(new Set(Array.from(keys).filter(isUsablePaperKey)));
  if (safe.length === 0) return [];
  const params = new URLSearchParams();
  params.set('select', PAPER_COLUMNS);
  params.set('external_paper_id', `in.(${safe.map((k) => `"${k}"`).join(',')})`);
  params.set('order', 'source_created_at.desc.nullslast');
  params.set('limit', String(Math.max(1, Math.min(limit, SAVED_PAPER_CAP))));
  const res = await fetch(`${SUPABASE_URL}/rest/v1/pyq_papers?${params.toString()}`, {
    headers: backendHeaders(),
    signal,
  }).catch((): null => null);
  if (!res || !res.ok) return [];
  const rows = (await res.json().catch((): unknown[] => [])) as unknown;
  return Array.isArray(rows) ? rows.filter(isArchivePaper) : [];
}

/** A student's saved list is per-device, so it is bounded by what one screen
 *  should carry rather than by how long their bookmarks have been growing. */
export const SAVED_PAPER_CAP = 120;

// ---------------------------------------------------------------------------
// Sync status and facets
// ---------------------------------------------------------------------------

/** Mirrors public.pyq_status(). Anything the importer never got to is null. */
export interface ArchiveStatus {
  papers: number | null;
  subjects: number | null;
  chennaiPapers: number | null;
  lastSyncAt: string | null;
  lastStatus: string | null;
  papersDiscovered: number | null;
  papersInserted: number | null;
  papersUpdated: number | null;
  papersSkippedUnchanged: number | null;
  papersFailed: number | null;
  errorSummary: string | null;
}

/** Honest enough for a header line: what the archive holds and when it last
 *  heard from the source. Says so when it does not know, rather than showing a
 *  confident zero. */
export function describeArchiveStatus(status: ArchiveStatus | null): string {
  if (!status) return 'Checking what the archive holds…';
  if (status.papers === null) return 'The archive could not report how many papers it holds.';
  const parts = [`${status.papers.toLocaleString()} papers`];
  if (status.subjects !== null) parts.push(`${status.subjects.toLocaleString()} subjects`);
  if (status.chennaiPapers !== null) parts.push(`${status.chennaiPapers.toLocaleString()} from Chennai`);
  const when = status.lastSyncAt ? new Date(status.lastSyncAt) : null;
  if (when && Number.isFinite(when.getTime())) {
    parts.push(`updated ${when.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`);
  }
  return `${parts.join(' · ')}.`;
}

export async function fetchArchiveStatus(signal?: AbortSignal): Promise<ArchiveStatus | null> {
  const value = await callRpc('pyq_status', signal);
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Record<string, unknown>;
  return {
    papers: numOf(row.papers),
    subjects: numOf(row.subjects),
    chennaiPapers: numOf(row.chennaiPapers),
    lastSyncAt: typeof row.lastSyncAt === 'string' ? row.lastSyncAt : null,
    lastStatus: typeof row.lastStatus === 'string' ? row.lastStatus : null,
    papersDiscovered: numOf(row.papersDiscovered),
    papersInserted: numOf(row.papersInserted),
    papersUpdated: numOf(row.papersUpdated),
    papersSkippedUnchanged: numOf(row.papersSkippedUnchanged),
    papersFailed: numOf(row.papersFailed),
    errorSummary: typeof row.errorSummary === 'string' ? row.errorSummary : null,
  };
}

export interface FacetValue {
  value: string;
  papers: number;
}

export interface ArchiveFacets {
  papers: number | null;
  examType: FacetValue[];
  year: FacetValue[];
  semester: FacetValue[];
  slot: FacetValue[];
  campus: FacetValue[];
}

/** Which facet a facetKind() result selects, in ArchiveFilters terms. */
export type FacetKind = keyof Omit<ArchiveFacets, 'papers'>;

export function filterKeyForFacet(kind: FacetKind): keyof ArchiveFilters {
  return kind === 'year' ? 'year' : kind;
}

export async function fetchArchiveFacets(signal?: AbortSignal): Promise<ArchiveFacets | null> {
  const value = await callRpc('pyq_facets', signal);
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Record<string, unknown>;
  return {
    papers: numOf(row.papers),
    examType: facetList(row.examType),
    year: facetList(row.year),
    semester: facetList(row.semester),
    slot: facetList(row.slot),
    campus: facetList(row.campus),
  };
}

function facetList(value: unknown): FacetValue[] {
  if (!Array.isArray(value)) return [];
  const out: FacetValue[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;
    const entry = item as Record<string, unknown>;
    if (typeof entry.value !== 'string' || !entry.value.trim()) continue;
    out.push({ value: entry.value.trim(), papers: numOf(entry.papers) ?? 0 });
  }
  return out;
}

/** Sorts are presentation, so they live here rather than in SQL: exam types
 *  follow VTOP's own order, academic years read newest-first, and an
 *  "Unspecified" bucket goes last instead of leading the chips. Anything
 *  unknown keeps its alphabetical place rather than disappearing. */
const EXAM_ORDER = ['CAT-1', 'CAT-2', 'FAT', 'Lab FAT', 'Model CAT-1', 'Model CAT-2', 'Model FAT'];

export function sortFacet(values: FacetValue[], kind: 'examType' | 'year' | 'other'): FacetValue[] {
  const last = (v: string) => (v === UNSPECIFIED ? 1 : 0);
  const copy = [...values];
  if (kind === 'year') {
    return copy.sort((a, b) => last(a.value) - last(b.value) || b.value.localeCompare(a.value));
  }
  if (kind !== 'examType') {
    return copy.sort((a, b) => last(a.value) - last(b.value) || a.value.localeCompare(b.value));
  }
  return copy.sort((a, b) => {
    // "Unspecified" trails even the exam types this list does not recognise:
    // it is a gap in the data, not another kind of paper.
    const byUnsaid = last(a.value) - last(b.value);
    if (byUnsaid !== 0) return byUnsaid;
    const ai = EXAM_ORDER.indexOf(a.value);
    const bi = EXAM_ORDER.indexOf(b.value);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.value.localeCompare(b.value);
  });
}

async function callRpc(name: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: backendHeaders(),
    body: JSON.stringify({}),
    signal,
  }).catch((): null => null);
  if (!res || !res.ok) return null;
  return res.json().catch((): null => null);
}

function numOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Chennai is a small slice of this archive, so a row says which campus it
 *  belongs to rather than implying the whole library is Chennai's. */
export function campusLabel(paper: ArchivePaper): string | null {
  const campus = (paper.campus || '').trim();
  return campus || null;
}

/** The paper as a list of human-readable facts — only the fields that exist. */
export function archiveMetaLine(paper: ArchivePaper): string[] {
  const parts: string[] = [];
  if (paper.exam_type) parts.push(paper.exam_type);
  if (paper.academic_year) parts.push(paper.academic_year);
  if (paper.semester) parts.push(paper.semester);
  if (paper.slot) parts.push(`Slot ${paper.slot}`);
  const campus = campusLabel(paper);
  if (campus) parts.push(campus);
  return parts;
}

/** Best available name for a paper: the published subject, else the course. */
export function archivePaperTitle(paper: ArchivePaper): string {
  return (paper.title || paper.course_title || paper.course_code || 'Previous year paper').trim();
}

/** "When this was added to the archive", from the ObjectId-derived date — the
 *  only honest recency signal upstream publishes. */
export function archiveAddedLine(paper: ArchivePaper): string | null {
  const at = paper.source_created_at ? new Date(paper.source_created_at) : null;
  if (!at || !Number.isFinite(at.getTime())) return null;
  return `Added ${at.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}
