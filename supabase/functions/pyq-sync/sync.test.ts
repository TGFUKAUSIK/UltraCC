/**
 * CodeChef-VIT PYQ importer — regression tests.
 *
 * Ground truth these are pinned to (all captured from the live public API on
 * 2026-09-20, with CodeChef-VIT's permission):
 *   - ?subject= is an unanchored, case-insensitive LITERAL substring match.
 *     '[' returns 3,152 papers, '^' returns 0, 'a{2,1}' returns 0 — an
 *     unescaped regex could not do that.
 *   - Every subject string contains a space, so '?subject=%20' returns the
 *     whole archive: 3,154 papers, ~1.3 MB, in one response.
 *   - A record carries _id, subject, slot, year, exam, semester, campus,
 *     thumbnail_url, file_url, answer_key_included (+ sometimes __v and
 *     public_id_cloudinary). Nothing else. One record
 *     (68a4da38991f450b79fcb7c5) has a double-scheme file_url.
 *
 * The contracts that matter for the portal, in order: never invent a field
 * upstream does not send, never rewrite a row that has not changed, never let
 * an upstream outage touch what is already stored, and never make 648 requests
 * when two will do.
 */

import { describe, expect, it } from 'vitest';
import {
  CODECHEF_BASE,
  COURSE_LIST_PATH,
  decideSyncAuth,
  deriveFileType,
  extractCourseNames,
  extractPapers,
  fingerprintOf,
  gatherPapers,
  httpsUrl,
  identityOf,
  MIN_SECRET_LENGTH,
  normaliseFileUrl,
  normalisePaper,
  objectIdDate,
  PAPERS_PATH,
  queryKeyForSubject,
  rotateSubjects,
  runSync,
  safeEqual,
  splitSubject,
  summarise,
  sweepPapers,
  SWEEP_PATTERNS,
  SYNC_DEFAULTS,
  UpstreamError,
  type FetchImpl,
  type PyqPaperRow,
  type RawPaper,
  type RestImpl,
} from './sync.ts';

// ---------------------------------------------------------------------------
// Fixtures — a real record, verbatim from /api/papers
// ---------------------------------------------------------------------------

const REAL_PAPER: RawPaper = {
  _id: '69d40aa70e1fbf5db4aa59d5',
  thumbnail_url: 'https://storage.googleapis.com/papers-codechefvit-prod/1775503304546-lvj6a06ms9c.jpg',
  file_url: 'https://storage.googleapis.com/papers-codechefvit-prod/papers/1775503304546-lvj6a06ms9c.pdf',
  subject: 'Soft Computing [BITE405L]',
  slot: 'G1',
  year: '2025-2026',
  exam: 'CAT-1',
  semester: 'Winter Semester',
  campus: 'Vellore',
  answer_key_included: false,
  __v: 0,
};

/** The corrupt double-scheme record, as upstream actually sends it. */
const BROKEN_PAPER: RawPaper = {
  ...REAL_PAPER,
  _id: '68a4da38991f450b79fcb7c5',
  file_url: 'https://storage.googleapis.com/papers-codechefvit-prod/papers/https://res.cloudinary.com/dtorpaj1c/image/upload/paper/live.pdf',
};

function paper(over: Partial<RawPaper> = {}, n = 0): RawPaper {
  return {
    ...REAL_PAPER,
    _id: `${(0x69d40aa0 + n).toString(16)}${'e1fbf5db4aa59d5'.padStart(16, '0')}`.slice(0, 24),
    subject: `Test Course [CSE100${n % 10}]`,
    ...over,
  };
}

const envelope = (data: unknown) => ({ status: 'success', data, message: 'OK' });
const papersEnvelope = (papers: RawPaper[]) =>
  envelope({
    papers,
    unique_years: [], unique_slots: [], unique_exams: [], unique_campuses: [], unique_semesters: [],
  });
const courseListEnvelope = (names: string[]) => envelope(names.map((name, i) => ({ _id: `c${i}`, name })));

// ---------------------------------------------------------------------------
// Mocks — upstream and PostgREST, both fully recorded
// ---------------------------------------------------------------------------

type UpstreamReply = { status: number; body: unknown } | 'throw';
type UpstreamHandler = (url: URL, attempt: number) => UpstreamReply;

