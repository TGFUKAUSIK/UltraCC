/**
 * sync.ts — pure CodeChef-VIT PYQ import logic (no Deno APIs; upstream fetch,
 * the PostgREST client, the clock, the sleeper and the SHA-256 digest are all
 * injected). Used by index.ts (the Supabase Edge Function) and unit tests.
 *
 * WHAT UPSTREAM ACTUALLY OFFERS (verified against the live site and the
 * MIT-licensed github.com/CodeChefVIT/papers-codechef source):
 *   GET /api/course-list  ->  { status:'success', data:[{ _id, name }, …], message:'OK' }
 *       `name` is the whole subject string, "Title [CODE]". 648 entries as of
 *       this import, of which ~88 have no papers at all. No pagination exists.
 *   GET /api/papers?subject=<x>  ->  { status:'success', data:{ papers:[…],
 *       unique_years:[…], unique_slots:[…], unique_exams:[…],
 *       unique_campuses:[…], unique_semesters:[…] }, message:'OK' }
 *       `subject` is an unanchored, case-insensitive LITERAL substring match —
 *       not a regex: '?subject=[' returns 3,152 papers, '?subject=^' returns 0
 *       and '?subject=a{2,1}' returns 0, none of which an unescaped regex would
 *       do. A missing or empty subject yields 400; page/limit/campus/exam/
 *       year/slot/semester are ignored (there is no upstream filtering).
 *
 * THE SWEEP THAT REPLACED 648 REQUESTS: because the match is a substring and
 * every subject string contains a space, '?subject=%20' returns the WHOLE
 * archive — 3,154 papers in one 1.3 MB response ('[' is kept as a second
 * pattern in case a future subject has no space). So a normal run is three
 * upstream requests instead of one per subject, which is what makes an hourly
 * schedule bearable on someone else's infrastructure. The per-subject walk
 * below is the fallback for the day upstream starts validating the parameter.
 *
 * WHY THE FALLBACK QUERIES BY CODE, NOT BY THE FULL NAME: papers' stored
 * `subject` strings drift from the catalogue's spelling ("Electronic Devices
 * And Circuits [BECE205L]" is catalogued but no paper carries it verbatim,
 * while 14 carry the code). A code is the widest key that cannot be defeated by
 * a title variant, and it contains no metacharacter under either reading.
 *
 *   A document carries exactly: _id, subject, slot, year, exam, semester,
 *   campus, thumbnail_url, file_url, answer_key_included (plus sometimes __v
 *   and public_id_cloudinary). There is no difficulty, no tags, no separate
 *   title, no answer-key URL. normalisePaper() returns null instead of
 *   inventing any of those.
 *
 * RULES:
 *   - Never truncate, never delete-then-insert. A failed or partial run leaves
 *     the previously imported metadata exactly as it was; only the run row
 *     changes. There is no DELETE verb anywhere in this code path.
 *   - Upstream is a third party's public site: bounded concurrency (max 3),
 *     a delay between requests, exponential backoff on 5xx/network, a
 *     per-request AbortSignal.timeout, and an overall wall-clock budget so a
 *     scheduled run cannot outlive its invocation.
 *   - HTTPS-only for upstream. Error summaries are built from status codes and
 *     counts only — never from a response body.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FetchImpl = (url: string, init: RequestInit) => Promise<Response>;

export type RestMethod = 'GET' | 'POST';

export interface RestInit {
  method: RestMethod;
  body?: unknown;
}

/** PostgREST call, path-only (e.g. '/rest/v1/pyq_papers?on_conflict=…'). */
export type RestImpl = (path: string, init: RestInit) => Promise<Response>;

export type DigestFn = (data: Uint8Array) => Promise<Uint8Array>;

/** A paper document exactly as upstream sends it — nothing more is trusted. */
export interface RawPaper {
  _id?: unknown;
  subject?: unknown;
  slot?: unknown;
  year?: unknown;
  exam?: unknown;
  semester?: unknown;
  campus?: unknown;
  thumbnail_url?: unknown;
  file_url?: unknown;
  answer_key_included?: unknown;
  [key: string]: unknown;
}

/** One normalised pyq_papers row, fingerprint included. */
export interface PyqPaperRow {
  source: string;
  external_paper_id: string;
  course_code: string | null;
  course_title: string | null;
  exam_type: string | null;
  academic_year: string | null;
  semester: string | null;
  slot: string | null;
  campus: string | null;
  title: string | null;
  subject_raw: string | null;
  paper_url: string;
  /** Always null for this source: upstream publishes no key URL, only the boolean. */
  answer_key_url: null;
  answer_key_included: boolean | null;
  thumbnail_url: string | null;
  file_type: string | null;
  url_fingerprint: string;
  source_created_at: string | null;
  imported_at: string;
  /**
   * first_seen_at is deliberately NOT a field here: the importer must never
   * send it, so the column default stamps inserts only and a later update
   * cannot move a paper's first-seen date.
   */
}

export type RunStatus = 'complete' | 'partial' | 'failed';

/** Mirrors public.pyq_sync_runs, one-for-one. */
export interface SyncRunSummary {
  status: RunStatus;
  /** public.pyq_sync_runs.id written for this run, or null if it could not be recorded. */
  runId: number | null;
  /** True when another run already holds the single-flight claim. */
  busy: boolean;
  startedAt: string;
  finishedAt: string;
  subjectsEnumerated: number;
  subjectsFetched: number;
  papersDiscovered: number;
  papersInserted: number;
  papersUpdated: number;
  papersSkippedUnchanged: number;
  papersFailed: number;
  errorSummary: string | null;
}

