import { describe, it, expect } from 'vitest';
import { examEndMs, examStartMs, istClock, countdownLabel, calendarDaysUntil, isSameIstDay, istDateLabel, istTodayStartMs, nextUpcomingExam, upcomingExams, enrichExamsWithCourses, vtopDateDayStartMs } from '../examUtils';
import { ExamSchedule } from '../../types';
import { ExamRecord, TimetableSlot } from '../../lib/vtop/types';

const exam = (overrides: Partial<ExamSchedule>): ExamSchedule => ({
  id: 'ex1',
  courseCode: 'CSE2001',
  courseTitle: 'Data Structures',
  examType: 'CAT 2',
  date: '2026-08-18',
  time: '10:00 AM - 11:30 AM',
  venue: 'SJT 402',
  seatNo: 'Row 3, Desk 12',
  syllabusTopics: [],
  topicsCompleted: 0,
  studyPriority: 'High',
  ...overrides,
});

describe('examStartMs', () => {
  it('interprets VTOP dates as Asia/Kolkata (UTC+05:30)', () => {
    // 2026-08-18 10:00 AM IST == 2026-08-18 04:30 UTC
    const ms = examStartMs('2026-08-18', '10:00 AM - 11:30 AM')!;
    expect(ms).toBe(Date.UTC(2026, 7, 18, 4, 30));
  });

  it('handles 12-hour PM and plain 24-hour times', () => {
    expect(examStartMs('2026-08-18', '02:00 PM - 03:30 PM')).toBe(Date.UTC(2026, 7, 18, 8, 30));
    expect(examStartMs('2026-08-18', '14:00-15:40')).toBe(Date.UTC(2026, 7, 18, 8, 30));
  });

  it('defaults to start of IST day when no time is given', () => {
    expect(examStartMs('2026-08-18', '')).toBe(Date.UTC(2026, 7, 17, 18, 30));
  });

  it('returns null for unparseable dates', () => {
    expect(examStartMs('', '10:00 AM')).toBeNull();
    expect(examStartMs('not-a-date', '10:00 AM')).toBeNull();
  });

  it('returns null for a date shape that is not a plain ISO day', () => {
    // VTOP writes other shapes ("18-AUG-2026", "TBD"). They are not silently
    // coerced: the parser normalises the ones it can, and this refuses the rest
    // rather than trusting Date's own guess at what "18-AUG-2026" means.
    expect(examStartMs('18-AUG-2026', '10:00 AM')).toBeNull();
    expect(examStartMs('TBD', '10:00 AM')).toBeNull();
    expect(examStartMs('2026-8-18', '10:00 AM')).toBeNull(); // un-padded, not VTOP's shape
  });

  it('will not roll a day that never happened into a day that did', () => {
    // The parsers are the first defence, but a cached or hand-written ISO can
    // still carry an impossible day. Date.UTC answered with the next month's
    // date — a real instant on a day VTOP never named, which a countdown then
    // pointed at. Null is the honest answer: there is no such day to count down
    // to. (The 2026-18-08 case is the one normalizeDate used to fabricate.)
    expect(examStartMs('2026-02-30', '10:00 AM')).toBeNull();
    expect(examStartMs('2026-04-31', '10:00 AM')).toBeNull();
    expect(examStartMs('2025-02-29', '10:00 AM')).toBeNull(); // 2025 is not a leap year
    // the day that only looks impossible still resolves to itself
    expect(examStartMs('2028-02-29', '10:00 AM')).toBe(Date.UTC(2028, 1, 29, 4, 30));
    expect(examStartMs('2026-06-30', '10:00 AM')).toBe(Date.UTC(2026, 5, 30, 4, 30));
  });
});

