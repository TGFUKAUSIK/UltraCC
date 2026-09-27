/**
 * supabaseCommunity.ts — tiny Supabase REST helpers for the community
 * features (cab-share rides + question-paper bank).
 *
 * These tables are public-read / anonymous-write by design (see
 * supabase/migrations/20260813000002_cabshare_qbank.sql). No student
 * identity, VTOP data, or credentials are ever sent here — only the
 * community content the student chooses to post.
 *
 * The anon key is the public client key (same one GradePredictor uses);
 * it is safe to embed for anonymous-only access.
 */

import { classifyPhoneBackendFailure, RIDE_BOARD_BACKEND_MESSAGE } from './phoneIdentity';
import { SUPABASE_URL, SUPABASE_ANON_KEY, backendHeaders } from './communityBackend';

const ANON_KEY = SUPABASE_ANON_KEY;

function headers(extra?: Record<string, string>): Record<string, string> {
  return backendHeaders(extra);
}

// ---------------------------------------------------------------------------
// Cab-share rides
// ---------------------------------------------------------------------------

export interface CabRide {
  id: number;
  from_place: string;
  to_place: string;
  travel_date: string;
  travel_time: string;
  seats: number;
  seats_left: number;
  notes: string;
  contact: string;
  participant_count?: number;
  created_at: string;
}

/** Generate a short capability code the poster keeps to edit/delete. */
export function makePosterCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  const arr = new Uint8Array(8);
  crypto.getRandomValues(arr);
  for (const b of arr) out += chars[b % chars.length];
  return out;
}

export async function fetchCabRides(): Promise<CabRide[]> {
  let res = await fetch(
    `${SUPABASE_URL}/rest/v1/cabshare_rides?select=id,from_place,to_place,travel_date,travel_time,seats,seats_left,participant_count,notes,contact,created_at&order=travel_date.asc,travel_time.asc&limit=100`,
    { headers: headers() }
  );
  // Keep the public board readable on projects that have not applied the
  // participant-count migration yet. The response still contains every
  // original ride field; the UI derives a legacy participant count.
  if (!res.ok && (res.status === 400 || res.status === 404)) {
    res = await fetch(
      `${SUPABASE_URL}/rest/v1/cabshare_rides?select=id,from_place,to_place,travel_date,travel_time,seats,seats_left,notes,contact,created_at&order=travel_date.asc,travel_time.asc&limit=100`,
      { headers: headers() }
    );
  }
  if (!res.ok) throw new Error('Could not reach the cab-share board');
  return res.json();
}

/**
 * Subscribe to row changes for the public ride board. The REST refresh remains
 * the source of truth; Realtime only tells the UI when to refetch. This keeps
 * deletes, RPC seat changes and older deployments consistent as well.
 */
export function subscribeToCabRides(
  onChange: () => void,
  onStatus?: (status: 'connecting' | 'live' | 'fallback') => void,
): () => void {
  if (typeof WebSocket === 'undefined') {
    onStatus?.('fallback');
    return () => undefined;
  }

  const topic = 'realtime:public:cabshare_rides';
  const endpoint = `${SUPABASE_URL.replace(/^http/, 'ws')}/realtime/v1/websocket?apikey=${encodeURIComponent(ANON_KEY)}&vsn=1.0.0`;
  const socket = new WebSocket(endpoint);
  let ref = 0;
  let heartbeat: number | undefined;
  let stopped = false;
  onStatus?.('connecting');

  const send = (event: string, payload: Record<string, unknown>, channel = topic) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ topic: channel, event, payload, ref: String(++ref) }));
  };

  socket.addEventListener('open', () => {
    if (stopped) return;
    send('phx_join', {
      config: {
        broadcast: { self: false },
        presence: { key: '' },
        postgres_changes: [{ event: '*', schema: 'public', table: 'cabshare_rides' }],
      },
    });
    heartbeat = window.setInterval(() => send('heartbeat', {}, 'phoenix'), 25_000);
  });
  socket.addEventListener('message', (event) => {
    try {
      const message = JSON.parse(String(event.data)) as { event?: string; payload?: { response?: { status?: string } } };
      if (message.event === 'postgres_changes') onChange();
      if (message.event === 'phx_reply' && message.payload?.response?.status === 'ok') onStatus?.('live');
      if (message.event === 'phx_error') onStatus?.('fallback');
    } catch {
      // Ignore malformed frames; REST polling remains the fallback.
    }
  });
  socket.addEventListener('error', () => onStatus?.('fallback'));
  socket.addEventListener('close', () => {
    if (heartbeat !== undefined) window.clearInterval(heartbeat);
    if (!stopped) onStatus?.('fallback');
  });

  return () => {
    stopped = true;
    if (heartbeat !== undefined) window.clearInterval(heartbeat);
    socket.close(1000, 'board closed');
  };
}

