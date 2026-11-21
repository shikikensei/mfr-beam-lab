// Do the one-dwell schedulers look bad because of the conventions this tool chose?
// Saturating situation of chapter 2 (30 targets appearing over 40 s, 60 s), mean of 4 seeds.
import { summarize } from '../src/engine/metrics.ts';
import { DEFAULT_CONFIG, makeScenario } from '../src/engine/scenario.ts';
import { simulate } from '../src/engine/simulate.ts';
import { ms } from '../src/engine/types.ts';
import type { Conventions, SimConfig } from '../src/engine/types.ts';
const SEEDS = [11, 12, 13, 14];
function row(name: string, c: Partial<SimConfig>, given: Partial<Conventions> = {}): void {
  const conv = { searchBacklog: Infinity, ...given }; // rows vary one thing from "backlog kept"; the tool's default is backlog 0
  const a = { search: 0, hi: 0, lo: 0, gap: 0, drop: 0, req: 0, upper: 0, lost: 0, held: 0 };
  for (const seed of SEEDS) {
    const sc = makeScenario({ targets: 30, ramp: ms(40000), seed, duration: ms(60000) });
    const s = summarize(simulate(sc, { ...DEFAULT_CONFIG, ...c, conv }));
    a.search += s.share.search / 0.5; a.hi += s.regions[0].served; a.lo += s.regions[1].served; a.gap += s.share.gap;
    a.drop += s.fixed.dropped; a.req += s.fixed.requested; a.upper += s.fixed.upperDropped; a.lost += s.lost; a.held += s.trackedShare;
  }
  const n = SEEDS.length, p = (x: number) => ((x / n) * 100).toFixed(0).padStart(4);
  console.log(name.padEnd(46), 'search', p(a.search), `(${p(a.hi)}/${p(a.lo)})`, 'gap', ((a.gap / n) * 100).toFixed(1).padStart(4), 'drop', (a.drop / n).toFixed(0).padStart(5),
    `${((a.drop / a.req) * 100).toFixed(1).padStart(5)}%`, 'upper', (a.upper / n).toFixed(0).padStart(4), 'lost', (a.lost / n).toFixed(0).padStart(4), 'held', p(a.held));
}
console.log('--- reference');
row('priority', { scheduler: 'priority' }); row('legacy', { scheduler: 'legacy' });
row('drsi paper', { scheduler: 'drsi', protect: 'paper' }); row('drsi plus', { scheduler: 'drsi', protect: 'followers' });
for (const scheduler of ['fifo', 'edf', 'balance'] as const) {
  console.log('---', scheduler);
  row(`${scheduler} backlog kept (grace 1, period)`, { scheduler });
  for (const g of [0.3, 2, 4, 12]) row(`${scheduler} grace ${g}`, { scheduler }, { searchGrace: g });
  for (const b of [4, 1, 0]) row(`${scheduler} backlog ${b}`, { scheduler }, { searchBacklog: b });
  row(`${scheduler} backlog 1, grace 4`, { scheduler }, { searchBacklog: 1, searchGrace: 4 });
  if (scheduler === 'balance') {
    row('balance by slack', { scheduler }, { balanceBy: 'slack' });
    for (const b of [4, 1, 0]) row(`balance by slack, backlog ${b}`, { scheduler }, { balanceBy: 'slack', searchBacklog: b });
  }
}
