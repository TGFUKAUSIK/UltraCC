/**
 * qbankArchive.test.ts — the browser half of the PYQ integration.
 *
 * Two things these tests hold the module to:
 *
 *   1. Every query it builds is one this schema can answer from an index, and
 *      nothing a student types can escape the filter it was put into.
 *   2. Nothing is invented on the way out of Postgres. A row with no campus, no
 *      year or an unreadable URL renders as absent, not as a guess — and a
 *      response that is not a list of papers is an error state, not an empty
 *      archive presented as a success.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  ARCHIVE_PAGE_SIZE, ArchiveUnavailableError, EMPTY_FILTERS, PAPER_COLUMNS,
  archiveAddedLine, archiveMetaLine, archivePaperTitle,
  buildArchivePageQuery, describeArchiveStatus, fetchArchiveCoursePapers,
  fetchArchiveFacets, fetchArchivePage, fetchArchivePapersByKeys, fetchArchiveStatus,
  fetchRelatedPapers, filtersAreEmpty, isUsablePaperKey, readContentRangeTotal,
  sanitizeSearchTerm, searchIsUsable, sortFacet, type ArchivePaper, type ArchiveStatus,
} from '../qbankArchive';

/** A verbatim-shaped row as pyq_papers returns it after the importer's pass. */
function row(overrides: Partial<ArchivePaper> = {}): ArchivePaper {
  return {
    id: 1,
    external_paper_id: '6891d76bf6766a56a03f5f67',
    course_code: 'CSE2009',
    course_title: 'Python for Data Science',
    title: 'Python for Data Science [CSE2009]',
    exam_type: 'CAT-1',
    academic_year: '2024-2025',
    semester: 'Fall',
    slot: 'B2',
    campus: 'Chennai',
    paper_url: 'https://storage.googleapis.com/codechef-vit/paper.pdf',
    answer_key_url: null,
    answer_key_included: true,
    thumbnail_url: null,
    file_type: 'pdf',
    source_created_at: '2025-08-05T12:34:56.000Z',
    imported_at: '2026-09-20T03:40:00.000Z',
    ...overrides,
  };
}

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

/** Parse either a bare query string (from buildArchivePageQuery) or a full URL. */
function paramsOf(urlOrQuery: string): URLSearchParams {
  return new URLSearchParams(urlOrQuery.startsWith('http') ? new URL(urlOrQuery).search : urlOrQuery);
}
const query = paramsOf;
const pathOf = (url: string): string => new URL(url).pathname;

describe('sanitizeSearchTerm', () => {
  it('removes the characters that would end a PostgREST or= list early', () => {
    expect(sanitizeSearchTerm('CAT, 2024')).toBe('CAT 2024');
    expect(sanitizeSearchTerm('a)(b')).toBe('a b');
    expect(sanitizeSearchTerm('x*y')).toBe('x y');
    expect(sanitizeSearchTerm('quote"brain')).toBe('quote brain');
  });

  it('keeps ordinary text and collapses the whitespace it introduces', () => {
    expect(sanitizeSearchTerm('  Data   Structures  ')).toBe('Data Structures');
    expect(sanitizeSearchTerm('')).toBe('');
  });

  it('refuses a one-letter search instead of matching the whole archive', () => {
    expect(searchIsUsable('a')).toBe(false);
    expect(searchIsUsable('a,')).toBe(false);
    expect(searchIsUsable('ca')).toBe(true);
  });
});

