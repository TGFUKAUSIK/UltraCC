/**
 * edgeFetch.ts — tiny helper for UltraCC's public-data edge functions
 * (faculty-directory, event-hub). These hit PUBLIC VIT Chennai sites
 * (chennai.vit.ac.in, eventhubcc.vit.ac.in) and need no student session.
 *
 * The anon key is the public client key for anonymous-only access; it is read
 * from VITE_SUPABASE_ANON_KEY and is never committed to the repository.
 *
 * FAILURE COPY: these answers surface in student-facing screens, so a non-2xx
 * response throws a fixed human sentence. Which function failed and its HTTP
 * status are developer detail (`debugErrorDetail`, development only) — naming
 * `campus-data` or printing `502` at the top of a page would be reading our
 * infrastructure back to the student.
 */

import { debugErrorDetail } from './errorCopy';

// Deploy-time configuration. The public build ships placeholders — set
// VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see .env.example) to your own
// Supabase project. Values that still read as placeholders are treated as unset.
function envValue(key: string, fallback: string): string {
  const value = typeof import.meta !== 'undefined' ? (import.meta as any).env?.[key] : undefined;
  if (!value) return fallback;
  const v = value.trim();
  if (!v || /your[_-]/i.test(v) || /^<.*>$/.test(v) || /example\.com|your-project\.supabase\.co/i.test(v)) return fallback;
  return v;
}

export const SUPABASE_URL = envValue('VITE_SUPABASE_URL', 'https://your-project.supabase.co');

export const ANON_KEY = envValue('VITE_SUPABASE_ANON_KEY', 'your_supabase_anon_key');

/** What a caller may show when `edgeFetch` throws — human, and true for any dataset. */
export const CAMPUS_SERVICE_MESSAGE = 'This campus service is temporarily unavailable. Try again in a moment.';

export async function edgeFetch<T>(fn: string): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
    headers: {
      'Content-Type': 'application/json',
      'apikey': ANON_KEY,
      'Authorization': `Bearer ${ANON_KEY}`,
    },
  });
  if (!res.ok) {
    debugErrorDetail('edgeFetch', `${fn} → HTTP ${res.status}`);
    throw new Error(CAMPUS_SERVICE_MESSAGE);
  }
  return res.json() as Promise<T>;
}

export interface FacultyMember {
  name: string;
  designation: string;
  schoolId: string;
  schoolName: string;
  employeeId: string;
  profileUrl: string;
  imageUrl: string;
  email: string;
}

export interface HubEventOption {
  type: string;
  price: string;
  eligibility: string;
}

export interface HubEvent {
  eid: string;
  title: string;
  /** ISO "YYYY-MM-DD" when parseable, else the card's verbatim date cell. */
  date: string;
  location: string;
  /** Deterministic public poster route, keyed by event id. */
  posterUrl: string;
  /** The same poster mirrored by the event-hub function, for clients whose TLS
   *  verifier will not repair the Event Hub host's incomplete certificate
   *  chain (iPhone, Android). See `src/lib/eventPoster.ts`. */
  posterProxy?: string;
  /** Deep link to the exact event's preview page (sign-in required there). */
  registerUrl: string;
  teamSize: string;
  type: string;
  price: string;
  eligibility: string;
  options: HubEventOption[];
}
