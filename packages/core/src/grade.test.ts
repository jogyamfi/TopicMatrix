import { describe, expect, it } from 'vitest';
import { computeBlendedPerformance, computeGrade } from './grade.js';

describe('computeBlendedPerformance', () => {
  it('is 0.7a + 0.3(c-1)/4', () => {
    expect(computeBlendedPerformance(1, 5)).toBeCloseTo(1);
    expect(computeBlendedPerformance(0, 1)).toBeCloseTo(0);
    expect(computeBlendedPerformance(0.8, 3)).toBeCloseTo(0.7 * 0.8 + 0.3 * 0.5);
  });
});

describe('computeGrade', () => {
  it('grade 4 (Easy): p >= 0.85 and a >= 0.90', () => {
    // confidence 5 -> (c-1)/4 = 1; p = 0.7a + 0.3
    expect(computeGrade(0.9, 5)).toBe(4); // p = 0.93
    expect(computeGrade(1, 5)).toBe(4); // p = 1
  });

  it('demotes to grade 3 when p >= 0.85 but a < 0.90 (the ceiling guard)', () => {
    // a = 0.8, c = 5 -> p = 0.56 + 0.3 = 0.86 >= 0.85, but a < 0.90
    expect(computeBlendedPerformance(0.8, 5)).toBeCloseTo(0.86);
    expect(computeGrade(0.8, 5)).toBe(3);
  });

  it('forces grade 1 when a < 0.40 even if p clears the 0.45 floor (the accuracy floor)', () => {
    // a = 0.35, c = 5 -> p = 0.245 + 0.3 = 0.545, which alone would be grade 2
    expect(computeBlendedPerformance(0.35, 5)).toBeCloseTo(0.545);
    expect(computeGrade(0.35, 5)).toBe(1);
  });

  it('grade boundaries at exactly p = 0.45, 0.65, 0.85', () => {
    // Hold confidence at 1 (so (c-1)/4 = 0) and solve a = p / 0.7 for each threshold.
    const aFor = (p: number) => p / 0.7;

    expect(computeGrade(aFor(0.45) - 0.001, 1)).toBe(1); // just below 0.45 -> Again
    expect(computeGrade(aFor(0.45), 1)).toBe(2); // exactly 0.45 -> Hard
    expect(computeGrade(aFor(0.65) - 0.001, 1)).toBe(2); // just below 0.65 -> Hard
    expect(computeGrade(aFor(0.65), 1)).toBe(3); // exactly 0.65 -> Good
    expect(computeGrade(aFor(0.85) - 0.001, 1)).toBe(3); // just below 0.85 -> Good
    // exactly 0.85 with a < 0.90 (aFor(0.85) ~ 1.214, clamp not required by this pure fn) is
    // covered by the ceiling-guard test above; here we only need a itself to clear 0.40.
  });

  it('boundary at exactly a = 0.40 (not below it, floor not triggered)', () => {
    // a = 0.40, c = 1 -> p = 0.28, which is < 0.45, so this is still grade 1 via the p threshold,
    // not the floor. Use a confidence that keeps p >= 0.45 to isolate the floor's own boundary.
    // a = 0.40, c = 5 -> p = 0.28 + 0.3 = 0.58 -> grade 2, since a = 0.40 does NOT trigger the floor.
    expect(computeGrade(0.4, 5)).toBe(2);
    // a just below 0.40 with the same confidence -> floor triggers -> grade 1.
    expect(computeGrade(0.399, 5)).toBe(1);
  });

  it('boundary at exactly a = 0.90 (ceiling requires >= 0.90, not just close)', () => {
    // a = 0.90, c = 5 -> p = 0.63 + 0.3 = 0.93 >= 0.85 and a >= 0.90 -> grade 4
    expect(computeGrade(0.9, 5)).toBe(4);
    // a just below 0.90, same confidence -> demoted to grade 3
    expect(computeGrade(0.899, 5)).toBe(3);
  });
});