export async function postCabRide(ride: {
  from_place: string; to_place: string; travel_date: string; travel_time: string;
  seats: number; notes: string; contact: string; poster_code: string;
  /** Required: server-side trigger rejects devices without a saved contact number. */
  poster_device_code: string;
}): Promise<void> {
  // return=minimal on purpose: the public board grants SELECT column-by-column
  // (poster_code / poster_device_code are capability secrets and must never be
  // readable by the browser), so no RETURNING clause is sent. The caller simply
  // refreshes the board afterwards.
  const res = await fetch(`${SUPABASE_URL}/rest/v1/cabshare_rides`, {
    method: 'POST',
    headers: headers({ Prefer: 'return=minimal' }),
    body: JSON.stringify({ ...ride, seats_left: ride.seats }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (text.includes('PHONE_REQUIRED')) {
      throw new Error('Save your mobile number before posting a ride.');
    }
    // The retired OTP-era trigger, a missing RPC, or revoked grants: say which
    // problem this is instead of a blanket "could not post".
    if (classifyPhoneBackendFailure(res.status, text) === 'BACKEND_OUTDATED') {
      throw new Error(RIDE_BOARD_BACKEND_MESSAGE);
    }
    throw new Error('Could not post your ride');
  }
}

/**
 * Atomically take a seat on a ride. Requires a device with a saved contact
 * number — the server refuses anonymous joins and rides that conflict with
 * another open ride inside the same 3-hour window.
 */
export interface CabJoinResult {
  joined: boolean;
  memberAware: boolean;
}

export type CabJoinError = 'phone' | 'conflict' | 'backend' | 'generic';

export async function joinCabRide(id: number, participantCode: string, deviceCode: string): Promise<CabJoinResult> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/join_cabride_with_member`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ p_ride_id: id, p_member_code: participantCode, p_device_code: deviceCode }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (text.includes('PHONE_REQUIRED')) {
      throw new CabShareJoinError('phone', 'Save your mobile number before joining a ride.');
    }
    if (text.includes('RIDE_TIME_CONFLICT')) {
      throw new CabShareJoinError('conflict', 'You already hold a seat on another ride that overlaps this departure time.');
    }
    if (classifyPhoneBackendFailure(res.status, text) === 'BACKEND_OUTDATED') {
      throw new CabShareJoinError('backend', RIDE_BOARD_BACKEND_MESSAGE);
    }
    throw new CabShareJoinError('generic', 'Could not join that ride.');
  }
  return { joined: (await res.json()) as boolean, memberAware: true };
}

export class CabShareJoinError extends Error {
  kind: CabJoinError;
  constructor(kind: CabJoinError, message: string) {
    super(message);
    this.kind = kind;
  }
}

/** Release one seat previously reserved by this browser session. */
export async function leaveCabRide(id: number, participantCode: string): Promise<boolean> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/leave_cabride`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ p_ride_id: id, p_member_code: participantCode }),
  });
  if (res.status === 404) throw new Error('Leave is available after the community board migration is applied.');
  if (!res.ok) throw new Error('Could not leave that ride');
  return (await res.json()) as boolean;
}

