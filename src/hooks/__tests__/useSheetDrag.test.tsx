/**
 * The throw that closes a bottom sheet.
 *
 * Three sheets in UltraCC are dismissed by dragging the head down — the More
 * menu, the timetable share sheet, and now the sign-in and settings sheets.
 * The first two each grew their own copy of the gesture; this hook is the one
 * the last two share, so its rules get pinned here rather than inferred from a
 * component that happens to use it.
 *
 * The rules that matter: a throw past the threshold closes, a nudge does not
 * (so the gesture is safe to try), a sheet that is mid-task ignores the hand
 * entirely, an upward pull is clamped instead of tearing a gap above the sheet,
 * and an interrupted gesture (a system sheet, a call) puts the sheet back
 * rather than counting as a throw. It is built from pointer events only — see
 * `mobileScrollRefresh.test.ts`, which bans `onTouchMove` outright.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useSheetDrag, SHEET_DISMISS_DISTANCE } from '../useSheetDrag';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement | undefined;
let root: Root | undefined;

function Harness({ onDismiss, enabled }: { onDismiss: () => void; enabled?: boolean }) {
  const { offset, dragging, handlers } = useSheetDrag({ onDismiss, enabled });
  return createElement('div', {
    className: 'head',
    'data-offset': String(offset),
    'data-dragging': String(dragging),
    ...handlers,
  });
}

function ControlHarness({ onDismiss }: { onDismiss: () => void }) {
  const { offset, dragging, handlers } = useSheetDrag({ onDismiss });
  return createElement('div', {
    className: 'head',
    'data-offset': String(offset),
    'data-dragging': String(dragging),
    ...handlers,
  }, createElement('button', { type: 'button', className: 'close' }, 'close'));
}

function mount(props: { onDismiss: () => void; enabled?: boolean }) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => { root!.render(createElement(Harness, props)); });
  return host.querySelector('.head') as HTMLElement;
}

/** A pointer event carrying the fields the hook reads. */
function pointer(type: string, clientY: number, pointerId = 1) {
  return new PointerEvent(type, { bubbles: true, cancelable: true, clientY, pointerId, pointerType: 'touch' });
}

const drag = (head: HTMLElement, from: number, to: number) => {
  act(() => { head.dispatchEvent(pointer('pointerdown', from)); });
  act(() => { head.dispatchEvent(pointer('pointermove', to)); });
  act(() => { head.dispatchEvent(pointer('pointerup', to)); });
};

const offsetNow = (head: HTMLElement) => Number(head.getAttribute('data-offset'));