describe('examEndMs', () => {
  it('reads the far end of VTOP\'s time range', () => {
    // 11:30 AM IST == 06:00 UTC
    expect(examEndMs('2026-08-18', '10:00 AM - 11:30 AM')).toBe(Date.UTC(2026, 7, 18, 6, 0));
    expect(examEndMs('2026-08-18', '14:00-15:40')).toBe(Date.UTC(2026, 7, 18, 10, 10));
  });

  it('says nothing when VTOP gave a single time, rather than inventing a duration', () => {
    expect(examEndMs('2026-08-18', '10:00 AM')).toBeNull();
    expect(examEndMs('2026-08-18', '')).toBeNull();
  });

  it('refuses a range that ends before it starts', () => {
    expect(examEndMs('2026-08-18', '11:30 PM - 10:00 AM')).toBeNull();
  });
});

describe('istClock', () => {
  it('reads the India hour off an IST-derived instant', () => {
    const c = istClock(examStartMs('2026-08-18', '10:00 AM - 11:30 AM')!)!;
    expect(c).toMatchObject({ year: 2026, month: 7, day: 18, hour: 10, minute: 0 });
    expect(c.dayStartMs).toBe(Date.UTC(2026, 7, 17, 18, 30));
  });

  it('keeps an exam on its own India date across midnight UTC', () => {
    // 2026-08-18 00:30 IST is still 2026-08-17 19:00 UTC.
    const c = istClock(Date.UTC(2026, 7, 17, 19, 0))!;
    expect({ y: c.year, m: c.month, d: c.day, h: c.hour }).toEqual({ y: 2026, m: 7, d: 18, h: 0 });
  });

  it('returns null instead of a fake clock face', () => {
    expect(istClock(Number.NaN)).toBeNull();
  });
});

describe('countdownLabel', () => {
  const now = Date.UTC(2026, 7, 10, 0, 0);
  it('labels days, hours and minutes', () => {
    expect(countdownLabel(now + 8 * 86400000, now)).toBe('8 days');
    expect(countdownLabel(now + 3 * 3600000 + 20 * 60000, now)).toBe('3h 20m');
    expect(countdownLabel(now + 45 * 60000, now)).toBe('45m');
    expect(countdownLabel(now - 1000, now)).toBe('Today');
  });
});

describe('nextUpcomingExam', () => {
  const now = Date.UTC(2026, 7, 10, 0, 0); // 2026-08-10

  it('picks the earliest future exam chronologically, not the first in the list', () => {
    const exams = [
      exam({ id: 'later', courseCode: 'MAT2002', date: '2026-08-21', time: '10:00 AM' }),
      exam({ id: 'sooner', courseCode: 'CSE2004', date: '2026-08-12', time: '09:00 AM' }),
      exam({ id: 'past', courseCode: 'EEE1001', date: '2026-08-01', time: '09:00 AM' }),
    ];
    const next = nextUpcomingExam(exams, now);
    expect(next?.exam.id).toBe('sooner');
    expect(next?.countdown).toBe('2 days');
  });

  it('returns null when every exam is in the past or unparseable', () => {
    expect(nextUpcomingExam([exam({ date: '2026-08-01' })], now)).toBeNull();
    expect(nextUpcomingExam([exam({ date: '' })], now)).toBeNull();
    expect(nextUpcomingExam([], now)).toBeNull();
  });
});