describe('buildArchivePageQuery', () => {
  it('selects only the columns the browser needs', () => {
    const q = query(buildArchivePageQuery({ filters: EMPTY_FILTERS, sort: 'recent', limit: 40, offset: 0 }));
    expect(q.get('select')).toBe(PAPER_COLUMNS);
    expect(PAPER_COLUMNS).not.toMatch(/url_fingerprint|subject_raw/);
  });

  it('searches code, course name and subject string in one or= list', () => {
    const q = query(buildArchivePageQuery({
      filters: { ...EMPTY_FILTERS, search: 'Calculus' }, sort: 'recent', limit: 40, offset: 0,
    }));
    expect(q.get('or')).toBe('(course_code.ilike.*Calculus*,course_title.ilike.*Calculus*,title.ilike.*Calculus*)');
  });

  it('pins an opened course with an exact indexed match, uppercased', () => {
    const q = query(buildArchivePageQuery({
      filters: { ...EMPTY_FILTERS, courseCode: ' cse2009 ' }, sort: 'recent', limit: 40, offset: 0,
    }));
    expect(q.get('course_code')).toBe('eq.CSE2009');
  });

  it('filters facets exactly, and sends the "Unspecified" chip as is.null', () => {
    const q = query(buildArchivePageQuery({
      filters: { ...EMPTY_FILTERS, examType: 'FAT', year: '2025-2026', semester: 'Fall', slot: 'B2', campus: 'Vellore' },
      sort: 'recent', limit: 40, offset: 0,
    }));
    expect(q.get('exam_type')).toBe('eq.FAT');
    expect(q.get('academic_year')).toBe('eq.2025-2026');
    expect(q.get('semester')).toBe('eq.Fall');
    expect(q.get('slot')).toBe('eq.B2');
    expect(q.get('campus')).toBe('eq.Vellore');

    const unsaid = query(buildArchivePageQuery({
      filters: { ...EMPTY_FILTERS, examType: 'Unspecified' }, sort: 'recent', limit: 40, offset: 0,
    }));
    expect(unsaid.get('exam_type')).toBe('is.null');
  });

  it('combines a search and an unspecified facet without either overwriting the other', () => {
    // Regression: both used to want the single `or` key, and the second one
    // silently replaced the first — a filtered list that looked filtered and
    // was not. They now live in separate keys, so both survive.
    const raw = buildArchivePageQuery({
      filters: { ...EMPTY_FILTERS, search: 'Calculus', campus: 'Unspecified' },
      sort: 'recent', limit: 40, offset: 0,
    });
    const q = query(raw);
    expect(q.getAll('or')).toHaveLength(1);
    expect(q.get('campus')).toBe('is.null');
    expect(q.get('or')).toContain('course_code.ilike.*Calculus*');
  });

  it('orders by the two ways a student reads the archive', () => {
    const recent = query(buildArchivePageQuery({ filters: EMPTY_FILTERS, sort: 'recent', limit: 40, offset: 0 }));
    expect(recent.get('order')).toBe('source_created_at.desc.nullslast');
    const byCode = query(buildArchivePageQuery({ filters: EMPTY_FILTERS, sort: 'code', limit: 40, offset: 0 }));
    expect(byCode.get('order')).toBe('course_code.asc,source_created_at.desc.nullslast');
  });

  it('caps the page and clamps a hostile offset', () => {
    const q = query(buildArchivePageQuery({ filters: EMPTY_FILTERS, sort: 'recent', limit: 9999, offset: -5 }));
    expect(q.get('limit')).toBe('200');
    expect(q.get('offset')).toBe('0');
    expect(ARCHIVE_PAGE_SIZE).toBeLessThanOrEqual(200);
  });
});

describe('filtersAreEmpty', () => {
  it('treats whitespace as no filter', () => {
    expect(filtersAreEmpty(EMPTY_FILTERS)).toBe(true);
    expect(filtersAreEmpty({ ...EMPTY_FILTERS, search: '   ' })).toBe(true);
    expect(filtersAreEmpty({ ...EMPTY_FILTERS, campus: 'Chennai' })).toBe(false);
  });
});

describe('readContentRangeTotal', () => {
  it('reads the matching total PostgREST reports', () => {
    expect(readContentRangeTotal('0-39/3154', 40)).toBe(3154);
    expect(readContentRangeTotal('*/3154', 40)).toBe(3154);
  });

  it('returns null rather than inventing a denominator', () => {
    expect(readContentRangeTotal(null, 40)).toBeNull();
    expect(readContentRangeTotal('0-39/*', 40)).toBeNull();
    expect(readContentRangeTotal('0-39/nope', 40)).toBeNull();
  });

  it('never reports fewer matching papers than were returned', () => {
    expect(readContentRangeTotal('0-49/10', 50)).toBe(50);
  });
});

