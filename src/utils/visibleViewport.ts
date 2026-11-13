/**
 * The on-screen keyboard is the only thing this module measures.
 *
 * The phone shell used to be sized from `visualViewport.height` at all times,
 * published as `--uc-visible-height`. That was the wrong shape: on a real
 * iPhone 12 (Safari *and* the installed home-screen app) a blank strip still
 * sat below the tab bar, because a fixed element that stops short of the
 * screen edge means the LAYOUT viewport is smaller than the window, and no
 * height this module can publish moves a box into the difference. The strip is
 * removed structurally instead — `#root` is pinned with `position: fixed;
 * inset: 0`, the document never scrolls, and the tab bar is the last in-flow
 * row of that pinned box (`src/index.css`). With the shell no longer sized
 * from a measurement, nothing in the normal height cascade reads this module.
 *
 * What is left is the keyboard, which is a genuine, temporary split between
 * the visible box and the layout box: iOS shrinks `visualViewport.height` (and
 * scrolls `offsetTop`) while the layout viewport — and therefore a fixed box —
 * keeps its full height, so the field being typed into would sit behind the
 * keys. While a keyboard is up, `html.uc-keyboard-open #root` is sized to the
 * measured visual height and released from the fixed bottom; the tab bar rides
 * that edge up above the keys, which is also why nothing may translate the bar
 * instead.
 *
 * The class and the property are raised together and removed together, and
 * neither exists outside the keyboard case: a stale inline height or a stale
 * `--uc-visible-height` would be a second, wrong answer to a question the
 * pinned frame has already answered.
 *
 * WHY THE GATE IS SO NARROW (each part was a bug on a real device). A keyboard
 * cannot exist without a field holding the caret, so the caret must actually be
 * in a text field — a focused button is not a keyboard. The inset must hold for
 * a beat, because iOS reports a one-frame inset while the URL bar settles during
 * a programme scroll or a route change, and a single frame of that used to blink
 * the tab bar out on the very tap that navigated. The threshold sits well above
 * any browser-chrome delta (a collapsing URL bar moves the visible height by
 * ~60px) and well below any keyboard (iOS and Android both take 250px or more).
 * Nothing here may act in the installed app with no keyboard at all.
 */

export const VISIBLE_HEIGHT_VAR = '--uc-visible-height';

/**
 * Raised on the element the height is published to (the document element in the
 * app) while the on-screen keyboard is up.
 *
 * The phone shell shrinks to `--uc-visible-height`, so the tab bar — its last
 * flex row — would ride up and sit over the field the student is typing in.
 * `index.css` hides the bar while this class is present, which gives the field
 * back the bar's height too.
 */
export const KEYBOARD_OPEN_CLASS = 'uc-keyboard-open';
const KEYBOARD_MIN_INSET = 150;
/** How long the inset and the caret must both hold before the override goes on. */
const KEYBOARD_OPEN_DELAY_MS = 80;

interface ViewportLike {
  height: number;
  scale?: number;
}

/**
 * Visible height in CSS pixels, clamped so it can never exceed the layout
 * viewport (`innerHeight`) — a shell taller than the box the browser renders
 * into would clip the tab bar's own labels. Returns 0 when nothing trustworthy
 * is measurable — the caller then leaves the pinned frame in charge.
 */
export function visibleViewportHeight(
  viewport: ViewportLike | null | undefined,
  layoutHeight: number,
): number {
  const layout = Math.round(layoutHeight);
  if (!Number.isFinite(layout) || layout <= 0) return 0;
  const raw = viewport?.height;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return layout;
  // Pinch zoom divides the visual viewport by the scale factor. That measurement
  // describes the zoomed canvas, not the device screen, so report nothing
  // (0 = the keyboard override stays off and the pinned frame holds).
  if ((viewport?.scale ?? 1) > 1.05) return 0;
  return Math.min(Math.round(raw), layout);
}

/**
 * True only when the caret is in something a keyboard can be raised for. A
 * focused button, a stray activeElement shift, or no focus at all is not a
 * keyboard.
 */
