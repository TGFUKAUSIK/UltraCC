/**
 * The sync bar is the shell's only "the app is working" signal.
 *
 * One hairline on the top edge of the window, and it is on screen only while a
 * sync is open. A quiet app must show nothing at all: the header used to carry a
 * day-line along its bottom edge that always ended in a dot, which read as a
 * loader that had stopped. There is nothing in its place when nothing is
 * happening.
 *
 * It is also the one element painted against the window rather than laid out in
 * the header, so it can never add height to the measured phone shell — and it
 * must stay out of the app bar, whose `backdrop-filter` would otherwise become
 * the containing block for a `position: fixed` child.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MeridianHeader } from '../MeridianHeader';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement | undefined;
let root: Root | undefined;

function mount(isRefreshing: boolean) {
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
      isRefreshing,
    }));
  });
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = undefined;
  root = undefined;
});

const bar = () => container?.querySelector<HTMLElement>('.uc-sync-bar') ?? null;

describe('the header sync bar', () => {
  it('is on screen, and says so, only while a sync is open', () => {
    mount(true);
    expect(bar()?.className).toContain('is-on');
    expect(bar()!.getAttribute('aria-hidden')).toBe('false');
    expect(bar()!.getAttribute('aria-label')).toBe('Syncing your VTOP data');

    act(() => root?.unmount());
    mount(false);
    expect(bar()?.className).not.toContain('is-on');
    expect(bar()!.getAttribute('aria-hidden')).toBe('true');
    expect(bar()!.getAttribute('aria-label')).toBeNull();
  });

  it('paints against the window, never inside the app bar', () => {
    mount(true);
    // Inside <header> the phone app bar's backdrop-filter would become this
    // element's containing block, and `fixed` would mean "fixed to the bar".
    expect(bar()!.closest('.meridian-header')).toBeNull();
  });

  it('leaves nothing behind that could read as a stopped loader', () => {
    mount(false);
    expect(container!.querySelector('.meridian-dayline')).toBeNull();
  });
});
