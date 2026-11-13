/**
 * The VIT Chennai slot map — which slot meets on which weekday, and at what
 * hours. One table, and the only place in this client that carries it.
 *
 * Three copies used to describe the same teaching week: this map's gateway
 * twin (which times every row of a student's synced timetable), the parser's
 * `FFCS_SLOT_TIMES` / `LAB_SLOT_TIMES` / `CHENNAI_SLOT_TIMES` trio, and the
 * free-period grid the timetable card counted. They drifted in ways a student
 * could see: the same 6th-hour lab ran 12:30–13:20 on Tuesday and 12:35–13:25
 * on Wednesday, and a card could count a period no timing table recognised.
 *
 * The rule this module now holds:
 *   - A slot's hours come from this map and nowhere else.
 *   - A weekday's period grid is the THEORY slots this map places on it.
 *     Lab rows are deliberately not periods of the day: a lab shares the
 *     theory hour it is scheduled inside, and adding it as its own row made
 *     the same lunch break 35 minutes on Monday and 40 on Tuesday.
 *   - A day this map does not place (Sunday) has no grid, and a surface that
 *     cannot count a day says so instead of printing zero.
 *
 * The gateway cannot import from `src/`, so it keeps a byte-for-byte mirror at
 * `supabase/functions/vtop-gateway/chennaiSlotMap.ts`; the drift guard in
 * `src/utils/__tests__/chennaiSlotMapLiveOnce.test.ts` fails the build if the
 * two — or the FFCS planner grid the section tools read — ever disagree.
 */

export const CHENNAI_DAY_CODES = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;
export type ChennaiDayCode = (typeof CHENNAI_DAY_CODES)[number];

/** Code → the weekday label a timetable row carries. This map places no
 *  Sunday class, so there is no Sunday entry to have. */
export const CHENNAI_DAY_LABEL: Record<ChennaiDayCode, string> = {
  MON: 'Monday', TUE: 'Tuesday', WED: 'Wednesday', THU: 'Thursday', FRI: 'Friday', SAT: 'Saturday',
};

/** Weekday label → the code this map keys its rows by, derived from the table
 *  above so the two cannot disagree about what day 'WED' is. */
export const CHENNAI_DAY_CODE = Object.fromEntries(
  Object.entries(CHENNAI_DAY_LABEL).map(([code, label]) => [label, code])
) as Record<string, ChennaiDayCode>;

/**
 * Slot → `'HH:MM-HH:MM'`, twenty-four hour, per weekday. A lab token appears
 * on the day VTOP schedules it: Monday's batches are L1–L6 and L31–L36,
 * Tuesday's are L7–L11 and L37–L42, and so on.
 */
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

/** A lab batch token. Theory slots (A1, TB2, S8B, X11…) never match it. */
export const LAB_SLOT_TOKEN = /^L\d{1,2}$/;

export interface SlotHours {
  start: string;
  end: string;
}

export interface SlotMeeting extends SlotHours {
  /** Full weekday label, e.g. 'Monday'. */
  day: string;
}

/** A range the map could not read is a gap in the data, not midnight. */
function readRange(value: string | undefined): SlotHours | null {
  const match = (value || '').match(/^(\d{2}:\d{2})-(\d{2}:\d{2})$/);
  return match ? { start: match[1], end: match[2] } : null;
}

/** A VTOP row may name its whole slot pair together (`A1+TA1`); each token in
 *  it is a slot the map knows on its own. */
function slotTokens(slot: string): string[] {
  return (slot || '')
    .trim()
    .toUpperCase()
    .split('+')
    .map((token) => token.trim())
    .filter(Boolean);
}

/**
 * The hours a slot meets on one weekday, or `null` when this map has no such
 * meeting. A row that names its slot pair (`A1+TA1`, VTOP writes them together)
 * is timed by the slot being met, which is the first one. A lab number is
 * looked up on the day VTOP put it: `L18` is a Wednesday batch, so asking for
 * it on Friday answers nothing rather than borrowing Wednesday's hour.
 */
export function slotTimeOn(day: string, slot: string): SlotHours | null {
  const code = CHENNAI_DAY_CODE[day.trim()];
  if (!code) return null;
  const [first] = slotTokens(slot);
  if (!first) return null;
  return readRange(CHENNAI_SLOT_TIMES[code][first]);
}

/** Every meeting a slot code has in the week — `A1` is Monday and Wednesday. */
export function slotMeetings(slot: string): SlotMeeting[] {
  const meetings: SlotMeeting[] = [];
  for (const token of slotTokens(slot)) {
    for (const code of CHENNAI_DAY_CODES) {
      const hours = readRange(CHENNAI_SLOT_TIMES[code][token]);
      if (hours) meetings.push({ day: CHENNAI_DAY_LABEL[code], ...hours });
    }
  }
  return meetings;
}

/**
 * The period grid of one teaching day: the theory slots this map places on it,
 * in the order the day runs. This is what "how many periods did I sit through,
 * and how many were free" counts against, so it is derived here instead of
 * being written out again by whichever card needs it.
 */
export function theoryPeriodsForDay(day: string): { slot: string; start: string; end: string }[] {
  const code = CHENNAI_DAY_CODE[day.trim()];
  if (!code) return [];
  return Object.entries(CHENNAI_SLOT_TIMES[code])
    .filter(([slot]) => !LAB_SLOT_TOKEN.test(slot))
    .flatMap(([slot, value]) => {
      const hours = readRange(value);
      return hours ? [{ slot, ...hours }] : [];
    })
    .sort((a, b) => a.start.localeCompare(b.start));
}
