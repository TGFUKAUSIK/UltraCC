/**
 * cabshareOwnership.ts — device-bound poster codes for Cab Share rides.
 *
 * Posting a ride generates a capability code that the server checks for every
 * poster action (listing riders, confirming them, revealing numbers, deleting
 * the listing). The codes are kept in localStorage keyed by the ride's public
 * details, the same way Q-Bank remembers paper codes (see ownershipCodes.ts).
 * This changes no authorization: the stored code is still sent to the server,
 * which verifies it against the row, so a device that never posted a ride
 * cannot manage it.
 */

import { type CodeMap, codesFor, consumeCode, holdsCode, latestCode, loadCodeMap, recordCode, saveCodeMap } from './ownershipCodes';

export type RideCodeMap = CodeMap;

const RIDE_CODES_KEY = 'ultracc:cabshare-poster-codes';

const norm = (value: string | undefined | null): string => (value ?? '').trim().replace(/\s+/g, ' ');

/** Stable key for a ride's public details (normalized like the POST is). */
export function rideKey(ride: { from_place: string; to_place: string; travel_date: string; travel_time: string }): string {
  return [norm(ride.from_place), norm(ride.to_place), norm(ride.travel_date), norm(ride.travel_time)].join('|');
}

/** Remember a poster code this device earned. Returns a new map. */
export function recordRideCode(map: RideCodeMap, key: string, code: string): RideCodeMap {
  return recordCode(map, key, code);
}

export function codesForRide(map: RideCodeMap, key: string): string[] {
  return codesFor(map, key);
}

/** True when this device posted a ride with these details. */
export function canManageRide(map: RideCodeMap, key: string): boolean {
  return holdsCode(map, key);
}

/** The code to offer the server for a ride this device posted (null = ask). */
export function posterCodeForRide(map: RideCodeMap, key: string): string | null {
  return latestCode(map, key);
}

/** Forget a code once its ride is gone. */
export function consumeRideCode(map: RideCodeMap, key: string, code: string): RideCodeMap {
  return consumeCode(map, key, code);
}

export function loadRideCodeMap(): RideCodeMap {
  return loadCodeMap(RIDE_CODES_KEY);
}

export function saveRideCodeMap(map: RideCodeMap): void {
  saveCodeMap(RIDE_CODES_KEY, map);
}
