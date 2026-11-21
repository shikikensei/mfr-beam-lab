// Per-seed drop ratios against nominal demand, used to set the thresholds of the tendency tests.
import { displacedByLower, summarize } from '../src/engine/metrics.ts';
import { DEFAULT_CONFIG, makeScenario, nominalDemand } from '../src/engine/scenario.ts';
import { simulate } from '../src/engine/simulate.ts';
import { ms } from '../src/engine/types.ts';
for (const protect of ['paper', 'followers'] as const) for (const scheduler of ['drsi', 'legacy'] as const) {
  if (scheduler === 'legacy' && protect === 'followers') continue;
  console.log(`== ${scheduler} ${scheduler === 'drsi' ? protect : ''}`);
  for (const n of [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 30, 40]) {
    const rates: number[] = [], dem: number[] = []; let disp = 0, drops = 0;
    for (const seed of [11, 12, 13, 14, 15, 16, 17, 18]) {
      const sc = makeScenario({ targets: n, seed, duration: ms(30000) });
      const r = simulate(sc, { ...DEFAULT_CONFIG, scheduler, protect });
      const s = summarize(r);
      rates.push(s.fixed.dropped / s.fixed.requested); dem.push(nominalDemand(sc)); disp += displacedByLower(r).length; drops += s.fixed.dropped;
    }
    console.log(`n=${String(n).padStart(2)} 需要 ${(Math.min(...dem) * 100).toFixed(0)}-${(Math.max(...dem) * 100).toFixed(0)}%  取りこぼし率 平均 ${(rates.reduce((a, b) => a + b) / 8 * 100).toFixed(2)}% 最大 ${(Math.max(...rates) * 100).toFixed(2)}%  下位に取られた ${disp} / ${drops}`);
  }
}
