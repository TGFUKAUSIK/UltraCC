import React, { useState } from 'react';
import { ChevronDown, ChevronRight, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { type SyncCoordinatorState } from '../lib/vtop/syncCoordinator';

interface SyncStatusPanelProps {
  syncState: SyncCoordinatorState;
}

/** Compact per-dataset sync results panel — shows below the header during/after sync. */
export const SyncStatusPanel: React.FC<SyncStatusPanelProps> = ({ syncState }) => {
  const [expanded, setExpanded] = useState(false);
  const results = syncState.results;
  const isRefreshing = syncState.status === 'refreshing';

  // Don't show when there's nothing to show
  if (!isRefreshing && !results) return null;

  const succeeded = results?.filter((r) => r.ok) ?? [];
  const failed = results?.filter((r) => !r.ok) ?? [];

  return (
    <div className="bg-white border border-zinc-200 rounded-2xl mb-4 overflow-hidden transition-all duration-300">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-controls="ultracc-sync-dataset-details"
        className="w-full flex items-center justify-between px-4 py-3 text-xs cursor-pointer hover:bg-zinc-100 transition"
      >
        <div className="flex items-center gap-2">
          {isRefreshing ? (
            <Loader2 className="h-3.5 w-3.5 text-blue-600 animate-spin" aria-hidden="true" />
          ) : failed.length > 0 ? (
            <XCircle className="h-3.5 w-3.5 text-amber-600" aria-hidden="true" />
          ) : (
            <CheckCircle className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
          )}
          <span className="font-bold text-zinc-900">
            {isRefreshing
              ? 'Updating your data…'
              : failed.length > 0
                ? `${succeeded.length} of ${results!.length} sections updated`
                : `All ${succeeded.length} sections updated`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {failed.length > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 text-[10px] font-bold border border-amber-500/20">
              {failed.length} failed
            </span>
          )}
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-zinc-500" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-zinc-500" aria-hidden="true" />
          )}
        </div>
      </button>

      {expanded && results && (
        <div id="ultracc-sync-dataset-details" className="border-t border-zinc-200 px-4 py-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-1.5">
            {results.map((r) => (
              <div
                key={r.key}
                className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-medium ${
                  r.ok
                    ? 'text-emerald-600 bg-emerald-500/5'
                    : 'text-rose-600 bg-rose-500/5'
                }`}
              >
                {r.ok ? (
                  <CheckCircle className="h-3 w-3 shrink-0" aria-hidden="true" />
                ) : (
                  <XCircle className="h-3 w-3 shrink-0" aria-hidden="true" />
                )}
                <span className="sr-only">{r.ok ? 'Synced:' : 'Failed:'}</span>
                <span className="truncate" title={r.error || r.label}>
                  {r.label}
                </span>
              </div>
            ))}
            {isRefreshing && (
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-medium text-blue-600 bg-blue-500/5">
                <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                <span>Syncing…</span>
              </div>
            )}
          </div>
          {failed.length > 0 && (
            <div className="mt-2 pt-2 border-t border-zinc-200 space-y-1">
              {failed.map((r) => (
                <p key={r.key} className="text-[10px] text-rose-600/80">
                  <span className="font-bold">{r.label}:</span>{' '}
                  {r.error || 'Unknown error — session may have expired'}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
