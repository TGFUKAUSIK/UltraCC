import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

/**
 * How far the student has to throw a sheet down before it closes, in px.
 *
 * A throw is not a scroll: the head the gesture starts from opts out of panning
 * (`touch-action: none` on `.uc-sheet-head`), so this is the only number that
 * separates "I meant to close it" from a thumb that twitched. Below it the
 * sheet springs back untouched, which is what makes the gesture safe to try.
 */
export const SHEET_DISMISS_DISTANCE = 96;

export interface SheetDragOptions {
  /** Called when the sheet is thrown far enough to close. */
  onDismiss: () => void;
  /**
   * false while the sheet is mid-task. A sign-in that is halfway through the
   * CAPTCHA has already spent VTOP's single-use image, and a settings sync has
   * already dropped the old LMS pair — throwing the sheet away at that moment
   * would hide the work rather than cancel it, so the gesture goes inert and
   * the sheet sits still under the thumb.
   */
  enabled?: boolean;
}

export interface SheetDrag {
  /** Downward offset in px while the student holds the sheet; 0 otherwise. */
  offset: number;
  /** true only between pointerdown and pointerup. */
  dragging: boolean;
  /** Spread onto the draggable element — the sheet head. */
  handlers: {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  };
}

/**
 * Throw-to-dismiss for a bottom sheet.
 *
 * The gesture is built from pointer events and nothing else (see
 * `mobileScrollRefresh.test.ts`: `onTouchMove` is banned outright, because the
 * one thing a touch handler on a sheet would hijack is the scroll underneath
 * it). The offset is applied as a `translateY` transform and never as a layout
 * property, so dragging stays on the compositor at 60fps; the snap-back is the
 * CSS transition on `.uc-sheet`, which is why this hook has no easing of its
 * own and simply stops moving the moment the finger lifts.
 *
 * `enabled`, `onDismiss` and the live offset are read through refs so the four
 * handlers keep one identity across renders — a drag in progress must not be
 * interrupted by a re-render caused by the very state it is producing.
 */
export function useSheetDrag({ onDismiss, enabled = true }: SheetDragOptions): SheetDrag {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);

  const fromRef = useRef<number | null>(null);
  const offsetRef = useRef(0);
  const pointerRef = useRef<number | null>(null);
  const dismissRef = useRef(onDismiss);
  const enabledRef = useRef(enabled);
  dismissRef.current = onDismiss;
  enabledRef.current = enabled;

  const reset = useCallback(() => {
    fromRef.current = null;
    pointerRef.current = null;
    offsetRef.current = 0;
    setOffset(0);
    setDragging(false);
  }, []);

  // A sheet that becomes busy mid-drag (a sync starting under the thumb) must
  // not be left hanging halfway down the screen.
  useEffect(() => {
    if (!enabled) reset();
  }, [enabled, reset]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!enabledRef.current) return;
    // One finger or the primary mouse button only — a second finger is a pinch
    // or a scroll the student did not mean as a throw.
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (fromRef.current !== null) return;
    // A press that starts on a control belongs to that control. Capturing the
    // pointer on the head would retarget the pointerup and swallow the click,
    // which is exactly what made the sheet's close button dead on touch.
    const target = event.target;
    if (target instanceof Element && target.closest('button, a, input, select, textarea, [role="switch"]')) return;
    fromRef.current = event.clientY;
    pointerRef.current = event.pointerId;
    offsetRef.current = 0;
    setDragging(true);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Capture is an optimisation for tracking outside the element; the
      // handlers below work without it.
    }
  }, []);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!enabledRef.current || fromRef.current === null) return;
    if (pointerRef.current !== event.pointerId) return;
    // Downward only: pulling the sheet up past its resting place would tear a
    // hole above it, and there is nothing up there to reveal.
    const next = Math.max(0, event.clientY - fromRef.current);
    offsetRef.current = next;
    setOffset(next);
  }, []);

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (fromRef.current === null) return;
    if (pointerRef.current !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const thrown = enabledRef.current && offsetRef.current >= SHEET_DISMISS_DISTANCE;
    // Reset first, so a render caused by the dismissal cannot paint the sheet
    // at the dragged position for a frame.
    reset();
    if (thrown) dismissRef.current();
  }, [reset]);

  const onPointerCancel = useCallback(() => {
    // The gesture was taken away (a call, a system sheet): put the sheet back
    // where it was rather than treating the interruption as a throw.
    reset();
  }, [reset]);

  return {
    offset,
    dragging,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
  };
}
