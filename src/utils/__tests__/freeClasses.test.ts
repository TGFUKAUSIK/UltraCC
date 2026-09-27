import { describe, it, expect } from 'vitest';
import { computeFreeClasses } from '../freeClasses';

describe('computeFreeClasses', () => {
  it('counts free periods on a day with partial classes', () => {
    const summary = computeFreeClasses('Monday', [
      { day: 'Monday', startTime: '08:00', endTime: '08:50' },  // A1 covered
      { day: 'Monday', startTime: '14:00', endTime: '14:50' },  // A2 covered
    ]);
    expect(summary.totalPeriods).toBe(12);
    expect(summary.freeCount).toBe(10);
    expect(summary.freeMinutes).toBeGreaterThanOrEqual(60); // big afternoon gap
    const covered = summary.periods.filter((p) => p.covered).map((p) => p.slot);
    expect(covered).toContain('A1');
    expect(covered).toContain('A2');
  });

  it('handles a fully-free day and an unknown day', () => {
    const full = computeFreeClasses('Saturday', []);
    expect(full.freeCount).toBe(full.totalPeriods);

    const unknown = computeFreeClasses('Sunday', [{ day: 'Sunday', startTime: '09:00', endTime: '09:50' }]);
    expect(unknown.totalPeriods).toBe(0);
    expect(unknown.freeCount).toBe(0);
  });

  it('treats a lab starting slightly off-grid as covering its period', () => {
    const summary = computeFreeClasses('Monday', [
      { day: 'Monday', startTime: '14:05', endTime: '14:55' }, // within 12 min of A2 14:00
    ]);
    expect(summary.periods.find((p) => p.slot === 'A2')?.covered).toBe(true);
  });
});
