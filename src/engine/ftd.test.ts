import { describe, expect, it } from 'vitest';
import { flexibleTaskDeficit } from './ftd.ts';

describe('flexibleTaskDeficit', () => {
  it('reproduces the worked example in the paper (DFT 8 s, elapsed 4 s, PL 3.2 s, done 1.4 s -> 0.2 s)', () => {
    expect(flexibleTaskDeficit(3.2, 8, 4, 1.4)).toBeCloseTo(0.2, 12);
  });

  it('gives the same answer in integer microseconds', () => {
    expect(flexibleTaskDeficit(3_200_000, 8_000_000, 4_000_000, 1_400_000)).toBe(200_000);
  });

  it('is negative when the pattern is ahead of its desired rate', () => {
    expect(flexibleTaskDeficit(3.2, 8, 4, 2)).toBeLessThan(0);
  });
});
