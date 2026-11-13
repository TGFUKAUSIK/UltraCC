import { StudentProfile } from '../types';
import {
  parseDocument,
  parseOutcome,
  ParseOutcome,
  isLikelyLoginPage,
} from './helpers';

/**
 * VTOP Chennai "Profile" page (POST studentsRecord/StudentProfileAllView).
 *
 * Real shape (corroborated by the live-tested VtopMCP client): the
 * registration number lives in a HIDDEN INPUT named "regno"; the rest of the
 * profile is label/value <td> pairs (Student Name, Application Number,
 * Programme/Degree, Branch / Group Studied, School, Email, Mobile
 * Number, Blood Group). First-match semantics: the first occurrence of each
 * label is the student's own personal info block.
 *
 * "Branch / Group Studied" is VTOP's Class-XII (+2) subject group — "PCM",
 * "Computer with Maths" — NOT the degree branch, so it is parsed into
 * `groupStudied`. `branch` only accepts a row VTOP actually labels as the branch.
 *
 * A profile is only accepted when a plausible registration number is found
 * (either from the regno input or a label pair).
 *
 * Verification status: UNVERIFIED until an authenticated live pass — see
 * src/lib/vtop/verification.ts
 */
export function parseStudentProfileHtml(htmlString: string): StudentProfile;
export function parseStudentProfileHtml(htmlString: string, withOutcome: true): ParseOutcome<StudentProfile>;
export function parseStudentProfileHtml(htmlString: string, withOutcome?: true) {
  const warnings: ParseOutcome<StudentProfile>['warnings'] = [];
  const doc = parseDocument(htmlString);

  if (isLikelyLoginPage(htmlString)) {
    const outcome = parseOutcome<StudentProfile>(
      emptyProfile(),
      [{ code: 'session-expired', detail: 'Received the login page instead of the profile.' }],
      true
    );
    return withOutcome ? outcome : outcome.data;
  }

  const clean = (value: string): string => value.replace(/\s+/g, ' ').trim();

  // Registration number: prefer the hidden input VTOP embeds on the page.
  let regNo = clean(doc.querySelector('input[name="regno"]')?.getAttribute('value') || '');

  const valueForLabel = (labelPatterns: RegExp[]): string => {
    // Pass 1: label/value in table rows.
    const rows = Array.from(doc.querySelectorAll('tr'));
    for (const row of rows) {
      const cells = Array.from(row.querySelectorAll('td, th'));
      if (cells.length < 2) continue;
      const label = clean(cells[0].textContent || '');
      if (!label) continue;
      if (labelPatterns.some((re) => re.test(label)) && label.length <= 60) {
        const value = clean(cells[1].textContent || '');
        if (value) return value;
      }
    }
    // Pass 2: adjacent label/value elements outside tables.
    const all = Array.from(doc.querySelectorAll('td, th, span, div'));
    for (let i = 0; i < all.length; i++) {
      const label = clean(all[i].textContent || '');
      if (!label || label.length > 60) continue;
      if (!labelPatterns.some((re) => re.test(label))) continue;
      const next = all[i].nextElementSibling;
      if (!next) continue;
      const value = clean(next.textContent || '');
      if (value && value.length <= 120 && !labelPatterns.some((re) => re.test(value))) return value;
    }
    return '';
  };

  if (!regNo) regNo = valueForLabel([/^(Reg(?:istration)?(?: No\.?| Number)?|Register No\.?)$/i]);

  // Hard validation: without a registration number the page is not a profile.
  // VIT reg numbers: 23BCE0000 (2-digit year + 2-3 letter program + 4 digits).
  if (!/^\d{2}[A-Z]{2,3}\d{4}$/.test(regNo || '')) {
    warnings.push({
      code: 'no-valid-regno',
      detail: 'No plausible registration number found — page may have changed structure or be an error page.',
    });
    const outcome = parseOutcome<StudentProfile>(emptyProfile(), warnings, true);
    return withOutcome ? outcome : outcome.data;
  }

  const cgpaText = valueForLabel([/^(CGPA|Cumulative Grade Point Average)$/i]);
  const cgpa = cgpaText ? parseFloat(cgpaText) : NaN;
  const semesterText = valueForLabel([/^(Current )?Semester$/i]);
  const semester = semesterText ? parseInt(semesterText, 10) : 0;

  const profile: StudentProfile = {
    registrationNo: regNo,
    name: valueForLabel([/^(Student Name|Name)$/i]) || 'Student',
    // VTOP's word for this row is the study LEVEL ("UG"/"PG"), left empty
    // when absent rather than defaulted to 'B.Tech'.
    program: valueForLabel([/^(Program(?:me)?|Applied Degree|Degree)$/i]) || '',
    // A branch may only come from a row VTOP labels as the branch — see the
    // header note: "Branch / Group Studied" is the +2 group, not the branch.
    branch: valueForLabel([
      /^Branch$/i,
      /^Branch\s*(Name|of Study)?$/i,
      /^(Programme|Program)\s*\/\s*Branch$/i,
      /^Speciali[sz]ation$/i,
    ]) || '',
    groupStudied: valueForLabel([
      /^Branch\s*\/\s*Group Studied$/i,
      /^Group Studied$/i,
      /^Branch\s*\/\s*Stream$/i,
      /^Stream$/i,
      /^(Class\s*)?XII\b.*\b(Group|Studied|Subjects)$/i,
      /^(12th|Plus Two)\b.*\b(Group|Studied|Subjects)$/i,
    ]) || '',
    school: valueForLabel([/^School$/i]) || '',
    semester: semester ? `Semester ${semester}` : 'Current Semester',
    cgpa: Number.isFinite(cgpa) ? cgpa : 0,
    proctorName: valueForLabel([/^(Proctor(?: Name)?)$/i]) || '',
    // Proctor contact is ONLY read from proctor-prefixed labels — generic
    // "Email"/"Mobile Number"/"Contact" labels are the student's own block
    // (they appear first on the page) and were being stored as the proctor's.
    proctorEmail: valueForLabel([/^(Proctor E-?mail)$/i]),
    proctorMobile: valueForLabel([/^(Proctor Mobile)$/i]),
    hostelBlock: valueForLabel([/^(Hostel|Block)$/i]),
    roomNo: valueForLabel([/^(Room(?: No\.?)?)$/i]),
  };

  // VTOP has no documented JSON photo field. If its authenticated profile
  // page embeds the student's image as a data URI, preserve it. Protected
  // same-origin image sources are resolved by the gateway instead.
  // VTOP's real-world shape is "data:null;base64,..." — a NON-IMAGE MIME on a
  // real JPEG/PNG payload (observed on the live portal and in independent
  // VTOP clients). Accept any base64 data URI large enough to be a photo and
  // rewrite the MIME from the payload's magic bytes so the browser renders it.
  const MIN_BARE_PHOTO_B64 = 1_000;
  const dataUriRe = /^data:[^;,]*;base64,([A-Za-z0-9+/=]+)$/i;
  const sniffMime = (payload: string): string => {
    const head = payload.slice(0, 6);
    return head.startsWith('/9j/') ? 'image/jpeg'
      : head.startsWith('iVBORw') ? 'image/png'
      : head.startsWith('UklGR') ? 'image/webp'
      : 'image/jpeg';
  };
  const inlinePhoto = Array.from(doc.querySelectorAll('img'))
    .map((img) => ({
      src: img.getAttribute('src') || '',
      hint: [img.getAttribute('id'), img.getAttribute('class'), img.getAttribute('alt'), img.getAttribute('title')]
        .filter(Boolean).join(' '),
    }))
    .find(({ src, hint }) => {
      const m = src.match(dataUriRe);
      if (!m) return false;
      const fits = m[1].length >= MIN_BARE_PHOTO_B64 && src.length <= 2_500_000;
      if (/photo|profile|student|avatar|user/i.test(hint)) return fits;
      // Unlabeled inline image large enough to be a photo, not a UI icon.
      return fits;
    });
  if (inlinePhoto) {
    const m = inlinePhoto.src.match(dataUriRe);
    if (m) profile.profilePhotoDataUrl = `data:${sniffMime(m[1])};base64,${m[1]}`;
  }

  return withOutcome ? parseOutcome(profile, warnings) : profile;
}

function emptyProfile(): StudentProfile {
  return {
    registrationNo: '',
    name: '',
    program: '',
    branch: '',
    groupStudied: '',
    school: '',
    semester: '',
    cgpa: 0,
    proctorName: '',
    proctorEmail: '',
    proctorMobile: '',
  };
}