export interface SyncDeps {
  /** Raw fetch against CodeChef-VIT. index.ts also pins HTTPS and a UA here. */
  fetchUpstream: FetchImpl;
  /** Authenticated PostgREST call using the service-role key. */
  rest: RestImpl;
  base?: string;
  concurrency?: number;
  delayMs?: number;
  requestTimeoutMs?: number;
  budgetMs?: number;
  attempts?: number;
  backoffBaseMs?: number;
  batchSize?: number;
  pageLimit?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  digest?: DigestFn;
  signalFor?: (ms: number) => AbortSignal | undefined;
  log?: (message: string) => void;
}

// ---------------------------------------------------------------------------
// Constants — the only upstream endpoints this module knows about.
// ---------------------------------------------------------------------------

export const CODECHEF_BASE = 'https://www.papers.codechefvit.com';
export const COURSE_LIST_PATH = '/api/course-list';
export const PAPERS_PATH = '/api/papers';

/**
 * Subject values that together cover the archive under the verified literal
 * substring match: every subject contains a space, and every bracketed subject
 * contains '['. Tried in order, results unioned by `_id`, so a future subject
 * with no space is still found and a future tightening of the parameter simply
 * moves the run to the per-subject fallback.
 */
export const SWEEP_PATTERNS = [' ', '['] as const;

/** Upsert target: conflicts resolve on the UNIQUE external_paper_id. */
export const UPSERT_PATH = '/rest/v1/pyq_papers?on_conflict=external_paper_id';

export const SYNC_DEFAULTS = {
  concurrency: 3,
  delayMs: 120,
  requestTimeoutMs: 15_000,
  /**
   * The per-subject fallback is ~648 upstream requests. Keep the budget under
   * the Edge Function's wall-clock timeout so the run reports 'partial' with
   * real numbers instead of being killed mid-batch.
   */
  budgetMs: 210_000,
  attempts: 3,
  backoffBaseMs: 500,
  batchSize: 200,
  /** PostgREST may cap a response at 1000 rows; page regardless of the role. */
  pageLimit: 1000,
};

/**
 * Minimum accepted PYQ_SYNC_SECRET length, matching the CHECK on
 * public.pyq_sync_config. A shorter configured value is treated as a
 * misconfiguration and refused rather than honoured: a guessable secret here
 * means anyone can make the app hammer a third party's site.
 */
export const MIN_SECRET_LENGTH = 32;

export class UpstreamError extends Error {
  readonly kind: 'insecure-url' | 'http' | 'network' | 'envelope' | 'shape' | 'budget';
  /** HTTP status, when the failure came from a response. */
  readonly status?: number;
  /** True when retrying could plausibly help (5xx, network, timeout). */
  readonly retryable: boolean;

