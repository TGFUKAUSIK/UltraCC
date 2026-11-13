/**
 * Filled-surface contrast guard.
 *
 * UltraCC's route views are written in light vocabulary (`bg-blue-600
 * text-zinc-900`), and the shell then re-maps `text-zinc-900` onto `--uc-ink` —
 * in the route frame with `!important`, and again per theme. On a plain card
 * that is exactly right; on a solid fill it silently destroys the label,
 * because a -600 fill paints the same pixel in light, dark and midnight while
 * its ink does not: #0f172a on Tailwind's blue-600 measures 3.8:1, below the
 * 4.5:1 AA bar — and that is what every primary button ("Login with VTOP", the
 * Academics filters, the Event Hub tabs) was wearing.
 *
 * So a fill's label must be theme-independent, and there are only two sane
 * choices: `text-white` or `text-slate-950`. Which one wins is a luminance
 * question, not a taste question, and it splits by hue — white carries blue,
 * indigo, violet, purple, fuchsia, rose, red; near-black carries sky, cyan,
 * emerald, teal, green, amber, yellow, orange. `text-zinc-950` is NOT a safe
 * value: the dark re-map claims it along with 900 and 800, so a bright fill
 * wearing it turns pale-on-bright in dark themes.
 *
 * The same arithmetic applies to hover fills, which is why `hover:bg-blue-500`
 * under `text-white` (3.8:1) became `hover:bg-blue-700` (6.8:1), and
 * `hover:bg-emerald-700` under `text-slate-950` became `hover:bg-emerald-500`.
 *
 * Nothing here trusts a remembered hex: the palette is parsed from Tailwind's
 * own theme.css and converted from OKLCH, so a Tailwind bump that shifts a hue
 * fails this test instead of quietly failing the students who read it.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const CSS = readFileSync(join(ROOT, 'src', 'index.css'), 'utf8');
const TW = readFileSync(join(ROOT, 'node_modules', 'tailwindcss', 'theme.css'), 'utf8');
const AA = 4.5;

/** OKLCH (as Tailwind v4 defines it) -> sRGB hex. */
function oklchToHex(source: string): string {
  const [lRaw, cRaw, hRaw = '0'] = source.trim().split(/[\s,]+/);
  const L = lRaw.endsWith('%') ? parseFloat(lRaw) / 100 : parseFloat(lRaw);
  const C = parseFloat(cRaw);
  const H = (parseFloat(hRaw) * Math.PI) / 180;
  const A = C * Math.cos(H);
  const B = C * Math.sin(H);
  const l_ = L + 0.3963377794 * A + 0.2158037573 * B;
  const m_ = L - 0.1055613458 * A - 0.0638541728 * B;
  const s_ = L - 0.0894841775 * A - 1.291485548 * B;
  const [lr, mg, bs] = [l_ ** 3, m_ ** 3, s_ ** 3];
  const linear = [
    4.0767416621 * lr - 3.307716642 * mg + 0.2317456898 * bs,
    -1.2684380046 * lr + 2.6097574011 * mg - 0.3413193965 * bs,
    -0.0041960863 * lr - 0.7034186147 * mg + 1.707614701 * bs,
  ];
  const encode = (v: number) => {
    const s = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, s)) * 255);
  };
  return `#${linear.map((v) => encode(v).toString(16).padStart(2, '0')).join('')}`;
}

/** Every colour Tailwind ships, as `hue-step` -> hex. */
const PALETTE = new Map<string, string>();
for (const m of TW.matchAll(/--color-([a-z]+)-(\d{2,3}):\s*oklch\(([^)]+)\)/g)) {
  PALETTE.set(`${m[1]}-${m[2]}`, oklchToHex(m[3]));
}

const channel = (hex: string, i: number) => {
  const v = parseInt(hex.slice(i, i + 2), 16) / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) =>
  0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
const ratio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return Number(((hi + 0.05) / (lo + 0.05)).toFixed(2));
};

/** The two theme-independent labels a fill may wear. */
const LABELS = { 'text-white': '#ffffff', 'text-slate-950': PALETTE.get('slate-950') ?? '#020617' };

/** Whichever label reads better on that fill — the whole rule, in one function. */
function labelFor(hex: string): keyof typeof LABELS {
  return ratio(hex, LABELS['text-white']) >= ratio(hex, LABELS['text-slate-950'])
    ? 'text-white'
    : 'text-slate-950';
}

/** Fills solid enough to carry a label; 50–300 are tints and use theme ink. */
const SOLID_STEPS = ['400', '500', '600', '700', '800', '900', '950'];

