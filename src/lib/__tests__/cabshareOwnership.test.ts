/**
 * Cab Share poster-code regression tests.
 *
 * The bug these guard against: the poster code was held in a React state
 * variable only, and the one notice that displayed it lived inside the post
 * form the submit handler closes. A student could therefore never see the code
 * and lost it on reload — which locked them out of confirming riders and
 * deleting their own listing.
 *
 * Ownership is a LOOKUP, not an authorization: whatever code is used still goes
 * to the server, which verifies it against the row.
 */

import { describe, it, expect } from 'vitest';
import {
  canManageRide, codesForRide, consumeRideCode, loadRideCodeMap, posterCodeForRide,
  recordRideCode, rideKey, saveRideCodeMap,
} from '../cabshareOwnership';
import { codesFor, holdsCode, latestCode } from '../ownershipCodes';

const ride = {
  from_place: ' T. Nagar ',
  to_place: 'VIT  Chennai',
  travel_date: '2026-08-01',
  travel_time: '09:30',
};

describe('cabshare poster codes', () => {
  it('keys a ride by its normalized public details', () => {
    expect(rideKey(ride)).toBe('T. Nagar|VIT Chennai|2026-08-01|09:30');
    expect(rideKey({ from_place: 'T. Nagar', to_place: 'VIT Chennai', travel_date: '2026-08-01', travel_time: '09:30' }))
      .toBe(rideKey(ride));
  });

  it('binds the code at post time and offers it back without a prompt', () => {
    const map = recordRideCode({}, rideKey(ride), 'KMHZ2345');
    expect(canManageRide(map, rideKey(ride))).toBe(true);
    expect(posterCodeForRide(map, rideKey(ride))).toBe('KMHZ2345');
  });

  it('never invents a code for someone else’s ride', () => {
    expect(canManageRide({}, rideKey(ride))).toBe(false);
    expect(posterCodeForRide({}, rideKey(ride))).toBeNull();
    expect(codesForRide({}, rideKey(ride))).toEqual([]);
  });

  it('forgets the code once the listing is deleted', () => {
    let map = recordRideCode({}, rideKey(ride), 'KMHZ2345');
    map = consumeRideCode(map, rideKey(ride), 'KMHZ2345');
    expect(canManageRide(map, rideKey(ride))).toBe(false);
  });

  it('keeps earlier codes when a device posted the same route twice', () => {
    let map = recordRideCode({}, rideKey(ride), 'AAAA1111');
    map = recordRideCode(map, rideKey(ride), 'BBBB2222');
    expect(codesForRide(map, rideKey(ride))).toEqual(['AAAA1111', 'BBBB2222']);
    // The newest listing is the one most likely being managed.
    expect(posterCodeForRide(map, rideKey(ride))).toBe('BBBB2222');
    map = consumeRideCode(map, rideKey(ride), 'BBBB2222');
    expect(posterCodeForRide(map, rideKey(ride))).toBe('AAAA1111');
  });
});

describe('shared ownership code map', () => {
  it('exposes the same rules the Q-Bank wrapper uses', () => {
    const map = recordRideCode({}, 'k', 'C1');
    expect(codesFor(map, 'k')).toEqual(['C1']);
    expect(holdsCode(map, 'k')).toBe(true);
    expect(latestCode(map, 'missing')).toBeNull();
  });

  it('survives a reload through localStorage, and a broken entry without throwing', () => {
    const map = recordRideCode({}, rideKey(ride), 'KMHZ2345');
    saveRideCodeMap(map);
    expect(posterCodeForRide(loadRideCodeMap(), rideKey(ride))).toBe('KMHZ2345');

    localStorage.setItem('ultracc:cabshare-poster-codes', 'not json{');
    expect(loadRideCodeMap()).toEqual({});
    localStorage.setItem('ultracc:cabshare-poster-codes', JSON.stringify({ k: ['OK', 42, ''] }));
    expect(codesForRide(loadRideCodeMap(), 'k')).toEqual(['OK']);
    localStorage.removeItem('ultracc:cabshare-poster-codes');
  });
});