function makeUpstream(handlers: Record<string, UpstreamHandler>) {
  const calls: { path: string; subject: string | null }[] = [];
  const attempts = new Map<string, number>();
  const fetchUpstream: FetchImpl = async (url) => {
    const parsed = new URL(url);
    calls.push({ path: parsed.pathname, subject: parsed.searchParams.get('subject') });
    const key = parsed.pathname;
    const attempt = (attempts.get(key) ?? 0) + 1;
    attempts.set(key, attempt);
    const handler = handlers[key];
    if (!handler) throw new Error(`no handler for ${key}`);
    const reply = handler(parsed, attempt);
    if (reply === 'throw') throw new TypeError('fetch failed');
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return { calls, fetchUpstream };
}

interface RestOptions {
  existing?: { id: number; external_paper_id: string; url_fingerprint: string }[];
  /** What pyq_sync_begin() returns: an id, or null when another run owns the claim. */
  beginId?: number | null;
  failUpsert?: boolean;
  failFinish?: boolean;
  failFingerprintRead?: boolean;
}

function makeRest(options: RestOptions = {}) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const upserts: PyqPaperRow[][] = [];
  let pageSent = false;

  const rest: RestImpl = async (path, init) => {
    calls.push({ method: init.method, path, body: init.body });
    const respond = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

    if (path === '/rest/v1/rpc/pyq_sync_begin') {
      return respond(options.beginId === undefined ? 7 : options.beginId);
    }
    if (path === '/rest/v1/rpc/pyq_sync_finish') {
      return options.failFinish ? respond({ error: 'no' }, 500) : respond(true);
    }
    if (path.startsWith('/rest/v1/pyq_papers?select=id')) {
      if (options.failFingerprintRead) return respond({ error: 'no' }, 401);
      if (pageSent) return respond([]); // second page: nothing more
      pageSent = true;
      return respond(options.existing ?? []);
    }
    if (path.startsWith('/rest/v1/pyq_papers')) {
      if (options.failUpsert) return respond({ error: 'rejected' }, 400);
      upserts.push(init.body as PyqPaperRow[]);
      return respond({}, 201);
    }
    throw new Error(`unhandled rest path ${path}`);
  };

  /** Every row the importer asked Postgres to write, flattened. */
  const written = () => upserts.flat();
  return { calls, upserts, written, rest };
}

/** No real waiting, no real timeouts, and a clock the test owns. */
function fakeClock(start = 1_760_000_000_000) {
  let ms = start;
  return {
    now: () => ms,
    advance: (delta: number) => { ms += delta; },
    sleep: async (_ms: number) => { ms += _ms; },
  };
}

function syncDeps(
  upstream: Record<string, UpstreamHandler>,
  rest: RestImpl,
  clock: ReturnType<typeof fakeClock>,
  over: Partial<Parameters<typeof runSync>[0]> = {},
) {
  const { calls, fetchUpstream } = makeUpstream(upstream);
  return {
    calls,
    deps: {
      fetchUpstream,
      rest,
      now: clock.now,
      sleep: clock.sleep,
      signalFor: () => undefined,
      delayMs: 0,
      ...over,
    },
  };
}

const SWEEP_HANDLERS = (papers: RawPaper[]): Record<string, UpstreamHandler> => ({
  [PAPERS_PATH]: () => ({ status: 200, body: papersEnvelope(papers) }),
  [COURSE_LIST_PATH]: () => ({ status: 200, body: courseListEnvelope([]) }),
});

// ---------------------------------------------------------------------------
// 1. Normalisation — what a real record becomes
// ---------------------------------------------------------------------------

describe('normalisePaper — one live record, honestly', () => {
  it('maps every field upstream sends and derives nothing it cannot check', async () => {
    const row = await normalisePaper(REAL_PAPER, '2026-09-20T00:00:00.000Z');
    expect(row).not.toBeNull();
    expect(row).toMatchObject({
      source: 'codechef-vit',
      external_paper_id: '69d40aa70e1fbf5db4aa59d5',
      course_code: 'BITE405L',
      course_title: 'Soft Computing',
      title: 'Soft Computing [BITE405L]',
      subject_raw: 'Soft Computing [BITE405L]',
      exam_type: 'CAT-1',
      academic_year: '2025-2026',
      semester: 'Winter Semester',
      slot: 'G1',
      campus: 'Vellore',
      paper_url: REAL_PAPER.file_url,
      thumbnail_url: REAL_PAPER.thumbnail_url,
      answer_key_included: false,
      file_type: 'pdf',
      imported_at: '2026-09-20T00:00:00.000Z',
    });
    // DERIVED from the ObjectId, because upstream sends no timestamp field.
    expect(row!.source_created_at).toBe(new Date(0x69d40aa7 * 1000).toISOString());
    // A field for a source that has one — this source does not.
    expect(row!.answer_key_url).toBeNull();
    expect(row!.url_fingerprint).toMatch(/^[0-9a-f]{64}$/);
    // first_seen_at is a column default: sending it would let an update move it.
    expect('first_seen_at' in row!).toBe(false);
  });

  it('keeps __v and public_id_cloudinary out of the row', async () => {
    const row = await normalisePaper({ ...REAL_PAPER, public_id_cloudinary: 'paper/abc' }, 'now');
    expect(Object.keys(row!)).not.toContain('public_id_cloudinary');
    expect(Object.keys(row!)).not.toContain('__v');
  });

  it('drops a record with no id or no usable file instead of guessing one', async () => {
    expect(await normalisePaper({ ...REAL_PAPER, _id: undefined }, 'now')).toBeNull();
    expect(await normalisePaper({ ...REAL_PAPER, file_url: '' }, 'now')).toBeNull();
    expect(await normalisePaper({ ...REAL_PAPER, file_url: 'http://example.com/a.pdf' }, 'now')).toBeNull();
    expect(await normalisePaper(null, 'now')).toBeNull();
    expect(await normalisePaper('paper', 'now')).toBeNull();
  });

  it('leaves an absent facet NULL rather than inventing a filter value', async () => {
    const row = await normalisePaper(
      { _id: 'aaa', subject: 'Bare Subject', file_url: 'https://x.test/a.pdf' },
      '2026-09-20T00:00:00.000Z',
    );
    expect(row).toMatchObject({
      course_code: null,
      course_title: 'Bare Subject',
      exam_type: null,
      academic_year: null,
      semester: null,
      slot: null,
      campus: null,
      answer_key_included: null,
      source_created_at: null, // not an ObjectId, so no date to derive
    });
  });
});