/**
 * The palette Tailwind ships has colours no UI can label safely at all — that
 * is Tailwind's problem, not UltraCC's. What must hold is that every fill this
 * app puts a label on has a passing label, and that the components use it.
 */
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

const variants = /^(?:hover:|focus:|active:|group-hover:|peer-hover:)/;
const fillOf = (token: string) => {
  const bare = token.replace(variants, '');
  const m = bare.match(/^bg-([a-z]+)-(\d{2,3})$/);
  if (!m || !SOLID_STEPS.includes(m[2])) return null;
  return PALETTE.get(`${m[1]}-${m[2]}`) ?? null;
};

/**
 * The other way this app paints a fill: the --acc-* / --uc-* tokens the redesign
 * moves filled surfaces onto. `.acc-bg` and `.uc-X-go.acc-bg` wear the accent
 * label from the pin rule; `.uc-fill-*` and `.uc-panel-*` are the tone tints.
 * The scan below counts a literal carrying one of these as a filled surface too,
 * so the proof that the scan read real code does not evaporate as the literals
 * `fillOf` recognises are retired — the painted surfaces just change vocabulary.
 */
const TOKEN_FILL = /\b(?:acc-bg|uc-(?:fill|panel)-(?:safe|warning|critical|unknown|info))\b/;
const isFilled = (token: string) => fillOf(token) !== null || TOKEN_FILL.test(token);

const tokensOf = (raw: string) => raw.trim().split(/\s+/);

/**
 * One className literal -> the violations it commits. A pure function, so this
 * suite can feed it the exact bug the guard exists to catch rather than trusting
 * that some real file still happens to contain one.
 */
function inspect(rel: string, raw: string, used: Map<string, string>): string[] {
  const violations: string[] = [];
  const tokens = tokensOf(raw);
  const fills = tokens.filter((t) => fillOf(t));

  // The original defect: a solid fill wearing a label the shell repaints per
  // theme. Checked on EVERY literal with a fill — the shipped bug was precisely
  // a fill carrying only a zinc label, which a label-only scan walked straight
  // past. `.acc-bg` is exempt because the accent pin re-colours it past these.
  const ink = tokens.find((t) => /^text-zinc-9\d\d$/.test(t));
  if (ink && fills.length && !tokens.includes('acc-bg'))
    violations.push(
      `${rel}: ${fills.join(', ')} with ${ink} — the shell repaints that ink per theme — ${raw.slice(0, 70)}`,
    );

  const white = tokens.includes('text-white');
  const nearBlack = tokens.includes('text-slate-950');
  if (!white && !nearBlack) return violations;

  const label = white ? 'text-white' : 'text-slate-950';
  for (const token of tokens) {
    const hex = fillOf(token);
    if (!hex) continue;
    used.set(token.replace(variants, ''), hex);
    const measured = ratio(LABELS[label], hex);
    if (labelFor(hex) !== label)
      violations.push(`${rel}: ${token} is a ${labelFor(hex)} fill, written as ${label} (${measured}:1)`);
    else if (measured < AA)
      violations.push(`${rel}: ${token} + ${label} = ${measured}:1, below AA`);
  }
  return violations;
}

