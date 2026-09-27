/**
 * Shared modal/popover keyboard behaviour. Only layout-independent guarantees
 * are asserted here — happy-dom reports every element as 0×0, so the tab-ring
 * code (which deliberately skips zero-sized, i.e. display:none, controls) can
 * only be verified in a real browser.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useDialog, useEscapeKey } from '../useDialog';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement;
let root: Root;

function mount(node: ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(node));
}

function unmount() {
  act(() => root.unmount());
  host.remove();
}

afterEach(unmount);

function pressEscape() {
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  });
}

function DialogHarness({ onClose, open = true }: { onClose: () => void; open?: boolean }) {
  const panelRef = useDialog<HTMLDivElement>({ isOpen: open, onClose });
  if (!open) return <div />;
  return (
    <div ref={panelRef} role="dialog" aria-label="Test dialog">
      <button type="button">Inside</button>
    </div>
  );
}

describe('useDialog', () => {
  it('closes on Escape and ignores other keys', () => {
    const onClose = vi.fn();
    mount(<DialogHarness onClose={onClose} />);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
    pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('routes Escape to the current onClose, not the one it mounted with', () => {
    // Callers pass inline arrows, so a stale closure would close an old target.
    const first = vi.fn();
    const second = vi.fn();
    mount(<DialogHarness onClose={first} />);
    act(() => root.render(<DialogHarness onClose={second} />));
    pressEscape();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('stops listening once the dialog closes', () => {
    const onClose = vi.fn();
    mount(<DialogHarness onClose={onClose} />);
    act(() => root.render(<DialogHarness onClose={onClose} open={false} />));
    pressEscape();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('returns focus to the element that opened the dialog', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    mount(<DialogHarness onClose={vi.fn()} />);
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});

describe('useEscapeKey', () => {
  function PopoverHarness({ active, onDismiss }: { active: boolean; onDismiss: () => void }) {
    useEscapeKey(active, onDismiss);
    return <div />;
  }

  it('dismisses an open popover on Escape and stops listening once closed', () => {
    const onDismiss = vi.fn();
    mount(<PopoverHarness active onDismiss={onDismiss} />);
    pressEscape();
    expect(onDismiss).toHaveBeenCalledTimes(1);

    act(() => root.render(<PopoverHarness active={false} onDismiss={onDismiss} />));
    pressEscape();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
