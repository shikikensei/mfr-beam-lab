// Two-slope benefit scheduler: window length, and what is lost at the window edge. 60 s, mean of 4 seeds.
import { summarize } from '../src/engine/metrics.ts';
import { DEFAULT_CONFIG, makeScenario } from '../src/engine/scenario.ts';
import { simulate } from '../src/engine/simulate.ts';
import { ms } from '../src/engine/types.ts';
const SEEDS = [11, 12, 13, 14];
for (const [name, o] of [['light', { targets: 8, ramp: ms(20000) }], ['sat', { targets: 30, ramp: ms(40000) }]] as const) {
  console.log('==', name);
  for (const W of [50, 100, 150, 300]) {
    const a = { search: 0, hi: 0, lo: 0, gapF: 0, gapB: 0, drop: 0, req: 0, upper: 0, lost: 0, boundary: 0, conflict: 0, timeout: 0, tRetry: 0, tConfirm: 0, tTrack: 0, midWindow: 0 };
    for (const seed of SEEDS) {
      const r = simulate(makeScenario({ ...o, seed, duration: ms(60000) }), { ...DEFAULT_CONFIG, scheduler: 'tsbf', tsbfWindow: ms(W) });
      const s = summarize(r);
      a.search += s.share.search / 0.5; a.hi += s.regions[0].served; a.lo += s.regions[1].served; a.gapF += s.gapByCause.fragment / s.total; a.gapB += s.gapByCause.boundary / s.total;
      a.drop += s.fixed.dropped; a.req += s.fixed.requested; a.upper += s.fixed.upperDropped; a.lost += s.lost;
      a.boundary += s.fixed.byReason.boundary; a.conflict += s.fixed.byReason.conflict; a.timeout += s.fixed.byReason.timeout;
      for (const q of r.requests) {
        if (q.status !== 'dropped' || q.dropReason !== 'timeout') continue;
        if (q.kind === 'retry') a.tRetry++; else if (q.kind === 'confirm') a.tConfirm++; else a.tTrack++;
        // asked for inside a window and already too late when the next window began
        if (q.latest < (Math.floor(q.createdAt / ms(W)) + 1) * ms(W)) a.midWindow++;
      }
    }
    const n = SEEDS.length, f = (x: number, d = 0) => (x / n).toFixed(d), p = (x: number, d = 0) => ((x / n) * 100).toFixed(d);
    console.log(`window ${String(W).padStart(3)} ms: search ${p(a.search)} % (${p(a.hi)}/${p(a.lo)})  gap fragment ${p(a.gapF, 1)} % edge ${p(a.gapB, 1)} %  drop ${f(a.drop)} (${((a.drop / a.req) * 100).toFixed(1)} %) upper ${f(a.upper)} lost ${f(a.lost)}`);
    console.log(`     reasons: window edge ${f(a.boundary)}, lost the selection ${f(a.conflict)}, window passed while waiting ${f(a.timeout)} (retry ${f(a.tRetry)}, confirm ${f(a.tConfirm)}, track ${f(a.tTrack)}; of these, asked mid-window and expired before the next window: ${f(a.midWindow)})`);
  }
}
