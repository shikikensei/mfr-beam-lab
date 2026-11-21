import { describe, expect, it } from 'vitest';
import { summarize, validate } from './metrics.ts';
import { allocate, applyAllocation, bruteForce, hull, radarTasks } from './qram.ts';
import type { QTask, Setpoint } from './qram.ts';
import { sequence } from './rand.ts';
import { DEFAULT_CONFIG, makeScenario, nominalDemand } from './scenario.ts';
import { simulate } from './simulate.ts';
import { ms } from './types.ts';

const P = (r: number, u: number): Setpoint => ({ r, u, label: `${r}/${u}` });

describe('allocation: hull', () => {
  it('keeps the cheapest setting, drops settings that cost more for no more utility, and is concave', () => {
    const h = hull([P(1, 1), P(2, 5), P(3, 5.5), P(4, 9), P(5, 9), P(2.5, 2)]);
    expect(h.map((p) => p.r)).toEqual([1, 2, 4]); // (3, 5.5) lies below the line from (2, 5) to (4, 9)
    for (let i = 2; i < h.length; i++) {
      const s1 = (h[i - 1].u - h[i - 2].u) / (h[i - 1].r - h[i - 2].r), s2 = (h[i].u - h[i - 1].u) / (h[i].r - h[i - 1].r);
      expect(s2).toBeLessThan(s1);
    }
  });
});

describe('allocation: greedy upgrades', () => {
  const sc = makeScenario({ targets: 20, seed: 11 });
  const tasks = radarTasks(sc);
  it('never uses more than the limit, and uses more utility as the limit grows', () => {
    let last = -1;
    for (const limit of [0.3, 0.5, 0.7, 0.9, 1.1]) {
      const a = allocate(tasks, limit);
      if (!a.feasible) continue;
      expect(a.used).toBeLessThanOrEqual(limit + 1e-9);
      expect(a.utility).toBeGreaterThanOrEqual(last);
      last = a.utility;
    }
    expect(last).toBeGreaterThan(0);
  });
  it('says so when even the cheapest settings do not fit', () => {
    expect(allocate(tasks, 0.05).feasible).toBe(false);
  });
  it('is never better than the true optimum, and can be worse (small random inputs)', () => {
    const r = sequence(9);
    let worse = 0;
    for (let trial = 0; trial < 300; trial++) {
      const small: QTask[] = Array.from({ length: 4 }, (_, i) => ({ id: 't' + i, group: 'g',
        points: Array.from({ length: 4 }, (_, k) => P(0.05 + 0.08 * k + 0.04 * r(), (k + 1) * (0.5 + r()))) }));
      const limit = 0.5 + 0.5 * r(), a = allocate(small, limit);
      if (!a.feasible) continue;
      const opt = bruteForce(small, limit);
      expect(a.utility).toBeLessThanOrEqual(opt + 1e-9);
      if (a.utility < opt - 1e-9) worse++;
    }
    expect(worse).toBeGreaterThan(0);
  });
});

describe('allocation: written into a scenario', () => {
  it('the scenario then asks for no more than the limit, and still runs under every scheduler', () => {
    const base = makeScenario({ targets: 30, seed: 11, duration: ms(8000) });
    const { sc, alloc } = applyAllocation(base, 0.9);
    expect(alloc.feasible).toBe(true);
    expect(nominalDemand(sc)).toBeLessThanOrEqual(0.9 + 1e-9);
    expect(nominalDemand(sc)).toBeCloseTo(alloc.used, 9);
    for (const scheduler of ['drsi', 'legacy', 'priority', 'interleave', 'edf', 'tsbf'] as const) {
      const r = simulate(sc, { ...DEFAULT_CONFIG, scheduler });
      expect(validate(r)).toEqual([]);
      expect(summarize(r).fixed.requested).toBeGreaterThan(0);
    }
  });
});