describe('isUsablePaperKey', () => {
  it('accepts a Mongo ObjectId and rejects anything that could break in.()', () => {
    expect(isUsablePaperKey('6891d76bf6766a56a03f5f67')).toBe(true);
    expect(isUsablePaperKey('6891d76b",external_paper_id.eq.x')).toBe(false);
    expect(isUsablePaperKey('')).toBe(false);
    expect(isUsablePaperKey(42)).toBe(false);
    expect(isUsablePaperKey(null)).toBe(false);
  });
});

describe('sortFacet', () => {
  it('puts exam types in VTOP order and the unknown bucket last', () => {
    const sorted = sortFacet([
      { value: 'Unspecified', papers: 3 },
      { value: 'FAT', papers: 938 },
      { value: 'CAT-1', papers: 1285 },
      { value: 'CAT-2', papers: 925 },
      { value: 'Weird', papers: 1 },
    ], 'examType').map((v) => v.value);
    expect(sorted).toEqual(['CAT-1', 'CAT-2', 'FAT', 'Weird', 'Unspecified']);
  });

  it('reads academic years newest-first', () => {
    const sorted = sortFacet([
      { value: '2022-2023', papers: 167 },
      { value: '2025-2026', papers: 1338 },
      { value: '2024-2025', papers: 900 },
    ], 'year').map((v) => v.value);
    expect(sorted).toEqual(['2025-2026', '2024-2025', '2022-2023']);
  });

  it('does not mutate the caller’s array', () => {
    const input = [{ value: 'B', papers: 1 }, { value: 'A', papers: 2 }];
    sortFacet(input, 'other');
    expect(input[0].value).toBe('B');
  });
});

describe('fetchArchivePage', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it('asks for an exact count and maps the rows it gets back', async () => {
    const mock = vi.mocked(fetch);
    mock.mockResolvedValue(jsonResponse([row(), row({ id: 2, external_paper_id: 'bbb' })], { headers: { 'Content-Range': '0-1/2' } }));
    const page = await fetchArchivePage({ filters: EMPTY_FILTERS, sort: 'recent', limit: 40, offset: 0 });
    expect(page.papers).toHaveLength(2);
    expect(page.total).toBe(2);
    expect(page.hasMore).toBe(false);
    const [, init] = mock.mock.calls[0];
    expect((init?.headers as Record<string, string>).Prefer).toBe('count=exact');
    expect(pathOf(mock.mock.calls[0][0] as string)).toBe('/rest/v1/pyq_papers');
  });

  it('keeps paging while the reported total is ahead of what is loaded', async () => {
    const rows = Array.from({ length: 40 }, (_, i) => row({ id: i + 1, external_paper_id: `id${i}` }));
    vi.mocked(fetch).mockResolvedValue(jsonResponse(rows, { headers: { 'Content-Range': '0-39/3154' } }));
    const page = await fetchArchivePage({ filters: EMPTY_FILTERS, sort: 'recent', limit: 40, offset: 0 });
    expect(page.hasMore).toBe(true);
    expect(page.total).toBe(3154);
  });

  it('drops a row it cannot link to instead of rendering a dead card', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse([
      row(),
      { ...row({ id: 2 }), paper_url: 'http://insecure.example/p.pdf' },
      { ...row({ id: 3 }), external_paper_id: '' },
    ], { headers: { 'Content-Range': '0-2/3' } }));
    const page = await fetchArchivePage({ filters: EMPTY_FILTERS, sort: 'recent', limit: 40, offset: 0 });
    expect(page.papers.map((p) => p.id)).toEqual([1]);
  });

  it('reports a total it never received as unknown, not as zero', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse([row()]));
    const page = await fetchArchivePage({ filters: EMPTY_FILTERS, sort: 'recent', limit: 40, offset: 0 });
    expect(page.papers).toHaveLength(1);
    expect(page.total).toBeNull();
  });

  it('raises a retryable error when PostgREST refuses the read', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ error: 'relation not found' }, { status: 404 }));
    await expect(fetchArchivePage({ filters: EMPTY_FILTERS, sort: 'recent', limit: 40, offset: 0 }))
      .rejects.toMatchObject({ name: 'ArchiveUnavailableError', status: 404 });
  });

  it('turns a transport failure into the same retryable error', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(fetchArchivePage({ filters: EMPTY_FILTERS, sort: 'recent', limit: 40, offset: 0 }))
      .rejects.toBeInstanceOf(ArchiveUnavailableError);
  });
});

