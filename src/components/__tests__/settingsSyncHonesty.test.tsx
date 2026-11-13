/**
 * What Settings says about a sync it just ran (production defects: a failed LMS
 * sync rendered in success green because the colour read the sentence for the
 * word "failed" — "LMS synced with 3 issues." is a success colour on a failure;
 * and the campus list read localStorage straight from render, so on a phone
 * where storage is blocked the whole dialog went to the error boundary).
 *
 * These mount the real modal, click the real buttons, and put the device in the
 * state a locked-down iPhone is in.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SettingsModal } from '../SettingsModal';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement;
let root: Root | null = null;

const realStorage = globalThis.localStorage;

/** A browser that refuses to hand out storage: iOS private, blocked PWA. */
function denyStorage() {
  const refusal = () => { throw new DOMException('Storage is denied', 'SecurityError'); };
  Object.defineProperty(window, 'localStorage', { configurable: true, value: { getItem: refusal, setItem: refusal, removeItem: refusal } });
}

function restoreStorage() {
  Object.defineProperty(window, 'localStorage', { configurable: true, value: realStorage });
}

const modal = (props: Partial<Parameters<typeof SettingsModal>[0]> = {}) =>
  createElement(SettingsModal, {
    isOpen: true,
    onClose: () => {},
    semesters: [],
    selectedSemesterId: '',
    onSemesterChange: () => {},
    onClearAllData: async () => {},
    ...props,
  } as never);

function mount(node: ReturnType<typeof modal>) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
}

const buttonNamed = (text: string) =>
  [...host.querySelectorAll('button')].find((b) => (b.textContent || '').includes(text));

/** The status line the LMS sync leaves behind. */
const lmsStatus = () => host.querySelector<HTMLParagraphElement>('p[role="status"]');

beforeEach(() => {
  restoreStorage();
  localStorage.clear();
});

afterEach(() => {
  if (root) act(() => root.unmount());
  root = null;
  host?.remove();
  restoreStorage();
  vi.restoreAllMocks();
});

describe('the LMS sync answer', () => {
  it('turns red when the sync reports a problem, whatever the sentence says', async () => {
    mount(modal({ onLmsSync: async () => ({ ok: false, message: 'LMS synced with 3 issues.' }) }));
    const sync = buttonNamed('Sync Now');
    expect(sync).toBeTruthy();
    await act(async () => { sync!.click(); });

    const status = lmsStatus();
    expect(status?.textContent).toBe('LMS synced with 3 issues.');
    expect(status?.className).toContain('text-rose-700');
    expect(status?.className).not.toContain('emerald');
  });

  it('stays green when the sync really did finish', async () => {
    mount(modal({ onLmsSync: async () => ({ ok: true, message: 'LMS assignments and quizzes updated.' }) }));
    const sync = buttonNamed('Sync Now');
    await act(async () => { sync!.click(); });

    const status = lmsStatus();
    expect(status?.className).toContain('text-emerald-700');
    expect(status?.className).not.toContain('rose');
  });

  it('reports a sync that threw instead of hanging on the spinner', async () => {
    mount(modal({ onLmsSync: async () => { throw new Error('Could not reach the LMS. Check your login and try again.'); } }));
    const sync = buttonNamed('Sync Now');
    await act(async () => { sync!.click(); });

    const status = lmsStatus();
    expect(status?.className).toContain('text-rose-700');
    expect((status?.textContent || '').toLowerCase()).toContain('could not reach the lms');
    // The button is clickable again rather than stuck on "Syncing LMS…".
    expect(buttonNamed('Syncing LMS')).toBeUndefined();
    expect(buttonNamed('Sync Now')).toBeTruthy();
  });
});

describe('a device that will not share its storage', () => {
  it('still opens Settings and shows the campus list', () => {
    denyStorage();
    expect(() => mount(modal())).not.toThrow();
    const text = host.textContent || '';
    expect(text).toContain('VIT Chennai');
    // With nothing readable, the verified campus is the one on screen.
    expect(text).toContain('ACTIVE');
  });

  it('says so when a campus choice cannot be kept, instead of reloading for nothing', () => {
    denyStorage();
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    mount(modal());

    const chennai = [...host.querySelectorAll('button')].find((b) => (b.textContent || '').includes('VIT Chennai'));
    expect(chennai).toBeTruthy();
    act(() => { chennai!.click(); });

    expect(reload).not.toHaveBeenCalled();
    expect(host.textContent).toContain('will not save settings');
    vi.unstubAllGlobals();
  });
});
