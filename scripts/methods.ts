// All schedulers on the chapter 2/3 presets: the numbers behind the scoreboard.
import { summarize } from '../src/engine/metrics.ts';
import { DEFAULT_CONFIG, makeScenario, nominalDemand } from '../src/engine/scenario.ts';
import { simulate } from '../src/engine/simulate.ts';
import { ms } from '../src/engine/types.ts';
import type { SimConfig } from '../src/engine/types.ts';
const M: [string, Partial<SimConfig>][] = [['fifo', { scheduler: 'fifo' }], ['template', { scheduler: 'template' }], ['priority', { scheduler: 'priority' }], ['edf', { scheduler: 'edf' }],
  ['balance', { scheduler: 'balance' }], ['legacy', { scheduler: 'legacy' }], ['paper', { scheduler: 'drsi', protect: 'paper' }], ['plus', { scheduler: 'drsi', protect: 'followers' }]];
const P = { light: { targets: 8, ramp: ms(20000) }, sat: { targets: 30, ramp: ms(40000) }, high: { targets: 22, ramp: ms(40000), highFrac: 0.8 }, recover: { targets: 36, ramp: ms(20000), disappear: { at: ms(40000), keep: 8 } } };
const pc = (x: number) => (x * 100).toFixed(1).padStart(5);
for (const [pn, o] of Object.entries(P)) {
  const sc = makeScenario({ seed: 11, duration: ms(60000), ...o });
  console.log(`== ${pn}  nominal demand at full count ${pc(nominalDemand(sc))} %`);
  for (const [name, c] of M) {
    const t0 = performance.now(); const r = simulate(sc, { ...DEFAULT_CONFIG, ...c }); const dt = performance.now() - t0;
    const s = summarize(r);
    console.log(name.padEnd(9), 'search', pc(s.share.search), 'served', s.regions.map((g) => pc(g.served)).join('/'), 'gap', pc(s.share.gap), 'spare', pc(s.share.spare),
      'fixed', pc(s.share.fixed), 'drop', String(s.fixed.dropped).padStart(5), '/', s.fixed.requested, 'upper', String(s.fixed.upperDropped).padStart(4), '/', s.fixed.upperRequested, 'lost', s.lost, 'held', pc(s.trackedShare), `${dt.toFixed(0)}ms`);
  }
}
