/**
 * The VIT Chennai slot map — which slot meets on which weekday, and at what
 * hours. This is the gateway's mirror of `src/utils/chennaiSlotMap.ts`; a
 * function deployed to Supabase cannot import from the web client, so the
 * table is kept twice and the guard test
 * `src/utils/__tests__/chennaiSlotMapLiveOnce.test.ts` fails if the two ever
 * disagree, or if they contradict the FFCS planner grid the section tools read.
 *
 * This table is load-bearing: a student's timetable page gives VTOP's course
 * list as slots with no clock, so the day and the hours of every class the app
 * prints are decided here. That is also why one day's lab hour must not be
 * typed in slightly differently from the next day's.
 */

export const CHENNAI_DAY_CODES = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;
export type ChennaiDayCode = (typeof CHENNAI_DAY_CODES)[number];

/** Slot → 'HH:MM-HH:MM', twenty-four hour, per weekday. */
export const CHENNAI_SLOT_TIMES: Record<ChennaiDayCode, Record<string, string>> = {
  MON: {
    A1: '08:00-08:50', F1: '08:55-09:45', D1: '09:50-10:40', TB1: '10:45-11:35',
    TG1: '11:40-12:30', S11: '12:35-13:25', A2: '14:00-14:50', F2: '14:55-15:45',
    D2: '15:50-16:40', TB2: '16:45-17:35', TG2: '17:40-18:30', S3: '18:35-19:25',
    L1: '08:00-08:50', L2: '08:50-09:40', L3: '09:50-10:40', L4: '10:40-11:30',
    L5: '11:40-12:30', L6: '12:30-13:20', L31: '14:00-14:50', L32: '14:50-15:40',
    L33: '15:50-16:40', L34: '16:40-17:30', L35: '17:40-18:30', L36: '18:30-19:20',
  },
  TUE: {
    B1: '08:00-08:50', G1: '08:55-09:45', E1: '09:50-10:40', TC1: '10:45-11:35',
    TAA1: '11:40-12:30', L12: '12:30-13:20', B2: '14:00-14:50', G2: '14:55-15:45',
    E2: '15:50-16:40', TC2: '16:45-17:35', TAA2: '17:40-18:30', S1: '18:35-19:25',
    L7: '08:00-08:50', L8: '08:50-09:40', L9: '09:50-10:40', L10: '10:40-11:30',
    L11: '11:40-12:30', L37: '14:00-14:50', L38: '14:50-15:40', L39: '15:50-16:40',
    L40: '16:40-17:30', L41: '17:40-18:30', L42: '18:30-19:20',
  },
  WED: {
    C1: '08:00-08:50', A1: '08:55-09:45', F1: '09:50-10:40', TD1: '10:45-11:35',
    TBB1: '11:40-12:30', L18: '12:30-13:20', C2: '14:00-14:50', A2: '14:55-15:45',
    F2: '15:50-16:40', TD2: '16:45-17:35', TBB2: '17:40-18:30', S4: '18:35-19:25',
    L13: '08:00-08:50', L14: '08:50-09:40', L15: '09:50-10:40', L16: '10:40-11:30',
    L17: '11:40-12:30', L43: '14:00-14:50', L44: '14:50-15:40', L45: '15:50-16:40',
    L46: '16:40-17:30', L47: '17:40-18:30', L48: '18:30-19:20',
  },
  THU: {
    D1: '08:00-08:50', B1: '08:55-09:45', G1: '09:50-10:40', TE1: '10:45-11:35',
    TCC1: '11:40-12:30', L24: '12:30-13:20', D2: '14:00-14:50', B2: '14:55-15:45',
    G2: '15:50-16:40', TE2: '16:45-17:35', TCC2: '17:40-18:30', S2: '18:35-19:25',
    L19: '08:00-08:50', L20: '08:50-09:40', L21: '09:50-10:40', L22: '10:40-11:30',
    L23: '11:40-12:30', L49: '14:00-14:50', L50: '14:50-15:40', L51: '15:50-16:40',
    L52: '16:40-17:30', L53: '17:40-18:30', L54: '18:30-19:20',
  },
  FRI: {
    E1: '08:00-08:50', C1: '08:55-09:45', TA1: '09:50-10:40', TF1: '10:45-11:35',
    TDD1: '11:40-12:30', S15: '12:35-13:25', E2: '14:00-14:50', C2: '14:55-15:45',
    TA2: '15:50-16:40', TF2: '16:45-17:35', TDD2: '17:40-18:30',
    L25: '08:00-08:50', L26: '08:50-09:40', L27: '09:50-10:40', L28: '10:40-11:30',
    L29: '11:40-12:30', L30: '12:30-13:20', L55: '14:00-14:50', L56: '14:50-15:40',
    L57: '15:50-16:40', L58: '16:40-17:30', L59: '17:40-18:30', L60: '18:30-19:20',
  },
  SAT: {
    X11: '08:00-08:50', X12: '08:55-09:45', Y11: '09:50-10:40', Y12: '10:45-11:35',
    S8: '11:40-12:30', S8B: '12:35-13:25', X21: '14:00-14:50', Z21: '14:55-15:45',
    Y21: '15:50-16:40', W21: '16:45-17:35', W22: '17:40-18:30', Z22: '18:35-19:25',
    L71: '08:00-08:50', L72: '08:50-09:40', L73: '09:50-10:40', L74: '10:40-11:30',
    L75: '11:40-12:30', L76: '12:30-13:20', L77: '14:00-14:50', L78: '14:50-15:40',
    L79: '15:50-16:40', L80: '16:40-17:30', L81: '17:40-18:30', L82: '18:30-19:20',
  },
};

/**
 * Weekday code → full label. VTOP's own grid rows start with MON/TUE/…, and
 * the Sunday entry exists only because the grid can carry a Sunday row; the
 * slot map itself places no Sunday class.
 */
export const DAY_LABEL: Record<string, string> = {
  SUN: 'Sunday', MON: 'Monday', TUE: 'Tuesday', WED: 'Wednesday',
  THU: 'Thursday', FRI: 'Friday', SAT: 'Saturday',
};

export interface SlotMeeting {
  day: string;
  start: string;
  end: string;
}

function readRange(value: string | undefined): { start: string; end: string } | null {
  const match = (value || '').match(/^(\d{2}:\d{2})-(\d{2}:\d{2})$/);
  return match ? { start: match[1], end: match[2] } : null;
}

/** A VTOP row may name its whole slot pair together (`A1+TA1`); each token in
 *  it is a slot this map knows on its own. */
function slotTokens(slot: string): string[] {
  return (slot || '')
    .trim()
    .toUpperCase()
    .split('+')
    .map((token) => token.trim())
    .filter(Boolean);
}

/**
 * Every weekly meeting a slot code has — 'A1' is Monday 08:00 and Wednesday
 * 08:55. A code the map does not carry answers with nothing, which is how a
 * course reaches the UI without a fabricated day or hour.
 */
export function slotMeetings(slot: string): SlotMeeting[] {
  const meetings: SlotMeeting[] = [];
  for (const token of slotTokens(slot)) {
    for (const code of CHENNAI_DAY_CODES) {
      const hours = readRange(CHENNAI_SLOT_TIMES[code][token]);
      if (hours) meetings.push({ day: DAY_LABEL[code], ...hours });
    }
  }
  return meetings;
}