/** Poster confirms a rider — the second half of mutual confirmation. */
export async function confirmRideMember(id: number, posterCode: string, memberCode: string): Promise<boolean> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/confirm_ride_member`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ p_ride_id: id, p_poster_code: posterCode, p_member_code: memberCode }),
  });
  if (!res.ok) throw new Error('Could not confirm that rider');
  return (await res.json()) as boolean;
}

export interface RideMemberSummary {
  memberCode: string;
  posterConfirmed: boolean;
  joinedAt: string;
  /** Server-issued last-4 fragment, or null — never a full number. */
  last4?: string | null;
}

/** Poster-only rider list (codes + confirmation state, no phone numbers). */
export async function listRideMembers(id: number, posterCode: string): Promise<RideMemberSummary[] | null> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/list_ride_members`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ p_ride_id: id, p_poster_code: posterCode }),
  });
  if (!res.ok) return null;
  const payload = (await res.json()) as { status: string; members: RideMemberSummary[] };
  return payload.status === 'ok' ? payload.members : null;
}

export interface ContactReveal {
  status: 'ok' | 'hidden' | 'awaiting_confirmation' | 'needs_confirmation' | 'unavailable' | 'forbidden' | 'not_found';
  phone?: string;
  masked?: string;
}

/**
 * Contact exchange — allowed only after mutual confirmation, and only when
 * the counterparty has a saved number they have not hidden. Callers pass
 * their own capability code; the server never trusts the client's claim.
 */
export async function revealMemberContact(id: number, myCode: string, memberCode: string): Promise<ContactReveal> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/reveal_member_contact`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ p_ride_id: id, p_code: myCode, p_member_code: memberCode }),
  });
  if (!res.ok) return { status: 'unavailable' };
  return (await res.json()) as ContactReveal;
}

/** Delete a ride when the correct poster code is supplied (returns false on wrong code). */
export async function deleteCabRide(id: number, posterCode: string): Promise<boolean> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/delete_cabride`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ p_ride_id: id, p_code: posterCode }),
  });
  if (!res.ok) throw new Error('Could not delete that ride');
  return (await res.json()) as boolean;
}

// ---------------------------------------------------------------------------
// Question-paper bank
// ---------------------------------------------------------------------------

export interface QnPaper {
  id: number;
  course_code: string;
  course_title: string;
  exam_type: string;
  title: string;
  url: string;
  uploaded_by: string;
  created_at: string;
}

/** Generate the per-paper removal code. Same code *generator* as the cab-share
 *  poster code, but the two features keep independent authorization models:
 *  this code is bound to one paper and kept only on the sharing device (see
 *  qbankOwnership.ts). It is never something the user has to type back in. */
export function makePaperCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  const arr = new Uint8Array(8);
  crypto.getRandomValues(arr);
  for (const b of arr) out += chars[b % chars.length];
  return out;
}

export async function fetchQnPapers(courseCode?: string): Promise<QnPaper[]> {
  // Explicit columns: poster_code is the capability token for deleting a paper
  // and must stay server-side only.
  const columns = 'id,course_code,course_title,exam_type,title,url,uploaded_by,created_at';
  const q = courseCode
    ? `select=${columns}&course_code=ilike.${encodeURIComponent(courseCode.trim())}&order=created_at.desc&limit=100`
    : `select=${columns}&order=created_at.desc&limit=100`;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/qbank_papers?${q}`, { headers: headers() });
  if (!res.ok) throw new Error('Could not reach the question-paper bank');
  return res.json();
}

export async function fetchQnCourses(): Promise<string[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/qbank_papers?select=course_code&order=course_code.asc`, {
    headers: headers(),
  });
  if (!res.ok) return [];
  const rows = (await res.json()) as { course_code: string }[];
  return Array.from(new Set(rows.map((r) => r.course_code.trim()).filter(Boolean))).sort();
}

export async function postQnPaper(paper: {
  course_code: string; course_title: string; exam_type: string; title: string;
  url: string; uploaded_by: string; poster_code: string;
}): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/qbank_papers`, {
    method: 'POST',
    headers: headers({ Prefer: 'return=minimal' }),
    body: JSON.stringify(paper),
  });
  if (!res.ok) throw new Error('Could not share the paper');
}

/** Delete a paper when the removal code bound to it at upload time is supplied
 *  (verified server-side; returns false on a mismatch). The code is stored on
 *  the sharing device only — the UI never prompts the user for it. */
export async function deleteQnPaper(id: number, posterCode: string): Promise<boolean> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/delete_qbank_paper`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ p_paper_id: id, p_code: posterCode }),
  });
  if (!res.ok) throw new Error('Could not delete that paper');
  return (await res.json()) as boolean;
}
