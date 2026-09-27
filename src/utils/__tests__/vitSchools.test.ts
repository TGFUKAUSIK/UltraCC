/**
 * School-resolution regression tests.
 *
 * The bug this pins: VTOP's profile page has a row labelled "School" which,
 * for many Chennai records, holds the faculty/research centre the record is
 * grouped under rather than the student's school. A real B.Tech Electrical and
 * Electronics Engineering profile carries "Centre for e-Automation
 * Technologies" there — and the portal printed it as the student's school on
 * the dashboard heading, My Info and the AI Advisor context.
 */

import { describe, it, expect } from 'vitest';
import { isVitSchoolValue, schoolForBranch, resolveSchool } from '../vitSchools';

describe('isVitSchoolValue', () => {
  it('accepts VIT Chennai school acronyms and long forms', () => {
    for (const v of ['SCOPE', 'SELECT', 'SENSE', 'SMEC', 'SAS', 'SBST', 'SSL', 'SCE', 'SCBE', 'V-FIT']) {
      expect(isVitSchoolValue(v), `${v} is a school`).toBe(true);
    }
    expect(isVitSchoolValue('School of Electrical Engineering')).toBe(true);
    expect(isVitSchoolValue('School of Advanced Sciences')).toBe(true);
    expect(isVitSchoolValue(' scope ')).toBe(true);
  });

  it('rejects the values that are not a school', () => {
    // The real-world offender, plus the shapes it comes with.
    expect(isVitSchoolValue('Centre for e-Automation Technologies')).toBe(false);
    expect(isVitSchoolValue('Center for Nanoscience and Technology')).toBe(false);
    expect(isVitSchoolValue('Department of Physics')).toBe(false);
    expect(isVitSchoolValue('')).toBe(false);
    expect(isVitSchoolValue(null)).toBe(false);
    expect(isVitSchoolValue(undefined)).toBe(false);
  });
});

describe('schoolForBranch', () => {
  it('maps the branches VTOP actually writes', () => {
    expect(schoolForBranch('Electrical and Electronics Engineering')).toBe('SELECT');
    expect(schoolForBranch('B.Tech. EEE')).toBe('SELECT');
    expect(schoolForBranch('Computer Science and Engineering')).toBe('SCOPE');
    expect(schoolForBranch('Information Technology')).toBe('SCOPE');
    expect(schoolForBranch('Electronics and Communication Engineering')).toBe('SENSE');
    expect(schoolForBranch('Mechanical Engineering')).toBe('SMEC');
    expect(schoolForBranch('Civil Engineering')).toBe('SCE');
    expect(schoolForBranch('Applied Mathematics')).toBe('SAS');
    expect(schoolForBranch('Bioinformatics')).toBe('SBST');
  });

  it('prefers the most specific phrase, so a hybrid branch cannot be misread', () => {
    // "Electronics and Communication" is SENSE; bare "Electronics" would be too
    // a loose match for SELECT's "Electrical".
    expect(schoolForBranch('M.Tech VLSI and Embedded Electronics')).toBe('SENSE');
    expect(schoolForBranch('Power Electronics and Mechanical Drives')).toBe('SELECT');
  });

  it('claims nothing for a branch it does not know', () => {
    expect(schoolForBranch('')).toBe('');
    expect(schoolForBranch('Some Future Programme')).toBe('');
  });
});

describe('resolveSchool', () => {
  it('keeps VTOP\'s value when it genuinely names a school', () => {
    expect(resolveSchool('SCOPE', 'Computer Science and Engineering')).toBe('SCOPE');
    expect(resolveSchool('School of Mechanical Engineering', 'Mechanical Engineering')).toBe('School of Mechanical Engineering');
  });

  it('derives the school from the branch when VTOP\'s row is a research centre', () => {
    expect(resolveSchool('Centre for e-Automation Technologies', 'Electrical and Electronics Engineering')).toBe('SELECT');
  });

  it('reports nothing rather than the proctor\'s centre', () => {
    // No branch to go on either — the honest answer is blank, not a wrong school.
    expect(resolveSchool('Centre for e-Automation Technologies', '')).toBe('');
    expect(resolveSchool('', '')).toBe('');
  });
});
