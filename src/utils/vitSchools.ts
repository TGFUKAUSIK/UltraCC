/**
 * VIT Chennai's schools, and what a "School" value on a VTOP screen can be
 * trusted to mean.
 *
 * WHY THIS EXISTS: VTOP's own profile screen (studentsRecord/
 * StudentProfileAllView) carries a row labelled "School", and for a large
 * number of students that row does NOT hold their school — it holds the
 * faculty/research centre the record is grouped under, e.g. "Centre for
 * e-Automation Technologies" for a B.Tech Electrical and Electronics
 * Engineering student whose school is SELECT. Showing that row verbatim put
 * the proctor's affiliation on the student's own identity screens (dashboard
 * heading, My Info, AI Advisor), which is what this module exists to stop.
 *
 * THE RULE: a school may only be displayed when it is a school VIT Chennai
 * actually has. That means either VTOP's value names one of them, or the
 * student's VTOP branch maps onto one. Anything else is reported as unknown —
 * an honest blank, never the proctor's centre and never a guess.
 */

export interface VitSchool {
  acronym: string;
  name: string;
  /** Lower-cased phrases that identify a branch as belonging to this school. */
  branches: string[];
}

/**
 * The schools of VIT Chennai, with the undergraduate/postgraduate programmes
 * each one runs. Branch matching is deliberately phrase-based: VTOP writes the
 * same programme as "Electrical and Electronics Engineering", "B.Tech. EEE" or
 * "EEE" depending on the screen.
 */
export const VIT_CHENNAI_SCHOOLS: readonly VitSchool[] = [
  {
    acronym: 'SCOPE',
    name: 'School of Computer Science and Engineering',
    branches: ['computer science', 'information technology', 'information science', 'computer network', 'cyber security', 'artificial intelligence', 'data science', 'machine learning', 'software engineering', 'computer technology', 'blockchain', 'iot'],
  },
  {
    acronym: 'SELECT',
    name: 'School of Electrical Engineering',
    branches: ['electrical and computer science', 'electrical & computer science', 'electrical and electronics', 'electronics and power', 'power electronics', 'electrical engineering', 'e&e', 'eee', 'm.e. power'],
  },
  {
    acronym: 'SENSE',
    name: 'School of Electronics Engineering',
    branches: ['electronics and communication', 'communication and instrumentation', 'instrumentation and control', 'microelectronics', 'vlsi', 'optoelectronics', 'ece', 'embedded'],
  },
  {
    acronym: 'SMEC',
    name: 'School of Mechanical Engineering',
    branches: ['mechanical', 'automobile', 'automotive', 'mechatronics', 'production engineering', 'robotics'],
  },
  {
    acronym: 'SCBE',
    name: 'School of Chemical and Bio Technology',
    branches: ['chemical engineering', 'bio technology', 'bioprocess'],
  },
  {
    acronym: 'SCE',
    name: 'School of Civil Engineering',
    branches: ['civil engineering', 'environmental engineering', 'structural engineering', 'geoinformatics'],
  },
  {
    acronym: 'SAS',
    name: 'School of Advanced Sciences',
    branches: ['applied mathematics', 'applied physics', 'applied chemistry', 'mathematics', 'physics', 'chemistry', 'statistics'],
  },
  {
    acronym: 'SBST',
    name: 'School of Bio Sciences and Technology',
    branches: ['bioinformatics', 'biotechnology', 'genetics', 'food processing', 'environmental science', 'microbiology'],
  },
  {
    acronym: 'SSL',
    name: 'School of Social Sciences and Languages',
    branches: ['english', 'literature', 'communication', 'history', 'economics', 'sociology', 'political science'],
  },
  {
    acronym: 'V-FIT',
    name: 'School of Vellore Fashion Institute of Technology',
    branches: ['apparel', 'fashion'],
  },
];

/** Any word-boundary-ish school acronym, e.g. "SCOPE" or "V-FIT". */
const SCHOOL_ACRONYMS = new Set(
  VIT_CHENNAI_SCHOOLS.map((s) => s.acronym.toLowerCase()),
);

/**
 * True when a value VTOP put in a "School" row really names one of VIT
 * Chennai's schools — its acronym, or a "School of …" long form. Everything
 * else ("Centre for e-Automation Technologies", "Department of …", a research
 * group) is not a school and must never be shown as the student's.
 */
export function isVitSchoolValue(value: string | null | undefined): boolean {
  const v = (value || '').trim();
  if (!v) return false;
  if (SCHOOL_ACRONYMS.has(v.toLowerCase())) return true;
  // A long form is only accepted when it matches a school this file knows.
  return VIT_CHENNAI_SCHOOLS.some(
    (s) => v.toLowerCase() === s.name.toLowerCase()
      || new RegExp(`\\b${s.acronym.replace(/[-/]/g, '[-/]?')}\\b`, 'i').test(v)
      || (/\bschool of\b/i.test(v) && s.name.toLowerCase().split('school of ')[1] && v.toLowerCase().includes(s.name.toLowerCase().split('school of ')[1])),
  );
}

/** The school a VTOP branch string belongs to, or '' when it maps to none. */
export function schoolForBranch(branch: string | null | undefined): string {
  const b = (branch || '').toLowerCase();
  if (!b.trim()) return '';
  // Longer phrases first: "Electronics and Communication" must not be read as
  // generic "Electronics" (SELECT), and "Computer Science and Engineering" is
  // SCOPE whatever else it mentions.
  const ranked = VIT_CHENNAI_SCHOOLS
    .flatMap((s) => s.branches.map((needle) => ({ acronym: s.acronym, needle })))
    .sort((x, y) => y.needle.length - x.needle.length);
  for (const { acronym, needle } of ranked) {
    if (b.includes(needle)) return acronym;
  }
  return '';
}

/**
 * The school to display. VTOP's own value wins whenever it names a real
 * school; otherwise the branch decides; otherwise nothing is claimed.
 */
export function resolveSchool(vtopSchool: string | null | undefined, branch: string | null | undefined): string {
  if (isVitSchoolValue(vtopSchool)) return (vtopSchool || '').trim();
  return schoolForBranch(branch);
}

/**
 * The school's own long name, for display. `resolveSchool` and the branch
 * fallback both speak in acronyms ("SELECT", "SCOPE"), and a bare acronym on a
 * student's own profile reads like a placeholder rather than their school — so
 * the screens print the name. Any value that is not one of our acronyms (a long
 * form, a value VTOP wrote in full, or "") is returned untouched.
 */
export function schoolLabel(value: string | null | undefined): string {
  const v = (value || '').trim();
  if (!v) return '';
  const match = VIT_CHENNAI_SCHOOLS.find((s) => s.acronym.toLowerCase() === v.toLowerCase());
  return match ? match.name : v;
}
