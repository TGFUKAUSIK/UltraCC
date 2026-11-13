import { useCallback, useSyncExternalStore } from 'react';
import { getTargetAttendance, saveTargetAttendance, subscribeTargetAttendance } from './settings';

/**
 * The student's own attendance bar, read live.
 *
 * The Academics tab shows this number in three places at once — the slider,
 * the per-course cards and the course-intelligence cards under them — and each
 * used to keep its own copy. The slider wrote the preference while the
 * intelligence cards asked for a hardcoded 75%, so one course could read "3
 * safe bunks" on a card and "0 safe bunks" on the card beside it.
 *
 * Going through the store instead of one component's state means a slider drag
 * repaints every surface in the same frame, and a fresh mount shows the saved
 * target on its first render rather than one effect later.
 */
export function useTargetAttendance(): [number, (percent: number) => void] {
  const target = useSyncExternalStore(subscribeTargetAttendance, getTargetAttendance, getTargetAttendance);
  const setTarget = useCallback((percent: number) => {
    saveTargetAttendance(percent);
  }, []);
  return [target, setTarget];
}
