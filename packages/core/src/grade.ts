// Outcome → grade mapping (§8.1, FR-5.4).
import type { Grade } from './types.js';

/** `p = 0.7a + 0.3·(c-1)/4` — the blended performance value the grade thresholds apply to. */
export function computeBlendedPerformance(accuracy: number, confidence: number): number {
  return 0.7 * accuracy + 0.3 * ((confidence - 1) / 4);
}

/**
 * §8.1's table, evaluated in the order that resolves its two overlapping edge cases:
 * - `a < 0.40` forces grade 1 even if high confidence pushed `p` above the 0.45 floor (stops low
 *   accuracy from being disguised as a pass).
 * - `p >= 0.85` only reaches grade 4 when `a >= 0.90` too; otherwise it's demoted to grade 3, the
 *   next band down (stops high confidence from disguising a poorer accuracy as "Easy").
 */
export function computeGrade(accuracy: number, confidence: number): Grade {
  const p = computeBlendedPerformance(accuracy, confidence);
  if (accuracy < 0.4 || p < 0.45) {
    return 1;
  }
  if (p >= 0.85 && accuracy >= 0.9) {
    return 4;
  }
  if (p >= 0.65) {
    return 3;
  }
  return 2;
}
