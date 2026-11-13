/**
 * PwaStatusBar — quiet, one-line PWA affordances rendered above content:
 *
 *   - "Update ready" when a new service worker version is waiting (never
 *     auto-reloads mid-task).
 *   - An install chip (Chrome/Edge/Android) or the iOS "Add to Home Screen"
 *     hint, since iOS has no install prompt.
 *
 * It is a chip, not a bar: 36px tall with an 8px seam, so it can never push the
 * greeting down by more than ~44px. Everything is opt-in and dismissible, and
 * nothing here ever blocks content. Installing and the iOS hint stay dismissed
 * once the student waves them off; an update notice is tied to the waiting
 * build, so dismissing it lasts only for the session (persisting it would hide
 * a real update forever).
 *
 * Installing is the only thing that means nothing once the app is installed. The
 * update notice means *more* there: an installed shell is cached, and the worker
 * will not swap it out on its own. So `isStandalone` silences the install
 * affordances, not the update.
 */

import React, { useEffect, useState } from 'react';
import { ArrowDownToLine, RefreshCw, Share, X } from 'lucide-react';
import { usePwa } from '../hooks/usePwa';

const INSTALL_KEY = 'ultracc:installPromptDismissed';
const IOS_HINT_KEY = 'ultracc:iosInstallHintDismissed';

interface Chip {
  icon: React.ReactNode;
  text: React.ReactNode;
  action?: { label: string; onClick: () => void };
  onDismiss: () => void;
  /** Announced like a status change (only the "updated" notice is one). */
  status: boolean;
}

export const PwaStatusBar: React.FC = () => {
  const { isStandalone, isIOS, canInstall, updateReady, promptInstall, applyUpdate } = usePwa();
  const [dismissed, setDismissed] = useState<Record<string, boolean>>({});
  const [updateHidden, setUpdateHidden] = useState(false);

  useEffect(() => {
    try {
      setDismissed({
        [INSTALL_KEY]: localStorage.getItem(INSTALL_KEY) === '1',
        [IOS_HINT_KEY]: localStorage.getItem(IOS_HINT_KEY) === '1',
      });
    } catch { /* storage unavailable */ }
  }, []);

  const dismiss = (key: string) => {
    setDismissed((prev) => ({ ...prev, [key]: true }));
    try { localStorage.setItem(key, '1'); } catch { /* ignore */ }
  };

  let chip: Chip | null = null;

  if (updateReady && !updateHidden) {
    // Rendered in the installed app too — that is precisely where it is needed.
    // The worker never activates itself (see public/sw.js), so a Home Screen
    // build keeps serving the shell it cached until the student says otherwise,
    // and a fix that ships to the server can sit unseen on the phone. Short-circuiting
    // every chip on `isStandalone` silenced the one notice an installed app needs.
    chip = {
      icon: <RefreshCw className="h-3.5 w-3.5" />,
      text: <>UltraCC was updated — <b>refresh</b> to get the new version</>,
      action: { label: 'Refresh', onClick: () => void applyUpdate() },
      onDismiss: () => setUpdateHidden(true),
      status: true,
    };
  } else if (!isStandalone && canInstall && !dismissed[INSTALL_KEY]) {
    chip = {
      icon: <ArrowDownToLine className="h-3.5 w-3.5" />,
      text: <>Install UltraCC for a full-screen, offline app</>,
      action: { label: 'Install', onClick: () => void promptInstall() },
      onDismiss: () => dismiss(INSTALL_KEY),
      status: false,
    };
  } else if (!isStandalone && isIOS && !dismissed[IOS_HINT_KEY]) {
    chip = {
      icon: <Share className="h-3.5 w-3.5" />,
      text: <>Tap <Share className="uc-install-inline" /> Share, then <b>Add to Home Screen</b></>,
      onDismiss: () => dismiss(IOS_HINT_KEY),
      status: false,
    };
  }

  if (!chip) return null;

  return (
    <div className="uc-install" role={chip.status ? 'status' : undefined}>
      <span className="uc-install-ico" aria-hidden="true">{chip.icon}</span>
      <span className="uc-install-text">{chip.text}</span>
      {chip.action ? (
        <button type="button" className="uc-install-act" onClick={chip.action.onClick}>{chip.action.label}</button>
      ) : null}
      <button type="button" className="uc-install-x" aria-label="Dismiss this hint" onClick={chip.onDismiss}>
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
};
