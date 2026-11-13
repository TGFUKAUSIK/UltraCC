/**
 * The sign-in and settings dialogs are bottom sheets, and they behave like ones.
 *
 * Both were already wearing the sheet classes, and on a phone both already sat
 * at the bottom of the screen — but the sign-in sheet only got there because a
 * blanket `[class*="fixed"][class*="inset-0"]` rule happens to match its class
 * list, which also left it a *centred* dialog in the 701–768px band where
 * Settings was already a sheet. And neither could be thrown away: the CSS that
 * makes a sheet head draggable (a 44px floor plus `touch-action: none` on
 * `.uc-sheet-head`) was authored for exactly this gesture and, on these two
 * sheets, decorated a header nothing dragged from.
 *
 * So two things are pinned here: the sheets answer the same geometry question
 * the same way (read from the stylesheet, not remembered), and the throw the
 * head advertises actually closes them — with a nudge leaving them where they
 * were. `useSheetDrag`'s own mechanics are covered in its hook test; this file
 * checks the wiring the student touches.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React, { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SettingsModal } from '../SettingsModal';
import { SHEET_DISMISS_DISTANCE } from '../../hooks/useSheetDrag';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = process.cwd();
// index.css is CRLF; nothing below crosses a newline without allowing for it.
const CSS = readFileSync(join(ROOT, 'src', 'index.css'), 'utf8');
const source = (name: string) => readFileSync(join(ROOT, 'src', 'components', name), 'utf8');

const LOGIN = source('ExtensionSyncModal.tsx');
const SETTINGS = source('SettingsModal.tsx');

let host: HTMLElement | undefined;
let root: Root | undefined;

const modal = (props: Record<string, unknown> = {}) =>
  createElement(SettingsModal, {
    isOpen: true,
    onClose: () => {},
    semesters: [],
    selectedSemesterId: '',
    onSemesterChange: () => {},
    onClearAllData: async () => {},
    ...props,
  } as never);

function mount(node: React.ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => { root!.render(node); });
  return host.querySelector('.uc-sheet-head') as HTMLElement;
}

function pointer(type: string, clientY: number, pointerId = 1) {
  return new PointerEvent(type, { bubbles: true, cancelable: true, clientY, pointerId, pointerType: 'touch' });
}

afterEach(() => {
  if (root) act(() => root.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
});

describe('the two sheets are built from the same parts', () => {
  it('hands both an identically-anchored mobile sheet', () => {
    // Settings had its own rule; the login overlay is named here so it can no
    // longer drift with the Tailwind classes it happens to carry.
    expect(CSS).toMatch(/\.ultracc-settings-overlay\s*\{align-items:\s*flex-end/);
    expect(CSS).toMatch(/\.ultracc-login-overlay\s*\{align-items:\s*flex-end/);
    // Scoped to the overlay, not the bare panel class: `.uc-plate`/`.uc-sheet`
    // are declared later at the same specificity, so a single-class rule here
    // silently lost and the panel stayed a centred 672px card with a 14px
    // all-round radius. Both sheets have to win the same way.
    expect(CSS).toMatch(/\.ultracc-login-overlay\s+\.uc-sheet\s*\{[^}]*border-radius:\s*18px 18px 0 0/);
    expect(CSS).toMatch(/\.ultracc-settings-overlay\s+\.uc-sheet\s*\{[^}]*border-radius:\s*18px 18px 0 0/);
  });

  it('sizes the sheets’ corner buttons to a thumb, not a sliver', () => {
    expect(CSS).toMatch(/\.uc-sheet\s+\.uc-dir-ico\s*\{[^}]*min-width:\s*44px\s*!important/);
  });

  it('keeps the head’s action rail from eating the title', () => {
    // The directory mast gives `.uc-dir-rail` a line of its own — `flex: 1 0 100%`
    // — but a sheet head is a single non-wrapping row. There that full basis took
    // the whole line, could not shrink (`flex-shrink: 0`), and squeezed
    // `.uc-dir-id` — grow 1, shrink 1, `min-width: 0` — down to zero width, so
    // the sheet shipped a heading and a note nobody could read. In a head the
    // rail is content-sized instead.
    const body = /\.uc-sheet-head\s+\.uc-dir-rail\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? '';
    expect(body, 'a sheet head needs its own rail sizing rule').not.toBe('');
    // Content-sized, and it may not shrink: the one thing in a sheet head's rail
    // is a 44px close button, so a shrinkable rail would push the button out of
    // its own row the moment the title grew. The title takes the squeeze.
    expect(body).toMatch(/flex:\s*0 0 auto/);
    expect(body).toMatch(/min-width:\s*0/);
    // …while the mast keeps its own full-width row, untouched.
    expect(CSS).toMatch(/\.uc-dir-rail\s*\{[^}]*flex:\s*1 0 100%/);
  });

  it('paints a grabber only on a head that is actually wired to the drag', () => {
    const grabber = /\.uc-sheet-head\.is-draggable::before\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? '';
    expect(grabber, 'the sheet grabber disappeared').not.toBe('');
    // Four pixels of ink for the thumb to aim at; the 44px target is the head.
    expect(Number(/height:\s*(\d+)px/.exec(grabber)?.[1] ?? NaN)).toBeLessThan(44);
    for (const file of [LOGIN, SETTINGS]) {
      expect(file, 'the head is styled draggable but never marked so').toMatch(/uc-sheet-head is-draggable/);
    }
  });

  it('wires both heads to the shared throw gesture', () => {
    for (const file of [LOGIN, SETTINGS]) {
      expect(file).toMatch(/useSheetDrag\s*\(/);
      // The handlers go on the head; the offset becomes a transform on the
      // panel. A sheet that reads the hook but spreads it somewhere else would
      // pass a looser check and still not drag.
      expect(file).toMatch(/className="uc-plate-head uc-sheet-head is-draggable"\s*\{\.\.\.sheetDrag/);
      expect(file).toMatch(/transform:\s*`translateY\(\$\{[\w.]*(?:offset|sheetDrag\.offset)\}px\)`/);
    }
  });

  it('never grows its own touch handler — the gesture is pointer events only', () => {
    for (const file of [LOGIN, SETTINGS]) {
      expect(file).not.toMatch(/onTouch(Start|Move|End)/);
    }
  });
});

describe('the settings sheet answers the throw', () => {
  it('closes when the head is thrown down', () => {
    let closed = 0;
    const head = mount(modal({ onClose: () => { closed += 1; } }));
    act(() => { head.dispatchEvent(pointer('pointerdown', 0)); });
    act(() => { head.dispatchEvent(pointer('pointermove', SHEET_DISMISS_DISTANCE + 40)); });
    act(() => { head.dispatchEvent(pointer('pointerup', SHEET_DISMISS_DISTANCE + 40)); });
    expect(closed).toBe(1);
  });

  it('follows the finger before it is released', () => {
    const head = mount(modal());
    const panel = host!.querySelector('.uc-sheet') as HTMLElement;
    act(() => { head.dispatchEvent(pointer('pointerdown', 0)); });
    act(() => { head.dispatchEvent(pointer('pointermove', 70)); });
    expect(panel.style.transform).toBe('translateY(70px)');
    act(() => { head.dispatchEvent(pointer('pointerup', 70)); });
  });

  it('stays put when the head is only nudged', () => {
    let closed = 0;
    const head = mount(modal({ onClose: () => { closed += 1; } }));
    act(() => { head.dispatchEvent(pointer('pointerdown', 0)); });
    act(() => { head.dispatchEvent(pointer('pointermove', 20)); });
    act(() => { head.dispatchEvent(pointer('pointerup', 20)); });
    expect(closed).toBe(0);
  });

  it('is inert while a sync is running under the thumb', async () => {
    let closed = 0;
    let release: (v: { ok: boolean; message: string }) => void = () => {};
    const pending = new Promise<{ ok: boolean; message: string }>((resolve) => { release = resolve; });
    const head = mount(modal({ onClose: () => { closed += 1; }, onLmsSync: () => pending }));

    const sync = [...host!.querySelectorAll('button')].find((b) => (b.textContent || '').includes('Sync Now'))!;
    await act(async () => { sync.click(); });

    act(() => { head.dispatchEvent(pointer('pointerdown', 0)); });
    act(() => { head.dispatchEvent(pointer('pointermove', 400)); });
    act(() => { head.dispatchEvent(pointer('pointerup', 400)); });
    expect(closed).toBe(0);

    await act(async () => { release({ ok: true, message: 'done' }); });
  });
});