describe('fetchArchiveCoursePapers', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it('reads one course in full so "4 of 12 solved" is a true fraction', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse([row(), row({ id: 2, external_paper_id: 'b' })]));
    const { papers, capped } = await fetchArchiveCoursePapers('cse2009');
    expect(papers).toHaveLength(2);
    expect(capped).toBe(false);
    const q = query(vi.mocked(fetch).mock.calls[0][0] as string);
    expect(q.get('course_code')).toBe('eq.CSE2009');
    expect(q.get('limit')).toBe('201');
  });

  it('says when it had to stop short', async () => {
    const many = Array.from({ length: 201 }, (_, i) => row({ id: i + 1, external_paper_id: `id${i}` }));
    vi.mocked(fetch).mockResolvedValue(jsonResponse(many));
    const { papers, capped } = await fetchArchiveCoursePapers('CSE2009');
    expect(capped).toBe(true);
    expect(papers).toHaveLength(200);
  });

  it('raises rather than showing an empty course when the read fails', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse([], { status: 500 }));
    await expect(fetchArchiveCoursePapers('CSE2009')).rejects.toBeInstanceOf(ArchiveUnavailableError);
  });

  it('asks no question at all for a blank course code', async () => {
    await expect(fetchArchiveCoursePapers('   ')).resolves.toEqual({ papers: [], capped: false });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('fetchArchivePapersByKeys', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it('looks saved papers up by their source ids', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse([row()]));
    const papers = await fetchArchivePapersByKeys(['6891d76bf6766a56a03f5f67', 'other-id']);
    expect(papers).toHaveLength(1);
    const q = query(vi.mocked(fetch).mock.calls[0][0] as string);
    expect(q.get('external_paper_id')).toBe('in.("6891d76bf6766a56a03f5f67","other-id")');
  });

  it('refuses to build a query out of storage it does not recognise', async () => {
    const papers = await fetchArchivePapersByKeys(['"; drop', 'ok id with spaces', 7, null]);
    expect(papers).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('degrades to an empty saved list when the read fails', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse([], { status: 503 }));
    await expect(fetchArchivePapersByKeys(['6891d76bf6766a56a03f5f67'])).resolves.toEqual([]);
  });
});

describe('fetchRelatedPapers', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it('excludes the paper being read', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse([row({ id: 9 })]));
    const related = await fetchRelatedPapers('CSE2009', 1, 6);
    expect(related[0].id).toBe(9);
    const q = query(vi.mocked(fetch).mock.calls[0][0] as string);
    expect(q.get('id')).toBe('neq.1');
    expect(q.get('course_code')).toBe('eq.CSE2009');
  });

  it('shows nothing rather than an error when related papers cannot be read', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('offline'));
    await expect(fetchRelatedPapers('CSE2009', 1)).resolves.toEqual([]);
  });
});

