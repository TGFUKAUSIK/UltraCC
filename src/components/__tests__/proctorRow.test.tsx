/**
 * The proctor row: a centred, accent-tinted 44px disc, the initials inside it,
 * and a contact line a phone can act on.
 *
 * The defect this guards. The avatar was a `<span>` inside `.uc-person`, and
 * `.uc-person span` — an element-qualified rule written for the contact line —
 * outranks the plain `.uc-person-avatar` class. The disc inherited
 * `display: block`, a 2px top margin and 10.5px muted type, so the initials
 * landed top-left in a dim, off-centre circle. Home also printed the adapter's
 * raw "email | mobile" string as dead text, where Faculty already split it into
 * a mail link and a dial link.
 *
 * Both halves are checked, because they fail differently: the rendered DOM
 * proves the split and the absence of an empty line, and the stylesheet proves
 * the cascade — a later sweep that re-adds a bare `.uc-person span` rule would
 * pass a DOM-only test and put the initials back in the corner.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MeridianDashboard } from '../MeridianDashboard';
import { ProctorPerson, proctorInitials } from '../ProctorPerson';
import type { StudentProfile } from '../../types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CSS = readFileSync(join(process.cwd(), 'src', 'index.css'), 'utf8');

interface Block { selector: string; body: string; media: string }

/** Flat rule blocks, with the `@media` context each was written inside. */
function ruleBlocks(css: string): Block[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Block[] = [];
  const stack: string[] = [];
  let buf = '';
  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    if (ch === '{') {
      const selector = buf.trim().replace(/\s+/g, ' ');
      buf = '';
      if (selector.startsWith('@')) {
        stack.push(selector);
        continue;
      }
      let depth = 1;
      let j = i + 1;
      while (j < clean.length && depth > 0) {
        if (clean[j] === '{') depth += 1;
        else if (clean[j] === '}') depth -= 1;
        j += 1;
      }
      out.push({ selector, body: clean.slice(i + 1, j - 1), media: stack.join(' ') });
      i = j - 1;
      continue;
    }
    if (ch === '}') {
      stack.pop();
      buf = '';
      continue;
    }
    buf += ch;
  }
  return out;
}

const BLOCKS = ruleBlocks(CSS);
const block = (selector: string): Block | undefined => BLOCKS.find((b) => b.selector === selector);

const student: StudentProfile = {
  name: 'Aarav R', regNo: '25BEE0000',
  branch: 'Electrical and Electronics Engineering', program: 'UG',
  school: 'School of Electrical and Electronics Engineering', groupStudied: 'PCM',
  semester: 5, cgpa: 8.4, totalCreditsCompleted: 60, totalCreditsRequired: 200,
  proctorName: 'Dr. R. Ramanathan',
  proctorContact: 'faculty.name@vit.ac.in | +91 98765 43210',
  proctorAvailable: true,
  hostelBlock: '', roomNo: '', dayScholar: true,
};

let host: HTMLElement;
let root: Root | null = null;

function mount(node: ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
}

function mountDashboard(over: Partial<StudentProfile> = {}) {
  mount(createElement(MeridianDashboard, {
    student: { ...student, ...over },
    attendance: [], timetable: [], exams: [], assignments: [], od: null, onNavigateTab: () => {},
  }));
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host?.remove();
});