function scanLiterals() {
  const violations: string[] = [];
  const used = new Map<string, string>();
  let labelled = 0;
  let filled = 0;
  for (const file of [...sourceFiles('src/components'), join(ROOT, 'src', 'App.tsx')]) {
    const rel = file.slice(ROOT.length + 1);
    const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of code.matchAll(/["'`]([^"'`\n]{1,700})["'`]/g)) {
      const tokens = tokensOf(m[1]);
      if (tokens.some(isFilled)) filled += 1;
      if (tokens.includes('text-white') || tokens.includes('text-slate-950')) labelled += 1;
      violations.push(...inspect(rel, m[1], used));
    }
  }
  return { violations, used, labelled, filled };
}

const SCAN = scanLiterals();

describe('the fills this app labels', () => {
  it('scans a real surface of the UI', () => {
    // A guard that quietly stops matching anything is a guard that passes, so
    // the scan has to prove it read real code. It proves that through the fills
    // it finds — not through the labels. Both halves walk the same literals, so
    // a broken quote pattern or a moved directory still shows up here as a
    // crater.
    //
    // "Fill" here means either vocabulary this app paints with: Tailwind's
    // `bg-<hue>-<step>` literals, or the --acc-* / --uc-* tokens the redesign
    // moves solid surfaces onto (`.acc-bg`, `.uc-fill-*`, `.uc-panel-*`). The
    // floor is unchanged, so counting the token fills too does not lower the bar
    // the scan has to clear — it keeps the bar reachable as the literals retire,
    // which is exactly what the label half below now does without.
    //
    // The label count is deliberately not a floor any more. The redesign takes
    // filled surfaces off Tailwind's `bg-<hue>-<step>` literals and onto the
    // --acc-* / --uc-* tokens (`.acc-bg`, `.uc-X-go.acc-bg`), where the accent
    // pin supplies the label instead of a `text-white` class; that work shrinks
    // the label half toward nothing, and a floor here would only force the app
    // to keep the literals it is retiring. What must hold is that whatever label
    // the scan still finds clears AA — that is the next test, and the accent
    // contract below covers the token fills this can no longer see.
    expect(SCAN.filled).toBeGreaterThan(12);
    if (SCAN.labelled > 0) expect(SCAN.used.size).toBeGreaterThan(0);
  });

  it('every fill it sees has an AA-passing label in the table', () => {
    for (const [key, hex] of SCAN.used) {
      expect(ratio(hex, LABELS[labelFor(hex)]), `${key} → ${labelFor(hex)}`).toBeGreaterThanOrEqual(AA);
    }
  });
});

describe('the guard catches the bug it was written for', () => {
  const planted = (cls: string) => inspect('planted.tsx', cls, new Map());

  it('flags a fill carrying only theme-re-mapped ink', () => {
    // What "Login with VTOP" looked like before the fix — and what the first
    // version of this scan passed, because it skipped literals with no label.
    expect(planted('bg-blue-600 hover:bg-blue-500 text-zinc-900 font-semibold').length).toBeGreaterThan(0);
    expect(planted('bg-indigo-600 text-zinc-950 px-4 py-2 rounded-lg').length).toBeGreaterThan(0);
  });

  it('flags the wrong label for the hue', () => {
    expect(planted('bg-emerald-600 text-white px-3').length).toBeGreaterThan(0);
    expect(planted('bg-blue-600 text-slate-950 px-3').length).toBeGreaterThan(0);
  });

  it('flags a hover step that drops below AA', () => {
    expect(planted('bg-blue-600 hover:bg-blue-500 text-white px-3').length).toBeGreaterThan(0);
    expect(planted('bg-emerald-600 hover:bg-emerald-700 text-slate-950 px-3').length).toBeGreaterThan(0);
  });

  it('accepts the shapes the app now uses', () => {
    expect(planted('bg-blue-600 hover:bg-blue-700 text-white font-semibold px-3 py-2')).toEqual([]);
    expect(planted('bg-emerald-600 hover:bg-emerald-500 text-slate-950 px-3 py-2')).toEqual([]);
    expect(planted('bg-white text-zinc-900 border border-zinc-200')).toEqual([]);
    expect(planted('acc-bg bg-blue-600 text-zinc-900')).toEqual([]);
  });
});

describe('index.css accent contract', () => {
  const accents = [...CSS.matchAll(/--acc-600:\s*(#[0-9a-f]{6})[\s\S]{0,220}?--acc-on:\s*(#[0-9a-f]{6})/g)];

  it('every accent that paints .acc-bg also declares its label colour', () => {
    const fills = [...CSS.matchAll(/--acc-600:\s*(#[0-9a-f]{6})/g)].length;
    expect(fills).toBeGreaterThanOrEqual(6);
    expect(accents.length).toBe(fills);
  });

  it('each accent label clears AA against its own fill', () => {
    for (const [, fill, on] of accents) {
      expect(ratio(fill, on), `${fill} with ${on}`).toBeGreaterThanOrEqual(AA);
    }
  });

  it('pins the accent label after the re-maps that would beat it', () => {
    const pin = CSS.lastIndexOf('html .ultracc-app .ultracc-route-frame .acc-bg');
    const routeRemap = CSS.indexOf('[class*="text-zinc-900"]');
    const themeRemap = CSS.indexOf('.ultracc-app .text-zinc-900');
    expect(pin).toBeGreaterThan(-1);
    // Both re-maps run with !important; the pin can only win from behind them.
    expect(pin).toBeGreaterThan(routeRemap);
    expect(pin).toBeGreaterThan(themeRemap);
  });

  it('never re-colours the theme-independent labels', () => {
    // text-white / text-slate-950 are safe precisely because nothing translates
    // them; a future dark-mode sweep must not "fix" them. A `:not(...)` use is
    // the opposite of a translation — it is the hover rule stepping aside — so
    // only a positive selection counts as a re-map.
    const positives = [...CSS.matchAll(/\[class\*="(?:text-white|text-slate-950)"\]/g)]
      .filter((m) => !CSS.slice(Math.max(0, m.index - 6), m.index).endsWith(':not('));
    expect(positives.map((m) => CSS.slice(m.index - 80, m.index + 30))).toEqual([]);
    expect(CSS).not.toMatch(/\.text-slate-950\b/);
    expect(CSS).toMatch(/\.text-zinc-950\b/); // proof the guard covers real rules
  });
});

describe('component literals', () => {
  it('parses the palette Tailwind actually ships', () => {
    expect(PALETTE.size).toBeGreaterThan(100);
    expect(PALETTE.get('blue-600')).toMatch(/^#[0-9a-f]{6}$/);
    expect(PALETTE.get('slate-950')).toBe(LABELS['text-slate-950']);
  });

  it('no labelled fill wears a label that fails AA or the theme re-maps', () => {
    expect(SCAN.violations).toEqual([]);
  });
});

/**
 * The hover re-map is this file's own blind spot: every rule above measures a
 * label against its fill in the static class list, but the shell also has a
 * hover rule that overwrites the label of any route-frame button with
 * `!important` — and `:hover` is what a phone applies to a button the student
 * has just tapped. It exempted the accent fill and two hues by name, so every
 * other deep fill kept its white label only until the student touched it:
 * "Fetch syllabus" (white on zinc-900) went to ink on a zinc-700 hover, about
 * 1.6:1, and the laundry submit did the same on purple.
 *
 * A label written as `text-white` / `text-slate-950` is safe precisely because
 * nothing translates it, so the hover rule must not either.
 */
describe('index.css hover re-map contract', () => {
  const hoverRule = CSS.match(/\.ultracc-route-frame button:not\(\.acc-bg\)[^{}]*:hover\s*\{[^}]*\}/)?.[0] ?? '';
  const LABEL_EXEMPTIONS = ['[class*="text-white"]', '[class*="text-slate-950"]'];
  const sparesLabels = (selector: string) =>
    LABEL_EXEMPTIONS.every((x) => selector.includes(`:not(${x})`));

  /**
   * `<button className="…">` the hover rule is obliged to keep its hands off:
   * the accent fill (`.acc-bg`, spared by name) and the two label classes no
   * theme translates (`text-white` / `text-slate-950`, spared by attribute).
   *
   * This scanned only `text-white` until the consistency sweep moved the app's
   * last holdout — the CGPA simulator's Save button — onto `.acc-bg`, which
   * carries its own label. The exemption's targets still exist; they changed
   * name, so the scan covers the class it is now written with.
   */
  function sparedLabelButtons(): string[] {
    const found: string[] = [];
    for (const file of [...sourceFiles('src/components'), join(ROOT, 'src', 'App.tsx')]) {
      const code = readFileSync(file, 'utf8');
      for (const m of code.matchAll(/<button[\s\S]{0,600}?className="([^"\n]*)"/g)) {
        const cls = ` ${m[1]} `;
        if (/\sacc-bg\s/.test(cls) || /\stext-white\b/.test(cls) || /\stext-slate-950\b/.test(cls)) {
          found.push(`${file}:${m.index}`);
        }
      }
    }
    return found;
  }

  it('finds the hover ink rule and the buttons it must spare', () => {
    // A guard that stopped matching either side would pass by doing nothing.
    expect(hoverRule).not.toBe('');
    expect(sparedLabelButtons().length).toBeGreaterThan(0);
  });

  it('spares both labels no theme translates', () => {
    expect(sparesLabels(hoverRule), hoverRule.slice(0, 160)).toBe(true);
  });

  it('catches the version that erased them', () => {
    // DELETED_COPIES — the shipped selector before this fix, quoted here rather
    // than read back out of git so the guard cannot drift with the branch.
    const before =
      '.ultracc-route-frame button:not(.acc-bg):not([class*="bg-blue-6"]):not([class*="bg-indigo-6"]):hover';
    expect(sparesLabels(before)).toBe(false);
  });

  it('keeps exempting the fills that carry no label token of their own', () => {
    // Those three are coloured by the `.acc-bg, [class*="bg-blue-600"],
    // [class*="bg-indigo-600"]` rule further down; dropping an exemption here
    // would hand the hover ink back to a button with nothing to spare it.
    for (const token of ['.acc-bg', '[class*="bg-blue-6"]', '[class*="bg-indigo-6"]']) {
      expect(hoverRule, `missing :not(${token})`).toContain(`:not(${token})`);
    }
    expect(CSS).toMatch(/\.ultracc-route-frame \.acc-bg[^{]*\{[^}]*color:\s*#fff\s*!important/);
  });
});
