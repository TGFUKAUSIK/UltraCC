import { useEffect } from 'react';

/** Lock only the document behind an open dialog/sheet, preserving inner scroll. */
export function useBodyScrollLock(locked: boolean): void {
  useEffect(() => {
    if (!locked || typeof document === 'undefined') return;
    const body = document.body;
    const previousOverflow = body.style.overflow;
    const previousOverscroll = body.style.overscrollBehavior;
    body.style.overflow = 'hidden';
    body.style.overscrollBehavior = 'none';
    body.classList.add('ultracc-modal-open');
    return () => {
      body.style.overflow = previousOverflow;
      body.style.overscrollBehavior = previousOverscroll;
      body.classList.remove('ultracc-modal-open');
    };
  }, [locked]);
}
