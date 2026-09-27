import { useEffect, useRef } from 'react';

/**
 * Focusable elements, in DOM order, that a keyboard user can actually reach.
 * `[tabindex="-1"]` is excluded so programmatic-only targets never enter the
 * tab ring.
 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function visibleFocusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hidden && (el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement),
  );
}

export interface DialogOptions {
  isOpen: boolean;
  onClose: () => void;
  /**
   * Element to focus when the dialog opens (e.g. its close button or search
   * field). Defaults to the first control inside the panel.
   */
  initialFocus?: { current: HTMLElement | null };
}

/**
 * Shared modal behaviour: Escape closes, Tab is trapped inside the panel,
 * focus moves into the dialog on open and back to the trigger on close.
 *
 * Attach the returned ref to the element carrying `role="dialog"`.
 *
 * `onClose` is read through a ref on purpose: callers pass inline arrow
 * functions, and re-running the setup effect on every render would yank focus
 * back to the top of the dialog while the user is typing in it.
 */
export function useDialog<T extends HTMLElement = HTMLDivElement>({ isOpen, onClose, initialFocus }: DialogOptions) {
  const panelRef = useRef<T>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return undefined;
    const opener = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    (initialFocus?.current ?? visibleFocusables(panel ?? document.body)[0])?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab' || !panel) return;
      const focusables = visibleFocusables(panel);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      if (opener && opener.isConnected) opener.focus();
    };
  }, [isOpen, initialFocus]);

  return panelRef;
}

/**
 * Escape-to-dismiss for non-modal popovers (menus, notification panels).
 * These must NOT trap focus — the trigger stays part of the page — so they
 * get the keyboard exit without `useDialog`'s tab ring.
 */
export function useEscapeKey(active: boolean, onDismiss: () => void): void {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (!active) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      dismissRef.current();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [active]);
}
