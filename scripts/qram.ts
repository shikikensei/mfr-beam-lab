// How far is the greedy allocation from the true optimum? And what does an allocation do to a
// saturated situation once it is handed to the schedulers?
import { summarize } from '../src/engine/metrics.ts';
import { allocate, applyAllocation, bruteForce, radarTasks } from '../src/engine/qram.ts';
import type { QTask } from '../src/engine/qram.ts';
import { sequence } from '../src/engine/rand.ts';
import { DEFAULT_CONFIG, makeScenario, nominalDemand } from '../src/engine/scenario.ts';
import { simulate } from '../src/engine/simulate.ts';
import { ms } from '../src/engine/types.ts';

function gaps(name: string, cases: { tasks: QTask[]; limit: number }[]): void {
  let n = 0, worse = 0, sum = 0, max = 0, unused = 0;
  for (const c of cases) {
    const a = allocate(c.tasks, c.limit);
    if (!a.feasible) continue;
    const opt = bruteForce(c.tasks, c.limit), gap = (opt - a.utility) / opt;
    n++; if (gap > 1e-9) worse++; sum += gap; max = Math.max(max, gap); unused += (c.limit - a.used) / c.limit;
  }
  console.log(`${name}: ${n} cases, greedy below the optimum in ${((worse / n) * 100).toFixed(0)} %, mean gap ${((sum / n) * 100).toFixed(2)} %, worst ${(max * 100).toFixed(1)} %, resource left unused on average ${((unused / n) * 100).toFixed(1)} %`);
}
const r = sequence(9);
gaps('random, 4 tasks x 4 settings', Array.from({ length: 2000 }, () => ({
  tasks: Array.from({ length: 4 }, (_, i): QTask => ({ id: 't' + i, group: 'g', points: Array.from({ length: 4 }, (_, k) => ({ r: 0.05 + 0.08 * k + 0.04 * r(), u: (k + 1) * (0.5 + r()), label: '' })) })),
  limit: 0.5 + 0.5 * r() })));
for (const n of [2, 3, 4]) {
  const cases = [];
  for (let seed = 11; seed <= 18; seed++) for (const limit of [0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.7, 0.8, 0.9]) cases.push({ tasks: radarTasks(makeScenario({ targets: n, seed })), limit });
  gaps(`radar tasks, 2 regions + ${n} targets`, cases);
}
console.log('--- allocation handed to the schedulers: saturating situation (30 targets over 40 s, 60 s), mean of 4 seeds');
for (const limit of [null, 1.0, 0.9, 0.8]) {
  for (const [name, cfg] of [['priority', { scheduler: 'priority' }], ['plus', { scheduler: 'drsi', protect: 'followers' }], ['legacy', { scheduler: 'legacy' }]] as const) {
    const a = { demand: 0, served: 0, drop: 0, req: 0, lost: 0, util: 0 };
    for (const seed of [11, 12, 13, 14]) {
      const base = makeScenario({ targets: 30, ramp: ms(40000), seed, duration: ms(60000) });
      const x = limit === null ? null : applyAllocation(base, limit), sc = x ? x.sc : base;
      const s = summarize(simulate(sc, { ...DEFAULT_CONFIG, ...cfg }));
      a.demand += nominalDemand(sc); a.served += s.regions.reduce((p, g) => p + g.served, 0) / s.regions.length; a.drop += s.fixed.dropped; a.req += s.fixed.requested; a.lost += s.lost; a.util += x ? x.alloc.utility : 0;
    }
    console.log(`limit ${limit === null ? 'none' : (limit * 100).toFixed(0) + ' %'} ${name.padEnd(8)} asked ${((a.demand / 4) * 100).toFixed(0)} %  search at its (chosen) pace ${((a.served / 4) * 100).toFixed(0)} %  drop ${(a.drop / 4).toFixed(0)} (${((a.drop / a.req) * 100).toFixed(1)} %)  lost ${(a.lost / 4).toFixed(0)}  utility ${(a.util / 4).toFixed(1)}`);
  }
}
