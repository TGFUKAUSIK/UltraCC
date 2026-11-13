/**
 * TEMPORARY. Delete this file and its call site in `App.tsx` once the phone
 * measurement below has been read off a real iPhone — it exists only to replace
 * guesswork with numbers.
 *
 * "The bottom part is not utilised and leaves a white space blank" has now been
 * reported three times on an iPhone 12, in Safari *and* in the installed
 * home-screen app, and it has survived two structural repairs. The shell is
 * sized from `visualViewport.height` and the tab bar is its last flex row, so
 * every edge this codebase controls is already the same pixel. What is left is
 * the one thing no stylesheet can assert: how much of the screen the browser
 * hands to the page at all. On iOS the *layout* viewport and the *visible* box
 * are different rectangles, and the gap between them is painted by the browser,
 * not by us.
 *
 * So this panel reports both boxes side by side and lets the screenshot say
 * which one is short. It is deliberately inline-styled and takes no taps:
 * `overlayChrome.test.ts` reads full-screen overlays out of `className` string
 * literals, and a debug panel must not be mistaken for a product dialog.
 *
 * Reachable only by asking for it: append `?debug=viewport` to the URL. Nothing
 * renders otherwise, and the whole file is deleted in the same commit that
 * closes this pass.
 *
 * It answers a second question the same way. "The More sheet is invisible on the
 * phone" was reported after the sheet had already been measured correct in a
 * browser, so what is left is which build the phone is actually running and what is
 * on top of it. The `sw`, `cache` and `entry` rows say whether the code under test
 * is the code on the device. The `sheet` rows say where the sheet is and whether
 * anything paints over it — read them with the sheet open.
 */

import React, { useEffect, useState } from 'react';

const PANEL: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  zIndex: 9999,
  pointerEvents: 'none',
  font: '700 11px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  letterSpacing: '0.01em',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  color: '#d1fae5',
  background: 'rgba(3, 7, 18, 0.93)',
  padding: '8px 10px',
  borderBottom: '1px solid rgba(255, 255, 255, 0.28)',
};

/** Laid out off-screen so `env()` still resolves to a real length. */
const PROBE: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: '-9999px',
  width: '1px',
  height: '1px',
  visibility: 'hidden',
  pointerEvents: 'none',
  padding:
    'env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)',
};

function px(n: number): string {
  return `${Math.round(n * 100) / 100}px`;
}

function readInsets(): string {
  const probe = document.getElementById('uc-viewport-probe');
  if (!probe) return 'unavailable';
  const s = getComputedStyle(probe);
  return `t ${px(parseFloat(s.paddingTop) || 0)} r ${px(parseFloat(s.paddingRight) || 0)} b ${px(
    parseFloat(s.paddingBottom) || 0,
  )} l ${px(parseFloat(s.paddingLeft) || 0)}`;
}

function background(selector: string): string {
  const el = document.querySelector(selector);
  return el ? getComputedStyle(el).backgroundColor : '(none)';
}

function edge(selector: string): string {
  const el = document.querySelector(selector);
  return el ? px(el.getBoundingClientRect().bottom) : '(absent)';
}

/**
 * Which element the phone actually paints at the tab bar's own centre.
 *
 * This is the one reading the sheet cannot give and the stylesheet guards cannot
 * assert: a bar can have the right box, the right background and the right
 * `display` and still be invisible, because a fixed strip on the same row — the
 * safety net that reproduces the bar's footprint — paints over the top of it and
 * takes the icons and labels with it. `elementFromPoint` answers in paint order,
 * so "inside the bar" or a name are the whole test. The panel itself takes no
 * taps, so it can never be the thing that matches.
 */
