/**
 * publicApi.ts — anonymous Supabase reads for the mobile app: the event hub and
 * the previous-year-paper (PYQ) archive. No student identity, no session, no
 * credentials are sent — the public anon key is all these endpoints accept.
 */

import { SUPABASE_URL, anonHeaders } from '../config';
import type { ArchivePaper, HubEvent } from '../types';

const EVENT_HUB_URL = `${SUPABASE_URL}/functions/v1/event-hub`;
const FACULTY_URL = `${SUPABASE_URL}/functions/v1/faculty-directory`;

export async function fetchEvents(): Promise<HubEvent[]> {
  const res = await fetch(EVENT_HUB_URL, { headers: anonHeaders() });
  if (!res.ok) throw new Error('The event hub is temporarily unavailable. Try again in a moment.');
  // The event-hub edge function returns an envelope { success, events, syncedAt },
  // exactly as the web app reads it — not a bare array.
  const data = (await res.json()) as { success?: boolean; events?: HubEvent[] } | HubEvent[];
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object' && data.success === false) {
    throw new Error('The event hub is temporarily unavailable. Try again in a moment.');
  }
  return (data && typeof data === 'object' ? data.events ?? [] : []);
}

export async function fetchFaculty(): Promise<unknown[]> {
  const res = await fetch(FACULTY_URL, { headers: anonHeaders() });
  if (!res.ok) throw new Error('The faculty directory is temporarily unavailable. Try again in a moment.');
  const data = (await res.json()) as unknown;
  return Array.isArray(data) ? (data as unknown[]) : [];
}

// ---------------------------------------------------------------------------
// PYQ archive (public.pyq_papers via PostgREST)
// ---------------------------------------------------------------------------

const PAPER_COLUMNS = [
  'id', 'external_paper_id', 'course_code', 'course_title', 'title',
  'exam_type', 'academic_year', 'semester', 'slot', 'campus',
  'paper_url', 'answer_key_url', 'answer_key_included', 'thumbnail_url',
  'file_type', 'source_created_at', 'imported_at',
].join(',');

export const ARCHIVE_PAGE_SIZE = 40;

function sanitizeSearchTerm(raw: string): string {
  return raw.replace(/[,()*"\\]/g, ' ').replace(/\s+/g, ' ').trim();
}

function isArchivePaper(value: unknown): value is ArchivePaper {
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

export interface PyqPage {
  papers: ArchivePaper[];
  hasMore: boolean;
  total: number | null;
}

export interface PyqQuery {
  search?: string;
  courseCode?: string;
  examType?: string;
  year?: string;
  semester?: string;
  slot?: string;
  campus?: string;
  offset?: number;
  limit?: number;
}

export async function fetchPyqPage(q: PyqQuery = {}): Promise<PyqPage> {
  const params = new URLSearchParams();
  params.set('select', PAPER_COLUMNS);

  const term = sanitizeSearchTerm(q.search || '');
  if (term.length >= 2) {
    params.set('or', `(course_code.ilike.*${term}*,course_title.ilike.*${term}*,title.ilike.*${term}*)`);
  }
  if (q.courseCode?.trim()) params.set('course_code', `eq.${q.courseCode.trim().toUpperCase()}`);
  if (q.examType?.trim()) params.set('exam_type', `eq.${q.examType.trim()}`);
  if (q.year?.trim()) params.set('academic_year', `eq.${q.year.trim()}`);
  if (q.semester?.trim()) params.set('semester', `eq.${q.semester.trim()}`);
  if (q.slot?.trim()) params.set('slot', `eq.${q.slot.trim()}`);
  if (q.campus?.trim()) params.set('campus', `eq.${q.campus.trim()}`);

  params.set('order', 'source_created_at.desc.nullslast');
  const limit = Math.max(1, Math.min(Math.trunc(q.limit ?? ARCHIVE_PAGE_SIZE), 200));
  params.set('limit', String(limit));
  params.set('offset', String(Math.max(0, Math.trunc(q.offset ?? 0))));

  const res = await fetch(`${SUPABASE_URL}/rest/v1/pyq_papers?${params.toString()}`, {
    headers: anonHeaders({ Prefer: 'count=exact' }),
  });
  if (!res.ok) throw new Error('Could not load the question-paper archive.');

  const rows = (await res.json().catch((): unknown[] => [])) as unknown;
  const papers = Array.isArray(rows) ? rows.filter(isArchivePaper) : [];
  const total = readTotal(res.headers.get('content-range'), papers.length);
  const loaded = (q.offset ?? 0) + papers.length;
  return { papers, total, hasMore: total === null ? papers.length >= limit : loaded < total };
}

function readTotal(header: string | null, returned: number): number | null {
  if (!header) return null;
  const total = Number(header.split('/')[1]?.trim());
  if (!Number.isFinite(total) || total < 0) return null;
  return Math.max(total, returned);
}

/** Distinct course codes, newest first — for the course-picker screen. */
export async function fetchPyqCourses(): Promise<string[]> {
  const params = new URLSearchParams();
  params.set('select', 'course_code');
  params.set('order', 'course_code.asc');
  params.set('limit', '1000');
  const res = await fetch(`${SUPABASE_URL}/rest/v1/pyq_papers?${params.toString()}`, {
    headers: anonHeaders(),
  });
  if (!res.ok) return [];
  const rows = (await res.json().catch((): unknown[] => [])) as unknown;
  if (!Array.isArray(rows)) return [];
  return Array.from(new Set(rows.map((r) => (r as { course_code?: string }).course_code ?? '').map((c) => c.trim().toUpperCase()).filter(Boolean))).sort();
}
