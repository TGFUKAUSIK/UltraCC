/**
 * examUtils.ts — exam helpers (IST-safe). Ported from the web app, using the
 * canonical VTOP ExamRecord / TimetableSlot types.
 */

import { ExamRecord, TimetableSlot } from '../types';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export function examStartMs(date: string, time: string): number | null {
  if (!date) return null;
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);

  let hour = 0;
  let minute = 0;
  const timeMatch = time ? time.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i) : null;
  if (timeMatch) {
    let h = parseInt(timeMatch[1], 10);
    minute = parseInt(timeMatch[2], 10);
    const ap = (timeMatch[3] || '').toUpperCase();
    if (ap === 'PM' && h !== 12) h += 12;
    else if (ap === 'AM' && h === 12) h = 0;
    hour = h;
  }
  return Date.UTC(year, month - 1, day, hour, minute) - IST_OFFSET_MS;
}

export function countdownLabel(startsAtMs: number, nowMs: number): string {
  const diff = startsAtMs - nowMs;
  if (diff <= 0) return 'Today';
  const days = Math.floor(diff / 86400000);
  if (days >= 1) return `${days} day${days > 1 ? 's' : ''}`;
  const hours = Math.floor(diff / 3600000);
  if (hours >= 1) return `${hours}h ${Math.floor((diff % 3600000) / 60000)}m`;
  return `${Math.max(1, Math.round(diff / 60000))}m`;
}

export function istDateLabel(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() + IST_OFFSET_MS);
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${month}-${day}`;
}

export function isSameIstDay(dateStr: string | undefined, now: Date = new Date()): boolean {
  return !!dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr.trim()) && dateStr.trim() === istDateLabel(now);
}

export function istTodayStartMs(now: Date = new Date()): number {
  return examStartMs(istDateLabel(now), '00:00') ?? Number.NaN;
}

export interface NextExam {
  exam: ExamRecord;
  startsAtMs: number;
  countdown: string;
}

export function nextUpcomingExam(exams: ExamRecord[], nowMs = Date.now()): NextExam | null {
  const candidates = exams
    .map((exam) => ({ exam, startsAtMs: examStartMs(exam.date, exam.time) }))
    .filter((x): x is { exam: ExamRecord; startsAtMs: number } => x.startsAtMs !== null)
    .filter((x) => x.startsAtMs >= nowMs)
    .sort((a, b) => a.startsAtMs - b.startsAtMs);
  const first = candidates[0];
  if (!first) return null;
  return { exam: first.exam, startsAtMs: first.startsAtMs, countdown: countdownLabel(first.startsAtMs, nowMs) };
}

export function enrichExamsWithCourses(exams: ExamRecord[], timetable: TimetableSlot[]): ExamRecord[] {
  const courseBySlot = new Map<string, { code: string; title: string }>();
  for (const slot of timetable) {
    if (!courseBySlot.has(slot.slot)) {
      courseBySlot.set(slot.slot, { code: slot.courseCode, title: slot.courseTitle });
    }
  }
  return exams.map((e) => {
    const primarySlot = (e.slot || '').split('+')[0].trim();
    const course = primarySlot ? courseBySlot.get(primarySlot) : undefined;
    if (!course) return e;
    return { ...e, courseCode: course.code, courseTitle: course.title };
  });
}