  constructor(kind: UpstreamError['kind'], message: string, retryable = false, status?: number) {
    super(message);
    this.name = 'UpstreamError';
    this.kind = kind;
    this.retryable = retryable;
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Hashing — WebCrypto only, no dependencies.
// ---------------------------------------------------------------------------

export const webCryptoDigest: DigestFn = async (data) => {
  const subtle = (globalThis.crypto as Crypto | undefined)?.subtle;
  if (!subtle) throw new Error('WebCrypto subtle is unavailable in this runtime');
  const buffer = await subtle.digest('SHA-256', data);
  return new Uint8Array(buffer);
};

export async function sha256Hex(text: string, digest: DigestFn = webCryptoDigest): Promise<string> {
  const bytes = await digest(new TextEncoder().encode(text));
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

/**
 * The stable identity of a paper: everything the client filters or renders,
 * plus the URLs. Deliberately excludes imported_at (which changes every run)
 * and first_seen_at (which must never change).
 */
export function identityOf(row: PyqPaperRow): string {
  const fields: (string | null)[] = [
    row.external_paper_id,
    row.title,
    row.course_code,
    row.course_title,
    row.exam_type,
    row.academic_year,
    row.semester,
    row.slot,
    row.campus,
    row.paper_url,
    row.thumbnail_url,
    row.answer_key_url,
    row.answer_key_included === null ? null : String(row.answer_key_included),
    row.file_type,
  ];
  // \u0000 cannot occur in these strings, so the join is unambiguous.
  return fields.map((field) => (field === null ? '\u2205' : field)).join('\u0000');
}

export function fingerprintOf(row: PyqPaperRow, digest: DigestFn = webCryptoDigest): Promise<string> {
  return sha256Hex(identityOf(row), digest);
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

const BRACKET_TAIL = /^(.*?)\s*\[([^\]]+)\]$/;
/** A real catalogue entry whose code was never filled in upstream. */
const EMPTY_BRACKET_TAIL = /^(.*?)\s*\[\s*\]$/;

/**
 * "Probability And Statistics [BMAT202L]" ->
 *   { title: 'Probability And Statistics [BMAT202L]',
 *     course_code: 'BMAT202L', course_title: 'Probability And Statistics' }
 *
 * A subject with no bracketed tail keeps course_code NULL rather than guessing
 * one — a wrong code is worse than no code, because the client filters on it.
 * The code is uppercased so the client's exact `eq.` filter cannot be defeated
 * by upstream casing drift. An EMPTY bracket ("Intra and Interpersonal skills
 * []", three real records) is upstream's own gap: the placeholder comes off the
 * title and the code stays NULL, rather than being shown as a pair of brackets.
 */
export function splitSubject(rawSubject: string): {
  title: string | null;
  course_code: string | null;
  course_title: string | null;
} {
  const collapsed = rawSubject.replace(/\s+/g, ' ').trim();
  const match = BRACKET_TAIL.exec(collapsed);
  if (!match) {
    const empty = EMPTY_BRACKET_TAIL.exec(collapsed);
    if (!empty) {
      return { title: collapsed || null, course_code: null, course_title: collapsed || null };
    }
    const bare = (empty[1].trim() || collapsed) || null;
    return { title: bare, course_code: null, course_title: bare };
  }
  const titlePart = match[1].trim();
  const codePart = match[2].trim().toUpperCase();
  return {
    title: collapsed,
    course_code: codePart || null,
    course_title: titlePart || collapsed || null,
  };
}

/**
 * The value to send as `subject` for one catalogue entry.
 *
 * The bracketed code, when there is one: it is the widest key a paper can be
 * found under (title spellings drift between the catalogue and the stored
 * papers) and it contains no metacharacter, so it behaves the same whether
 * upstream treats `subject` as a literal or as a regex. Entries whose bracket
 * is empty ("Intra and Interpersonal skills []") have no code to offer, so the
 * whole name is the only thing left to search.
 */
export function queryKeyForSubject(subject: string): string {
  const split = splitSubject(subject);
  return split.course_code || (split.title || subject).trim();
}

/**
 * Repair the known double-scheme defect and enforce HTTPS.
 *
 * Record 68a4da38991f450b79fcb7c5 is published as
 *   https://storage.googleapis.com/…/papers/https://res.cloudinary.com/…/x.pdf
 * The outer URL 404s; the trailing Cloudinary URL is the live one. So when a
 * second absolute URL is embedded in the path, the LAST one wins.
 *
 * Returns null for anything that is not a single-scheme https URL afterwards —
 * including http:, javascript:, data: and relative paths. Callers drop the
 * paper rather than store a URL the app cannot honour.
 */
export function normaliseFileUrl(rawUrl: unknown): { url: string; repaired: boolean } | null {
  if (typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  let candidate = trimmed;
  let repaired = false;
  const schemes = [...trimmed.matchAll(/https?:\/\//gi)];
  if (schemes.length > 1) {
    const last = schemes[schemes.length - 1];
    candidate = trimmed.slice(last.index ?? 0).trim();
    repaired = true;
  }
  if (!/^https:\/\/[^\s/]+/i.test(candidate)) return null;
  // Reject a nested scheme that survived the repair (query-string smuggling).
  if (/https?:\/\//i.test(candidate.slice(8))) return null;
  return { url: candidate, repaired };
}

/**
 * Derive file_type from the URL suffix. Upstream sends no file type at all, so
 * this is a local derivation that only lets the client pick a viewer without
 * sniffing; it is NULL when the URL has no recognisable extension.
 */
export function deriveFileType(url: string): string | null {
  const clean = url.split('?')[0].split('#')[0];
  const match = /\.([a-z0-9]{1,8})$/i.exec(clean);
  return match ? match[1].toLowerCase() : null;
}

/**
 * A Mongo ObjectId's first 4 bytes are its creation seconds, so
 * source_created_at is DERIVED from `_id` — upstream sends no timestamp field.
 * Null for non-ObjectId ids and for implausible dates.
 */
export function objectIdDate(rawId: string): string | null {
  if (!/^[0-9a-f]{24}$/i.test(rawId)) return null;
  const seconds = Number.parseInt(rawId.slice(0, 8), 16);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const date = new Date(seconds * 1000);
  const year = date.getUTCFullYear();
  if (year < 2005 || year > 2100) return null;
  return date.toISOString();
}

function optionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

/** Thumbnails are optional; a non-HTTPS or repaired-once one is dropped. */
function normaliseThumbnail(value: unknown): string | null {
  const file = normaliseFileUrl(value);
  return file ? file.url : null;
}

/**
 * Turn one upstream document into a row, or return null.
 *
 * Null is the only acceptable answer for a document we cannot describe
 * honestly: no `_id` (nothing to dedupe on) or no usable HTTPS file_url (no
 * paper). Everything else is nullable and stays nullable — an absent `exam`
 * becomes NULL, never 'Unknown', because inventing a facet value would
 * fabricate a filter the client would then trust.
 */
export async function normalisePaper(
  raw: unknown,
  importedAt: string,
  digest: DigestFn = webCryptoDigest,
): Promise<PyqPaperRow | null> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const paper = raw as RawPaper;

  const externalId = optionalText(paper._id);
  if (!externalId) return null;

  const file = normaliseFileUrl(paper.file_url);
  if (!file) return null;

  const subject = optionalText(paper.subject);
  const split = subject
    ? splitSubject(subject)
    : { title: null, course_code: null, course_title: null };

  const row: PyqPaperRow = {
    source: 'codechef-vit',
    external_paper_id: externalId,
    course_code: split.course_code,
    course_title: split.course_title,
    exam_type: optionalText(paper.exam),
    academic_year: optionalText(paper.year),
    semester: optionalText(paper.semester),
    slot: optionalText(paper.slot),
    campus: optionalText(paper.campus),
    title: split.title,
    subject_raw: subject,
    paper_url: file.url,
    // No upstream answer-key URL exists. Explicit null, every time.
    answer_key_url: null,
    answer_key_included: typeof paper.answer_key_included === 'boolean' ? paper.answer_key_included : null,
    thumbnail_url: normaliseThumbnail(paper.thumbnail_url),
    file_type: deriveFileType(file.url),
    url_fingerprint: '',
    source_created_at: objectIdDate(externalId),
    imported_at: importedAt,
  };

  row.url_fingerprint = await fingerprintOf(row, digest);
  return row;
}

// ---------------------------------------------------------------------------
// Envelope parsing
// ---------------------------------------------------------------------------

interface Envelope {
  status?: unknown;
  data?: unknown;
  message?: unknown;
}

/** Unwrap { status, data, message }; an error envelope becomes an UpstreamError. */
function envelopeData(body: unknown, status: number): unknown {
  if (!body || typeof body !== 'object') {
    throw new UpstreamError('shape', `expected a JSON envelope, got ${body === null ? 'null' : typeof body}`, false, status);
  }
  const envelope = body as Envelope;
  if (envelope.status !== 'success') {
    // Only upstream's short human-readable message is kept, and only for the
    // operator-facing error summary — never a body.
    const message = typeof envelope.message === 'string' ? sanitizeMessage(envelope.message) : 'no message';
    const retryable = envelope.status === 'error' && status >= 500;
    throw new UpstreamError('envelope', `upstream reported an error (${message})`, retryable, status);
  }
  return envelope.data;
}

function sanitizeMessage(message: string): string {
  return message.replace(/[\r\n]+/g, ' ').slice(0, 80);
}

/**
 * course-list -> the subject strings to enumerate.
 * Shape: data is an array of { _id, name } documents (Course.find().lean()).
 */
export function extractCourseNames(body: unknown, status = 200): string[] {
  const data = envelopeData(body, status);
  if (!Array.isArray(data)) {
    throw new UpstreamError('shape', 'course-list data is not an array', false, status);
  }
  const names: string[] = [];
  for (const entry of data) {
    if (entry && typeof entry === 'object') {
      const name = (entry as { name?: unknown }).name;
      if (typeof name === 'string' && name.trim()) names.push(name.trim());
    }
  }
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

/**
 * papers -> the document array.
 * Shape: data is { papers:[…], unique_years:[…], unique_slots:[…],
 * unique_exams:[…], unique_campuses:[…], unique_semesters:[…] }.
 */
export function extractPapers(body: unknown, status = 200): RawPaper[] {
  const data = envelopeData(body, status);
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const papers = (data as { papers?: unknown }).papers;
    if (Array.isArray(papers)) return papers.filter((p): p is RawPaper => !!p && typeof p === 'object');
    throw new UpstreamError('shape', 'papers data has no papers array', false, status);
  }
  throw new UpstreamError('shape', 'papers data is not an object', false, status);
}

// ---------------------------------------------------------------------------
// URL safety
// ---------------------------------------------------------------------------

/**
 * HTTPS-only. Rejects anything that is not an absolute https URL before a
 * request is made, so a misconfigured base or a crafted subject can never turn
 * this function into a probe against http:// or an internal host. TLS
 * verification is never disabled anywhere in this module.
 */
export function httpsUrl(base: string, path: string, query?: Record<string, string>): string {
  let url: URL;
  try {
    url = new URL(path, base);
  } catch {
    throw new UpstreamError('insecure-url', 'upstream base is not a valid URL');
  }
  if (url.protocol !== 'https:') {
    throw new UpstreamError('insecure-url', `refusing non-HTTPS target (${url.protocol})`);
  }
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
    || host.endsWith('.internal') || host.endsWith('.local') || host.endsWith('.localhost')) {
    throw new UpstreamError('insecure-url', 'refusing internal target');
  }
  for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
  return url.toString();
}

/** Same guarantee for the Supabase URL the function talks to. */
export function assertHttpsBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('SUPABASE_URL is not a valid URL');
  }
  if (url.protocol !== 'https:') {
    throw new Error(`SUPABASE_URL must be https (got ${url.protocol})`);
  }
  return url.origin;
}

// ---------------------------------------------------------------------------
// Fetching with retry + budget
// ---------------------------------------------------------------------------

export interface FetchOptions {
  attempts: number;
  backoffBaseMs: number;
  timeoutMs: number;
  deadlineAt: number;
  signalFor?: (ms: number) => AbortSignal | undefined;
}

export interface FetchedJson {
  body: unknown;
  status: number;
}

const UPSTREAM_HEADERS = {
  Accept: 'application/json',
  // Identified, polite, and no personal data in it.
  'User-Agent': 'UltraCC-QBank-PYQ-indexer/1.0 (server-side metadata importer)',
};

/**
 * GET a JSON endpoint, retrying 5xx / network / timeout with exponential
 * backoff. A 4xx fails immediately — hammering a public site over a bad query
 * only makes it less likely to answer.
 */
export async function fetchJsonWithRetry(
  url: string,
  deps: Pick<SyncDeps, 'fetchUpstream' | 'now' | 'sleep'>,
  options: FetchOptions,
): Promise<FetchedJson> {
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? (async (ms: number) => { await new Promise<void>((r) => setTimeout(r, ms)); });
  const signalFor = options.signalFor ?? ((ms: number) => AbortSignal.timeout(ms));

  let lastError: UpstreamError | null = null;
  for (let attempt = 1; attempt <= options.attempts; attempt++) {
    const remaining = options.deadlineAt - now();
    if (remaining <= 0) {
      throw new UpstreamError('budget', lastError ? `time budget exhausted (after ${lastError.kind})` : 'time budget exhausted');
    }
    const timeoutMs = Math.max(500, Math.min(options.timeoutMs, remaining));
    try {
      const response = await deps.fetchUpstream(url, {
        method: 'GET',
        headers: UPSTREAM_HEADERS,
        redirect: 'error',
        signal: signalFor(timeoutMs),
      });

      if (response.status >= 500) {
        lastError = new UpstreamError('http', `upstream returned ${response.status}`, true, response.status);
      } else if (!response.ok) {
        throw new UpstreamError('http', `upstream returned ${response.status}`, false, response.status);
      } else {
        return { body: await response.json(), status: response.status };
      }
    } catch (error) {
      if (error instanceof UpstreamError) {
        if (!error.retryable) throw error;
        lastError = error;
      } else {
        // fetch rejection: DNS, TLS handshake, abort/timeout. All retried.
        // A TLS failure surfaces here — verification is never disabled to get
        // around one, the run simply ends 'partial'/'failed' and says so.
        lastError = new UpstreamError('network', `request failed (${error instanceof Error ? error.name : 'unknown'})`, true);
      }
    }

    if (attempt < options.attempts) {
      const backoff = options.backoffBaseMs * 2 ** (attempt - 1);
      if (options.deadlineAt - now() <= backoff) break; // no time to retry honestly
      await sleep(backoff);
    }
  }

  throw lastError ?? new UpstreamError('network', 'request failed');
}

/**
 * Rotate the enumeration start so consecutive runs sweep a different slice.
 *
 * A single pass may not finish inside the wall-clock budget; walking the same
 * alphabetical prefix every time would then starve the tail forever. Rotating
 * by hour reaches every subject within a day of hourly runs, and rotation
 * cannot change the result — rows are upserted by external_paper_id.
 */
export function rotateSubjects<T>(subjects: T[], nowMs: number, periodMs = 3_600_000): T[] {
  if (subjects.length <= 1) return [...subjects];
  const offset = Math.abs(Math.floor(nowMs / periodMs)) % subjects.length;
  return [...subjects.slice(offset), ...subjects.slice(0, offset)];
}

export interface GatherOptions {
  concurrency: number;
  delayMs: number;
  attempts: number;
  timeoutMs: number;
  deadlineAt: number;
}

export interface GatherResult {
  raw: RawPaper[];
  fetched: number;
  failures: string[];
  /** Peak simultaneous requests actually observed — asserted in the tests. */
  inFlightPeak: number;
  budgetStopped: boolean;
}

/** Bounded-concurrency walk over subjects; never more than `concurrency` in flight. */
export async function gatherPapers(subjects: string[], deps: SyncDeps, options: GatherOptions): Promise<GatherResult> {
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? (async (ms: number) => { await new Promise<void>((r) => setTimeout(r, ms)); });
  const base = deps.base ?? CODECHEF_BASE;
  const fetchOptions: FetchOptions = {
    attempts: options.attempts,
    backoffBaseMs: deps.backoffBaseMs ?? SYNC_DEFAULTS.backoffBaseMs,
    timeoutMs: options.timeoutMs,
    deadlineAt: options.deadlineAt,
    signalFor: deps.signalFor,
  };

  const raw: RawPaper[] = [];
  const failures: string[] = [];
  let cursor = 0;
  let inFlight = 0;
  let inFlightPeak = 0;
  let fetched = 0;
  let budgetStopped = false;

  const workerCount = Math.min(Math.max(1, options.concurrency), Math.max(1, subjects.length));
  const worker = async (): Promise<void> => {
    for (;;) {
      if (options.deadlineAt - now() <= 0) {
        budgetStopped = true;
        return;
      }
      const index = cursor++;
      if (index >= subjects.length) return;
      const subject = subjects[index];

      inFlight++;
      inFlightPeak = Math.max(inFlightPeak, inFlight);
      try {
        // The code, not the catalogue's full name — see queryKeyForSubject().
        const url = httpsUrl(base, PAPERS_PATH, { subject: queryKeyForSubject(subject) });
        const { body, status } = await fetchJsonWithRetry(url, deps, fetchOptions);
        raw.push(...extractPapers(body, status));
        fetched++;
      } catch (error) {
        if (error instanceof UpstreamError && error.kind === 'budget') budgetStopped = true;
        failures.push(`${subject} (${describeError(error)})`);
      } finally {
        inFlight--;
      }

      // Be a considerate guest on someone else's infrastructure.
      if (cursor < subjects.length && options.delayMs > 0) await sleep(options.delayMs);
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return { raw, fetched, failures, inFlightPeak, budgetStopped };
}

// ---------------------------------------------------------------------------
// The sweep — the whole archive in as few requests as upstream allows
// ---------------------------------------------------------------------------

export interface SweepResult {
  /** Union of every pattern's papers, deduped by `_id`. */
  raw: RawPaper[];
  /** How many patterns answered with at least one paper. */
  patternsAnswered: number;
  /**
   * True when the FIRST pattern (a space) yielded papers. If only the safety
   * net answered, upstream's matching has narrowed and the sweep can no longer
   * claim completeness — the caller must enumerate per subject instead.
   */
  primaryAnswered: boolean;
  failures: string[];
  budgetStopped: boolean;
}

/**
 * Fetch the archive with SWEEP_PATTERNS rather than one request per subject.
 *
 * WHY THIS IS THE PRIMARY PATH: `subject` is a literal substring match and
 * every subject string upstream holds contains a space, so '?subject=%20'
 * returns all 3,154 records in a single 1.3 MB response. A per-subject walk
 * needs ~648 requests against a third party's site for the same rows, and at
 * the polite delay this function is designed to keep it could not finish
 * inside one invocation anyway. Two patterns are tried (' ' then '[') so a
 * subject that somehow has no space is still swept: today the second response
 * is a subset of the first, and unioning them by `_id` costs one request.
 *
 * It never raises on a partial failure: an empty or failed sweep is the
 * caller's signal to run the per-subject enumeration, and a total upstream
 * outage is reported as such.
 */
export async function sweepPapers(
  deps: SyncDeps,
  options: GatherOptions & { patterns?: readonly string[] },
): Promise<SweepResult> {
  const base = deps.base ?? CODECHEF_BASE;
  const patterns = options.patterns ?? SWEEP_PATTERNS;
  const fetchOptions: FetchOptions = {
    attempts: options.attempts,
    backoffBaseMs: deps.backoffBaseMs ?? SYNC_DEFAULTS.backoffBaseMs,
    timeoutMs: options.timeoutMs,
    deadlineAt: options.deadlineAt,
    signalFor: deps.signalFor,
  };
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? (async (ms: number) => { await new Promise<void>((r) => setTimeout(r, ms)); });

  const byId = new Map<string, RawPaper>();
  // Records with no usable `_id` cannot be deduped by identity, so they are
  // deduped by content: the same broken row answers both patterns, and counting
  // it twice would double-count the failure it reports.
  const anonymousSeen = new Set<string>();
  const anonymous: RawPaper[] = [];
  const failures: string[] = [];
  let patternsAnswered = 0;
  let primaryAnswered = false;
  let budgetStopped = false;

  for (const [index, pattern] of patterns.entries()) {
    if (options.deadlineAt - now() <= 0) {
      budgetStopped = true;
      break;
    }
    try {
      const url = httpsUrl(base, PAPERS_PATH, { subject: pattern });
      const { body, status } = await fetchJsonWithRetry(url, deps, fetchOptions);
      const papers = extractPapers(body, status);
      if (papers.length > 0) patternsAnswered++;
      // The completeness tripwire is about the FIRST pattern specifically: a
      // space matches every subject today, and if it stops matching while '['
      // still answers, upstream's matching has changed shape.
      if (index === 0 && papers.length > 0) primaryAnswered = true;
      for (const paper of papers) {
        const id = typeof paper._id === 'string' && paper._id.trim() ? paper._id : null;
        // No id to dedupe on: keep it once, so normalisePaper() rejects it
        // visibly as a failure instead of each pattern adding it again.
        if (id === null) {
          const key = stableStringify(paper);
          if (anonymousSeen.has(key)) continue;
          anonymousSeen.add(key);
          anonymous.push(paper);
          continue;
        }
        if (!byId.has(id)) byId.set(id, paper);
      }
    } catch (error) {
      if (error instanceof UpstreamError && error.kind === 'budget') budgetStopped = true;
      failures.push(`sweep ${describePattern(pattern)} failed (${describeError(error)})`);
    }
    // A second pattern is a safety net, not a load source: still be polite.
    if (patterns.length > 1) await sleep(Math.max(options.delayMs, 200));
  }

  const merged = [...byId.values(), ...anonymous];
  return { raw: merged, patternsAnswered, primaryAnswered, failures, budgetStopped };
}

/** The pattern as it can be logged: quoted, so a bare space stays visible. */
function describePattern(pattern: string): string {
  return JSON.stringify(pattern);
}

/**
 * A content key for a record that has no usable `_id`, so repeating patterns
 * cannot count the same broken paper twice. Keys are sorted because JSON key
 * order is not contractual — the same row may arrive with its fields permuted.
 * Undefined values and non-plain members (neither occurs upstream) fall out of
 * the sort rather than throwing: this only ever dedupes, it never validates.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

// ---------------------------------------------------------------------------
// Postgres side
// ---------------------------------------------------------------------------

/** Every already-stored fingerprint, paged so a role row cap cannot truncate it. */
export async function loadFingerprints(deps: SyncDeps, pageLimit: number, deadlineAt: number): Promise<Map<string, string>> {
  const now = deps.now ?? (() => Date.now());
  const known = new Map<string, string>();
  let afterId = 0;
  for (;;) {
    if (deadlineAt - now() <= 0) {
      throw new UpstreamError('budget', 'time budget exhausted while reading existing fingerprints');
    }
    const path =
      `/rest/v1/pyq_papers?select=id,external_paper_id,url_fingerprint` +
      `&id=gt.${afterId}&order=id.asc&limit=${pageLimit}`;
    const response = await deps.rest(path, { method: 'GET' });
    if (!response.ok) {
      throw new UpstreamError('http', `could not read existing fingerprints (${response.status})`, false, response.status);
    }
    const rows = (await response.json()) as { id?: number; external_paper_id?: string; url_fingerprint?: string | null }[];
    if (!Array.isArray(rows) || rows.length === 0) return known;
    for (const row of rows) {
      if (row && typeof row.external_paper_id === 'string' && typeof row.url_fingerprint === 'string') {
        known.set(row.external_paper_id, row.url_fingerprint);
      }
    }
    const lastId = Number(rows[rows.length - 1]?.id ?? 0);
    if (!Number.isFinite(lastId) || lastId <= afterId) return known; // no forward progress -> stop
    afterId = lastId;
    if (rows.length < pageLimit) return known;
  }
}

export function chunk<T>(items: T[], size: number): T[][] {
  const safe = Math.max(1, Math.floor(size));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += safe) out.push(items.slice(i, i + safe));
  return out;
}

/**
 * Upsert one batch keyed on external_paper_id. `first_seen_at` is not in the
 * payload by construction, so an existing row keeps its original first-seen
 * date; `imported_at` is, so a touched row shows when it changed.
 */
export async function upsertBatch(deps: SyncDeps, rows: PyqPaperRow[]): Promise<void> {
  const response = await deps.rest(UPSERT_PATH, { method: 'POST', body: rows });
  if (!response.ok) {
    throw new UpstreamError('http', `upsert batch rejected (${response.status})`, false, response.status);
  }
}

/**
 * Length check + full mismatch scan, so a compare cannot leak by timing.
 * Same helper shape as push-dispatch/auth.ts.
 */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type SyncAuthDecision =
  | { kind: 'authorized'; via: 'service-key' | 'env-secret' | 'db-secret' }
  | { kind: 'denied'; reason: string }
  /** public.pyq_sync_config holds the authority; ask it before rejecting. */
  | { kind: 'ask-database'; secret: string };

export interface SyncAuthInput {
  /** PYQ_SYNC_SECRET from the function environment, when the operator set one. */
  envSecret: string | null;
  /** x-pyq-secret header, or the ?secret= query param, whichever was sent. */
  provided: string | null;
  /** The Authorization: Bearer value as sent, if any. */
  bearer: string | null;
  /** SUPABASE_SERVICE_ROLE_KEY from the environment. */
  serviceKey: string;
}

/**
 * Who may start an import.
 *
 * An import rewrites a public table, and on the per-subject path it is ~648
 * requests against a third party's public site, so an anonymous caller must
 * never be able to trigger it — and there is no configuration that makes an
 * unauthenticated call succeed.
 *
 *   1. The platform service-role key (dashboard / manual run). Always accepted.
 *   2. PYQ_SYNC_SECRET in the function environment — timing-safe compare, and
 *      when it is configured it is the ONLY authority, so a mismatch is a
 *      denial rather than a silent fallback (two sources of truth that disagree
 *      is a misconfiguration worth failing loudly on).
 *   3. No environment secret: the secret held in public.pyq_sync_config decides,
 *      via authorize_pyq_sync(). The value therefore never has to appear in this
 *      function's environment, in the repository or in a log — and the row is
 *      unreadable by anon, so a wrong guess comes back as a plain false.
 *
 * Configured nowhere, the answer is always 'denied': it never fails open, and a
 * wrong secret is a 401 that leaks nothing.
 */
export function decideSyncAuth(input: SyncAuthInput): SyncAuthDecision {
  const { envSecret, provided, bearer, serviceKey } = input;

  // 1. Platform trust.
  if (bearer && serviceKey && safeEqual(bearer, serviceKey)) {
    return { kind: 'authorized', via: 'service-key' };
  }

  // 2. Operator-configured shared secret.
  if (envSecret) {
    if (provided && safeEqual(provided, envSecret)) return { kind: 'authorized', via: 'env-secret' };
    return { kind: 'denied', reason: 'Invalid or missing x-pyq-secret.' };
  }

  // 3. Database-held secret, and nothing else. No secret at all means no way in.
  if (!provided) return { kind: 'denied', reason: 'Missing x-pyq-secret header (or ?secret= query parameter).' };
  return { kind: 'ask-database', secret: provided };
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

export async function runSync(deps: SyncDeps): Promise<SyncRunSummary> {
  const now = deps.now ?? (() => Date.now());
  const digest = deps.digest ?? webCryptoDigest;
  const base = deps.base ?? CODECHEF_BASE;
  const log = deps.log ?? (() => undefined);

  // Bounded, always: a caller cannot raise concurrency past 3.
  const concurrency = clamp(deps.concurrency ?? SYNC_DEFAULTS.concurrency, 1, SYNC_DEFAULTS.concurrency);
  const delayMs = clamp(deps.delayMs ?? SYNC_DEFAULTS.delayMs, 0, 5_000);
  const attempts = clamp(deps.attempts ?? SYNC_DEFAULTS.attempts, 1, 5);
  const timeoutMs = clamp(deps.requestTimeoutMs ?? SYNC_DEFAULTS.requestTimeoutMs, 500, 60_000);
  const batchSize = clamp(deps.batchSize ?? SYNC_DEFAULTS.batchSize, 1, 500);
  const pageLimit = clamp(deps.pageLimit ?? SYNC_DEFAULTS.pageLimit, 1, 1000);
  const budgetMs = clamp(deps.budgetMs ?? SYNC_DEFAULTS.budgetMs, 5_000, 900_000);

  const startMs = now();
  const startedAt = new Date(startMs).toISOString();
  const deadlineAt = startMs + budgetMs;
  const reasons: string[] = [];

  const counters = {
    subjectsEnumerated: 0,
    subjectsFetched: 0,
    papersDiscovered: 0,
    papersInserted: 0,
    papersUpdated: 0,
    papersSkippedUnchanged: 0,
    papersFailed: 0,
  };

  const emptySummary = (status: RunStatus, busy: boolean, runId: number | null): SyncRunSummary => ({
    status,
    runId,
    busy,
    startedAt,
    finishedAt: new Date(now()).toISOString(),
    errorSummary: reasons.length ? summarise(reasons) : null,
    ...counters,
  });

  // --- 0. Claim the run (single-flight) -----------------------------------
  let runId: number | null = null;
  let claimSucceeded = false;
  try {
    const claim = await deps.rest('/rest/v1/rpc/pyq_sync_begin', { method: 'POST', body: {} });
    if (claim.ok) {
      claimSucceeded = true;
      const value = await claim.json();
      runId = typeof value === 'number' && Number.isFinite(value) ? value : null;
    } else {
      reasons.push(`could not record the run (${claim.status})`);
    }
  } catch (error) {
    reasons.push(`could not record the run (${error instanceof Error ? error.name : 'unknown'})`);
  }
  if (claimSucceeded && runId === null) {
    // pyq_sync_begin() returned NULL: another run owns the claim. Touch nothing.
    return emptySummary('failed', true, null);
  }

  const finish = async (status: RunStatus): Promise<SyncRunSummary> => {
    const errorSummary = reasons.length ? summarise(reasons) : null;
    try {
      const response = await deps.rest('/rest/v1/rpc/pyq_sync_finish', {
        method: 'POST',
        body: {
          p_run_id: runId,
          p_status: status,
          p_subjects_enumerated: counters.subjectsEnumerated,
          p_subjects_fetched: counters.subjectsFetched,
          p_papers_discovered: counters.papersDiscovered,
          p_papers_inserted: counters.papersInserted,
          p_papers_updated: counters.papersUpdated,
          p_papers_skipped_unchanged: counters.papersSkippedUnchanged,
          p_papers_failed: counters.papersFailed,
          p_error_summary: errorSummary,
        },
      });
      if (!response.ok) log(`pyq_sync_finish rejected (${response.status})`);
    } catch (error) {
      log(`pyq_sync_finish unreachable (${error instanceof Error ? error.name : 'unknown'})`);
    }
    return { ...emptySummary(status, false, runId), errorSummary };
  };

  // --- 1. Sweep the archive: as few upstream requests as it allows --------
  const sweep = await sweepPapers(deps, { concurrency, delayMs, attempts, timeoutMs, deadlineAt });
  // The subjects actually present in what came back. In sweep mode this is the
  // only subject census available, and it is the honest one: it counts the
  // subjects that HAVE papers rather than the catalogue's 648 entries.
  const subjectsSeen = new Set<string>();
  for (const paper of sweep.raw) {
    if (typeof paper.subject === 'string' && paper.subject.trim()) subjectsSeen.add(paper.subject.trim());
  }
  let raw: RawPaper[] = sweep.raw;
  for (const failure of sweep.failures) reasons.push(failure);

  if (sweep.raw.length > 0 && sweep.primaryAnswered) {
    counters.subjectsEnumerated = subjectsSeen.size;
    counters.subjectsFetched = subjectsSeen.size;
  } else {
    // Either nothing came back (upstream changed the parameter's meaning or is
    // down) or only the safety-net pattern answered, which means a subject with
    // no space exists and the sweep can no longer claim to be complete. In both
    // cases walk the catalogue instead of importing a silently partial archive.
    if (sweep.raw.length > 0) {
      reasons.push('the broad sweep no longer matches every subject; enumerated per subject instead');
    }
    log(`sweep unusable (${sweep.raw.length} papers, primary ${sweep.primaryAnswered}) — enumerating`);

    // --- 1b. Enumerate the catalogue --------------------------------------
    let subjects: string[];
    try {
      const { body, status } = await fetchJsonWithRetry(httpsUrl(base, COURSE_LIST_PATH), deps, {
        attempts,
        backoffBaseMs: deps.backoffBaseMs ?? SYNC_DEFAULTS.backoffBaseMs,
        timeoutMs,
        deadlineAt,
        signalFor: deps.signalFor,
      });
      subjects = extractCourseNames(body, status);
    } catch (error) {
      // Nothing was read and nothing was written: the archive stays as it is.
      reasons.push(`course-list failed (${describeError(error)})`);
      log(reasons[reasons.length - 1]);
      return finish('failed');
    }

    counters.subjectsEnumerated = subjects.length;
    if (subjects.length === 0) {
      reasons.push('course-list returned 0 subjects');
      return finish('failed');
    }

    // --- 1c. Fetch every subject, bounded ---------------------------------
    const queue = rotateSubjects(subjects, startMs);
    const gathered = await gatherPapers(queue, deps, { concurrency, delayMs, attempts, timeoutMs, deadlineAt });
    raw = gathered.raw;
    counters.subjectsFetched = gathered.fetched;

    if (gathered.budgetStopped) {
      reasons.push(`time budget reached after ${gathered.fetched}/${queue.length} subjects`);
    } else if (gathered.failures.length) {
      reasons.push(`${gathered.failures.length} subject fetches failed (e.g. ${gathered.failures[0]})`);
    } else if (gathered.fetched < queue.length) {
      reasons.push(`only ${gathered.fetched}/${queue.length} subjects were fetched`);
    }
  }

  // --- 2. Existing fingerprints (so unchanged rows are not rewritten) -----
  let known: Map<string, string>;
  try {
    known = await loadFingerprints(deps, pageLimit, deadlineAt);
  } catch (error) {
    reasons.push(`fingerprint read failed (${describeError(error)})`);
    return finish('failed');
  }

  // --- 3. Normalise + dedupe by _id ---------------------------------------
  const byId = new Map<string, PyqPaperRow>();
  let repairedUrls = 0;
  for (const paper of raw) {
    let row: PyqPaperRow | null;
    try {
      row = await normalisePaper(paper, startedAt, digest);
    } catch {
      row = null;
    }
    if (!row) {
      counters.papersFailed++;
      continue;
    }
    if (typeof paper.file_url === 'string' && paper.file_url.trim() !== row.paper_url) repairedUrls++;
    // A substring query can hand back the same paper twice, and a subject query
    // can carry papers belonging to other subjects. `_id` decides.
    if (!byId.has(row.external_paper_id)) byId.set(row.external_paper_id, row);
  }
  counters.papersDiscovered = byId.size;
  if (repairedUrls > 0) log(`repaired ${repairedUrls} malformed file_url record(s)`);

  if (byId.size === 0) {
    reasons.push('no usable papers discovered');
    return finish('failed');
  }

  // --- 4. Skip unchanged, upsert the rest ---------------------------------
  const changed: PyqPaperRow[] = [];
  for (const row of byId.values()) {
    if (known.get(row.external_paper_id) === row.url_fingerprint) {
      counters.papersSkippedUnchanged++;
      continue;
    }
    changed.push(row);
  }

  for (const batch of chunk(changed, batchSize)) {
    if (deadlineAt - now() <= 0) {
      counters.papersFailed += batch.length;
      reasons.push('time budget reached before all batches were written');
      continue;
    }
    try {
      await upsertBatch(deps, batch);
      for (const row of batch) {
        if (known.has(row.external_paper_id)) counters.papersUpdated++;
        else counters.papersInserted++;
      }
    } catch (error) {
      counters.papersFailed += batch.length;
      reasons.push(`upsert batch rejected (${describeError(error)})`);
      log(reasons[reasons.length - 1]);
    }
  }

  // Every upstream or write problem was pushed into `reasons` as it happened,
  // so an empty list here is what 'complete' means: all requests answered and
  // every discovered row landed.
  return finish(reasons.length > 0 || counters.papersFailed > 0 ? 'partial' : 'complete');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function describeError(error: unknown): string {
  if (error instanceof UpstreamError) {
    return `${error.kind}${typeof error.status === 'number' ? ` ${error.status}` : ''}`;
  }
  return error instanceof Error ? error.name : 'unknown';
}

/** Cap the summary and strip newlines so it can never smuggle a payload. */
export function summarise(reasons: string[]): string {
  return reasons
    .map((reason) => String(reason).replace(/[\r\n]+/g, ' ').slice(0, 120))
    .join('; ')
    .slice(0, 300);
}
