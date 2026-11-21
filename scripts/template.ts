// Fixed template: how much do the results depend on the share reserved for fixed tasks?
// Saturating situation of chapter 2, mean of 4 seeds.
import { summarize } from '../src/engine/metrics.ts';
import { DEFAULT_CONFIG, makeScenario } from '../src/engine/scenario.ts';
import { simulate } from '../src/engine/simulate.ts';
import { ms } from '../src/engine/types.ts';
const SEEDS = [11, 12, 13, 14];
for (const [name, o] of [['sat', { targets: 30, ramp: ms(40000) }], ['light', { targets: 8, ramp: ms(20000) }]] as const) {
  console.log('==', name);
  for (const share of [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]) {
    const a = { search: 0, gap: 0, drop: 0, req: 0, upper: 0, lost: 0 };
    for (const seed of SEEDS) {
      const s = summarize(simulate(makeScenario({ ...o, seed, duration: ms(60000) }), { ...DEFAULT_CONFIG, scheduler: 'template', templateShare: share }));
      a.search += s.share.search / 0.5; a.gap += s.share.gap; a.drop += s.fixed.dropped; a.req += s.fixed.requested; a.upper += s.fixed.upperDropped; a.lost += s.lost;
    }
    const n = SEEDS.length;
    console.log(`share ${share}`, 'search', ((a.search / n) * 100).toFixed(0).padStart(4), 'gap', ((a.gap / n) * 100).toFixed(1).padStart(5), 'drop', (a.drop / n).toFixed(0).padStart(5), `${((a.drop / a.req) * 100).toFixed(1).padStart(5)}%`, 'upper', (a.upper / n).toFixed(0).padStart(5), 'lost', (a.lost / n).toFixed(0));
  }
}
