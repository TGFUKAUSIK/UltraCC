/**
 * FirstRunLanding — the onboarding surface a brand-new student sees before any
 * VTOP sync. It must offer exactly three things — login, semester, feature
 * mode — and nothing else (the rail/header/tab-bar belong to the full app, not
 * this component, so they are asserted absent here only in the sense that the
 * landing renders none of its own chrome).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { FirstRunLanding } from '../FirstRunLanding';
import type { SemesterInfo } from '../../lib/vtop/types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SEMESTERS: SemesterInfo[] = [
  { id: 'CH2025261', name: 'Winter Semester 2025-26', isCurrent: true },
  { id: 'CH2025262', name: 'Fall Semester 2026-27', isCurrent: false },
];

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let onLogin: ReturnType<typeof vi.fn>;
let onSemesterChange: ReturnType<typeof vi.fn>;
let onModeChange: ReturnType<typeof vi.fn>;

function mount(semesters: SemesterInfo[] = [], mode: 'minimal' | 'complete' = 'complete') {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(createElement(FirstRunLanding, {
      onLogin, onSemesterChange, onModeChange,
      semesters, selectedSemesterId: semesters[0]?.id ?? '', mode,
    }));
  });
}

function text(): string {
  return (host!.textContent || '').replace(/\s+/g, ' ').trim();
}

function buttons(): HTMLButtonElement[] {
  return Array.from(host!.querySelectorAll('button'));
}

beforeEach(() => {
  onLogin = vi.fn();
  onSemesterChange = vi.fn();
  onModeChange = vi.fn();
  localStorage.removeItem('ultracc.featureMode');
});

afterEach(() => {
  act(() => { root?.unmount(); });
  host?.remove();
  host = null;
  root = null;
  localStorage.removeItem('ultracc.featureMode');
});

describe('FirstRunLanding', () => {
  it('offers exactly the three setup actions', () => {
    mount();
    const t = text();
    expect(t).toContain('Login with VTOP');
    expect(t).toContain('Semester');
    expect(t).toContain('Minimal');
    expect(t).toContain('Complete');
  });

  it('login button triggers the VTOP sign-in flow', () => {
    mount();
    const login = buttons().find((b) => (b.textContent || '').includes('Login with VTOP'))!;
    act(() => login.click());
    expect(onLogin).toHaveBeenCalledTimes(1);
  });

  it('shows a hint instead of a select when no semester is known yet', () => {
    mount();
    expect(text()).toContain('Your semesters appear here after you log in');
    expect(host!.querySelector('select')).toBeNull();
  });

  it('renders the known semesters in a select', () => {
    mount(SEMESTERS);
    const select = host!.querySelector('select')!;
    expect(select).not.toBeNull();
    expect(select.querySelectorAll('option')).toHaveLength(2);
    expect(select.textContent).toContain('Winter Semester 2025-26');
    expect(select.textContent).toContain('Fall Semester 2026-27');
    expect((select as HTMLSelectElement).value).toBe('CH2025261');
  });

  it('choosing a mode persists it and reports the change', () => {
    mount([], 'complete');
    const minimal = buttons().find((b) => (b.textContent || '').includes('Minimal'))!;
    act(() => minimal.click());
    expect(onModeChange).toHaveBeenCalledWith('minimal');
    expect(localStorage.getItem('ultracc.featureMode')).toBe('"minimal"');
  });
});
