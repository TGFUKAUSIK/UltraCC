import { describe, expect, it } from 'vitest';
import { getCabParticipantCount, getCabRideState } from '../cabShare';

describe('cab share states', () => {
  const now = new Date('2026-09-06T10:00:00').getTime();

  it('classifies open, full and expired rides from their real fields', () => {
    expect(getCabRideState({ travel_date: '2026-09-06', travel_time: '12:00', seats: 3, seats_left: 2 }, now)).toBe('open');
    expect(getCabRideState({ travel_date: '2026-09-06', travel_time: '12:00', seats: 3, seats_left: 0 }, now)).toBe('full');
    expect(getCabRideState({ travel_date: '2026-09-06', travel_time: '09:00', seats: 3, seats_left: 3 }, now)).toBe('expired');
  });

  it('uses member accounting when available and derives legacy counts otherwise', () => {
    expect(getCabParticipantCount({ travel_date: '', travel_time: '', seats: 4, seats_left: 3, participant_count: 2 })).toBe(2);
    expect(getCabParticipantCount({ travel_date: '', travel_time: '', seats: 4, seats_left: 1 })).toBe(3);
  });
});
