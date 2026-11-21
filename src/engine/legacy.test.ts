import { describe, expect, it } from 'vitest';
import { planLegacy } from './legacy.ts';
import { fx, idle, region, startOf, tiles, view } from './testkit.ts';

const REGIONS = [region('hi', 10, 15, 300, 0), region('lo', 10, 10, 300, 1)];

describe('legacy fixed-length RSI', () => {
  it('uses a fixed box on a fixed grid, whatever is waiting', () => {
    expect(planLegacy(view(0, [], REGIONS, { rsiLen: 100_000 })).end).toBe(100_000);
    expect(planLegacy(view(130, [], REGIONS, { rsiLen: 100_000 })).end).toBe(200_000);
  });

  it('puts a fixed task at its requested time when that time is free', () => {
    const a = fx('track', 60, 10, 10, 10);
    const b = planLegacy(view(0, [a], REGIONS, { fill: 'full' }));
    expect(startOf(b, a)).toBe(60);
    expect(tiles(b)).toBe(true);
  });

  it('serves the more important queue first and moves the other to the nearest free time in its slack', () => {
    const a = fx('trackHigh', 60, 5, 5, 10), low = fx('track', 62, 10, 10, 10);
    const b = planLegacy(view(0, [low, a], REGIONS, { fill: 'full' }));
    expect(startOf(b, a)).toBe(60);
    expect(startOf(b, low)).toBe(70);
  });

  it('cannot let a task straddle the RSI edge: it is carried over if its slack allows, dropped if not', () => {
    const carry = fx('track', 95, 4, 10, 10), lost = fx('track', 96, 3, 3, 10);
    const b = planLegacy(view(0, [carry, lost], REGIONS, { fill: 'full' }));
    expect(startOf(b, carry)).toBeNull();
    expect(startOf(b, lost)).toBeNull();
    expect(b.dropped.map((d) => [d.req.id, d.reason])).toEqual([[lost.id, 'boundary']]);
  });

  it('fills search in priority order and does not close up around fixed tasks', () => {
    const a = fx('track', 50, 0, 0, 10);
    const b = planLegacy(view(0, [a], REGIONS, { fill: 'full' }));
    const flex = b.items.filter((x) => x.type === 'flex');
    expect(flex.every((x) => x.type === 'flex' && (x.region === 0 || x.len === 10_000))).toBe(true);
    expect(flex.filter((x) => x.type === 'flex' && x.region === 0).length).toBeGreaterThan(0);
    // 0..50: three 15 ms beams + one 5 ms fragment that no beam fits -> gap
    expect(idle(b, 'gap')).toBeGreaterThan(0);
    expect(tiles(b)).toBe(true);
  });
});