function barTopmost(): string {
  const bar = document.querySelector('.mobile-tab-bar');
  if (!bar) return '(absent)';
  const r = bar.getBoundingClientRect();
  if (!r.width || !r.height) return '(no box)';
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  if (!hit) return '(nothing)';
  if (hit === bar || bar.contains(hit)) return 'inside the bar';
  const name = `.${String((hit as HTMLElement).className || '').split(' ')[0] || hit.tagName.toLowerCase()}`;
  return `COVERED by ${name}`;
}

function zIndexOf(selector: string): string {
  const el = document.querySelector(selector);
  return el ? getComputedStyle(el).zIndex : '(absent)';
}

function netZIndex(): string {
  return getComputedStyle(document.body, '::after').zIndex;
}

/** What the phone paints at the middle of a box, in words that need no reading. */
function topmostAt(el: Element | null, label: string): string {
  if (!el) return '(absent)';
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return '(no box)';
  const y = Math.max(1, Math.min(r.top + r.height / 2, window.innerHeight - 1));
  const hit = document.elementFromPoint(r.left + r.width / 2, y);
  if (!hit) return '(nothing at its centre)';
  if (hit === el || el.contains(hit)) return `${label} is on top`;
  if ((hit as HTMLElement).contains?.(el)) return `inside ${label}, but a parent takes the point`;
  const name = `.${String((hit as HTMLElement).className || '').split(' ')[0] || hit.tagName.toLowerCase()}`;
  return `COVERED by ${name}`;
}

/**
 * The More sheet, reported the way the student meets it.
 *
 * `sheet parent` is the row that decides whether the phone is even running the
 * build under test: the sheet must hang off a body-level `.meridian-feature-layer`,
 * and a parent of `.meridian-header` means this device still has the copy from
 * before it was portalled out of the app bar.
 *
 * `sheet landed` answers the next question without anyone having to work it out:
 * the sheet now measures itself on opening and hangs from the top of the frame when
 * the bottom edge put it under the glass, so this row says which of the two this
 * phone needed.
 */
function sheetRows(): string[] {
  const menu = document.getElementById('ultracc-services-menu') as HTMLElement | null;
  if (!menu) return ['sheet                     (not open — tap More, then read these rows)'];
  const layer = document.querySelector<HTMLElement>('.meridian-feature-layer');
  const header = document.querySelector('.meridian-header');
  const rescued = menu.classList.contains('meridian-feature-rescue');
  const r = menu.getBoundingClientRect();
  const cs = getComputedStyle(menu);
  const parent = menu.parentElement;
  const where = layer && parent === layer
    ? '.meridian-feature-layer (portal)'
    : header && header.contains(menu)
      ? '.meridian-header  ← OLD BUILD, pre-portal'
      : `.${String(parent?.className || parent?.tagName || '').split(' ')[0]}`;
  const onGlass = Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0);
  return [
    `sheet parent              ${where}`,
    `sheet landed              ${rescued ? `FALLBACK — the bottom edge left only ${px(onGlass)} on the glass` : `bottom-anchored, ${px(onGlass)} of it on the glass`}`,
    `sheet rect                top ${px(r.top)} bottom ${px(r.bottom)} of ${px(window.innerHeight)}`,
    `sheet style               ${cs.position} z${cs.zIndex} ${cs.display}/${cs.visibility} op ${cs.opacity}`,
    `sheet topmost at centre   ${topmostAt(menu, 'the sheet')}`,
    `scrim topmost at centre   ${topmostAt(document.querySelector('.meridian-feature-scrim'), 'the scrim')}`,
  ];
}

