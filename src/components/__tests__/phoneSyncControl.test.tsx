/**
 * The phone app bar keeps a way to refresh, and the bar stops zooming on a
 * double tap.
 *
 * Two reports off the same handset. The desktop bar's only sync affordance is
 * an 8px lamp whose state lives in a tooltip — a thumb cannot hover, so at phone
 * width the lamp was simply `display: none` and the sync control vanished with
 * it; the real action sat three taps deep in the account menu. And because
 * `html, body` declared no `touch-action`, a stray double tap anywhere in the
 * bar or the tab bar zoomed the whole app.
 *
 * So the phone bar now wears a refresh glyph coloured by the same state the
 * desktop lamp encodes (and it turns while a sync runs), and the document frame
 * removes double-tap zoom with `manipulation` — which is `auto` for panning and
 * pinch-zoom, minus the tap zoom. Both are read from the stylesheet and the
 * rendered header rather than remembered.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MeridianHeader } from '../MeridianHeader';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = process.cwd();
// index.css is CRLF; every pattern below allows for it via \s.
const CSS = readFileSync(join(ROOT, 'src', 'index.css'), 'utf8');

let container: HTMLElement | undefined;
let root: Root | undefined;

function mount(overrides: Record<string, unknown> = {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(createElement(MeridianHeader, {
      activeTab: 'dashboard',
      setActiveTab: () => {},
      onOpenCommandCenter: () => {},
      onOpenLogin: () => {},
      onOpenSettings: () => {},
      ...overrides,
    }));
  });
  return container;
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = undefined;
  root = undefined;
});

describe('the phone app bar keeps a visible refresh control', () => {
  it('shows the sync button at phone width instead of hiding it', () => {
    // The rule that started this was `.meridian-actions .meridian-status { display: none }`.
    expect(CSS).not.toMatch(/\.meridian-actions \.meridian-status\s*\{[^}]*display:\s*none/);
    const phone = CSS.match(/\.meridian-actions \.meridian-status \.meridian-status-refresh\s*\{[^}]*\}/)?.[0] ?? '';
    expect(phone, 'the phone rule must reveal the refresh glyph').toMatch(/display:\s*block/);
    const dot = CSS.match(/\.meridian-actions \.meridian-status \.meridian-status-dot\s*\{[^}]*\}/)?.[0] ?? '';
    expect(dot, 'the desktop dot must step aside for the glyph').toMatch(/display:\s*none/);
  });

  it('is a 44px thumb target, not the 34px desktop lamp', () => {
    // The desktop lamp rule is `.meridian-actions .meridian-status { 34px }`, and
    // it sits later in the file than the bar's 44px icon-button floor — so the
    // phone block has to claim the box itself or the button renders small.
    const boxes = CSS.match(/\.meridian-actions \.meridian-status\s*\{[^}]*\}/g) ?? [];
    expect(
      boxes.some((r) => /width:\s*44px/.test(r) && /height:\s*44px/.test(r)),
      'the phone sync control needs a 44px touch floor',
    ).toBe(true);
  });

  it('keeps the glyph off the desktop bar, which already shows the lamp', () => {
    expect(CSS).toMatch(/\.meridian-status-refresh\s*\{\s*display:\s*none/);
  });

  it('colours the glyph by the same state the lamp encodes', () => {
    const pairs: [string, string][] = [['live', '--uc-live'], ['stale', '--uc-amber-ink'], ['off', '--uc-red-ink']];
    for (const [state, token] of pairs) {
      const rule = CSS.match(new RegExp(`\\.meridian-actions \\.meridian-status\\[data-state="${state}"\\]\\s*\\{[^}]*\\}`))?.[0] ?? '';
      expect(rule, `${state} needs a glyph colour`).toContain(token);
    }
  });

  it('turns the glyph while a sync runs, and only when motion is welcome', () => {
    expect(CSS).toMatch(/\.meridian-status\.is-syncing\s+\.meridian-status-refresh\s*\{[^}]*animation:\s*spin/);
    expect(CSS).toMatch(/@media \(prefers-reduced-motion: no-preference\)\s*\{\s*\.meridian-status\.is-syncing \.meridian-status-refresh/);
  });

  it('renders the glyph inside the sync button, named for the action it takes', () => {
    const header = mount({ profileName: 'A Student' }).querySelector('.meridian-header')!;
    const btn = header.querySelector('.meridian-status')!;
    expect(btn.querySelector('.meridian-status-refresh'), 'the phone affordance is missing').toBeTruthy();
    expect(btn.querySelector('.meridian-status-dot'), 'the desktop lamp must survive').toBeTruthy();
    expect(btn.getAttribute('data-state')).toBeTruthy();
    expect(btn.getAttribute('aria-label')).toMatch(/refresh/i);
  });

  it('says it is working while the glyph is disabled mid-sync', () => {
    const header = mount({ profileName: 'A Student', isRefreshing: true }).querySelector('.meridian-header')!;
    const btn = header.querySelector<HTMLButtonElement>('.meridian-status')!;
    expect(btn.disabled).toBe(true);
    expect(btn.className).toContain('is-syncing');
    expect(btn.getAttribute('aria-label')).toBe('Refreshing your VTOP data');
  });
});

describe('a stray double tap cannot zoom the app', () => {
  it('removes double-tap zoom on the document frame without giving up panning', () => {
    const block = CSS.match(/html,\s*body\s*\{[^}]*\}/)?.[0] ?? '';
    expect(block, 'the html/body document-frame rule was not found').toBeTruthy();
    // `manipulation` = auto for pan/pinch, minus the double-tap zoom. Anything
    // stricter (`none`) would cancel the descendant `pan-y` scrollers.
    expect(block).toMatch(/touch-action:\s*manipulation/);
    // The pull-to-refresh guard it already carried is untouched.
    expect(block).toMatch(/overscroll-behavior:\s*none/);
    expect(block).toMatch(/overflow:\s*hidden/);
  });
});
