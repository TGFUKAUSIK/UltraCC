import React from 'react';
import { isReal } from '../utils/placeholders';

/**
 * The one place a person is drawn as a row — the proctor on Home, the proctor on
 * Faculty — so the disc, the initials and the way a phone can act on the contact
 * line are the same on both.
 *
 * Two defects lived in the two private copies this replaces:
 *
 *   - the avatar was a `<span>` inside `.uc-person`, and `.uc-person span` — an
 *     element-qualified rule written for the contact line — outranks the plain
 *     `.uc-person-avatar` class. The disc inherited `display: block`,
 *     `margin-top: 2px` and the 10.5px muted type, so the initials landed
 *     top-left in a dim, off-centre circle. The stylesheet now scopes the contact
 *     line to `.uc-person > div > span` and the disc to
 *     `.uc-person > .uc-person-avatar`, which no bare `.uc-person span` can beat.
 *   - Home printed the adapter's joined string ("email | mobile") as flat text,
 *     so nothing on the row was tappable, where Faculty already split it. One
 *     component now does the split, so a tap on the address composes a mail and
 *     a tap on the number dials — everywhere, or not at all.
 */

/** First letters of the first two words, uppercased — "—" when there is no name. */
export function proctorInitials(name?: string | null): string {
  const letters = (name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return letters || '—';
}

/**
 * The proctor's contact line, split back into the parts the adapter joined
 * ("email | mobile") so a phone can act on it. Anything that is neither an
 * address nor a number stays plain text, and a line with nothing in it is not
 * printed at all rather than standing empty under the name.
 */
export const ProctorContact: React.FC<{ raw?: string; name: string }> = ({ raw, name }) => {
  const parts = (raw || '').split('|').map((p) => p.trim()).filter(isReal);
  if (parts.length === 0) return null;
  return (
    <span>
      {parts.map((part, i) => {
        const isEmail = /@/.test(part);
        const digits = part.replace(/[^\d+]/g, '');
        const href = isEmail
          ? `mailto:${part}`
          : /^\d{6,}$/.test(digits.replace(/^\+/, ''))
            ? `tel:${digits}`
            : null;
        return (
          <React.Fragment key={part}>
            {i > 0 && ' · '}
            {href ? (
              <a className="uc-dir-inline-link" href={href} aria-label={`${isEmail ? 'Email' : 'Call'} ${name}`}>
                {part}
              </a>
            ) : (
              part
            )}
          </React.Fragment>
        );
      })}
    </span>
  );
};

interface ProctorPersonProps {
  name: string;
  /** The adapter's joined "email | mobile"; the line is hidden when this is empty. */
  contact?: string;
  /** A photo to fill the disc when one is on file; the initials carry it otherwise. */
  photoUrl?: string;
}

/** A person as a row: the tinted disc, the name, then what a phone can act on. */
export const ProctorPerson: React.FC<ProctorPersonProps> = ({ name, contact, photoUrl }) => (
  <div className="uc-person">
    <span className="uc-person-avatar" aria-hidden="true">
      {photoUrl ? <img src={photoUrl} alt="" /> : proctorInitials(name)}
    </span>
    <div>
      <strong>{name}</strong>
      <ProctorContact raw={contact} name={name} />
    </div>
  </div>
);
