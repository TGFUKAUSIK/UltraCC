import { Component, type ReactNode } from 'react';
import { AlertTriangle, Home, RotateCcw } from 'lucide-react';
import { humanErrorCopy } from '../lib/errorCopy';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  /** Sanitized, human-readable line shown in the UI (brief §9: production
   *  boundaries never print raw stacks; dev keeps them via componentDidCatch). */
  message: string;
}

/** True only when running under Vite dev — gates every debug channel here. */
function isDev(): boolean {
  return typeof import.meta !== 'undefined'
    && Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);
}

/**
 * Global error boundary — a crash in one view must never blank the whole app.
 * Shows a friendly recovery card instead of a white screen.
 *
 * Note: this project's `react` dependency ships without type declarations, so
 * tsc resolves the base class to `any` and its members are invisible. We
 * declare the members we use (`props`) and route `setState` through a typed
 * cast so typecheck stays green; runtime behavior is unchanged.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  props!: ErrorBoundaryProps;
  state: ErrorBoundaryState = { hasError: false, message: '' };

  static getDerivedStateFromError(err: unknown): ErrorBoundaryState {
    // Never surface raw stack text in production UI: React error messages
    // routinely carry component/function names and prop values. Curated,
    // human-shaped messages still pass through (e.g. a view that throws an
    // intentional "X is unavailable" error); anything technical collapses
    // to the generic sentence below.
    return {
      hasError: true,
      message: humanErrorCopy(err, 'The view could not be displayed on this device.'),
    };
  }

  componentDidCatch(error: unknown) {
    // Dev-only full detail (component stack included). Production logs a
    // single fixed line with NO error payload — crash messages can carry
    // prop values, and this app renders VTOP-derived data, so nothing
    // sensitive may reach logs (brief §9).
    if (isDev()) console.error('[UltraCC] View crashed:', error);
    else console.error('[UltraCC] A view crashed and was recovered by the error boundary.');
  }

  private setStateSafe(partial: Partial<ErrorBoundaryState>): void {
    (this as unknown as { setState(s: Partial<ErrorBoundaryState>): void }).setState(partial);
  }

  private reset = () => this.setStateSafe({ hasError: false, message: '' });

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="ultracc-error-state" role="alert">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center">
          <AlertTriangle className="h-6 w-6 text-rose-600" />
        </div>
        <h2 id="ultracc-error-title" className="text-xl font-extrabold text-zinc-900 tracking-tight">This view hit an unexpected error</h2>
        <p className="text-xs text-zinc-500 font-medium leading-relaxed">
          Your data is safe — this is a rendering issue, not a sync problem. Try reloading the view, or re-sync your
          data from the Login button.
        </p>
        {this.state.message && (
          <p className="text-[10px] font-mono text-zinc-600 break-all bg-white border border-zinc-200 rounded-xl p-2.5">
            {this.state.message}
          </p>
        )}
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={this.reset}
            className="px-5 py-2.5 acc-bg text-zinc-900 rounded-xl text-xs font-extrabold transition cursor-pointer hover:opacity-90 flex items-center gap-2"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Try Again
          </button>
          <button
            onClick={() => {
              this.reset();
              // Deep links are ?tab= based (see App.initialTab) — a bare
              // #dashboard hash navigated nowhere and left the crash on screen.
              try {
                const url = new URL(window.location.href);
                url.searchParams.set('tab', 'dashboard');
                window.location.href = url.toString();
              } catch { /* history unavailable — reset alone still recovers */ }
            }}
            className="px-5 py-2.5 bg-white text-zinc-900 border border-zinc-200 rounded-xl text-xs font-bold transition cursor-pointer hover:bg-zinc-100 flex items-center gap-2"
          >
            <Home className="h-3.5 w-3.5" /> Go to Dashboard
          </button>
        </div>
      </div>
    );
  }
}
