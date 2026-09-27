/**
 * Quiz-window notifications (3a) — the highest-value LMS feature.
 *
 * For every LMS quiz with an open/close window, schedule local notifications:
 *   - "opens in 15 min"  (15 minutes before openTime)
 *   - "closes in 15 min" (15 minutes before closeTime)
 *   - "closes in 5 min"  (5 minutes before closeTime)
 *
 * Fired notifications are persisted in IndexedDB (quizNotifications) so a
 * given trigger never fires twice, even across app restarts. While the app
 * is open, in-page notifications also render in the Quiz Tracker view.
 *
 * Privacy: notification content is course/quiz names only — no credentials.
 */

import { LmsQuizWindow } from './types';
import { vtopDb } from '../db/vtopDatabase';

export type QuizTriggerKey = 'opened' | 'close-15min' | 'close-5min';

export interface QuizTrigger {
  id: string; // `${quizId}:${triggerKey}`
  quizId: number;
  triggerKey: QuizTriggerKey;
  at: number; // epoch ms
  title: string;
  body: string;
}

/** Compute all pending triggers for a quiz at the current time. */
export function computeQuizTriggers(quiz: LmsQuizWindow, now = Date.now()): QuizTrigger[] {
  const triggers: QuizTrigger[] = [];
  const open = quiz.openTime ? new Date(quiz.openTime).getTime() : null;
  const close = quiz.closeTime ? new Date(quiz.closeTime).getTime() : null;

  if (open && open > now) {
    triggers.push({
      id: `${quiz.quizId}:opened`,
      quizId: quiz.quizId,
      triggerKey: 'opened',
      at: open - 15 * 60 * 1000,
      title: `Quiz opens soon: ${quiz.name}`,
      body: `${quiz.name} opens in 15 minutes (${fmt(open)}).`,
    });
  }
  if (close && close > now) {
    triggers.push({
      id: `${quiz.quizId}:close-15min`,
      quizId: quiz.quizId,
      triggerKey: 'close-15min',
      at: close - 15 * 60 * 1000,
      title: `Quiz closes soon: ${quiz.name}`,
      body: `${quiz.name} closes in 15 minutes (${fmt(close)}).`,
    });
    triggers.push({
      id: `${quiz.quizId}:close-5min`,
      quizId: quiz.quizId,
      triggerKey: 'close-5min',
      at: close - 5 * 60 * 1000,
      title: `Quiz closing: ${quiz.name}`,
      body: `${quiz.name} closes in 5 minutes!`,
    });
  }
  return triggers;
}

/**
 * Evaluate all quizzes: find due triggers (time reached AND not yet fired),
 * fire them, and persist the fired ids. Call after each LMS sync and on a
 * periodic interval while the app is open.
 */
export async function evaluateQuizNotifications(quizzes: LmsQuizWindow[], now = Date.now()): Promise<void> {
  if (typeof Notification === 'undefined') return;
  const fired = await vtopDb.getQuizNotifications();
  const firedIds = new Set(fired.map((r) => r.id));

  const toFire: QuizTrigger[] = [];
  for (const q of quizzes) {
    for (const t of computeQuizTriggers(q, now)) {
      if (t.at <= now && !firedIds.has(t.id)) toFire.push(t);
    }
  }

  if (!toFire.length) return;

  let permission = Notification.permission;
  if (permission === 'default') {
    try {
      permission = await Notification.requestPermission();
    } catch { permission = 'denied'; }
  }

  const firedRecords: { id: string; quizId: number; triggerKey: QuizTriggerKey; firedAt: number }[] = [];
  for (const t of toFire) {
    firedRecords.push({ id: t.id, quizId: t.quizId, triggerKey: t.triggerKey, firedAt: now });
    if (permission === 'granted') {
      try {
        new Notification(t.title, { body: t.body, icon: '/icon-192.svg' });
      } catch { /* ignore */ }
    }
  }
  await vtopDb.putQuizNotifications(firedRecords);
}

/** Start a 30s polling loop while the app is open (returns a stop fn). */
export function startQuizNotificationWatcher(quizzes: () => LmsQuizWindow[]): () => void {
  const iv = setInterval(() => {
    evaluateQuizNotifications(quizzes()).catch(() => { /* best effort */ });
  }, 30 * 1000);
  return () => clearInterval(iv);
}

function fmt(ts: number): string {
  const d = new Date(ts);
  const date = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  return `${date}, ${time}`;
}
