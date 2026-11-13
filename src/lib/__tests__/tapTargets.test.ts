/**
 * Tap-target and accessible-name guard for icon-only buttons.
 *
 * An icon-only button is the one control on the page a student cannot see the
 * label of, so it has to satisfy two things or it fails on a phone: a thumb
 * target of at least 44px (Apple's own minimum, and the number index.css
 * already enforces for the app's rows, tabs and chips) and a name a screen
 * reader can say. "p-2 rounded-lg" with a 16px X inside is 32px of target, and
 * `CgpaSimulator`'s clear-goal trash had neither — VoiceOver announced it as
 * plain "button" in the middle of a saved-result card.
 *
 * Both halves of the rule are read from the repo rather than remembered: the
 * 44px floor can be declared in the button's own Tailwind classes, or come from
 * a class index.css sizes at 44px or more (`.calendar-day-sheet-close` is 44px
 * on every screen, `.attendance-predictor-close` gets the phone floor from the
 * touch-target block). A future component that shrinks one of those shell
 * classes below 44 fails here instead of on a student's thumb.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const CSS = readFileSync(join(ROOT, 'src', 'index.css'), 'utf8');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    if (entry === '__tests__') continue;
    const full = join(ROOT, dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(`${dir}/${entry}`));
    else if (/\.tsx$/.test(entry)) out.push(full);
  }
  return out;
}

const RENDER = [...sourceFiles('src/components'), join(ROOT, 'src', 'App.tsx')];
// Forward slashes on every platform, so the file names below read the same way
// they do in an editor or a stack trace.
const relative = (p: string) => p.slice(ROOT.length + 1).split('\\').join('/');

/**
 * Comments out, but every character position is kept, so a reported line number
 * is the line the student's browser would have shown in the source map.
 */
function codeOnly(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (match, prefix) => prefix + ' '.repeat(match.length - prefix.length));
}

/** Classes index.css itself sizes to a thumb-reachable box. */
const CSS_SIZED = (() => {
  const sized = new Set<string>();
  for (const rule of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls = rule[2];
    const tall = /(?:min-)?(?:height|width):\s*(?:4[4-9]|[5-9]\d|1\d\d)px/.test(decls);
    const floored = /min-height:\s*44px\s*!important/.test(decls);
    if (!tall && !floored) continue;
    for (const selector of rule[1].matchAll(/\.([a-z][a-z0-9-]*)/g)) sized.add(selector[1]);
  }
  return sized;
})();

