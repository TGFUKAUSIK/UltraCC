import { describe, it, expect } from 'vitest';

describe('Marks Simulator & Calculations', () => {
  it('correctly computes weighted internal scores and required FAT marks', () => {
    // Standard 50% internal + 50% FAT course structure
    const internalScores = [
      { scored: 42, max: 50, weightage: 15 }, // CAT 1: 12.6 wt
      { scored: 40, max: 50, weightage: 15 }, // CAT 2: 12.0 wt
      { scored: 10, max: 10, weightage: 5 },  // DA 1: 5.0 wt
      { scored: 9, max: 10, weightage: 5 },   // DA 2: 4.5 wt
      { scored: 8, max: 10, weightage: 10 },  // Quiz: 8.0 wt
    ];

    const totalInternal = internalScores.reduce(
      (acc, c) => acc + (c.scored / c.max) * c.weightage,
      0
    );
    expect(totalInternal).toBeCloseTo(42.1, 1);

    // Target S Grade (>= 90 marks)
    const targetThreshold = 90;
    const fatWeight = 50;
    const fatMax = 100;
    const neededFromFat = Math.max(0, targetThreshold - totalInternal);
    const fatRawNeeded = Math.ceil((neededFromFat / fatWeight) * fatMax);

    // Needed from FAT: 90 - 42.1 = 47.9 out of 50 weightage -> 95.8 / 100 in FAT exam
    expect(fatRawNeeded).toBe(96);
    expect(fatRawNeeded).toBeLessThanOrEqual(100);

    // Target A Grade (>= 80 marks)
    const targetAThreshold = 80;
    const neededFromFatA = Math.max(0, targetAThreshold - totalInternal);
    const fatRawNeededA = Math.ceil((neededFromFatA / fatWeight) * fatMax);
    expect(fatRawNeededA).toBe(76);
  });

  it('correctly handles unattainable target marks', () => {
    const totalInternal = 25; // 25 / 50 internal
    const targetThreshold = 90; // S Grade
    const fatWeight = 50;
    const fatMax = 100;
    const neededFromFat = targetThreshold - totalInternal; // 65 / 50 wt needed
    const fatRawNeeded = Math.ceil((neededFromFat / fatWeight) * fatMax); // 130 / 100
    expect(fatRawNeeded).toBeGreaterThan(100);
  });

  it('correctly handles already achieved targets', () => {
    const totalInternal = 45;
    const targetCThreshold = 40;
    const needed = Math.max(0, targetCThreshold - totalInternal);
    expect(needed).toBe(0);
  });
});
