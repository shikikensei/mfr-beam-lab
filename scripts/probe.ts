import { summarize, unexplainedDrops, validate } from '../src/engine/metrics.ts';
import { DEFAULT_CONFIG, makeScenario } from '../src/engine/scenario.ts';
import { simulate } from '../src/engine/simulate.ts';
import { ms } from '../src/engine/types.ts';
import type { FillMode, SchedulerId } from '../src/engine/types.ts';

const pc = (x: number): string => (x * 100).toFixed(1).padStart(5) + '%';
for (const fill of ['pace', 'full'] as FillMode[]) for (const n of [2, 6, 14, 24, 40]) for (const [scheduler, protect] of [['drsi', 'paper'], ['drsi', 'followers'], ['legacy', 'paper']] as [SchedulerId, 'paper' | 'followers'][]) {
  const sc = makeScenario({ targets: n, seed: 11, duration: ms(30000) });
  const t0 = performance.now();
  const r = simulate(sc, { ...DEFAULT_CONFIG, scheduler, fill, protect });
  const dt = performance.now() - t0, s = summarize(r), v = validate(r);
  console.log(fill, String(n).padStart(2), (scheduler + (protect === 'followers' ? '+F' : '')).padEnd(7), 'search', pc(s.share.search), 'fixed', pc(s.share.fixed), 'gap', pc(s.share.gap), 'spare', pc(s.share.spare),
    '| frames', s.regions.map((g) => (g.meanFrame === null ? '   -' : (g.meanFrame / 1e6).toFixed(2)) + '/' + (g.dft / 1e6).toFixed(1)).join(' '),
    '| drops', s.fixed.dropped, JSON.stringify(s.fixed.byReason), 'unexpl', unexplainedDrops(r).length, 'lost', s.lost, 'held', pc(s.trackedShare), 'shift', s.meanShift.toFixed(2),
    '| boxes', r.boxes.length, dt.toFixed(0) + 'ms', v.length ? 'INVALID ' + v.slice(0, 3).join('; ') : 'ok');
}