describe('the proctor row', () => {
  it('puts the initials of the first two words in the disc', () => {
    expect(proctorInitials('Dr. R. Ramanathan')).toBe('DR');
    mount(createElement(ProctorPerson, { name: 'Dr. R. Ramanathan' }));
    expect(host.querySelector('.uc-person-avatar')?.textContent).toBe('DR');
  });

  it('falls back to an em dash when there is no name at all', () => {
    expect(proctorInitials('')).toBe('—');
    expect(proctorInitials(undefined)).toBe('—');
  });

  it('dials a number and composes a mail, separated by a middle dot', () => {
    mount(createElement(ProctorPerson, { name: 'Dr. R. Ramanathan', contact: student.proctorContact }));
    const links = [...host.querySelectorAll<HTMLAnchorElement>('.uc-person a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      'mailto:faculty.name@vit.ac.in',
      'tel:+919876543210',
    ]);
    // The separator is the row's own text, not part of either link.
    expect(host.querySelector('.uc-person')?.textContent).toContain(' · ');
    expect(links[0].getAttribute('aria-label')).toBe('Email Dr. R. Ramanathan');
    expect(links[1].getAttribute('aria-label')).toBe('Call Dr. R. Ramanathan');
  });

  it('prints no contact line at all when there is nothing to act on', () => {
    mount(createElement(ProctorPerson, { name: 'Dr. R. Ramanathan', contact: '' }));
    expect(host.querySelector('.uc-person strong')?.textContent).toBe('Dr. R. Ramanathan');
    expect(host.querySelector('.uc-person > div > span')).toBeNull();
  });

  it('keeps a non-address, non-number detail as plain text rather than a dead link', () => {
    mount(createElement(ProctorPerson, { name: 'Dr. R. Ramanathan', contact: 'Cabin SJT 402' }));
    expect(host.querySelectorAll('.uc-person a')).toHaveLength(0);
    expect(host.querySelector('.uc-person')?.textContent).toContain('Cabin SJT 402');
  });

  it('fills the disc with a photo when one is on file', () => {
    mount(createElement(ProctorPerson, { name: 'Dr. R. Ramanathan', photoUrl: 'blob:photo' }));
    expect(host.querySelector('.uc-person-avatar img')?.getAttribute('src')).toBe('blob:photo');
    expect(host.querySelector('.uc-person-avatar')?.textContent).toBe('');
  });

  it('shows the same row on Home, with the contact links and no placeholder line', () => {
    mountDashboard();
    const links = [...host.querySelectorAll<HTMLAnchorElement>('.uc-person a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      'mailto:faculty.name@vit.ac.in',
      'tel:+919876543210',
    ]);
    expect(host.textContent).not.toContain('Not available');
  });

  it('says the proctor is not available instead of printing a stub name', () => {
    // `proctorAvailable` true but the name is a VTOP stub — the honest state.
    mountDashboard({ proctorName: '-', proctorContact: '' });
    expect(host.querySelector('.uc-person strong')?.textContent).toBe('Proctor not available');
    expect(host.querySelector('.uc-person-avatar')?.classList.contains('is-quiet')).toBe(true);
    expect(host.querySelector('.uc-person-avatar')?.textContent).toBe('—');
  });
});

describe('the proctor row stylesheet', () => {
  it('keeps the disc a centred, fixed 44px circle', () => {
    const disc = block('.uc-person > .uc-person-avatar');
    expect(disc, 'the disc rule exists').toBeDefined();
    expect(disc!.body).toMatch(/display:\s*grid/);
    expect(disc!.body).toMatch(/place-items:\s*center/);
    expect(disc!.body).toMatch(/width:\s*44px/);
    expect(disc!.body).toMatch(/height:\s*44px/);
    expect(disc!.body).toMatch(/line-height:\s*1\b/);
    expect(disc!.body).toMatch(/flex:\s*none/);
  });

  it('takes the disc tint from the accent', () => {
    const disc = block('.uc-person > .uc-person-avatar');
    expect(disc!.body).toMatch(/background:\s*color-mix\(in srgb, var\(--acc-500\)/);
    expect(disc!.body).not.toMatch(/#[0-9a-f]{3,6}\b/i);
  });

  it('covers the circle with a photo rather than letter-boxing it', () => {
    const img = block('.uc-person > .uc-person-avatar > img');
    expect(img, 'the photo rule exists').toBeDefined();
    expect(img!.body).toMatch(/object-fit:\s*cover/);
    expect(img!.body).toMatch(/width:\s*100%/);
    expect(img!.body).toMatch(/height:\s*100%/);
  });

  it('scopes the contact line past the disc, and never leaves a bare `.uc-person span`', () => {
    // The bug itself: this selector outranks `.uc-person-avatar` and overrides
    // the disc's display, margin and type.
    expect(BLOCKS.some((b) => b.selector === '.uc-person span')).toBe(false);
    expect(block('.uc-person > div > span')?.body).toMatch(/margin-top:\s*2px/);
    expect(block('.uc-person > div > span')?.body).toMatch(/font-size:\s*10\.5px/);
  });
});