describe('pyq_status and pyq_facets', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it('reads the counts the importer recorded', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({
      papers: 3154, subjects: 648, chennaiPapers: 39,
      lastSyncAt: '2026-09-20T03:41:00.000Z', lastStatus: 'complete',
      papersDiscovered: 3154, papersInserted: 3154, papersUpdated: 0,
      papersSkippedUnchanged: 0, papersFailed: 0, errorSummary: null,
    }));
    const status = await fetchArchiveStatus();
    expect(status).toMatchObject({ papers: 3154, subjects: 648, chennaiPapers: 39, lastStatus: 'complete' });
    expect(pathOf(vi.mocked(fetch).mock.calls[0][0] as string)).toBe('/rest/v1/rpc/pyq_status');
  });

  it('survives a status call that answers nothing useful', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(null, { status: 500 }));
    await expect(fetchArchiveStatus()).resolves.toBeNull();
  });

  it('parses facets defensively, ignoring entries with no value', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({
      papers: 3154,
      examType: [{ value: ' FAT ', papers: 938 }, { value: '', papers: 5 }, 'junk', { papers: 3 }],
      year: null,
      semester: [{ value: 'Fall', papers: 'many' }],
      slot: [],
      campus: [{ value: 'Chennai', papers: 39 }],
    }));
    const facets = await fetchArchiveFacets();
    expect(facets?.examType).toEqual([{ value: 'FAT', papers: 938 }]);
    expect(facets?.year).toEqual([]);
    expect(facets?.semester).toEqual([{ value: 'Fall', papers: 0 }]);
    expect(facets?.campus).toEqual([{ value: 'Chennai', papers: 39 }]);
    expect(facets?.papers).toBe(3154);
  });

  it('describes the archive honestly, including when it cannot', () => {
    const status: ArchiveStatus = {
      papers: 3154, subjects: 648, chennaiPapers: 39,
      lastSyncAt: '2026-09-20T03:41:00.000Z', lastStatus: 'complete',
      papersDiscovered: null, papersInserted: null, papersUpdated: null,
      papersSkippedUnchanged: null, papersFailed: null, errorSummary: null,
    };
    const line = describeArchiveStatus(status);
    expect(line).toContain('3,154 papers');
    expect(line).toContain('39 from Chennai');
    expect(describeArchiveStatus(null)).toContain('Checking');
    expect(describeArchiveStatus({ ...status, papers: null })).toContain('could not report');
  });
});

describe('archive copy', () => {
  it('lists only the facts the row carries', () => {
    expect(archiveMetaLine(row())).toEqual(['CAT-1', '2024-2025', 'Fall', 'Slot B2', 'Chennai']);
    expect(archiveMetaLine(row({
      exam_type: null, academic_year: null, semester: null, slot: null, campus: null,
    }))).toEqual([]);
  });

  it('names a paper from what exists, never from what is missing', () => {
    expect(archivePaperTitle(row())).toBe('Python for Data Science [CSE2009]');
    expect(archivePaperTitle(row({ title: null, course_title: null, course_code: null }))).toBe('Previous year paper');
  });

  it('reports an unreadable added-date as absent', () => {
    expect(archiveAddedLine(row({ source_created_at: 'not a date' }))).toBeNull();
    expect(archiveAddedLine(row({ source_created_at: null }))).toBeNull();
    expect(archiveAddedLine(row())).toMatch(/^Added \d/);
  });
});

// ---------------------------------------------------------------------------
// The viewer contract, asserted where it is actually written.
//
// The paper itself is rendered by the browser and handed back to the browser:
// this component embeds the source URL and offers one "Open paper" link. That
// is not laziness — the hosts serving these PDFs allow-list CodeChef's own
// origin for CORS, so a `fetch()` from this tab fails on a URL that opens
// perfectly well in a new tab. A "why not add a download button" pass would
// reintroduce that dead request, plus a second control labelled "Save" next to
// the bookmark button that already means something else by that word.
// ---------------------------------------------------------------------------

describe('archive viewer contract', () => {
  const viewerSource = readFileSync(join(__dirname, '..', '..', 'components', 'QbankArchive.tsx'), 'utf8');

  it('never pulls the file into the app', () => {
    expect(viewerSource).not.toMatch(/fetch\(/);
    expect(viewerSource).toContain('<iframe');
  });

  it('offers exactly one way out of the preview, in a new tab, without a referrer', () => {
    expect(viewerSource.match(/href=\{paper\.paper_url\}/g)).toHaveLength(1);
    expect(viewerSource).toMatch(/target="_blank"/);
    expect(viewerSource).toContain('referrerPolicy="no-referrer"');
    expect(viewerSource).not.toMatch(/^\s+download\s*$/m);
  });

  it('keeps its touch targets at the size the mobile brief asked for', () => {
    expect(viewerSource).toContain('min-h-[44px]');
  });

  it('keeps upstream attribution on GitHub, never in the app UI', () => {
    expect(viewerSource).not.toContain('Source: CodeChef-VIT Papers');
    expect(viewerSource).not.toContain('PYQ_ATTRIBUTION');
  });
});