describe('splitSubject — the "Title [CODE]" shape upstream uses', () => {
  it('splits a real catalogue entry', () => {
    expect(splitSubject('Probability And Statistics [BMAT202L]')).toEqual({
      title: 'Probability And Statistics [BMAT202L]',
      course_code: 'BMAT202L',
      course_title: 'Probability And Statistics',
    });
  });

  it('uppercases the code so an exact client filter survives casing drift', () => {
    expect(splitSubject('Optics [bphy201l]').course_code).toBe('BPHY201L');
  });

  it('collapses whitespace and keeps a subject with no bracket whole', () => {
    expect(splitSubject('  Open   Elective  ')).toEqual({
      title: 'Open Elective', course_code: null, course_title: 'Open Elective',
    });
  });

  it('strips upstream’s empty-code placeholder instead of showing "[]"', () => {
    // "Intra and Interpersonal skills []" is a real catalogue entry with 3 papers.
    expect(splitSubject('Intra and Interpersonal skills []')).toEqual({
      title: 'Intra and Interpersonal skills',
      course_code: null,
      course_title: 'Intra and Interpersonal skills',
    });
  });
});

describe('file_url repair and file_type derivation', () => {
  it('repairs the known double-scheme record to the live trailing URL', () => {
    const fixed = normaliseFileUrl(BROKEN_PAPER.file_url);
    expect(fixed).toEqual({ url: 'https://res.cloudinary.com/dtorpaj1c/image/upload/paper/live.pdf', repaired: true });
  });

  it('refuses http, javascript, relative and scheme-in-query targets', () => {
    for (const bad of [
      'http://x.test/a.pdf', 'javascript:alert(1)', '/papers/a.pdf', '', '   ',
      'https://x.test/a.pdf?next=http://evil.test', 'data:application/pdf;base64,AAA',
    ]) {
      expect(normaliseFileUrl(bad), bad).toBeNull();
    }
  });

  it('keeps a plain https URL unrepaired', () => {
    expect(normaliseFileUrl(REAL_PAPER.file_url)).toEqual({ url: REAL_PAPER.file_url, repaired: false });
    expect(normaliseFileUrl(undefined)).toBeNull();
  });

  it('derives the suffix only when the URL really has one', () => {
    expect(deriveFileType('https://x.test/dir/notes.pdf')).toBe('pdf');
    expect(deriveFileType('https://x.test/dir/notes.PDF?signature=abc')).toBe('pdf');
    expect(deriveFileType('https://x.test/dir/1234')).toBeNull();
  });

  it('reads a creation date off an ObjectId and refuses a silly one', () => {
    expect(objectIdDate('69d40aa70e1fbf5db4aa59d5')).toBe(new Date(0x69d40aa7 * 1000).toISOString());
    expect(objectIdDate('00000000ffffffffffffffff')).toBeNull();
    expect(objectIdDate('not-an-object-id')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. Envelope parsing — a malformed answer is an error, not empty data
// ---------------------------------------------------------------------------

describe('envelope parsing', () => {
  it('takes the subject strings out of a real course-list response', () => {
    const names = extractCourseNames(envelope([
      { _id: '1', name: ' Optics [BPHY201L] ' }, { _id: '2', name: 'Optics [BPHY201L]' },
      { _id: '3', name: 'Algebra [BMAT101L]' }, { _id: '4' }, { _id: '5', name: '  ' },
    ]));
    expect(names).toEqual(['Algebra [BMAT101L]', 'Optics [BPHY201L]']);
  });

  it('reads the papers array and ignores the facet lists', () => {
    const papers = extractPapers(envelope({ papers: [REAL_PAPER], unique_years: ['2025-2026'] }));
    expect(papers).toEqual([REAL_PAPER]);
  });

  it('reports an upstream error envelope and every shape surprise as a parse failure', () => {
    expect(() => extractPapers({ status: 'error', data: null, message: 'boom' }, 400))
      .toThrow(/upstream reported an error/);
    expect(() => extractPapers(envelope(null))).toThrow(/not an object/);
    expect(() => extractPapers(envelope({ papers: 'nope' }))).toThrow(/no papers array/);
    expect(() => extractCourseNames('string', 200)).toThrow(/expected a JSON envelope/);
    expect(() => extractCourseNames(envelope({}))).toThrow(/not an array/);
  });
});

// ---------------------------------------------------------------------------
// 3. URL safety
// ---------------------------------------------------------------------------

describe('httpsUrl', () => {
  it('builds an https URL and encodes the subject', () => {
    const url = httpsUrl(CODECHEF_BASE, PAPERS_PATH, { subject: 'Optics [BPHY201L]' });
    expect(url.startsWith('https://www.papers.codechefvit.com/api/papers?subject=')).toBe(true);
    expect(new URL(url).searchParams.get('subject')).toBe('Optics [BPHY201L]');
  });

  it('refuses a non-HTTPS or internal target before any request is made', () => {
    expect(() => httpsUrl('http://papers.codechefvit.com', PAPERS_PATH)).toThrow(/non-HTTPS/);
    expect(() => httpsUrl('https://localhost:54321', PAPERS_PATH)).toThrow(/internal target/);
    expect(() => httpsUrl('https://metadata.google.internal', PAPERS_PATH)).toThrow(/internal target/);
    expect(() => httpsUrl('not a url at all', PAPERS_PATH)).toThrow(/not a valid URL/);
  });
});

// ---------------------------------------------------------------------------
// 4. The sweep — two requests, not 648
// ---------------------------------------------------------------------------

describe('sweepPapers', () => {
  it('unions the patterns and dedupes by _id, so one archive arrives once', async () => {
    const shared = paper({}, 1);
    const clock = fakeClock();
    const { calls, fetchUpstream } = makeUpstream({
      [PAPERS_PATH]: (url) => ({
        status: 200,
        body: papersEnvelope(url.searchParams.get('subject') === SWEEP_PATTERNS[0]
          ? [shared, paper({}, 2)]
          : [shared, paper({}, 3)]),
      }),
    });
    const result = await sweepPapers({ fetchUpstream, now: clock.now, sleep: clock.sleep, signalFor: () => undefined }, {
      concurrency: 3, delayMs: 0, attempts: 1, timeoutMs: 1000, deadlineAt: clock.now() + 10_000,
    });
    expect(calls.map((c) => c.subject)).toEqual([' ', '[']);
    expect(result.raw.map((p) => p._id).sort()).toEqual([shared._id, paper({}, 2)._id, paper({}, 3)._id].sort());
    expect(result.primaryAnswered).toBe(true);
    expect(result.patternsAnswered).toBe(2);
  });

  it('says when the primary pattern stops covering the archive', async () => {
    const clock = fakeClock();
    const { fetchUpstream } = makeUpstream({
      [PAPERS_PATH]: (url) => ({
        status: 200,
        body: papersEnvelope(url.searchParams.get('subject') === '[' ? [paper({}, 4)] : []),
      }),
    });
    const result = await sweepPapers({ fetchUpstream, now: clock.now, sleep: clock.sleep, signalFor: () => undefined }, {
      concurrency: 3, delayMs: 0, attempts: 1, timeoutMs: 1000, deadlineAt: clock.now() + 10_000,
    });
    expect(result.raw).toHaveLength(1);
    expect(result.primaryAnswered).toBe(false);
  });

  it('records a failure per pattern instead of throwing', async () => {
    const clock = fakeClock();
    const { fetchUpstream } = makeUpstream({ [PAPERS_PATH]: () => 'throw' });
    const result = await sweepPapers({ fetchUpstream, now: clock.now, sleep: clock.sleep, signalFor: () => undefined }, {
      concurrency: 3, delayMs: 0, attempts: 1, timeoutMs: 1000, deadlineAt: clock.now() + 10_000,
    });
    expect(result.raw).toEqual([]);
    expect(result.failures).toHaveLength(2);
    expect(result.failures[0]).toMatch(/sweep " " failed \(network\)/);
  });
});

describe('queryKeyForSubject — the fallback query key', () => {
  it('uses the code, which survives a title drift between catalogue and papers', () => {
    // Live case: 'Electronic Devices And Circuits [BECE205L]' matches 0 papers
    // verbatim while the code alone matches 14.
    expect(queryKeyForSubject('Electronic Devices And Circuits [BECE205L]')).toBe('BECE205L');
    expect(queryKeyForSubject('SUSTAINABLE ENERGY TECHNOLOGIES [BAMEE317]')).toBe('BAMEE317');
  });

  it('falls back to the whole name when there is no code, and never sends a metacharacter', () => {
    expect(queryKeyForSubject('Intra and Interpersonal skills []')).toBe('Intra and Interpersonal skills');
    expect(queryKeyForSubject('Bare Subject')).toBe('Bare Subject');
    expect(queryKeyForSubject('Optics [BPHY201L]')).not.toMatch(/[[\](){}^$.*+?|]/);
  });
});

// ---------------------------------------------------------------------------
// 5. The per-subject walk — bounded, polite, retrying
// ---------------------------------------------------------------------------

describe('gatherPapers', () => {
  it('never exceeds the concurrency it was given', async () => {
    const clock = fakeClock();
    let inFlight = 0;
    let peak = 0;
    const fetchUpstream: FetchImpl = async () => {
      inFlight++; peak = Math.max(peak, inFlight);
      await clock.sleep(1);
      inFlight--;
      return new Response(JSON.stringify(papersEnvelope([paper({}, 1)])), { status: 200 });
    };
    const subjects = Array.from({ length: 12 }, (_, i) => `Course [CSE10${i}]`);
    const result = await gatherPapers(subjects, { fetchUpstream, now: clock.now, sleep: clock.sleep, signalFor: () => undefined }, {
      concurrency: 3, delayMs: 0, attempts: 1, timeoutMs: 1000, deadlineAt: clock.now() + 600_000,
    });
    expect(result.inFlightPeak).toBeLessThanOrEqual(3);
    expect(result.fetched).toBe(12);
  });

  it('queries each catalogue entry by its code', async () => {
    const clock = fakeClock();
    const { calls, fetchUpstream } = makeUpstream({
      [PAPERS_PATH]: () => ({ status: 200, body: papersEnvelope([]) }),
    });
    await gatherPapers(['Machine Learning [BITE410L]'], { fetchUpstream, now: clock.now, sleep: clock.sleep, signalFor: () => undefined }, {
      concurrency: 1, delayMs: 0, attempts: 1, timeoutMs: 1000, deadlineAt: clock.now() + 60_000,
    });
    expect(calls).toEqual([{ path: PAPERS_PATH, subject: 'BITE410L' }]);
  });

  it('retries a 5xx and keeps going; a 4xx is not retried', async () => {
    const clock = fakeClock();
    let attempts5xx = 0;
    const { calls, fetchUpstream } = makeUpstream({
      [PAPERS_PATH]: (_url, attempt) => {
        if (attempt === 1) { attempts5xx++; return { status: 503, body: {} }; }
        return { status: 200, body: papersEnvelope([paper({}, 5)]) };
      },
    });
    const result = await gatherPapers(['Optics [BPHY201L]'], { fetchUpstream, now: clock.now, sleep: clock.sleep, signalFor: () => undefined }, {
      concurrency: 1, delayMs: 0, attempts: SYNC_DEFAULTS.attempts, timeoutMs: 1000, deadlineAt: clock.now() + 60_000,
    });
    expect(attempts5xx).toBe(1);
    expect(calls).toHaveLength(2);
    expect(result.fetched).toBe(1);
    expect(result.failures).toEqual([]);

    const g4 = fakeClock();
    const four = makeUpstream({ [PAPERS_PATH]: () => ({ status: 400, body: { status: 'error', message: 'Subject query parameter is required' } }) });
    const failed = await gatherPapers(['x [Y1]'], { fetchUpstream: four.fetchUpstream, now: g4.now, sleep: g4.sleep, signalFor: () => undefined }, {
      concurrency: 1, delayMs: 0, attempts: 3, timeoutMs: 1000, deadlineAt: g4.now() + 60_000,
    });
    expect(four.calls).toHaveLength(1); // no hammering a 4xx
    expect(failed.failures[0]).toMatch(/http 400/);
  });

  it('stops cleanly when the wall clock runs out and says so', async () => {
    const clock = fakeClock();
    const { fetchUpstream } = makeUpstream({
      [PAPERS_PATH]: () => { clock.advance(5_000); return { status: 200, body: papersEnvelope([]) }; },
    });
    const result = await gatherPapers(['a [A1]', 'b [B2]', 'c [C3]'], { fetchUpstream, now: clock.now, sleep: clock.sleep, signalFor: () => undefined }, {
      concurrency: 1, delayMs: 0, attempts: 1, timeoutMs: 1000, deadlineAt: clock.now() + 6_000,
    });
    expect(result.budgetStopped).toBe(true);
    expect(result.fetched).toBeLessThan(3);
  });
});

describe('rotateSubjects', () => {
  it('walks a different slice each hour without losing or duplicating anything', () => {
    const subjects = ['a', 'b', 'c', 'd', 'e'];
    const hour = 3_600_000;
    expect(rotateSubjects(subjects, 0)).toEqual(subjects);
    expect(rotateSubjects(subjects, hour).slice(0, 2)).toEqual(['b', 'c']);
    expect([...rotateSubjects(subjects, hour * 7)].sort()).toEqual(subjects.slice().sort());
    expect(rotateSubjects([], 0)).toEqual([]);
    expect(rotateSubjects(['only'], 0)).toEqual(['only']);
  });
});

// ---------------------------------------------------------------------------
// 6. A whole run — counts, incremental writes, and what an outage may not do
// ---------------------------------------------------------------------------

describe('runSync', () => {
  it('imports a fresh archive through the sweep, and only two upstream calls', async () => {
    const clock = fakeClock();
    const papers = [paper({}, 1), paper({}, 2), paper({}, 3)];
    const rest = makeRest();
    const { calls, deps } = syncDeps(SWEEP_HANDLERS(papers), rest.rest, clock);

    const summary = await runSync(deps);

    expect(summary).toMatchObject({
      status: 'complete',
      runId: 7,
      busy: false,
      subjectsEnumerated: 3,
      subjectsFetched: 3,
      papersDiscovered: 3,
      papersInserted: 3,
      papersUpdated: 0,
      papersSkippedUnchanged: 0,
      papersFailed: 0,
      errorSummary: null,
    });
    // One request per sweep pattern; the catalogue is not walked at all.
    expect(calls.map((c) => c.path)).toEqual([PAPERS_PATH, PAPERS_PATH]);
    expect(summary.finishedAt >= summary.startedAt).toBe(true);
    expect(rest.written().map((r) => r.external_paper_id).sort())
      .toEqual(papers.map((p) => p._id).sort());
  });

  it('writes the run row: begin claims it, finish carries the real counts', async () => {
    const clock = fakeClock();
    const rest = makeRest();
    const { deps } = syncDeps(SWEEP_HANDLERS([paper({}, 1)]), rest.rest, clock);
    await runSync(deps);

    const begin = rest.calls.find((c) => c.path === '/rest/v1/rpc/pyq_sync_begin');
    const finish = rest.calls.find((c) => c.path === '/rest/v1/rpc/pyq_sync_finish');
    expect(begin?.method).toBe('POST');
    expect(finish).toMatchObject({ method: 'POST', body: {
      p_run_id: 7, p_status: 'complete', p_papers_discovered: 1, p_papers_inserted: 1,
    } });
  });

  it('reports itself busy and touches nothing when another run holds the claim', async () => {
    const clock = fakeClock();
    const rest = makeRest({ beginId: null });
    const { calls, deps } = syncDeps(SWEEP_HANDLERS([paper({}, 1)]), rest.rest, clock);
    const summary = await runSync(deps);

    expect(summary).toMatchObject({ busy: true, status: 'failed', runId: null });
    expect(calls).toHaveLength(0);
    expect(rest.upserts).toHaveLength(0);
    expect(rest.calls.map((c) => c.path)).toEqual(['/rest/v1/rpc/pyq_sync_begin']);
  });

  it('re-writes only what changed on the next run', async () => {
    const clock = fakeClock();
    const stored = paper({}, 1);
    const row = await normalisePaper(stored, '2026-01-01T00:00:00.000Z');
    const rest = makeRest({ existing: [{ id: 1, external_paper_id: row!.external_paper_id, url_fingerprint: row!.url_fingerprint }] });
    const { deps } = syncDeps(SWEEP_HANDLERS([stored, paper({}, 2)]), rest.rest, clock);

    const summary = await runSync(deps);

    expect(summary).toMatchObject({ papersDiscovered: 2, papersInserted: 1, papersUpdated: 0, papersSkippedUnchanged: 1 });
    expect(rest.written().map((r) => r.external_paper_id)).toEqual([paper({}, 2)._id]);
  });

  it('updates a row whose URL changed and counts it as an update', async () => {
    const clock = fakeClock();
    const stored = paper({}, 1);
    const rest = makeRest({ existing: [{ id: 1, external_paper_id: String(stored._id), url_fingerprint: 'stale-stale-stale' }] });
    const { deps } = syncDeps(SWEEP_HANDLERS([stored]), rest.rest, clock);

    const summary = await runSync(deps);
    expect(summary).toMatchObject({ papersUpdated: 1, papersInserted: 0, papersSkippedUnchanged: 0 });
  });

  it('chunks the writes at the configured batch size', async () => {
    const clock = fakeClock();
    const many = Array.from({ length: 5 }, (_, i) => paper({}, i));
    const rest = makeRest();
    const { deps } = syncDeps(SWEEP_HANDLERS(many), rest.rest, clock);
    const summary = await runSync({ ...deps, batchSize: 2 });
    expect(summary.papersInserted).toBe(5);
    expect(rest.upserts.map((b) => b.length)).toEqual([2, 2, 1]);
  });

  it('leaves the stored archive untouched when upstream is down', async () => {
    const clock = fakeClock();
    const rest = makeRest();
    const { deps } = syncDeps({
      [PAPERS_PATH]: () => 'throw',
      [COURSE_LIST_PATH]: () => 'throw',
    }, rest.rest, clock);

    const summary = await runSync(deps);

    expect(summary.status).toBe('failed');
    expect(summary.papersDiscovered).toBe(0);
    expect(summary.papersInserted).toBe(0);
    expect(rest.upserts).toHaveLength(0);
    expect(summary.errorSummary).toMatch(/sweep " " failed \(network\)/);
    // The run row is still closed out, so the dashboard can show the failure.
    expect(rest.calls.some((c) => c.path === '/rest/v1/rpc/pyq_sync_finish')).toBe(true);
  });

  it('falls back to walking the catalogue when the sweep returns nothing', async () => {
    const clock = fakeClock();
    const rest = makeRest();
    const { calls, deps } = syncDeps({
      [PAPERS_PATH]: (url) => ({
        status: 200,
        // The space sweep no longer matches anything (upstream tightened the
        // parameter); '[' and a real code still answer.
        body: papersEnvelope(url.searchParams.get('subject') === ' ' ? [] : [paper({}, 6)]),
      }),
      [COURSE_LIST_PATH]: () => ({ status: 200, body: courseListEnvelope(['Optics [BPHY201L]']) }),
    }, rest.rest, clock);

    const summary = await runSync({ ...deps, concurrency: 1 });

    expect(calls.filter((c) => c.path === PAPERS_PATH).map((c) => c.subject))
      .toEqual([' ', '[', 'BPHY201L']);
    expect(summary).toMatchObject({ subjectsEnumerated: 1, subjectsFetched: 1, papersInserted: 1 });
    expect(summary.status).toBe('partial');
    expect(summary.errorSummary).toMatch(/no longer matches every subject/);
  });

  it('counts a malformed record as a failure without discarding the good ones', async () => {
    const clock = fakeClock();
    const rest = makeRest();
    const { deps } = syncDeps(SWEEP_HANDLERS([paper({}, 1), { _id: 'x', subject: 'No URL' }]), rest.rest, clock);
    const summary = await runSync(deps);
    expect(summary).toMatchObject({ papersDiscovered: 1, papersInserted: 1, papersFailed: 1, status: 'partial' });
  });

  it('repairs the corrupt record and imports it rather than dropping it', async () => {
    const clock = fakeClock();
    const rest = makeRest();
    const { deps } = syncDeps(SWEEP_HANDLERS([BROKEN_PAPER]), rest.rest, clock);
    const summary = await runSync(deps);
    expect(summary.papersInserted).toBe(1);
    expect(rest.written()[0].paper_url).toBe('https://res.cloudinary.com/dtorpaj1c/image/upload/paper/live.pdf');
  });

  it('reports partial, with the failed batch counted, when Postgres rejects a write', async () => {
    const clock = fakeClock();
    const rest = makeRest({ failUpsert: true });
    const { deps } = syncDeps(SWEEP_HANDLERS([paper({}, 1), paper({}, 2)]), rest.rest, clock);
    const summary = await runSync({ ...deps, batchSize: 2 });
    expect(summary).toMatchObject({ status: 'partial', papersFailed: 2, papersInserted: 0 });
    expect(summary.errorSummary).toMatch(/upsert batch rejected \(http 400\)/);
  });

  it('fails without writing when the fingerprint read is refused', async () => {
    const clock = fakeClock();
    const rest = makeRest({ failFingerprintRead: true });
    const { deps } = syncDeps(SWEEP_HANDLERS([paper({}, 1)]), rest.rest, clock);
    const summary = await runSync(deps);
    expect(summary.status).toBe('failed');
    expect(summary.errorSummary).toMatch(/fingerprint read failed/);
    expect(rest.upserts).toHaveLength(0);
  });

  it('still imports when the run row could not be recorded, and says so', async () => {
    const clock = fakeClock();
    const failing = makeRest();
    const { deps } = syncDeps(SWEEP_HANDLERS([paper({}, 1)]), failing.rest, clock);
    // begin() answering 503 means no run id and no claim: the import must go
    // ahead (the metadata is worth having) but must report the gap.
    const summary = await runSync({
      ...deps,
      rest: async (path, init) => (path === '/rest/v1/rpc/pyq_sync_begin'
        ? new Response('{"error":"unavailable"}', { status: 503 })
        : failing.rest(path, init)),
    });
    expect(summary).toMatchObject({ status: 'partial', runId: null, busy: false, papersInserted: 1 });
    expect(summary.errorSummary).toMatch(/could not record the run \(503\)/);
    expect(failing.upserts).toHaveLength(1);
  });

  it('never issues a DELETE, whatever happened upstream', async () => {
    const clock = fakeClock();
    const rest = makeRest({ existing: [{ id: 1, external_paper_id: 'gone-from-upstream', url_fingerprint: 'x' }] });
    const { deps } = syncDeps(SWEEP_HANDLERS([paper({}, 1)]), rest.rest, clock);
    await runSync(deps);
    expect(new Set(rest.calls.map((c) => c.method))).toEqual(new Set(['POST', 'GET']));
    // A paper upstream no longer lists keeps its row: it is a real archive.
    expect(rest.written().map((r) => r.external_paper_id)).not.toContain('gone-from-upstream');
  });

  it('stops writing when the budget runs out and counts the unwritten rows', async () => {
    const clock = fakeClock();
    const many = Array.from({ length: 6 }, (_, i) => paper({}, i));
    const inner = makeRest();
    const { deps } = syncDeps(SWEEP_HANDLERS(many), inner.rest, clock);
    // Each write costs four seconds of the five-second budget.
    const slowRest: RestImpl = async (path, init) => {
      const response = await inner.rest(path, init);
      if (path.startsWith('/rest/v1/pyq_papers?on_conflict')) clock.advance(4_000);
      return response;
    };

    const summary = await runSync({ ...deps, budgetMs: 5_000, batchSize: 2, rest: slowRest });

    expect(summary.status).toBe('partial');
    expect(summary.papersInserted).toBeGreaterThan(0);
    expect(summary.papersFailed).toBeGreaterThan(0);
    expect(summary.papersInserted + summary.papersFailed).toBe(6);
    expect(summary.errorSummary).toMatch(/time budget reached before all batches were written/);
  });

  it('refuses to call an archive of unreadable records a success', async () => {
    const clock = fakeClock();
    const rest = makeRest();
    const unreadable = [{ subject: 'No id or file here' }, { subject: 'Neither does this' }];
    const { deps } = syncDeps(SWEEP_HANDLERS(unreadable), rest.rest, clock);
    const summary = await runSync(deps);
    expect(summary.status).toBe('failed');
    expect(summary.papersFailed).toBe(2);
    expect(summary.errorSummary).toMatch(/no usable papers discovered/);
    expect(rest.upserts).toHaveLength(0);
  });

  it('reports a catalogue that lists no subjects as a failed run', async () => {
    const clock = fakeClock();
    const { deps } = syncDeps({
      [PAPERS_PATH]: () => ({ status: 200, body: papersEnvelope([]) }),
      [COURSE_LIST_PATH]: () => ({ status: 200, body: courseListEnvelope([]) }),
    }, makeRest().rest, clock);
    const summary = await runSync({ ...deps, budgetMs: 10, concurrency: 99 });
    expect(summary.status).toBe('failed');
    expect(summary.errorSummary).toMatch(/course-list returned 0 subjects/);
  });
});

// ---------------------------------------------------------------------------
// 7. Fingerprint identity — what decides "unchanged"
// ---------------------------------------------------------------------------

describe('identity and fingerprint', () => {
  it('ignores imported_at and first_seen_at so a re-run is not a change', async () => {
    const a = await normalisePaper(REAL_PAPER, '2026-09-20T00:00:00.000Z');
    const b = await normalisePaper(REAL_PAPER, '2027-01-01T00:00:00.000Z');
    expect(a!.imported_at).not.toBe(b!.imported_at);
    expect(identityOf(a!)).toBe(identityOf(b!));
    expect(await fingerprintOf(a!)).toBe(await fingerprintOf(b!));
  });

  it('notices a moved URL, because that is a different paper', async () => {
    const a = await normalisePaper(REAL_PAPER, 'now');
    const b = await normalisePaper({ ...REAL_PAPER, file_url: 'https://storage.googleapis.com/other.pdf' }, 'now');
    expect(await fingerprintOf(a!)).not.toBe(await fingerprintOf(b!));
  });

  it('is unambiguous between rows that differ only in nulls vs empty strings', async () => {
    const x = await normalisePaper({ _id: 'a', subject: 'S []', file_url: 'https://x.test/a.pdf' }, 'now');
    const y = await normalisePaper({ _id: 'a', subject: 'S', file_url: 'https://x.test/a.pdf' }, 'now');
    expect(identityOf(x!)).toBe(identityOf(y!)); // both: no code, title 'S'
    const z = await normalisePaper({ _id: 'a', subject: 'S [T1]', file_url: 'https://x.test/a.pdf' }, 'now');
    expect(identityOf(x!)).not.toBe(identityOf(z!));
  });

  it('hashes with the real WebCrypto implementation this runtime provides', async () => {
    const { sha256Hex } = await import('./sync.ts');
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

// ---------------------------------------------------------------------------
// 8. Who may start a run
// ---------------------------------------------------------------------------

describe('decideSyncAuth', () => {
  const serviceKey = 's'.repeat(40);
  const secret = 'k'.repeat(MIN_SECRET_LENGTH);

  it('accepts the platform service-role key', () => {
    expect(decideSyncAuth({ envSecret: null, provided: null, bearer: serviceKey, serviceKey }))
      .toEqual({ kind: 'authorized', via: 'service-key' });
  });

  it('compares the configured secret in a way that cannot leak by timing', () => {
    expect(decideSyncAuth({ envSecret: secret, provided: secret, bearer: null, serviceKey }).kind).toBe('authorized');
    expect(decideSyncAuth({ envSecret: secret, provided: secret.slice(0, -1) + 'x', bearer: null, serviceKey }).kind).toBe('denied');
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('abcd', 'abcd')).toBe(true);
  });

  it('treats a configured env secret as the only authority — no silent fallback', () => {
    const d = decideSyncAuth({ envSecret: secret, provided: 'wrong', bearer: null, serviceKey });
    expect(d).toEqual({ kind: 'denied', reason: 'Invalid or missing x-pyq-secret.' });
  });

  it('asks the database when only it holds the secret, and never fails open', () => {
    expect(decideSyncAuth({ envSecret: null, provided: secret, bearer: null, serviceKey }))
      .toEqual({ kind: 'ask-database', secret });
    expect(decideSyncAuth({ envSecret: null, provided: null, bearer: 'anon-jwt', serviceKey }).kind).toBe('denied');
  });
});

// ---------------------------------------------------------------------------
// 9. The operator-facing summary
// ---------------------------------------------------------------------------

describe('summarise', () => {
  it('cannot carry a payload or a newline out of the function', () => {
    const out = summarise(['line one\nline two', 'x'.repeat(400)]);
    expect(out).not.toMatch(/[\r\n]/);
    expect(out.length).toBeLessThanOrEqual(300);
  });

  it('keeps every short reason', () => {
    expect(summarise(['a', 'b'])).toBe('a; b');
  });
});

describe('UpstreamError', () => {
  it('classifies retryable failures apart from permanent ones', () => {
    const retryable = new UpstreamError('http', 'upstream returned 503', true, 503);
    const permanent = new UpstreamError('http', 'upstream returned 400', false, 400);
    expect([retryable.retryable, permanent.retryable]).toEqual([true, false]);
    expect(retryable.status).toBe(503);
    expect(retryable.name).toBe('UpstreamError');
  });
});
