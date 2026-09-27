export type CabRideState = 'open' | 'full' | 'expired';

export interface CabRideLike {
  travel_date: string;
  travel_time: string;
  seats: number;
  seats_left: number;
  participant_count?: number;
}

export function getCabRideState(ride: CabRideLike, now = Date.now()): CabRideState {
  if (ride.travel_date && ride.travel_time) {
    const timestamp = new Date(`${ride.travel_date}T${ride.travel_time}:00`).getTime();
    if (Number.isFinite(timestamp) && timestamp < now) return 'expired';
  }
  return ride.seats_left > 0 ? 'open' : 'full';
}

export function getCabParticipantCount(ride: CabRideLike): number {
  // Older rows predate participant_count; seats - seats_left is the truthful
  // fallback for those rows.
  return ride.participant_count && ride.participant_count > 0
    ? ride.participant_count
    : Math.max(0, ride.seats - ride.seats_left);
}

// ---------------------------------------------------------------------------
// Contact privacy (pure, testable)
// ---------------------------------------------------------------------------

export interface ContactPrivacyInput {
  /** Has the rider taken a seat (member row exists)? */
  riderJoined: boolean;
  /** Has the poster confirmed the rider? */
  posterConfirmed: boolean;
  /** Does the counterparty have a verified phone? */
  counterpartyVerified: boolean;
  /** Has the counterparty chosen to hide their number? */
  counterpartyHidden: boolean;
}

export type ContactExchangeStatus = 'blocked' | 'awaiting_confirmation' | 'hidden' | 'available';

/**
 * Pure contact-exchange gate shared by the UI and tests. Phone numbers are
 * only exchangeable AFTER mutual confirmation (rider joined + poster
 * confirmed), and only when the counterparty has a verified number they
 * have not hidden.
 */
export function contactExchangeStatus(input: ContactPrivacyInput): ContactExchangeStatus {
  if (!input.riderJoined || !input.posterConfirmed) return 'awaiting_confirmation';
  if (!input.counterpartyVerified) return 'blocked';
  if (input.counterpartyHidden) return 'hidden';
  return 'available';
}

/** Never render a raw number before this says `available`. */
export function canShowFullNumber(status: ContactExchangeStatus): boolean {
  return status === 'available';
}

/**
 * UI-safe phone display. A full number is only ever renderable when the
 * exchange status is `available`; otherwise fall back to the masked
 * fragment or a privacy-preserving label.
 */
export function displayPhoneForStatus(status: ContactExchangeStatus, full?: string | null, masked?: string | null): string | null {
  if (status === 'available' && full) return full;
  if (status === 'hidden' && masked) return masked;
  return null;
}