/** Which build the device is actually running, as far as a page is allowed to ask. */
async function workerRows(): Promise<string[]> {
  const rows: string[] = [];
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const controller = navigator.serviceWorker?.controller;
    rows.push(`sw controlled by          ${controller ? `${controller.scriptURL} ${controller.state}` : 'NO (network each load)'}`);
    rows.push(`sw waiting                ${reg?.waiting ? `${reg.waiting.scriptURL} ${reg.waiting.state} — tap Refresh` : 'none'}`);
  } catch {
    rows.push('sw registration           (unreadable)');
  }
  try {
    const keys = await caches.keys();
    rows.push(`shell cache               ${keys.filter((k) => /ultracc/.test(k)).join(', ') || '(none)'}`);
  } catch {
    rows.push('shell cache               (unreadable)');
  }
  const entry = performance
    .getEntriesByType('resource')
    .map((e) => e.name)
    .filter((n) => /\/assets\/.*\.(js|css)$/.test(n))
    .slice(0, 2);
  rows.push(`this page ran             ${entry.map((n) => n.split('/').pop()).join(', ') || '(no hashed assets — dev server)'}`);
  return rows;
}

function read(): string[] {
  const vv = window.visualViewport;
  const standalone =
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;
  return [
    `window.innerHeight        ${px(window.innerHeight)}`,
    `visualViewport.height     ${vv ? px(vv.height) : '(none)'}`,
    `visualViewport.offsetTop  ${vv ? px(vv.offsetTop) : '(none)'}`,
    `visualViewport.scale      ${vv ? String(vv.scale) : '(none)'}`,
    `documentElement.clientHeight ${px(document.documentElement.clientHeight)}`,
    `screen.height             ${px(window.screen.height)}`,
    `devicePixelRatio          ${String(window.devicePixelRatio)}`,
    `display-mode standalone   ${standalone ? 'YES' : 'no'}`,
    `env(safe-area-inset-*)    ${readInsets()}`,
    `--uc-visible-height       ${getComputedStyle(document.documentElement).getPropertyValue('--uc-visible-height').trim() || '(unset)'}`,
    `.ultracc-app rect.bottom  ${edge('.ultracc-app')}`,
    `.mobile-tab-bar bottom    ${edge('.mobile-tab-bar')}`,
    `bar topmost at centre     ${barTopmost()}`,
    `z #root / body::after     ${zIndexOf('#root')} / ${netZIndex()}`,
    `#root rect.bottom         ${edge('#root')}`,
    `bg html                   ${background('html')}`,
    `bg body                   ${background('body')}`,
    `bg #root                  ${background('#root')}`,
    `bg .ultracc-app           ${background('.ultracc-app')}`,
    `bg .mobile-tab-bar        ${background('.mobile-tab-bar')}`,
    ...sheetRows(),
  ];
}

export function ViewportDebugOverlay() {
  const [on] = useState(
    () =>
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('debug') === 'viewport',
  );
  const [lines, setLines] = useState<string[]>([]);
  const [workerLines, setWorkerLines] = useState<string[]>([]);

  useEffect(() => {
    if (!on) return;
    let alive = true;
    const update = () => setLines(read());
    update();
    const frame = requestAnimationFrame(update);
    const timer = window.setInterval(update, 400);
    // Cached storage and the worker registry are slower reads and change on a
    // much slower clock than a layout; two seconds is often enough to catch a
    // Refresh chip appearing after a deploy.
    const slow = window.setInterval(() => {
      void workerRows().then((rows) => {
        if (alive) setWorkerLines(rows);
      });
    }, 2000);
    void workerRows().then((rows) => {
      if (alive) setWorkerLines(rows);
    });
    const targets: Array<[EventTarget, string]> = [
      [window, 'resize'],
      [window, 'orientationchange'],
      [window, 'scroll'],
    ];
    if (window.visualViewport) {
      targets.push([window.visualViewport, 'resize'], [window.visualViewport, 'scroll']);
    }
    for (const [node, type] of targets) node.addEventListener(type, update, { passive: true });
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      window.clearInterval(timer);
      window.clearInterval(slow);
      for (const [node, type] of targets) node.removeEventListener(type, update);
    };
  }, [on]);

  if (!on) return null;

  return (
    <div style={PANEL} aria-hidden="true">
      <div id="uc-viewport-probe" style={PROBE} />
      {[...lines, ...workerLines].join('\n')}
    </div>
  );
}
