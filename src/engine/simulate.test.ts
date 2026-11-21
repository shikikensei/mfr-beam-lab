import { describe, expect, it } from 'vitest';
import { displacedByLower, summarize, validate } from './metrics.ts';
import { DEFAULT_CONFIG, makeScenario, nominalDemand } from './scenario.ts';
import { simulate } from './simulate.ts';
import { ms } from './types.ts';
import type { SimConfig } from './types.ts';

const VARIANTS: [string, Partial<SimConfig>][] = [
  ['dynamic RSI as described in the paper, pace', { scheduler: 'drsi', fill: 'pace', protect: 'paper' }],
  ['dynamic RSI as described in the paper, full', { scheduler: 'drsi', fill: 'full', protect: 'paper' }],
  ['dynamic RSI + room for followers (this tool), pace', { scheduler: 'drsi', fill: 'pace', protect: 'followers' }],
  ['dynamic RSI + room for followers (this tool), full', { scheduler: 'drsi', fill: 'full', protect: 'followers' }],
  ['legacy, pace', { scheduler: 'legacy', fill: 'pace' }],
  ['legacy, full', { scheduler: 'legacy', fill: 'full' }],
  ...(['fifo', 'template', 'priority', 'edf', 'balance'] as const).flatMap((scheduler): [string, Partial<SimConfig>][] =>
    [[`${scheduler}, pace`, { scheduler, fill: 'pace' }], [`${scheduler}, full`, { scheduler, fill: 'full' }]]),
];
const run = (targets: number, c: Partial<SimConfig>, seed = 11, extra = {}) =>
  simulate(makeScenario({ targets, seed, duration: ms(12000), ...extra }), { ...DEFAULT_CONFIG, ...c });

describe.each(VARIANTS)('invariants: %s', (_name, c) => {
  it.each([0, 2, 6, 14, 24, 40])('%i targets: the timeline is tiled, every fixed task runs inside its window or is recorded as dropped', (n) => {
    for (const seed of [11, 12, 13]) expect(validate(run(n, c, seed))).toEqual([]);
  });
  it('gives identical results for the same seed', () => {
    const a = run(14, c), b = run(14, c);
    expect(JSON.stringify([a.timeline, a.requests, a.marks])).toBe(JSON.stringify([b.timeline, b.requests, b.marks]));
  });
  it('accounts for all time: shares add up to 1 and efficiency = (total - gaps) / total', () => {
    const r = run(14, c), s = summarize(r);
    expect(s.share.search + s.share.fixed + s.share.gap + s.share.spare).toBeCloseTo(1, 12);
    const gaps = r.timeline.filter((x) => x.type === 'gap').reduce((a, x) => a + x.len, 0);
    expect(s.efficiency).toBe((r.end - gaps) / r.end);
  });
  it('still holds when targets appear gradually and most of them vanish again', () => {
    expect(validate(run(30, c, 11, { ramp: ms(4000), disappear: { at: ms(8000), keep: 6 } }))).toEqual([]);
  });
});

describe.each(VARIANTS)('interrupt by a critical task: %s', (_name, c) => {
  const criticals = [{ at: ms(1000), len: ms(20), notice: ms(30) }, { at: ms(2503), len: ms(20), notice: ms(40) }, { at: ms(7777), len: ms(12), notice: ms(25) }];
  it.each([6, 24])('%i targets: each critical task starts exactly on time and the cut box hands its remainder back', (n) => {
    const r = run(n, c, 11, { criticals });
    expect(validate(r)).toEqual([]);
    const crit = r.requests.filter((q) => q.kind === 'critical');
    expect(crit.map((q) => [q.status, q.start])).toEqual(criticals.map((x) => ['done', x.at]));
    expect(r.boxes.some((b) => b.interrupted)).toBe(true);
    // nothing that was pulled out of a box is left in limbo
    for (const q of r.requests) if (q.interrupts > 0) expect(['done', 'dropped', 'cancelled']).toContain(q.status);
  });
});

