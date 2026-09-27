import React, { useEffect, useState } from 'react';
import { X, CheckCircle, AlertCircle, AlertTriangle, Info, RefreshCw } from 'lucide-react';
import { subscribeToasts, getToasts, dismissToast, type Toast } from '../lib/toast';

const ICONS: Record<Toast['type'], React.FC<{ className?: string }>> = {
  success: CheckCircle,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
  sync: RefreshCw,
};

const STYLES: Record<Toast['type'], string> = {
  success: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-700',
  error: 'bg-red-500/15 border-red-500/30 text-red-700',
  warning: 'bg-amber-500/15 border-amber-500/30 text-amber-700',
  info: 'bg-blue-500/15 border-blue-500/30 text-blue-700',
  sync: 'bg-violet-500/15 border-violet-500/30 text-violet-700',
};

const LIVE_ROLE: Record<Toast['type'], 'status' | 'alert'> = {
  success: 'status',
  info: 'status',
  sync: 'status',
  warning: 'alert',
  error: 'alert',
};

const renderToast = (toast: Toast) => {
  const Icon = ICONS[toast.type];
  const style = STYLES[toast.type];
  const isSyncing = toast.type === 'sync';

  return (
    <div
      key={toast.id}
      className={`pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-2xl border backdrop-blur-md shadow-lg transition-all duration-200 ${style}`}
    >
      <Icon
        className={`h-4 w-4 mt-0.5 shrink-0 ${isSyncing ? 'animate-spin' : ''}`}
        aria-hidden="true"
      />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold leading-tight">{toast.message}</p>
        {toast.detail && (
          <p className="text-[11px] opacity-80 mt-0.5 leading-tight">{toast.detail}</p>
        )}
      </div>
      {toast.duration > 0 && (
        <button
          type="button"
          onClick={() => dismissToast(toast.id)}
          aria-label="Dismiss notification"
          className="shrink-0 -m-1 p-1 min-h-[26px] min-w-[26px] flex items-center justify-center text-current opacity-50 hover:opacity-100 transition cursor-pointer"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
};

export const ToastContainer: React.FC = () => {
  const [toasts, setToasts] = useState<Toast[]>(getToasts());

  useEffect(() => {
    return subscribeToasts(setToasts);
  }, []);

  const polite = toasts.filter((toast) => LIVE_ROLE[toast.type] === 'status');
  const assertive = toasts.filter((toast) => LIVE_ROLE[toast.type] === 'alert');

  // Both live regions stay mounted even when they hold nothing: a region that
  // is inserted into the DOM at the same moment as its message is reliably
  // ignored by screen readers, so sync and error toasts were never announced.
  return (
    <div
      className="ultracc-toasts fixed z-50 flex flex-col gap-2 pointer-events-none right-4 bottom-24 left-auto max-w-sm w-full sm:w-full"
      style={{ bottom: 'calc(5.5rem + env(safe-area-inset-bottom, 0px))' }}
    >
      <div role="status" aria-live="polite" className="flex flex-col gap-2 empty:hidden">
        {polite.map(renderToast)}
      </div>
      <div role="alert" aria-live="assertive" className="flex flex-col gap-2 empty:hidden">
        {assertive.map(renderToast)}
      </div>
    </div>
  );
};
