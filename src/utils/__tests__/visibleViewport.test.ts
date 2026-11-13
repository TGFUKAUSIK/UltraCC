/**
 * The keyboard override behind `--uc-visible-height`.
 *
 * The shell is no longer sized from this module at all: `#root` is pinned in
 * CSS and the tab bar is its last in-flow row, so nothing here runs in the
 * normal height cascade. What is left is the ONE case where the visible box and
 * the layout box genuinely differ — an on-screen keyboard — and the guards below
 * are about never publishing a height outside that case, and never leaving one
 * behind.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { KEYBOARD_OPEN_CLASS, VISIBLE_HEIGHT_VAR, trackVisibleViewportHeight, visibleViewportHeight } from '../visibleViewport';

interface FakeViewport {
  height: number;
  scale?: number;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
}

function fakeViewport(height: number, scale = 1): FakeViewport {
  return { height, scale, addEventListener: vi.fn(), removeEventListener: vi.fn() };
}

function setInnerHeight(value: number) {
  Object.defineProperty(window, 'innerHeight', { value, configurable: true, writable: true });
}

function setVisualViewport(viewport: FakeViewport | null) {
  Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true, writable: true });
}

/** The handler the tracker registered on the visual viewport's `resize`. */
const fire = (viewport: FakeViewport) =>
  (viewport.addEventListener.mock.calls.find((call) => call[0] === 'resize')?.[1] as () => void)();

afterEach(() => {
  setVisualViewport(null);
});

describe('visibleViewportHeight', () => {
  it('uses the visible viewport when it is smaller than the layout viewport', () => {
    // iOS Safari: `innerHeight` keeps reporting the large viewport while the
    // bottom toolbar is up. Trusting it left a shell taller than the screen.
    expect(visibleViewportHeight({ height: 660 }, 844)).toBe(660);
  });

  it('never publishes a height beyond the layout viewport', () => {
    expect(visibleViewportHeight({ height: 900 }, 844)).toBe(844);
  });

  it('falls back to the layout height when there is no visual viewport', () => {
    expect(visibleViewportHeight(null, 844)).toBe(844);
    expect(visibleViewportHeight(undefined, 700)).toBe(700);
  });

  it('ignores a pinch-zoomed measurement instead of halving the shell', () => {
    expect(visibleViewportHeight({ height: 422, scale: 2 }, 844)).toBe(0);
  });

  it('returns 0 only when even the layout height is unmeasurable', () => {
    expect(visibleViewportHeight({ height: 660 }, Number.NaN)).toBe(0);
    expect(visibleViewportHeight({ height: 660 }, 0)).toBe(0);
    // A broken viewport reading is not a reason to publish nothing — the
    // layout height is the next honest number.
    expect(visibleViewportHeight({ height: -5 }, 844)).toBe(844);
  });

  it('rounds to whole pixels', () => {
    expect(visibleViewportHeight({ height: 660.4 }, 844)).toBe(660);
  });
});

