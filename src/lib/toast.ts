/**
 * Toast notification system — lightweight, non-blocking feedback for sync
 * progress, errors, and success messages.
 *
 * Design:
 * - Multiple toasts can stack (max 5 visible)
 * - Auto-dismiss after configurable duration (default 4s for success, 8s for error)
 * - Manual dismiss via X button
 * - Priority: error > warning > info > success
 * - Deduplication: same message within 2s won't create duplicate toasts
 */

export type ToastType = 'success' | 'error' | 'warning' | 'info' | 'sync';

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  detail?: string;
  /** Auto-dismiss delay in ms. 0 = manual dismiss only. */
  duration: number;
  createdAt: number;
  /** Dataset key for sync toasts — allows updating in-place. */
  datasetKey?: string;
}

type Listener = (toasts: Toast[]) => void;

const MAX_VISIBLE = 5;
const DEDUP_WINDOW_MS = 2000;

let toasts: Toast[] = [];
let listeners: Set<Listener> = new Set();
let idCounter = 0;

function notify(): void {
  listeners.forEach((fn) => {
    try { fn([...toasts]); } catch { /* subscriber must not break the toast system */ }
  });
}

function remove(id: string): void {
  toasts = toasts.filter((t) => t.id !== id);
  notify();
}

/** Subscribe to toast changes. Returns an unsubscribe function. */
export function subscribeToasts(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Get current toasts (for initial render). */
export function getToasts(): Toast[] {
  return [...toasts];
}

/** Internal: add a toast. */
function addToast(
  type: ToastType,
  message: string,
  opts: { detail?: string; duration?: number; datasetKey?: string } = {}
): string {
  const now = Date.now();
  // Deduplication: skip if same message within window
  const existing = toasts.find(
    (t) => t.message === message && now - t.createdAt < DEDUP_WINDOW_MS
  );
  if (existing) return existing.id;

  const id = `toast-${++idCounter}`;
  const duration = opts.duration ?? (type === 'error' ? 8000 : type === 'sync' ? 0 : 4000);
  const toast: Toast = {
    id,
    type,
    message,
    detail: opts.detail,
    duration,
    createdAt: now,
    datasetKey: opts.datasetKey,
  };

  toasts = [toast, ...toasts].slice(0, MAX_VISIBLE);
  notify();

  // Auto-dismiss
  if (duration > 0) {
    setTimeout(() => remove(id), duration);
  }

  return id;
}

// --- Public API ---

export function toastSuccess(message: string, opts?: { detail?: string; duration?: number }): string {
  return addToast('success', message, opts);
}

export function toastError(message: string, opts?: { detail?: string; duration?: number }): string {
  return addToast('error', message, opts);
}

export function toastWarning(message: string, opts?: { detail?: string; duration?: number }): string {
  return addToast('warning', message, opts);
}

export function toastInfo(message: string, opts?: { detail?: string; duration?: number }): string {
  return addToast('info', message, opts);
}

export function showToast(opts: { title?: string; message: string; type?: ToastType; detail?: string; duration?: number }): string {
  const msg = opts.title ? `${opts.title} — ${opts.message}` : opts.message;
  return addToast(opts.type || 'info', msg, { detail: opts.detail, duration: opts.duration });
}

/**
 * Sync-progress toast — updates in-place for a given dataset key.
 * Call with `complete: true` to convert to success and auto-dismiss.
 */
export function toastSync(
  datasetKey: string,
  message: string,
  opts?: { complete?: boolean; error?: boolean; detail?: string }
): string {
  // Find existing sync toast for this dataset
  const existing = toasts.find(
    (t) => t.datasetKey === datasetKey && t.type === 'sync'
  );

  if (opts?.complete) {
    if (existing) {
      // Update existing toast to success
      toasts = toasts.map((t) =>
        t.id === existing.id
          ? { ...t, type: 'success' as const, message, detail: opts.detail, duration: 3000, createdAt: Date.now() }
          : t
      );
      notify();
      setTimeout(() => remove(existing.id), 3000);
      return existing.id;
    }
    return addToast('success', message, { detail: opts.detail, duration: 3000 });
  }

  if (opts?.error) {
    if (existing) {
      toasts = toasts.map((t) =>
        t.id === existing.id
          ? { ...t, type: 'error' as const, message, detail: opts.detail, duration: 8000, createdAt: Date.now() }
          : t
      );
      notify();
      setTimeout(() => remove(existing.id), 8000);
      return existing.id;
    }
    return addToast('error', message, { detail: opts.detail, duration: 8000 });
  }

  if (existing) {
    // Update message in-place
    toasts = toasts.map((t) =>
      t.id === existing.id ? { ...t, message, detail: opts?.detail } : t
    );
    notify();
    return existing.id;
  }

  return addToast('sync', message, { detail: opts?.detail, datasetKey, duration: 0 });
}

/** Remove a specific toast. */
export function dismissToast(id: string): void {
  remove(id);
}

/** Clear all toasts. */
export function clearToasts(): void {
  toasts = [];
  notify();
}
