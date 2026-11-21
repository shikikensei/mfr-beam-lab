// Drops by queue, per method: is "+look-ahead" protecting the more important queues?
import { displacedByLower, summarize } from '../src/engine/metrics.ts';
import { DEFAULT_CONFIG, makeScenario } from '../src/engine/scenario.ts';
import { simulate } from '../src/engine/simulate.ts';
import { ms } from '../src/engine/types.ts';
const M = [['paper', 'drsi', 'paper'], ['plus', 'drsi', 'followers'], ['legacy', 'legacy', 'paper']] as const;
for (const n of [6, 10, 14, 18, 24, 30, 40]) {
  for (const [name, scheduler, protect] of M) {
    const acc = { req: 0, drop: 0, confirm: 0, retry: 0, trackHigh: 0, track: 0, disp: 0, lost: 0 };
    for (let seed = 11; seed <= 18; seed++) {
      const sc = makeScenario({ targets: n, seed, duration: ms(30000) });
      const r = simulate(sc, { ...DEFAULT_CONFIG, scheduler, protect });
      const s = summarize(r);
      acc.req += s.fixed.requested; acc.drop += s.fixed.dropped; acc.lost += s.lost; acc.disp += displacedByLower(r).length;
      for (const k of ['confirm', 'retry', 'trackHigh', 'track'] as const) acc[k] += s.fixed.byKind[k] ?? 0;
    }
    console.log(n, name.padEnd(6), JSON.stringify(acc));
  }
}