describe('the override exists only while a keyboard is up', () => {
  it('publishes nothing with no caret in a text field', () => {
    setInnerHeight(844);
    // 444px of inset: keyboard-sized, but nothing is focused.
    setVisualViewport(fakeViewport(400));
    const target = document.createElement('div');

    trackVisibleViewportHeight(target);

    expect(target.style.getPropertyValue(VISIBLE_HEIGHT_VAR), 'no caret, no override').toBe('');
    expect(target.classList.contains(KEYBOARD_OPEN_CLASS)).toBe(false);
  });

  it('publishes nothing for a focused button', () => {
    vi.useFakeTimers();
    const button = document.createElement('button');
    const target = document.createElement('div');
    document.body.appendChild(button);
    document.body.appendChild(target);
    try {
      setInnerHeight(844);
      const viewport = fakeViewport(400);
      setVisualViewport(viewport);
      trackVisibleViewportHeight(target);
      button.focus();
      fire(viewport);
      vi.advanceTimersByTime(1000);
      expect(target.classList.contains(KEYBOARD_OPEN_CLASS)).toBe(false);
      expect(target.style.getPropertyValue(VISIBLE_HEIGHT_VAR)).toBe('');
    } finally {
      vi.useRealTimers();
      button.remove();
      target.remove();
    }
  });

  it('engages after the inset and caret have held, then releases both halves', () => {
    vi.useFakeTimers();
    const field = document.createElement('input');
    const target = document.createElement('div');
    document.body.appendChild(field);
    document.body.appendChild(target);
    try {
      setInnerHeight(844);
      const viewport = fakeViewport(400);
      setVisualViewport(viewport);
      trackVisibleViewportHeight(target);

      // The caret is in the field now, but the override still waits a beat.
      field.focus();
      fire(viewport);
      expect(target.classList.contains(KEYBOARD_OPEN_CLASS), 'one frame is not a keyboard').toBe(false);
      expect(target.style.getPropertyValue(VISIBLE_HEIGHT_VAR)).toBe('');
      vi.advanceTimersByTime(80);
      expect(target.classList.contains(KEYBOARD_OPEN_CLASS), 'a held inset is a keyboard').toBe(true);
      expect(target.style.getPropertyValue(VISIBLE_HEIGHT_VAR), 'the pinned root is sized to the visible box').toBe('400px');

      // The keyboard closes: the visible box grows back and BOTH halves leave at
      // once — a stale height or a bar lingering over a dismissed keyboard is
      // worse than neither.
      viewport.height = 844;
      fire(viewport);
      expect(target.classList.contains(KEYBOARD_OPEN_CLASS)).toBe(false);
      expect(target.style.getPropertyValue(VISIBLE_HEIGHT_VAR), 'no stale inline height may survive').toBe('');
    } finally {
      vi.useRealTimers();
      field.remove();
      target.remove();
    }
  });

  it('follows the keyboard as it resizes while engaged', () => {
    vi.useFakeTimers();
    const field = document.createElement('input');
    const target = document.createElement('div');
    document.body.appendChild(field);
    document.body.appendChild(target);
    try {
      setInnerHeight(844);
      const viewport = fakeViewport(400);
      setVisualViewport(viewport);
      trackVisibleViewportHeight(target);
      field.focus();
      fire(viewport);
      vi.advanceTimersByTime(80);
      expect(target.style.getPropertyValue(VISIBLE_HEIGHT_VAR)).toBe('400px');

      viewport.height = 320;
      fire(viewport);
      expect(target.style.getPropertyValue(VISIBLE_HEIGHT_VAR), 'a taller keyboard must shrink the root further').toBe('320px');
      expect(target.classList.contains(KEYBOARD_OPEN_CLASS)).toBe(true);
    } finally {
      vi.useRealTimers();
      field.remove();
      target.remove();
    }
  });

  it('releases when the field loses the caret, without any resize', () => {
    vi.useFakeTimers();
    const field = document.createElement('input');
    const target = document.createElement('div');
    document.body.appendChild(field);
    document.body.appendChild(target);
    try {
      setInnerHeight(844);
      setVisualViewport(fakeViewport(400));
      trackVisibleViewportHeight(target);
      field.focus();
      field.dispatchEvent(new Event('focusin', { bubbles: true }));
      vi.advanceTimersByTime(80);
      expect(target.classList.contains(KEYBOARD_OPEN_CLASS)).toBe(true);

      field.blur();
      field.dispatchEvent(new Event('focusout', { bubbles: true }));
      expect(target.classList.contains(KEYBOARD_OPEN_CLASS), 'the caret left, so the override must go').toBe(false);
      expect(target.style.getPropertyValue(VISIBLE_HEIGHT_VAR)).toBe('');
    } finally {
      vi.useRealTimers();
      field.remove();
      target.remove();
    }
  });

  it('never engages while the page is pinch-zoomed', () => {
    vi.useFakeTimers();
    const field = document.createElement('input');
    const target = document.createElement('div');
    document.body.appendChild(field);
    document.body.appendChild(target);
    try {
      setInnerHeight(844);
      const viewport = fakeViewport(330, 2);
      setVisualViewport(viewport);
      trackVisibleViewportHeight(target);
      field.focus();
      fire(viewport);
      vi.advanceTimersByTime(1000);
      expect(target.classList.contains(KEYBOARD_OPEN_CLASS)).toBe(false);
      expect(target.style.getPropertyValue(VISIBLE_HEIGHT_VAR)).toBe('');
    } finally {
      vi.useRealTimers();
      field.remove();
      target.remove();
    }
  });

  it('never engages in an engine with no visual viewport', () => {
    vi.useFakeTimers();
    const field = document.createElement('input');
    const target = document.createElement('div');
    document.body.appendChild(field);
    document.body.appendChild(target);
    try {
      setInnerHeight(740);
      setVisualViewport(null);
      trackVisibleViewportHeight(target);
      field.focus();
      vi.advanceTimersByTime(1000);
      expect(target.classList.contains(KEYBOARD_OPEN_CLASS), 'no measurement, no keyboard, no override').toBe(false);
      expect(target.style.getPropertyValue(VISIBLE_HEIGHT_VAR)).toBe('');
    } finally {
      vi.useRealTimers();
      field.remove();
      target.remove();
    }
  });

  it('watches the visual viewport and the caret, and detaches on cleanup', () => {
    setInnerHeight(844);
    const viewport = fakeViewport(844);
    setVisualViewport(viewport);
    const target = document.createElement('div');
    const stop = trackVisibleViewportHeight(target);

    expect(viewport.addEventListener.mock.calls.map(([type]) => type).sort()).toEqual(['resize', 'scroll']);
    stop();
    expect(viewport.removeEventListener.mock.calls.map(([type]) => type).sort()).toEqual(['resize', 'scroll']);
    expect(viewport.removeEventListener.mock.calls[0][1], 'the same handler must be the one detached')
      .toBe(viewport.addEventListener.mock.calls[0][1]);
  });

  it('releases the override when it is cleaned up', () => {
    vi.useFakeTimers();
    const field = document.createElement('input');
    const target = document.createElement('div');
    document.body.appendChild(field);
    document.body.appendChild(target);
    try {
      setInnerHeight(844);
      const viewport = fakeViewport(400);
      setVisualViewport(viewport);
      const stop = trackVisibleViewportHeight(target);
      field.focus();
      fire(viewport);
      vi.advanceTimersByTime(80);
      expect(target.classList.contains(KEYBOARD_OPEN_CLASS)).toBe(true);

      stop();
      expect(target.classList.contains(KEYBOARD_OPEN_CLASS)).toBe(false);
      expect(target.style.getPropertyValue(VISIBLE_HEIGHT_VAR)).toBe('');
    } finally {
      vi.useRealTimers();
      field.remove();
      target.remove();
    }
  });

  it('clears a stale override left by an earlier mount before doing anything else', () => {
    setInnerHeight(844);
    setVisualViewport(fakeViewport(844));
    const target = document.createElement('div');
    // What a previous HMR/remount could have left behind.
    target.classList.add(KEYBOARD_OPEN_CLASS);
    target.style.setProperty(VISIBLE_HEIGHT_VAR, '540px');

    trackVisibleViewportHeight(target);

    expect(target.classList.contains(KEYBOARD_OPEN_CLASS)).toBe(false);
    expect(target.style.getPropertyValue(VISIBLE_HEIGHT_VAR)).toBe('');
  });
});
