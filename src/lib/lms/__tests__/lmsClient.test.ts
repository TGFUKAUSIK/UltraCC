import { describe, expect, it } from 'vitest';
import { lmsUsernameFromRegNo } from '../lmsClient';

describe('LMS username handling', () => {
  it('preserves the exact LMS username supplied by the student', () => {
    expect(lmsUsernameFromRegNo('  student.name2025@vitstudent.ac.in ')).toBe('student.name2025@vitstudent.ac.in');
  });

  it('does not derive a Moodle email from a VTOP registration number', () => {
    expect(lmsUsernameFromRegNo('25BEE0001')).toBe('25BEE0001');
  });
});
