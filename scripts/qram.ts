// How far is the greedy allocation from the true optimum? And what does an allocation do to a
// saturated situation once it is handed to the schedulers?
import { summarize } from '../src/engine/metrics.ts';
import { allocate, applyAllocation, bruteForce, hull, radarTasks } from '../src/engine/qram.ts';
import type { QTask } from '../src/engine/qram.ts';
import { sequence } from '../src/engine/rand.ts';
import { DEFAULT_CONFIG, makeScenario, nominalDemand } from '../src/engine/scenario.ts';
import { simulate } from '../src/engine/simulate.ts';
import { ms } from '../src/engine/types.ts';

function gaps(name: string, cases: { tasks: QTask[]; limit: number }[]): void {
  for (const stopAtFirst of [true, false]) {
    let n = 0, worse = 0, sum = 0, max = 0, unused = 0, offHull = 0;
    for (const c of cases) {
      const a = allocate(c.tasks, c.limit, stopAtFirst);
      if (!a.feasible) continue;
      const opt = bruteForce(c.tasks, c.limit), gap = (opt - a.utility) / opt;
      n++; if (gap > 1e-9) worse++; sum += gap; max = Math.max(max, gap); unused += (c.limit - a.used) / c.limit;
      // would the optimum restricted to hull settings do as well? If not, the gap is the hull's, not the stopping rule's
      if (bruteForce(c.tasks.map((t) => ({ ...t, points: hull(t.points) })), c.limit) < opt - 1e-9) offHull++;
    }
    console.log(`${name} [${stopAtFirst ? 'stop at first misfit' : 'try next best    '}]: ${n} cases, below the optimum in ${((worse / n) * 100).toFixed(0)} %, mean gap ${((sum / n) * 100).toFixed(2)} %, worst ${(max * 100).toFixed(1)} %, unused ${((unused / n) * 100).toFixed(1)} %, optimum uses an off-hull setting in ${((offHull / n) * 100).toFixed(0)} %`);
  }
}
const rnd = (seed: number, settings: number) => { const q = sequence(seed); return Array.from({ length: 2000 }, () => ({
  tasks: Array.from({ length: 4 }, (_, i): QTask => ({ id: 't' + i, group: 'g', points: Array.from({ length: settings }, (_, k) => ({ r: 0.05 + (0.32 / settings) * k + (0.16 / settings) * q(), u: ((k + 1) * 4 / settings) * (0.5 + q()), label: `s${k}` })) })),
  limit: 0.5 + 0.5 * q() })); };
for (const settings of [4, 8]) gaps(`random, 4 tasks x ${settings} settings`, rnd(9, settings));
// the worst case under the current rule, taken apart
{
  let worst = { gap: 0, c: null as null | { tasks: QTask[]; limit: number } };
  for (const c of rnd(9, 4)) { const a = allocate(c.tasks, c.limit); if (!a.feasible) continue; const g = 1 - a.utility / bruteForce(c.tasks, c.limit); if (g > worst.gap) worst = { gap: g, c }; }
  const c = worst.c!, a = allocate(c.tasks, c.limit);
  console.log(`worst case: limit ${c.limit.toFixed(3)}, greedy uses ${a.used.toFixed(3)} for utility ${a.utility.toFixed(2)}, optimum ${bruteForce(c.tasks, c.limit).toFixed(2)} (gap ${(worst.gap * 100).toFixed(1)} %)`);
  c.tasks.forEach((t, i) => console.log(`  task ${i}: settings (r,u) ${t.points.map((p) => `(${p.r.toFixed(3)},${p.u.toFixed(2)})`).join(' ')} | hull ${hull(t.points).map((p) => p.label).join(',')} | greedy chose ${a.choice[i].label} (${a.choice[i].r.toFixed(3)},${a.choice[i].u.toFixed(2)})`));
  // the optimum itself
  let best = -1, pick: number[] = [];
  const walk = (i: number, used: number, u: number, sel: number[]): void => { if (used > c.limit + 1e-12) return; if (i === c.tasks.length) { if (u > best) { best = u; pick = sel; } return; } c.tasks[i].points.forEach((p, k) => walk(i + 1, used + p.r, u + p.u, [...sel, k])); };
  walk(0, 0, 0, []);
  console.log(`  optimum chooses ${pick.map((k, i) => `${c.tasks[i].points[k].label}(${c.tasks[i].points[k].r.toFixed(3)},${c.tasks[i].points[k].u.toFixed(2)})`).join(' ')} using ${pick.reduce((x, k, i) => x + c.tasks[i].points[k].r, 0).toFixed(3)}`);
}
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
