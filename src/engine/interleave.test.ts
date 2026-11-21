import { describe, expect, it } from 'vitest';
import { summarize, validate } from './metrics.ts';
import { DEFAULT_CONFIG, makeScenario } from './scenario.ts';
import { simulate } from './simulate.ts';
import { ms } from './types.ts';
import type { SchedulerId, SimResult } from './types.ts';

const run = (scheduler: SchedulerId, farFrac: number, targets = 24, seed = 11): SimResult =>
  simulate(makeScenario({ targets, seed, duration: ms(12000), farFrac }), { ...DEFAULT_CONFIG, scheduler });
const core = (r: SimResult): string => JSON.stringify([r.timeline, r.requests.map((q) => [q.status, q.start, q.hit]), r.marks]);

describe('pulse interleaving on top of fixed priority', () => {
  it('with no far targets it is exactly the fixed priority scheduler', () => {
    for (const n of [6, 24, 40]) {
      const a = run('interleave', 0, n), b = run('priority', 0, n);
      // the step index (gs) only numbers the frames of the slow-motion view; it is not part of what happened
      const plain = (r: SimResult): string => JSON.stringify(r.timeline.map(({ gs: _gs, ...x }) => x));
      expect(plain(a)).toBe(plain(b));
      expect(JSON.stringify(summarize(a))).toBe(JSON.stringify(summarize(b)));
    }
  });

  it('interleaves when there are far targets, and never uses the beam twice at once', () => {
    for (const far of [0.4, 0.8, 1]) for (const seed of [11, 12, 13]) {
      const r = run('interleave', far, 24, seed);
      expect(validate(r)).toEqual([]); // includes: transmit and receive segments never overlap anything
      expect(r.timeline.some((x) => x.saved)).toBe(true);
    }
  });

  it('a guest stays inside the wait of its host (whole), or only its transmit does and its receive comes after (tx)', () => {
    const r = run('interleave', 0.8);
    const tl = [...r.timeline].sort((a, b) => a.start - b.start);
    let whole = 0, tx = 0;
    tl.forEach((g, i) => {
      if (!g.saved) return;
      const h = tl[i - 1];
      if (h.type !== 'fixed') throw new Error('host is not a fixed dwell');
      const hs = r.requests[h.reqId].seg, waitFrom = h.start + hs.tx, waitTo = h.start + h.len - hs.rx, hostEnd = h.start + h.len;
      expect(hs.wait).toBeGreaterThan(0);
      expect(g.start).toBeGreaterThanOrEqual(waitFrom);
      if (g.start + g.len <= waitTo) { whole++; expect(g.saved).toBe(g.len); return; }
      if (g.type !== 'fixed') throw new Error('a dwell without a wait can only go in whole');
      const gs = r.requests[g.reqId].seg;
      expect(g.start + gs.tx).toBeLessThanOrEqual(waitTo); // transmit inside the host's wait
      expect(g.start + g.len - gs.rx).toBeGreaterThanOrEqual(hostEnd); // receive after the host's receive
      tx++;
    });
    expect(whole).toBeGreaterThan(0);
    expect(tx).toBeGreaterThan(0);
  });

  it('interleaved dwells still start inside their windows', () => {
    const r = run('interleave', 0.8, 40);
    for (const x of r.timeline) if (x.type === 'fixed') { const q = r.requests[x.reqId]; expect(x.start).toBeGreaterThanOrEqual(q.req); expect(x.start).toBeLessThanOrEqual(q.latest); }
  });
});

describe('the far attribute changes nothing for the schedulers that do not interleave', () => {
  const OTHERS: SchedulerId[] = ['fifo', 'template', 'priority', 'edf', 'balance', 'tsbf', 'legacy', 'drsi'];
  it.each(OTHERS)('%s: identical run with 0 %, 40 % and 100 % far targets', (scheduler) => {
    const base = core(run(scheduler, 0));
    expect(core(run(scheduler, 0.4))).toBe(base);
    expect(core(run(scheduler, 1))).toBe(base);
  });
  it('dynamic RSI as described in the paper too', () => {
    const go = (farFrac: number) => core(simulate(makeScenario({ targets: 24, seed: 11, duration: ms(12000), farFrac }), { ...DEFAULT_CONFIG, scheduler: 'drsi', protect: 'paper' }));
    expect(go(0.4)).toBe(go(0));
  });
});
