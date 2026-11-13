import React from 'react';
import { X } from 'lucide-react';

interface EmptyStateProps {
  /** The thing the page is about, drawn small and grey. Optional: a list can
   *  say it is empty in one line without an icon. */
  icon?: React.ReactNode;
  /** What is missing, in the student's words. */
  title: string;
  /** Why it is missing, and what would make it appear. */
  body: string;
  /** The way out. An empty screen is a dead end without one, and the button
   *  says exactly what pressing it does — "Clear search", not "Submit". */
  action?: { label: string; onClick: () => void };
}

/**
 * One empty state for the whole portal.
 *
 * Views used to write their own apology each time a filter matched nothing:
 * Q-Bank had a card with a clear button, Fresher Guide and Library rendered an
 * empty grid, and several others printed a bare "No results" with no way back.
 * The screen a student is actually stuck on is the one where the app has
 * something to show but the filter hid it, so this component's job is to name
 * what is missing and hand over the control that fixes it.
 *
 * Colours are the light vocabulary the theme re-maps (`bg-white`, `text-zinc-*`),
 * never a fill with a label on it — see the accent-fill pin in src/index.css.
 */
export function EmptyState({ icon, title, body, action }: EmptyStateProps) {
  return (
    <div className="p-8 sm:p-10 uc-plate text-center">
      {icon && <div className="mb-2">{icon}</div>}
      <p className="text-sm font-bold text-zinc-900">{title}</p>
      <p className="text-[11px] text-zinc-500 mt-1.5 max-w-sm mx-auto leading-relaxed">{body}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="mt-4 inline-flex min-h-[44px] items-center gap-1.5 px-4 py-2 rounded-xl bg-white border border-zinc-200 text-xs font-bold text-zinc-900 hover:border-zinc-300 transition cursor-pointer"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
          {action.label}
        </button>
      )}
    </div>
  );
}
