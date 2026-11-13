/**
 * Campus abstraction layer.
 *
 * UltraCC is a multi-campus-capable VIT student OS. Each campus carries its
 * own VTOP host and service availability. Today only Chennai (vtopcc) is
 * live-verified end-to-end; the other campuses are wired with their official
 * hosts so the SAME frontend/gateway can target them without code changes —
 * their parsers are marked UNVERIFIED until a live pass confirms the HTML is
 * identical (it is not guaranteed).
 *
 * Never hardcode a VTOP host inside a component — read it from the active
 * campus config. Timetable times are the exception, and deliberately so: see
 * the note at the foot of this file.
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
  /** True when the full pipeline (login -> session -> parsers) is live-verified.
   *  The UI surfaces this as "available": a student may only pick a campus UltraCC
   *  can actually sign in to, so the flag also gates the Settings control. */
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
    note: 'Sign-in for Vellore is not available yet.',
  },
  ap: {
    id: 'ap',
    name: 'VIT AP',
    shortName: 'AP',
    vtopHost: 'https://vtopcc.vitap.ac.in',
    label: 'VIT AP',
    verified: false,
    transportAvailable: false,
    note: 'Sign-in for AP is not available yet.',
  },
  bhopal: {
    id: 'bhopal',
    name: 'VIT Bhopal',
    shortName: 'Bhopal',
    vtopHost: 'https://vtopcc.vitbhopal.ac.in',
    label: 'VIT Bhopal',
    verified: false,
    transportAvailable: false,
    note: 'Sign-in for Bhopal is not available yet.',
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

/** Where the student's campus choice is kept on this device. */
export const CAMPUS_STORAGE_KEY = 'ultracc:campus';

/**
 * The saved campus, or the verified one when nothing is stored.
 *
 * Storage is unreadable in an installed PWA with site data blocked and in iOS
 * private windows, and the Settings campus list asks this question for every
 * row while it renders — so a refusal answers "nothing chosen here" instead of
 * taking the whole modal down.
 */
export function readStoredCampusId(): CampusId {
  try {
    const raw = localStorage.getItem(CAMPUS_STORAGE_KEY);
    return raw && raw in CAMPUSES ? (raw as CampusId) : ACTIVE_CAMPUS_ID;
  } catch {
    return ACTIVE_CAMPUS_ID;
  }
}

/**
 * Remember the campus choice. Returns false when the device refuses to store
 * it, which tells the caller a reload would land back where it started.
 */
export function writeStoredCampusId(id: CampusId): boolean {
  try {
    localStorage.setItem(CAMPUS_STORAGE_KEY, id);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Timetable slot times
// ---------------------------------------------------------------------------

/**
 * There is deliberately no slot-time table here. A VIT Chennai slot letter does
 * not carry one fixed time: the letters rotate per weekday (C1 meets 08:00 on
 * Wednesday and 08:55 on Friday) and VTOP files a lecture together with its
 * tutorial in a single cell ("A1+TA1"), so a flat letter→time map in this file
 * was both unused and wrong the moment it was written.
 *
 * The times a student sees come from VTOP's own timetable cells. Only when a
 * row ships without them does
 * `src/lib/vtop/parsers/timetable.ts` supply the day-wise grid from the FFCS
 * schedule, and every screen reads the resulting startTime/endTime off the row
 * rather than looking a letter up.
 */
