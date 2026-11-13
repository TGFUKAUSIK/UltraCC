/**
 * quizWindow.ts — one reading of a quiz's open/close window.
 *
 * A quiz window is two instants VTOP publishes (open, close) and one question
 * every surface asks: is it open right now, and how long is left? It used to be
 * answered inside QuizTrackerView, which meant Home could not show a quiz
 * countdown without a second copy of the rule — and two copies eventually
 * disagree, which is exactly how a student ends up trusting a number that is
 * wrong on one screen and right on another.
 *
 * The `at` field is the instant the *next* thing happens (the close while open,
 * the open while not), so callers that build a combined deadline feed can sort
 * quizzes alongside assignments without re-deriving it.
 */

import type { LmsQuizWindow } from './types';

export type QuizStatus = 'open-now' | 'not-open' | 'closed' | 'unknown';

export interface QuizWindowState {
  status: QuizStatus;
  /** Ready to print: "Closes in 6h 12m", "Closed", "Timing not published". */
  label: string;
  /** Epoch ms of the next transition, or null when VTOP published no window. */
  at: number | null;
}

/** Minutes/hours left, in the register the rest of the app counts down in. */
export function quizCountdown(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60000));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

export function quizStatus(quiz: LmsQuizWindow, now = Date.now()): QuizWindowState {
  const open = quiz.openTime ? new Date(quiz.openTime).getTime() : null;
  const close = quiz.closeTime ? new Date(quiz.closeTime).getTime() : null;
  if (open !== null && close !== null) {
    if (now < open) return { status: 'not-open', label: `Opens in ${quizCountdown(open - now)}`, at: open };
    if (now <= close) return { status: 'open-now', label: `Closes in ${quizCountdown(close - now)}`, at: close };
    return { status: 'closed', label: 'Closed', at: null };
  }
  if (open !== null) {
    if (now < open) return { status: 'not-open', label: `Opens in ${quizCountdown(open - now)}`, at: open };
    return { status: 'closed', label: 'Closed', at: null };
  }
  if (close !== null) {
    if (now <= close) return { status: 'open-now', label: `Closes in ${quizCountdown(close - now)}`, at: close };
    return { status: 'closed', label: 'Closed', at: null };
  }
  return { status: 'unknown', label: quiz.submissionStatus || 'Timing not published', at: null };
}
