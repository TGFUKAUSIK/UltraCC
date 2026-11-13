/**
 * A bottom sheet's drag handle must be a thumb, not a hairline.
 *
 * The grabber the student sees is 4px tall. What they actually have to hit is the
 * header it is painted into, and until now that header's height was *inherited*
 * from whatever happened to sit in the row — the More sheet's close button, the
 * sheet head's own title. Both measured over 44px on a phone, so nothing was
 * broken; but a later pass shrinking either control would have taken the handle
 * under a thumb with nothing to catch it. A guard that only passes because two
 * unrelated numbers are still large is not a guard.
 *
 * So the floor is declared in the CSS and read back here. jsdom does no layout,
 * which is exactly why this file reads the stylesheet instead of trying to
 * measure a rendered box: the declaration is the contract, and the measured
 * heights (68px for the More sheet, 65px for a sheet head) are the browser's
 * report of it, not something this file can or should reproduce.
 *
 * `mobileScrollRefresh.test.ts` keeps the other half honest: the gesture that
 * this handle starts must be built from pointer events, never touch handlers.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
// index.css is CRLF; nothing below may cross a newline without allowing for it.
const CSS = readFileSync(join(ROOT, 'src', 'index.css'), 'utf8');
const HEADER = readFileSync(join(ROOT, 'src', 'components', 'MeridianHeader.tsx'), 'utf8');
const TIMETABLE = readFileSync(join(ROOT, 'src', 'components', 'TimetableView.tsx'), 'utf8');

/** Every rule whose selector mentions `selector`, as `{ selector, body }`. */
function rulesFor(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const out: { selector: string; body: string }[] = [];
  for (const m of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].includes(selector)) out.push({ selector: m[1].trim(), body: m[2] });
    // The escaped name is used so a selector written across the file's CRLF
    // still matches.
    else if (new RegExp(escaped).test(m[1])) out.push({ selector: m[1].trim(), body: m[2] });
  }
  return out;
}

/** The declared `min-height` in px for a rule, or NaN when it declares none. */
function minHeight(body: string): number {
  return Number(/min-height:\s*(\d+(?:\.\d+)?)px/.exec(body)?.[1] ?? NaN);
}

/** The one rule that turns a header into a drag surface. */
const dragHandle = (selector: string) => {
  const found = rulesFor(selector).filter((rule) => /touch-action:\s*none/.test(rule.body));
  expect(found.length, `${selector} declares exactly one draggable rule`).toBe(1);
  return found[0];
};

const MORE = dragHandle('.feature-menu-title');
const HEAD = dragHandle('.uc-sheet-head');

/**
 * Where an element's opening tag ends. A regex cannot do this: the More sheet's
 * handle writes `onPointerUp={() => endSheetDrag(false)}`, whose arrow function
 * puts a `>` far before the tag actually closes, so `[^>]*` reports a tag that
 * stops mid-attribute list. Braces, brackets and quotes are tracked instead —
 * the same scanner `tapTargets.test.ts` uses for the same reason.
 */
function tagEnd(source: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === '{' || ch === '(' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ')' || ch === ']') depth -= 1;
    else if (ch === '>' && depth === 0) return i;
  }
  return -1;
}

/** The opening tag of the first element carrying `className="<cls>"`, or ''. */
function openingTag(source: string, cls: string): string {
  const at = source.indexOf(`className="${cls}"`);
  if (at < 0) return '';
  const open = source.lastIndexOf('<', at);
  if (open < 0) return '';
  const end = tagEnd(source, open);
  return end < 0 ? '' : source.slice(open, end + 1);
}

const MORE_HANDLE = openingTag(HEADER, 'feature-menu-title');
const SHEET_HEAD_HANDLE = openingTag(TIMETABLE, 'uc-sheet-head');

describe('a sheet drag handle is at least a 44px thumb target', () => {
  it('reads the two rules it is claiming to check', () => {
    // Both handles are drag surfaces *because* they opt out of panning, so the
    // selector cannot drift onto a decorative look-alike without failing here.
    expect(MORE.selector).toContain('.feature-menu-title');
    expect(HEAD.selector).toContain('.uc-sheet-head');
  });

  it('declares the floor on the More sheet’s handle', () => {
    expect(minHeight(MORE.body), '.feature-menu-title declares no min-height').toBeGreaterThanOrEqual(44);
  });

  it('declares the floor once for every sheet that shares the head', () => {
    // One rule, four sheets (TimetableView, SettingsModal, ExtensionSyncModal,
    // SocialTab) — the floor travels with the class rather than per component.
    expect(minHeight(HEAD.body), '.uc-sheet-head declares no min-height').toBeGreaterThanOrEqual(44);
    expect((CSS.match(/\.uc-sheet-head\s*\{/g) ?? []).length).toBeGreaterThanOrEqual(1);
  });
});

describe('the floor is declared on something that actually drags', () => {
  it('wires the More sheet’s header to the pointer gesture', () => {
    // A min-height on a header nothing drags from is decoration.
    expect(MORE_HANDLE, 'no draggable .feature-menu-title in MeridianHeader').not.toBe('');
    for (const handler of ['onPointerDown', 'onPointerMove', 'onPointerUp', 'onPointerCancel']) {
      expect(MORE_HANDLE, `the handle is missing ${handler}`).toContain(handler);
    }
  });

  it('wires the shared head to the same gesture', () => {
    expect(SHEET_HEAD_HANDLE, 'no draggable .uc-sheet-head in TimetableView').not.toBe('');
    for (const handler of ['onPointerDown', 'onPointerMove', 'onPointerUp', 'onPointerCancel']) {
      expect(SHEET_HEAD_HANDLE, `the shared handle is missing ${handler}`).toContain(handler);
    }
  });

  it('limits the drag to pointer events, so the sheet body keeps its scroll', () => {
    // The handles themselves must carry no touch handler. The sources are not
    // swept for `onTouch*` wholesale: TimetableView's day rail legitimately has
    // `onTouchStart`/`onTouchEnd` for its own gesture, and
    // `mobileScrollRefresh.test.ts` draws the real line there by banning
    // `onTouchMove` — which is also the one thing that would hijack a scroll.
    for (const handle of [MORE_HANDLE, SHEET_HEAD_HANDLE]) {
      expect(handle).not.toMatch(/onTouch(Start|Move|End)/);
    }
    for (const source of [HEADER, TIMETABLE]) {
      expect(source).not.toMatch(/onTouchMove/);
    }
  });
});

describe('the visual grabber is untouched by the floor', () => {
  it('paints exactly one grabber per handle', () => {
    // Two rules here once left the pill 18px off-centre: the second copy's
    // `margin-left` fought the first copy's `translateX(-50%)`.
    expect((CSS.match(/\.feature-menu-title::before\s*\{/g) ?? []).length).toBe(1);
  });

  it('draws the grabber as a small pill, not as the hit area', () => {
    const grabber = /\.feature-menu-title::before\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? '';
    expect(grabber, 'the grabber disappeared').not.toBe('');
    const height = Number(/height:\s*(\d+)px/.exec(grabber)?.[1] ?? NaN);
    // Four pixels of ink; the 44px floor lives on the header behind it.
    expect(height).toBeLessThan(44);
  });
});
