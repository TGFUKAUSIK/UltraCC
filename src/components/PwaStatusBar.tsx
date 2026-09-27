/**
 * PwaStatusBar — quiet, mobile-first PWA affordances rendered above content:
 *
 *   - "Update ready — tap to refresh" when a new service worker version is
 *     waiting (never auto-reloads mid-task).
 *   - A dismissible iOS "Add to Home Screen" hint (iOS has no install
 *     prompt). Android/Chrome get the native prompt via Settings instead.
 *
 * Everything here is opt-in, dismissible, and never blocks content.
 */

import React, { useEffect, useState } from 'react';
import { ArrowDownToLine, RefreshCw, Share, X } from 'lucide-react';
import { usePwa } from '../hooks/usePwa';

const IOS_HINT_KEY = 'ultracc:iosInstallHintDismissed';

export const PwaStatusBar: React.FC = () => {
  const { isStandalone, isIOS, canInstall, updateReady, promptInstall, applyUpdate } = usePwa();
  const [iosHintDismissed, setIosHintDismissed] = useState(true);

  useEffect(() => {
    try {
      setIosHintDismissed(localStorage.getItem(IOS_HINT_KEY) === '1');
    } catch { /* storage unavailable */ }
  }, []);

  const dismissIosHint = () => {
    setIosHintDismissed(true);
    try { localStorage.setItem(IOS_HINT_KEY, '1'); } catch { /* ignore */ }
  };

  // Already installed → nothing to offer.
  if (isStandalone) return null;

  if (updateReady) {
    return (
      <button
        onClick={() => void applyUpdate()}
        className="mb-4 w-full p-3 bg-blue-500/10 border border-blue-500/30 rounded-xl text-blue-700 text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition hover:bg-blue-500/20"
        role="status"
      >
        <RefreshCw className="h-4 w-4" />
        UltraCC was updated — tap to refresh to the new version
      </button>
    );
  }

  if (canInstall) {
    return (
      <button
        onClick={() => void promptInstall()}
        className="mb-4 w-full p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-700 text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition hover:bg-emerald-500/20"
        role="button"
      >
        <ArrowDownToLine className="h-4 w-4" />
        Install UltraCC on this device for a full-screen, offline-capable app
      </button>
    );
  }

  if (isIOS && !iosHintDismissed) {
    return (
      <div className="mb-4 w-full p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-700 text-xs flex items-center gap-2">
        <Share className="h-4 w-4 shrink-0" />
        <span className="flex-1">
          <b>Install UltraCC:</b> tap <Share className="inline h-3 w-3 -mt-0.5" /> Share, then “Add to Home Screen”.
        </span>
        <button onClick={dismissIosHint} aria-label="Dismiss install hint" className="p-1 opacity-60 hover:opacity-100 cursor-pointer">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return null;
};