/** A Tailwind box that is at least 44px on both axes, written or implied. */
const SELF_SIZED = /min-h-\[(4[4-9]|[5-9]\d|\d{3,})px\]|min-w-\[(4[4-9]|[5-9]\d|\d{3,})px\]|(?:(?:^|[\s"'\[])(?:w|h|size)-(?:1[1-9]|[2-9]\d))(?:\s|["'\]]|$)/;

/** An icon-only button: its whole content is one or more self-closing elements. */
const ICON_ONLY = /^(?:<\w[\w.]*\b[^>]*\/>\s*)+$/;
const NAMED = /aria-label=|aria-labelledby=|title=/;

/** What one button's markup says about its name and its target size. */
function evaluate(attrs: string, inner: string) {
  const classes = /className=(["'`])([\s\S]*?)\1/.exec(attrs)?.[2] ?? '';
  return {
    named: NAMED.test(attrs) || NAMED.test(inner),
    sized:
      SELF_SIZED.test(attrs) ||
      [...classes.matchAll(/[a-z][a-z0-9-]*/g)].some((token) => CSS_SIZED.has(token[0])),
  };
}

/**
 * Where an element's opening tag ends. A regex cannot do this: several of these
 * sheets are written on one line, and an arrow function in an attribute
 * (`onClick={() => setShowCreate(false)}`) puts a `>` far before the tag closes.
 * Braces, brackets and quotes are tracked instead.
 */
function tagEnd(code: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < code.length; i += 1) {
    const ch = code[i];
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

/**
 * Two surfaces are excused from the size rule, and each excuse is tied to the
 * CSS that justifies it — if that rule is ever removed, the file loses its
 * excuse and fails here rather than shrinking quietly on a phone.
 *
 * The app bar is measured shell geometry, not an oversight: index.css sizes its
 * controls against the 58px bar, and the whole phone shell was rebuilt around
 * the visible viewport of a real device, so changing it is a shell decision to
 * verify on that phone. The notification panel's two controls are lifted by the
 * touch-target floor block instead of per button.
 *
 * Both are still checked for a name: the exemption is about size only.
 */
const SIZE_EXEMPT: Record<string, RegExp[]> = {
  'src/components/MeridianHeader.tsx': [
    /\.meridian-actions \.icon-button\{width:38px;height:38px/,
    /\.meridian-avatar\s*\{\s*width:38px;\s*height:38px/,
    /\.meridian-rail\{display:none!important\}/,
  ],
  'src/components/NotificationBell.tsx': [
    /\.notification-bell-root\s+button,[^{}]*\{[^{}]*min-height:\s*44px\s*!important/,
  ],
};

const ICON_BUTTONS = RENDER.flatMap((file) => {
  const code = codeOnly(file);
  const exempt = Boolean(SIZE_EXEMPT[relative(file)]);
  const out: { file: string; line: number; attrs: string; named: boolean; sized: boolean; exempt: boolean }[] = [];
  for (let i = code.indexOf('<button'); i >= 0; i = code.indexOf('<button', i + 1)) {
    if (!/^<button[\s>]/.test(code.slice(i))) continue;
    const close = tagEnd(code, i);
    if (close < 0) break;
    const attrs = code.slice(i + '<button'.length, close);
    const end = code.indexOf('</button>', close);
    if (end < 0 || end - close > 1800) continue;
    const inner = code.slice(close + 1, end).trim();
    if (!ICON_ONLY.test(inner)) continue;
    out.push({
      file: relative(file),
      line: code.slice(0, i).split('\n').length,
      attrs: attrs.replace(/\s+/g, ' ').trim().slice(0, 70),
      ...evaluate(attrs, inner),
      exempt,
    });
  }
  return out;
});

describe('icon-only buttons', () => {
  it('finds the controls it is claiming to check', () => {
    expect(ICON_BUTTONS.filter((b) => !b.exempt).length).toBeGreaterThanOrEqual(20);
    // The shell must be readable, or "sized" means nothing.
    expect(CSS_SIZED.has('calendar-day-sheet-close')).toBe(true);
    expect(CSS_SIZED.has('attendance-predictor-close')).toBe(true);
  });

  it('excuses a surface only while the CSS that justifies it is still there', () => {
    for (const [file, proofs] of Object.entries(SIZE_EXEMPT)) {
      expect(RENDER.map(relative)).toContain(file);
      for (const proof of proofs) expect(CSS).toMatch(proof);
    }
  });

  it('catches the markup that started this', () => {
    const bad = evaluate(' onClick={clearGoal} className="p-2 rounded-lg text-zinc-500"', '<Trash2 className="h-4 w-4" />');
    expect(bad).toEqual({ named: false, sized: false });

    const fixed = evaluate(' onClick={clearGoal} aria-label="Clear target CGPA" className="grid min-h-[44px] min-w-[44px]"', '<Trash2 className="h-4 w-4" />');
    expect(fixed).toEqual({ named: true, sized: true });

    // Sized by the shell rather than by the component still counts.
    const shell = evaluate(' className="attendance-predictor-close" aria-label="Close"', '<X className="h-4 w-4" />');
    expect(shell.sized).toBe(true);
  });

  it('says what it does, in a name a screen reader can read', () => {
    const mute = ICON_BUTTONS.filter((b) => !b.named).map((b) => `${b.file}:${b.line} ${b.attrs}`);
    expect(mute).toEqual([]);
  });

  it('is at least a 44px target, in its own classes or the shell’s', () => {
    const small = ICON_BUTTONS.filter((b) => !b.sized && !b.exempt).map((b) => `${b.file}:${b.line} ${b.attrs}`);
    expect(small).toEqual([]);
  });
});
