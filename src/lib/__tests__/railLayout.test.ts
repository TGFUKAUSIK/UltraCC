/**
 * Navigation-rail layout contract.
 *
 * The rail is collapsible: an 82px icon column by default, 220px wide with
 * labels when expanded, and it snaps back to compact when a destination is
 * chosen. That behaviour lives entirely in `src/index.css`, and it silently
 * regressed once before: two later media queries forced the rail to 228px and
 * set `.meridian-rail-toggle { display: none }` at desktop widths, so the rail
 * could never collapse and the toggle never rendered.
 *
 * This test parses the stylesheet (precedent: upstreamIsolation.test.ts) and
 * holds the cascade to the contract, because no component-level test can see
 * a later `!important` override.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const PROJECT_ROOT = join(__dirname, '..', '..', '..');
const CSS = readFileSync(join(PROJECT_ROOT, 'src', 'index.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

interface Rule { condition: string; selector: string; body: string }

/** Walk the stylesheet, recording each rule's selector, body and enclosing @media. */
function parseStylesheet(css: string): Rule[] {
  const rules: Rule[] = [];
  const stack: string[] = [];
  let buffer = '';
  let index = 0;
  while (index < css.length) {
    const char = css[index];
    if (char === '{') {
      const head = buffer.trim();
      buffer = '';
      if (head.startsWith('@')) {
        stack.push(head);
      } else {
        const end = css.indexOf('}', index);
        rules.push({ condition: stack.join(' '), selector: head, body: css.slice(index + 1, end) });
        index = end;
      }
      index += 1;
      continue;
    }
    if (char === '}') {
      stack.pop();
      buffer = '';
      index += 1;
      continue;
    }
    buffer += char;
    index += 1;
  }
  return rules;
}

const RULES = parseStylesheet(CSS);

/** Does a media condition allow the given viewport width? */
function allowsWidth(condition: string, width: number): boolean {
  if (!condition.includes('@media')) return true;
  const min = /min-width:\s*(\d+)px/.exec(condition);
  const max = /max-width:\s*(\d+)px/.exec(condition);
  if (min && width < Number(min[1])) return false;
  if (max && width > Number(max[1])) return false;
  if (/max-height|orientation|print|prefers-/.test(condition)) return false;
  return true;
}

interface Declaration { value: string; condition: string }

/** Every declared value for a selector property, in document order. */
function declarations(selector: string, property: string, widths: number[]): Declaration[] {
  return RULES
    .filter((rule) => rule.selector.split(',').map((part) => part.trim()).includes(selector))
    .filter((rule) => widths.some((width) => allowsWidth(rule.condition, width)))
    .flatMap((rule) => rule.body.split(';')
      .map((part) => part.trim())
      .filter((part) => part.startsWith(`${property}:`))
      .map((part) => ({ value: part.slice(property.length + 1).trim(), condition: rule.condition })));
}

const DESKTOP = [900, 1280, 1600];
const PHONE = [414];

describe('navigation rail layout contract', () => {
  it('never hides the collapse/expand toggle at desktop widths', () => {
    const hiding = declarations('.meridian-rail-toggle', 'display', DESKTOP)
      .filter((entry) => entry.value.replace(/\s*!important$/, '') === 'none');
    expect(hiding, `The rail toggle is hidden inside: ${hiding.map((h) => h.condition).join(' | ')}`).toEqual([]);
    // ...and it is explicitly rendered, not left to fall back to `display: none`.
    const shown = declarations('.meridian-rail-toggle', 'display', DESKTOP)
      .filter((entry) => entry.value.replace(/\s*!important$/, '') === 'flex');
    expect(shown.length).toBeGreaterThan(0);
  });

  it('keeps the collapsed rail compact and the expanded rail wide', () => {
    const collapsed = declarations('.meridian-rail', 'width', DESKTOP).map((entry) => entry.value);
    expect(collapsed.at(-1)).toBe('82px!important');
    const expanded = declarations('.meridian-rail.expanded', 'width', DESKTOP).map((entry) => entry.value);
    expect(expanded.at(-1)).toBe('220px!important');
  });

  it('offsets the header and content by exactly the rail width, in both states', () => {
    const last = (selector: string, property: string) => declarations(selector, property, DESKTOP).at(-1)?.value;

    // Collapsed: the base layout reserves the compact rail.
    expect(last('.meridian-header', 'margin-left')).toBe('82px!important');
    expect(last('.ultracc-main', 'margin-left')).toBe('82px!important');
    expect(last('.ultracc-main', 'width')).toBe('calc(100% - 82px)!important');

    // Expanded: the rail grows and the reading area gives up the width.
    expect(last('.meridian-rail.expanded+.meridian-header', 'margin-left')).toBe('220px!important');
    expect(last('.ultracc-app:has(.meridian-rail.expanded) .ultracc-main', 'margin-left')).toBe('220px!important');
    expect(last('.ultracc-app:has(.meridian-rail.expanded) .ultracc-main', 'width'))
      .toBe('calc(100% - 220px)!important');
  });

  it('shows labels only while expanded', () => {
    // Expanded: labels are revealed (these rules are scoped to `.expanded`).
    const expandedLabel = declarations('.meridian-rail.expanded .portal-nav-group>button span', 'display', DESKTOP);
    expect(expandedLabel.at(-1)?.value).toBe('block!important');
    // Compact: the same labels are suppressed and the buttons shrink to icons.
    const compactLabel = declarations('.meridian-rail nav button>span:not(.meridian-more-dots)', 'display', DESKTOP)
      .map((entry) => entry.value);
    expect(compactLabel.at(-1)).toBe('none');
    const compact = declarations('.meridian-rail:not(.expanded) .portal-nav-group>button', 'width', DESKTOP);
    expect(compact.at(-1)?.value).toBe('46px!important');
    const headings = declarations('.meridian-rail:not(.expanded) .portal-nav-group h2', 'display', DESKTOP)
      .map((entry) => entry.value);
    expect(headings.at(-1)).toBe('none');
  });

  it('leaves phones to the dedicated tab bar — the rail never leaks in', () => {
    const railOnPhone = declarations('.meridian-rail', 'display', PHONE)
      .filter((entry) => entry.value.replace(/\s*!important$/, '') === 'none');
    expect(railOnPhone.length).toBeGreaterThan(0);
    const toggleOnPhone = declarations('.meridian-rail-toggle', 'display', PHONE)
      .filter((entry) => entry.value.replace(/\s*!important$/, '') === 'none');
    expect(toggleOnPhone.length).toBeGreaterThan(0);
  });

  it('scrolls only the destination list, so the bottom cluster stays reachable', () => {
    const navOverflow = declarations('.meridian-rail nav.portal-sidebar-nav', 'overflow-y', DESKTOP)
      .map((entry) => entry.value);
    expect(navOverflow.at(-1)).toBe('auto');
    const railOverflow = declarations('.meridian-rail', 'overflow', DESKTOP).map((entry) => entry.value);
    expect(railOverflow.at(-1)).toBe('hidden!important');
  });
});
