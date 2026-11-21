// Fixed priority with and without pulse interleaving: measured effect, to set against the estimate
// of scripts/interleave-estimate.ts, and its sensitivity to the share of far targets. 60 s, 4 seeds.
import { summarize } from '../src/engine/metrics.ts';
import { DEFAULT_CONFIG, makeScenario } from '../src/engine/scenario.ts';
import { simulate } from '../src/engine/simulate.ts';
import { ms } from '../src/engine/types.ts';
const SEEDS = [11, 12, 13, 14];
for (const [scene, o] of [['light', { targets: 8, ramp: ms(20000) }], ['sat', { targets: 30, ramp: ms(40000) }]] as const) {
  for (const keep of [false, true]) for (const far of keep ? [0.4] : [0, 0.2, 0.4, 0.8, 1]) {
    for (const scheduler of ['priority', 'interleave'] as const) {
      const a = { search: 0, hi: 0, lo: 0, drop: 0, req: 0, upper: 0, overlap: 0, tx: 0, spare: 0, guests: 0, whole: 0 };
      for (const seed of SEEDS) {
        const r = simulate(makeScenario({ ...o, seed, duration: ms(60000), farFrac: far }), { ...DEFAULT_CONFIG, scheduler, conv: { searchBacklog: keep ? Infinity : 0 } });
        const s = summarize(r);
        a.search += s.share.search / 0.5; a.hi += s.regions[0].served; a.lo += s.regions[1].served; a.drop += s.fixed.dropped; a.req += s.fixed.requested; a.upper += s.fixed.upperDropped;
        a.overlap += s.overlap; a.tx += s.txShare; a.spare += s.share.spare;
        for (const x of r.timeline) if (x.saved) { a.guests++; if (x.saved === x.len) a.whole++; }
      }
      const p = (x: number, d = 0) => ((x / 4) * 100).toFixed(d);
      console.log(`${scene.padEnd(5)} ${keep ? 'keep  ' : 'forget'} far ${String(far * 100).padStart(3)} % ${scheduler.padEnd(10)} search ${p(a.search)} % (${p(a.hi)}/${p(a.lo)})  drop ${(a.drop / 4).toFixed(0)} (${((a.drop / a.req) * 100).toFixed(1)} %) upper ${(a.upper / 4).toFixed(0)}  shared time ${p(a.overlap, 1)} %  transmit duty ${p(a.tx, 1)} %  spare ${p(a.spare, 1)} %  guests ${(a.guests / 4).toFixed(0)} (whole ${(a.whole / 4).toFixed(0)})`);
    }
  }
}
