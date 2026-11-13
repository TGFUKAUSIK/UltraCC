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

  /**
   * The three sections are a procedure, not a menu: the term list is empty
   * until VTOP has answered, and the layout choice is meaningless before there
   * is anything to lay out. Numbering them is the only place the app states
   * that order, so the numerals have to stay in step with the markup.
   */
  it('numbers the three steps in the order they can be done', () => {
    mount();
    const steps = Array.from(host!.querySelectorAll('.uc-first-run-step'));
    expect(steps).toHaveLength(3);
    expect(host!.querySelector('ol.uc-first-run-steps')).not.toBeNull();
    expect(steps.map((li) => (li.querySelector('.uc-first-run-step-num')?.textContent || '').trim()))
      .toEqual(['1', '2', '3']);
    expect(steps.map((li) => li.querySelector('h2')?.textContent?.trim()))
      .toEqual(['Get started', 'Semester', 'Layout']);
  });

  it('keeps the numerals out of the screen reader’s way', () => {
    mount();
    // The list already carries the count; a read-out "1, 2, 3" before every
    // heading is noise, so the gutter is decoration.
    for (const num of host!.querySelectorAll('.uc-first-run-step-num')) {
      expect(num.getAttribute('aria-hidden')).toBe('true');
    }
  });

  /**
   * The numeral chip is filled with the accent wash, so an accent-coloured digit
   * is accent text on an 8% tint of itself: --acc-600 measures 4.0:1 for rose on
   * the light wash and 2.9:1 for blue on the 13% dark wash, and a 12px numeral is
   * not large text. The ink is the one value that clears AA in every theme and
   * every accent, which is also what the mode radios do.
   */
  it('writes the numerals in the theme ink, not the accent', () => {
    mount();
    for (const num of host!.querySelectorAll('.uc-first-run-step-num')) {
      expect(num.className).toContain('text-zinc-900');
      expect(num.className).not.toMatch(/acc-text/);
    }
  });

  it('gives the phone-sized controls a thumb-height target', () => {
    mount(SEMESTERS);
    const login = buttons().find((b) => (b.textContent || '').includes('Login with VTOP'))!;
    expect(login.className).toContain('min-h-[44px]');
    expect(host!.querySelector('select')!.className).toContain('min-h-[44px]');
  });
});