describe('tendencies', () => {
  it.each(VARIANTS.filter(([, c]) => c.fill === 'pace'))('light load, %s: mean frame time stays near the desired one', (_name, c) => {
    for (const n of [2, 6]) {
      const r = simulate(makeScenario({ targets: n, seed: 11, duration: ms(30000) }), { ...DEFAULT_CONFIG, ...c });
      const longestBox = Math.max(DEFAULT_CONFIG.maxDrsi, DEFAULT_CONFIG.rsiLen);
      for (const g of summarize(r).regions) {
        expect(g.meanFrame!).toBeGreaterThanOrEqual(g.dft * 0.98);
        expect(g.meanFrame!).toBeLessThanOrEqual(g.dft + longestBox); // deficits are read once per box
      }
    }
  });
  it.each(VARIANTS)('light load, %s: no fixed task is dropped', (_name, c) => {
    expect(summarize(run(2, c)).fixed.dropped).toBe(0);
  });
  it.each(VARIANTS.filter(([, c]) => c.scheduler === 'drsi'))('%s: closing up leaves almost no gap', (_name, c) => {
    for (const n of [6, 14, 24]) expect(summarize(run(n, c)).share.gap).toBeLessThan(0.005);
  });

});

// The two tests below replace "overload: fixed tasks are dropped only where more important fixed
// tasks left them no room" (agreed with the author after the phase 1 report; that wording cannot
// hold once fixed tasks of equal priority compete for the same time).
//
// "Not saturated" (this tool's definition, the paper gives none): nominal demand <= 90 % of the
// timeline. Nominal demand = every search region at its desired frame time + every target at its
// update interval (scenario.ts, nominalDemand). It leaves out confirmations and re-illuminations,
// which in the didactic scenario add about (1 - pdTrack) = 12 % of the track load, i.e. up to
// 5 points near this limit; the rest of the 10-point margin is for dwells that cannot be split.
//
// "A small share" (this tool's value, the paper only says "few fixed tasks are lost"): at most 3 %
// of all fixed requests in a 30 s run. Reason for the value: a dropped update counts as one miss,
// and the radar itself misses 12 % of the looks in this scenario; 3 % keeps the scheduler's
// contribution to a quarter of that. Measured worst seeds at <= 90 %: 1.7 % (as described in the
// paper) and 0.0 % (with room for followers); see scripts/droprate.ts.
const NOT_SATURATED = 0.9, SMALL_SHARE = 0.03;
const DRSI: [string, Partial<SimConfig>][] = [
  ['as described in the paper', { scheduler: 'drsi', fill: 'pace', protect: 'paper' }],
  ['with room for followers (this tool)', { scheduler: 'drsi', fill: 'pace', protect: 'followers' }],
];
const SEEDS = [11, 12, 13, 14, 15, 16, 17, 18];
const long = (n: number, seed: number) => makeScenario({ targets: n, seed, duration: ms(30000) });

describe.each(DRSI)('fixed task losses, dynamic RSI %s', (_name, c) => {
  it('not saturated: only a small share of the fixed requests is dropped', () => {
    let checked = 0;
    for (const n of [2, 4, 6, 8, 10, 12, 14, 16]) for (const seed of SEEDS) {
      const sc = long(n, seed);
      if (nominalDemand(sc) > NOT_SATURATED) continue;
      const s = summarize(simulate(sc, { ...DEFAULT_CONFIG, ...c }));
      expect(s.fixed.dropped / s.fixed.requested).toBeLessThanOrEqual(SMALL_SHARE);
      checked++;
    }
    expect(checked).toBeGreaterThan(40);
  });
});

// Applies to the extension only. The method as described in the paper is single pass with no
// look-ahead and does not promise this; what it does promise (a more important candidate is
// protected inside one DRSI) is covered by the case 2 and case 3 tests in drsi.test.ts.
// Counts for both methods at all loads: scripts/droprate.ts, recorded in docs/assumptions.md.
describe('fixed task losses, dynamic RSI with room for followers (this tool)', () => {
  it('not saturated: no waiting fixed task loses its place to a less important one placed after it', () => {
    let checked = 0;
    for (const n of [2, 4, 6, 8, 10, 12, 14, 16]) for (const seed of SEEDS) {
      const sc = long(n, seed);
      if (nominalDemand(sc) > NOT_SATURATED) continue;
      expect(displacedByLower(simulate(sc, { ...DEFAULT_CONFIG, scheduler: 'drsi', fill: 'pace', protect: 'followers' }))).toEqual([]);
      checked++;
    }
    expect(checked).toBeGreaterThan(40);
  });
});
