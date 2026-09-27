/**
 * usePwa — install prompt, standalone detection, and SW update handling.
 *
 * Mobile PWA UX:
 *   - beforeinstallprompt is captured so the app can offer its own
 *     "Install app" affordance (Chrome/Edge/Android) instead of relying on
 *     the browser's transient mini-infobar.
 *   - iOS has no install prompt: `isIOS` lets the UI show the
 *     Share → Add to Home Screen hint instead.
 *   - When a new service worker is waiting, `updateReady` flips true and the
 *     UI can offer "Update now" (skipWaiting + reload). Never auto-reloads —
 *     the student could be mid-task.
 */

import { useCallback, useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface PwaState {
  /** True when running as an installed app (standalone display). */
  isStandalone: boolean;
  /** True on iOS/iPadOS (no beforeinstallprompt — needs the manual hint). */
  isIOS: boolean;
  /** Native install prompt is available right now. */
  canInstall: boolean;
  /** A new service worker version is waiting to activate. */
  updateReady: boolean;
  /** Ask the browser to show the install prompt. Resolves the user's choice. */
  promptInstall: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
  /** Activate the waiting service worker and reload. */
  applyUpdate: () => Promise<void>;
}

export function usePwa(): PwaState {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia?.('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsStandalone(Boolean(standalone));

    const ua = window.navigator.userAgent;
    setIsIOS(/iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && 'ontouchend' in document));

    const onInstallPrompt = (event: Event) => {
      event.preventDefault(); // keep the mini-infobar from stealing the gesture
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onInstallPrompt);

    // Installed (or dismissed permanently) — hide the affordance.
    const onInstalled = () => setInstallEvent(null);
    window.addEventListener('appinstalled', onInstalled);

    // Service-worker update detection: an installed+waiting SW means a new
    // version is ready. Listen to the message the SW sends after skipWaiting
    // is pending, and also check for an existing waiting registration.
    let registration: ServiceWorkerRegistration | null = null;
    const checkWaiting = () => {
      if (registration?.waiting && navigator.serviceWorker.controller) setUpdateReady(true);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'SW_WAITING') setUpdateReady(true);
      if (event.data?.type === 'SW_APPLY_UPDATE') window.location.reload();
    };
    navigator.serviceWorker?.addEventListener('message', onMessage);

    navigator.serviceWorker
      ?.getRegistration()
      .then((reg) => {
        registration = reg ?? null;
        checkWaiting();
        registration?.addEventListener('updatefound', () => {
          const installing = registration?.installing;
          installing?.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              setUpdateReady(true);
            }
          });
        });
        checkWaiting();
      })
      .catch(() => { /* SW unsupported — update flow just never appears */ });

    return () => {
      window.removeEventListener('beforeinstallprompt', onInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
      navigator.serviceWorker?.removeEventListener('message', onMessage);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    if (!installEvent) return 'unavailable';
    await installEvent.prompt();
    const { outcome } = await installEvent.userChoice;
    setInstallEvent(null);
    return outcome;
  }, [installEvent]);

  const applyUpdate = useCallback(async () => {
    const reg = await navigator.serviceWorker?.getRegistration().catch(() => null);
    reg?.waiting?.postMessage({ type: 'SKIP_WAITING' });
    // The SW broadcasts SW_APPLY_UPDATE after activating; reload then.
    // Fallback: reload here in case the message round-trip is lost.
    setTimeout(() => window.location.reload(), 1200);
  }, []);

  return { isStandalone, isIOS, canInstall: !!installEvent, updateReady, promptInstall, applyUpdate };
}