afterEach(() => {
  if (root) act(() => root.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
});

describe('a sheet head drag', () => {
  it('closes the sheet when thrown past the threshold', () => {
    let dismissed = 0;
    const head = mount({ onDismiss: () => { dismissed += 1; } });
    act(() => { head.dispatchEvent(pointer('pointerdown', 0)); });
    act(() => { head.dispatchEvent(pointer('pointermove', SHEET_DISMISS_DISTANCE + 24)); });
    expect(offsetNow(head)).toBe(SHEET_DISMISS_DISTANCE + 24);
    act(() => { head.dispatchEvent(pointer('pointerup', SHEET_DISMISS_DISTANCE + 24)); });
    expect(dismissed).toBe(1);
    // The offset is released in the same tick as the dismissal, so a render
    // caused by the close cannot paint the sheet still held down the screen.
    expect(offsetNow(head)).toBe(0);
  });

  it('springs back, without closing, when the drag is only a nudge', () => {
    let dismissed = 0;
    const head = mount({ onDismiss: () => { dismissed += 1; } });
    drag(head, 0, SHEET_DISMISS_DISTANCE - 1);
    expect(dismissed).toBe(0);
    expect(offsetNow(head)).toBe(0);
  });

  it('tracks the finger while it is down, and stops tracking once it lifts', () => {
    const head = mount({ onDismiss: () => {} });
    act(() => { head.dispatchEvent(pointer('pointerdown', 100)); });
    act(() => { head.dispatchEvent(pointer('pointermove', 160)); });
    expect(offsetNow(head)).toBe(60);
    act(() => { head.dispatchEvent(pointer('pointerup', 160)); });
    // Released below the threshold, so it is back at rest.
    expect(offsetNow(head)).toBe(0);
    expect(head.getAttribute('data-dragging')).toBe('false');
  });

  it('clamps an upward pull instead of tearing a gap above the sheet', () => {
    const head = mount({ onDismiss: () => {} });
    act(() => { head.dispatchEvent(pointer('pointerdown', 200)); });
    act(() => { head.dispatchEvent(pointer('pointermove', 120)); });
    expect(offsetNow(head)).toBe(0);
    act(() => { head.dispatchEvent(pointer('pointerup', 120)); });
  });

  it('is inert while the sheet is busy — a mid-task sheet is not thrown away', () => {
    let dismissed = 0;
    const head = mount({ onDismiss: () => { dismissed += 1; }, enabled: false });
    drag(head, 0, 400);
    expect(dismissed).toBe(0);
    expect(offsetNow(head)).toBe(0);
    expect(head.getAttribute('data-dragging')).toBe('false');
  });

  it('does not count an interrupted gesture as a throw', () => {
    let dismissed = 0;
    const head = mount({ onDismiss: () => { dismissed += 1; } });
    act(() => { head.dispatchEvent(pointer('pointerdown', 0)); });
    act(() => { head.dispatchEvent(pointer('pointermove', 300)); });
    act(() => { head.dispatchEvent(pointer('pointercancel', 300)); });
    expect(dismissed).toBe(0);
    expect(offsetNow(head)).toBe(0);
  });

  it('ignores a second finger that lands while the sheet is already moving', () => {
    const head = mount({ onDismiss: () => {} });
    act(() => { head.dispatchEvent(pointer('pointerdown', 0)); });
    act(() => { head.dispatchEvent(pointer('pointermove', 50, 1)); });
    // A second pointer is a pinch or a scroll, not a throw; the sheet follows
    // the first finger only.
    act(() => { head.dispatchEvent(pointer('pointerdown', 0, 2)); });
    act(() => { head.dispatchEvent(pointer('pointermove', 500, 2)); });
    act(() => { head.dispatchEvent(pointer('pointermove', 70, 1)); });
    expect(offsetNow(head)).toBe(70);
    act(() => { head.dispatchEvent(pointer('pointerup', 70, 1)); });
  });

  it('leaves a press that starts on a control to that control', () => {
    let dismissed = 0;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(createElement(ControlHarness, { onDismiss: () => { dismissed += 1; } })));
    const head = host.querySelector('.head') as HTMLElement;
    const close = host.querySelector('.close') as HTMLElement;
    // The close button sits inside the head. Capturing the pointer on the head
    // would retarget the pointerup and swallow the button's click.
    act(() => { close.dispatchEvent(pointer('pointerdown', 10, 7)); });
    act(() => { head.dispatchEvent(pointer('pointermove', 200, 7)); });
    act(() => { head.dispatchEvent(pointer('pointerup', 200, 7)); });
    expect(head.getAttribute('data-dragging')).toBe('false');
    expect(offsetNow(head)).toBe(0);
    expect(dismissed).toBe(0);
  });

  it('drops a drag that is still in progress when the sheet goes busy', () => {
    let dismissed = 0;
    const onDismiss = () => { dismissed += 1; };
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    const render = (enabled: boolean) => act(() => root!.render(createElement(Harness, { onDismiss, enabled })));
    render(true);
    const head = host.querySelector('.head') as HTMLElement;
    act(() => { head.dispatchEvent(pointer('pointerdown', 0)); });
    act(() => { head.dispatchEvent(pointer('pointermove', 200)); });
    expect(offsetNow(head)).toBe(200);
    // The sync starts under the thumb.
    render(false);
    expect(offsetNow(head)).toBe(0);
    act(() => { head.dispatchEvent(pointer('pointerup', 200)); });
    expect(dismissed).toBe(0);
  });
});