describe('upcomingExams — what still counts as ahead', () => {
  // 09:30 on 2026-08-10 in India.
  const now = Date.UTC(2026, 7, 10, 4, 0);

  it('keeps today\'s exam when VTOP published a date but no time', () => {
    // The old instant-only rule treated an untimed paper as starting at
    // midnight, so the dashboard said "no exam ahead" on the morning of it.
    const next = nextUpcomingExam([exam({ id: 'today', date: '2026-08-10', time: '' })], now);
    expect(next?.exam.id).toBe('today');
    expect(next?.timePending).toBe(true);
    expect(next?.countdown).toBe('Today');
  });

  it('drops a timed paper whose start has already gone', () => {
    const next = nextUpcomingExam([
      exam({ id: 'written', date: '2026-08-10', time: '08:00 AM - 09:00 AM' }),
      exam({ id: 'ahead', date: '2026-08-12', time: '10:00 AM' }),
    ], now);
    expect(next?.exam.id).toBe('ahead');
    expect(next?.timePending).toBe(false);
  });

  it('does not let the day rule rescue yesterday', () => {
    expect(nextUpcomingExam([exam({ date: '2026-08-09', time: '' })], now)).toBeNull();
    expect(nextUpcomingExam([exam({ date: 'not-a-date', time: '10:00 AM' })], now)).toBeNull();
  });

  it('lists every paper still ahead, soonest first, skipping undated rows', () => {
    const list = upcomingExams([
      exam({ id: 'later', date: '2026-08-21', time: '10:00 AM' }),
      exam({ id: 'undated', date: '', time: '' }),
      exam({ id: 'written', date: '2026-08-01', time: '09:00 AM' }),
      exam({ id: 'sooner', date: '2026-08-11', time: '09:00 AM' }),
    ], now);
    expect(list.map((item) => item.exam.id)).toEqual(['sooner', 'later']);
    expect(list.map((item) => item.countdown)).toEqual(['23h 30m', '11 days']);
    // The single answer the banner uses is the head of the same list.
    expect(nextUpcomingExam([
      exam({ id: 'later', date: '2026-08-21', time: '10:00 AM' }),
      exam({ id: 'sooner', date: '2026-08-11', time: '09:00 AM' }),
    ], now)?.exam.id).toBe('sooner');
  });
});

describe('enrichExamsWithCourses', () => {
  const timetable: TimetableSlot[] = [
    { id: 't1', slot: 'A1', courseCode: 'CSE2001', courseTitle: 'Data Structures', courseType: 'ETH', facultyName: 'Dr. X', venue: 'SJT 204', building: '', startTime: '08:00', endTime: '08:50', day: 'Monday' },
    { id: 't2', slot: 'B1', courseCode: 'CSE2004', courseTitle: 'DBMS', courseType: 'ETH', facultyName: 'Prof. Y', venue: 'SJT 308', building: '', startTime: '09:00', endTime: '09:50', day: 'Monday' },
  ];

  it('fills courseCode/title by slot when the exam page lacks them', () => {
    const exams: ExamRecord[] = [
      { id: 'ex1', slot: 'A1', courseCode: '', courseTitle: '', examType: 'CAT 2', date: '2026-08-18', time: '10:00 AM - 11:30 AM', venue: 'SJT 402', seatNo: '', syllabusTopics: [] },
    ];
    const enriched = enrichExamsWithCourses(exams, timetable);
    expect(enriched[0].courseCode).toBe('CSE2001');
    expect(enriched[0].courseTitle).toBe('Data Structures');
  });

  it('leaves exams untouched when no slot matches (never guesses)', () => {
    const exams: ExamRecord[] = [
      { id: 'ex1', slot: 'Z9', courseCode: '', courseTitle: '', examType: 'FAT', date: '2026-09-01', time: '09:00 AM - 12:00 PM', venue: '', seatNo: '', syllabusTopics: [] },
    ];
    const enriched = enrichExamsWithCourses(exams, timetable);
    expect(enriched[0].courseCode).toBe('');
    expect(enriched[0].courseTitle).toBe('');
  });

  it('keeps explicit course codes from the source', () => {
    const exams: ExamRecord[] = [
      { id: 'ex1', slot: 'A1', courseCode: 'CSE2001', courseTitle: 'Data Structures', examType: 'CAT 2', date: '2026-08-18', time: '10:00 AM - 11:30 AM', venue: 'SJT 402', seatNo: '', syllabusTopics: [] },
    ];
    const enriched = enrichExamsWithCourses(exams, timetable);
    expect(enriched[0].courseCode).toBe('CSE2001');
  });
});