function hasFocusedTextField(): boolean {
  const el = typeof document === 'undefined' ? null : document.activeElement;
  if (!el) return false;
  if (typeof HTMLTextAreaElement !== 'undefined' && el instanceof HTMLTextAreaElement) return true;
  if (typeof HTMLInputElement !== 'undefined' && el instanceof HTMLInputElement) {
    if (el.isContentEditable) return true;
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    return !['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'].includes(type);
  }
  return typeof HTMLElement !== 'undefined' && el instanceof HTMLElement && el.isContentEditable;
}

/**
 * Drives the keyboard-only override: writes `--uc-visible-height` on `target`
 * and raises `uc-keyboard-open` while a text field holds the caret and the
 * visible box has genuinely given away keyboard height, and removes BOTH the
 * moment that stops being true (blur, keyboard dismissal, rotation, zoom, or a
 * resize that closes the gap). Returns the cleanup function, which detaches the
 * listeners this call added and releases the override.
 */
export function trackVisibleViewportHeight(target: HTMLElement): () => void {
  let openTimer: ReturnType<typeof setTimeout> | null = null;

  const measure = (): { height: number; inset: number } => {
    const viewport = typeof window === 'undefined' ? null : window.visualViewport;
    const layout = typeof window === 'undefined' ? 0 : window.innerHeight;
    const height = visibleViewportHeight(viewport, layout);
    return { height, inset: height > 0 ? Math.round(layout) - height : 0 };
  };

  const keyboardIsUp = () => {
    const { height, inset } = measure();
    return height > 0 && inset >= KEYBOARD_MIN_INSET && hasFocusedTextField();
  };

  // Off is immediate: an override that lingers after the keyboard has gone is
  // worse than none. Both halves come off together, so no stale height can be
  // read by the CSS gate or by the debug overlay.
  const release = () => {
    if (openTimer !== null) { clearTimeout(openTimer); openTimer = null; }
    target.classList.remove(KEYBOARD_OPEN_CLASS);
    if (target.style.getPropertyValue(VISIBLE_HEIGHT_VAR)) target.style.removeProperty(VISIBLE_HEIGHT_VAR);
  };

  const sync = () => {
    if (!keyboardIsUp()) { release(); return; }
    if (target.classList.contains(KEYBOARD_OPEN_CLASS)) {
      // Already up: follow the keyboard as it resizes (a field can grow from one
      // line to many, and rotation changes the height without closing it).
      target.style.setProperty(VISIBLE_HEIGHT_VAR, `${measure().height}px`);
      return;
    }
    if (openTimer !== null) return;
    openTimer = setTimeout(() => {
      openTimer = null;
      // Re-measure at the end of the hold: the keyboard may still have been
      // animating when the resize fired.
      if (!keyboardIsUp()) return;
      target.style.setProperty(VISIBLE_HEIGHT_VAR, `${measure().height}px`);
      target.classList.add(KEYBOARD_OPEN_CLASS);
    }, KEYBOARD_OPEN_DELAY_MS);
  };
  // Start from a clean slate: a stale inline height left by an earlier mount
  // (HMR, a route remount) must not survive into a keyboard-free shell.
  sync();

  const targets: Array<[EventTarget, string]> = [[window, 'resize'], [window, 'orientationchange']];
  if (typeof window !== 'undefined' && window.visualViewport) {
    targets.push([window.visualViewport, 'resize'], [window.visualViewport, 'scroll']);
  }
  // The caret can move without any resize (a tap into the next field, a blur on
  // the way to another screen), so focus changes are watched as well.
  if (typeof document !== 'undefined') {
    targets.push([document, 'focusin'], [document, 'focusout']);
  }
  for (const [node, type] of targets) node.addEventListener(type, sync, { passive: true });

  return () => {
    // Detach, then release: a cleanup that left the class or the property behind
    // would keep a stale override alive over a keyboard-free shell.
    for (const [node, type] of targets) node.removeEventListener(type, sync);
    release();
  };
}
