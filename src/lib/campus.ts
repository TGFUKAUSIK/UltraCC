/**
 * Campus abstraction layer.
 *
 * UltraCC is a multi-campus-capable VIT student OS. Each campus carries its
 * own VTOP host, timetable slot map, and service availability. Today only
 * Chennai (vtopcc) is live-verified end-to-end; the other campuses are wired
 * with their official hosts so the SAME frontend/gateway can target them
 * without code changes — their parsers/slot maps are marked UNVERIFIED until
 * a live pass confirms the HTML is identical (it is not guaranteed).
 *
 * Never hardcode a VTOP host or slot time inside a parser/component — read it
 * from the active campus config.
 */

export type CampusId = 'chennai' | 'vellore' | 'ap' | 'bhopal';

export interface CampusConfig {
  id: CampusId;
  name: string;
  shortName: string;
  /** VTOP portal origin (login host). */
  vtopHost: string;
  /** Display label used across the UI. */
  label: string;
  /** True when the full pipeline (login -> session -> parsers) is live-verified. */
  verified: boolean;
  /** Whether day-scholar bus routes are available as a dataset. */
  transportAvailable: boolean;
  /** Notes surfaced in the UI about this campus's data readiness. */
  note?: string;
}

/** Official VIT VTOP hosts. Only Chennai is fully verified in UltraCC today. */
export const CAMPUSES: Record<CampusId, CampusConfig> = {
  chennai: {
    id: 'chennai',
    name: 'VIT Chennai',
    shortName: 'Chennai',
    vtopHost: 'https://vtopcc.vit.ac.in',
    label: 'VIT Chennai',
    verified: true,
    transportAvailable: true,
  },
  vellore: {
    id: 'vellore',
    name: 'VIT Vellore',
    shortName: 'Vellore',
    vtopHost: 'https://vtop.vit.ac.in',
    label: 'VIT Vellore',
    verified: false,
    transportAvailable: false,
    note: 'Host configured; parsers not yet live-verified for Vellore HTML.',
  },
  ap: {
    id: 'ap',
    name: 'VIT AP',
    shortName: 'AP',
    vtopHost: 'https://vtopcc.vitap.ac.in',
    label: 'VIT AP',
    verified: false,
    transportAvailable: false,
    note: 'Host configured; parsers not yet live-verified for AP HTML.',
  },
  bhopal: {
    id: 'bhopal',
    name: 'VIT Bhopal',
    shortName: 'Bhopal',
    vtopHost: 'https://vtopcc.vitbhopal.ac.in',
    label: 'VIT Bhopal',
    verified: false,
    transportAvailable: false,
    note: 'Host configured; parsers not yet live-verified for Bhopal HTML.',
  },
};

/** The campus the app is built and verified for today. */
export const ACTIVE_CAMPUS_ID: CampusId = 'chennai';
export const ACTIVE_CAMPUS: CampusConfig = CAMPUSES[ACTIVE_CAMPUS_ID];

export const CAMPUS_LIST: CampusConfig[] = [
  CAMPUSES.chennai,
  CAMPUSES.vellore,
  CAMPUSES.ap,
  CAMPUSES.bhopal,
];

// ---------------------------------------------------------------------------
// Timetable slot maps (per campus).
// ---------------------------------------------------------------------------

export interface SlotDef {
  /** Slot code as VTOP serves it (e.g. "A1"). */
  code: string;
  start: string; // "08:00"
  end: string;   // "08:50"
}

/**
 * VIT Chennai slot map — the verified default. Keyed by the slot codes VTOP
 * Chennai actually serves (A1..F2 + T slots). T slots are tutorial classes;
 * L slots are labs handled by the timetable parser itself.
 */
const CHENNAI_SLOT_MAP: Record<string, SlotDef> = {
  A1: { code: 'A1', start: '08:00', end: '08:50' },
  A2: { code: 'A2', start: '09:00', end: '09:50' },
  B1: { code: 'B1', start: '10:00', end: '10:50' },
  B2: { code: 'B2', start: '11:00', end: '11:50' },
  C1: { code: 'C1', start: '12:00', end: '12:50' },
  C2: { code: 'C2', start: '13:00', end: '13:50' },
  D1: { code: 'D1', start: '14:00', end: '14:50' },
  D2: { code: 'D2', start: '15:00', end: '15:50' },
  E1: { code: 'E1', start: '16:00', end: '16:50' },
  E2: { code: 'E2', start: '17:00', end: '17:50' },
  F1: { code: 'F1', start: '18:00', end: '18:50' },
  F2: { code: 'F2', start: '19:00', end: '19:50' },
  TA1: { code: 'TA1', start: '08:00', end: '08:50' },
  TA2: { code: 'TA2', start: '09:00', end: '09:50' },
  TB1: { code: 'TB1', start: '10:00', end: '10:50' },
  TB2: { code: 'TB2', start: '11:00', end: '11:50' },
  TC1: { code: 'TC1', start: '12:00', end: '12:50' },
  TC2: { code: 'TC2', start: '13:00', end: '13:50' },
  TD1: { code: 'TD1', start: '14:00', end: '14:50' },
  TD2: { code: 'TD2', start: '15:00', end: '15:50' },
  TE1: { code: 'TE1', start: '16:00', end: '16:50' },
  TE2: { code: 'TE2', start: '17:00', end: '17:50' },
};

/**
 * Vellore/AP/Bhopal slot maps are NOT assumed identical to Chennai. Each has
 * an empty map placeholder that must be filled from a live-verified pass
 * before that campus can be activated. This is deliberate: guessing slot
 * times would fabricate timetable data.
 */
const UNVERIFIED_SLOT_MAP: Record<string, SlotDef> = {};

export const CAMPUS_SLOT_MAPS: Record<CampusId, Record<string, SlotDef>> = {
  chennai: CHENNAI_SLOT_MAP,
  vellore: UNVERIFIED_SLOT_MAP,
  ap: UNVERIFIED_SLOT_MAP,
  bhopal: UNVERIFIED_SLOT_MAP,
};

/** Resolve a slot code to its time window for the active campus ('' when unknown). */
export function slotTimeFor(slot: string, campus: CampusId = ACTIVE_CAMPUS_ID): { start: string; end: string } | null {
  const def = CAMPUS_SLOT_MAPS[campus]?.[(slot || '').trim().toUpperCase()];
  return def ? { start: def.start, end: def.end } : null;
}