describe('istDateLabel / isSameIstDay', () => {
  it('reports the India calendar day, not the device or UTC day', () => {
    // 23:00 UTC on 20 Aug is already 04:30 IST on 21 Aug.
    expect(istDateLabel(new Date(Date.UTC(2026, 7, 20, 23, 0)))).toBe('2026-08-21');
    // 18:00 UTC on 20 Aug is 23:30 IST the same day.
    expect(istDateLabel(new Date(Date.UTC(2026, 7, 20, 18, 0)))).toBe('2026-08-20');
    // Just before the IST day turns over.
    expect(istDateLabel(new Date(Date.UTC(2026, 7, 20, 18, 29, 59)))).toBe('2026-08-20');
  });

  it('matches today only on the same India date', () => {
    const now = new Date(Date.UTC(2026, 7, 20, 23, 0)); // 21 Aug, 04:30 IST
    expect(isSameIstDay('2026-08-21', now)).toBe(true);
    expect(isSameIstDay('2026-08-20', now)).toBe(false);
    expect(isSameIstDay(undefined, now)).toBe(false);
    expect(isSameIstDay('21-08-2026', now)).toBe(false);
  });

  it('starts the India day at 00:00 IST (18:30 UTC the previous day)', () => {
    expect(istTodayStartMs(new Date(Date.UTC(2026, 7, 20, 23, 0)))).toBe(Date.UTC(2026, 7, 20, 18, 30));
  });
});

describe('how many days a VTOP date is away', () => {
  // India's midnight, as an instant: 18:30 UTC on the day before.
  const istMidnight = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) - 5.5 * 60 * 60 * 1000;

  it('anchors a VTOP date to India\'s calendar, not the device\'s', () => {
    expect(vtopDateDayStartMs('2026-09-16')).toBe(istMidnight(2026, 9, 16));
    // The LMS writes the same day the other way round; both must land on it.
    expect(vtopDateDayStartMs('16-09-2026')).toBe(istMidnight(2026, 9, 16));
  });

  it('says nothing about a date VTOP did not give', () => {
    for (const raw of ['', '   ', 'TBD', '16/09/2026', '2026-13-05', '2026-09-32']) {
      expect(vtopDateDayStartMs(raw), raw).toBeNull();
      expect(calendarDaysUntil(raw, Date.now()), raw).toBeNull();
    }
  });

  it('says nothing about a day inside the ranges but not in the month', () => {
    // The out-of-range cases above were already refused. This is the one the
    // range check could not see: 2026-02-30 satisfies "day 1-31" and Date.UTC
    // answered with 1 March, so an assignment VTOP never dated read as due on a
    // day two later, and "days until" was wrong by however far it rolled.
    for (const raw of ['2026-02-30', '2026-02-31', '2026-04-31', '2025-02-29', '30-02-2026', '29-02-2025']) {
      expect(vtopDateDayStartMs(raw), raw).toBeNull();
      expect(calendarDaysUntil(raw, Date.now()), raw).toBeNull();
    }
    // and the day that exists is still measured exactly
    expect(vtopDateDayStartMs('2028-02-29')).toBe(istMidnight(2028, 2, 29));
    expect(vtopDateDayStartMs('30-06-2026')).toBe(istMidnight(2026, 6, 30));
  });

  it('calls a deadline today zero, whoever is holding the phone', () => {
    // 09:30 IST on 14 September — the same instant is 04:00 UTC and 21:00 the
    // previous evening in San Francisco. Only the India day matters.
    const morningIst = istMidnight(2026, 9, 14) + 9.5 * 60 * 60 * 1000;
    expect(calendarDaysUntil('2026-09-14', morningIst)).toBe(0);
    expect(calendarDaysUntil('14-09-2026', morningIst)).toBe(0);
    expect(calendarDaysUntil('2026-09-15', morningIst)).toBe(1);
    expect(calendarDaysUntil('2026-09-12', morningIst)).toBe(-2);
  });

  it('counts an exam week the same way from either date spelling', () => {
    const today = istMidnight(2026, 9, 14) + 9.5 * 60 * 60 * 1000;
    const days = ['17-09-2026', '19-09-2026'].map((d) => calendarDaysUntil(d, today));
    expect(days).toEqual([3, 5]);
    expect(days.filter((d) => (d ?? 0) <= 7)).toHaveLength(2);
  });
});
