// Phase 4 groundwork: how often could a dwell be interleaved into the wait of the dwell just
// before it? An estimate from existing timelines, NOT an implementation: the timelines are not
// re-run after an insertion, so the numbers are a first look at how much room there is.
// Hypothetical dwell model (to be agreed): a "far" target's dwell is tx 2 ms + wait + rx 2 ms with
// the same total length as now; a "near" target's dwell has no wait. Search beams have no wait.
import { DEFAULT_CONFIG, makeScenario } from '../src/engine/scenario.ts';
import { simulate } from '../src/engine/simulate.ts';
import { ms } from '../src/engine/types.ts';
const SEEDS = [11, 12, 13, 14], TX = ms(2), RX = ms(2);
const isFar = (target: number, share: number): boolean => ((target * 7 + 3) % 10) < share * 10;
for (const [scene, o] of [['軽い（目標8）', { targets: 8, ramp: ms(20000) }], ['飽和する（目標30）', { targets: 30, ramp: ms(40000) }]] as const) {
  for (const far of [0.4, 0.8]) {
    console.log(`== ${scene}、遠距離の目標 ${far * 100} %`);
    for (const scheduler of ['priority', 'edf'] as const) {
      const a = { fixed: 0, withWait: 0, wait8: 0, follower: 0, mode1: 0, mode2: 0, saved: 0, total: 0, searchIn: 0 };
      for (const seed of SEEDS) {
        const r = simulate(makeScenario({ ...o, seed, duration: ms(60000) }), { ...DEFAULT_CONFIG, scheduler });
        const tl = [...r.timeline].sort((x, y) => x.start - y.start);
        a.total += r.end;
        const seg = (x: (typeof tl)[number]): { tx: number; wait: number; rx: number } => {
          if (x.type !== 'fixed' || x.kind === 'critical' || x.kind === 'confirm' || !isFar(x.target, far) || x.len < TX + RX + ms(2)) return { tx: x.len, wait: 0, rx: 0 };
          return { tx: TX, wait: x.len - TX - RX, rx: RX };
        };
        for (let i = 0; i < tl.length; i++) {
          const A = tl[i];
          if (A.type !== 'fixed') continue;
          a.fixed++;
          const sa = seg(A);
          if (!sa.wait) continue;
          a.withWait++; if (sa.wait >= ms(8)) a.wait8++;
          const B = tl[i + 1];
          if (!B || (B.type !== 'fixed' && B.type !== 'flex') || B.start !== A.start + A.len) continue; // nothing was ready right behind it
          a.follower++;
          const sb = seg(B), aEnd = A.start + A.len, txEnd = A.start + sa.tx, rxStart = aEnd - sa.rx;
          if (B.len <= sa.wait) { a.mode1++; a.saved += B.len; if (B.type === 'flex') a.searchIn++; continue; }
          const s = Math.max(txEnd, aEnd - sb.tx - sb.wait);
          if (sb.wait > 0 && s + sb.tx <= rxStart) { a.mode2++; a.saved += aEnd - s; }
        }
      }
      const pc = (x: number, of: number) => `${((x / of) * 100).toFixed(0)} %`;
      console.log(`  ${scheduler.padEnd(8)} 固定タスクの照射 ${(a.fixed / 4).toFixed(0)} 回、待ちあり ${pc(a.withWait, a.fixed)}（うち待ち8 ms以上 ${pc(a.wait8, a.fixed)}）` +
        `｜待ちありのうち、直後に別の照射が続く ${pc(a.follower, a.withWait)}、丸ごと入る ${pc(a.mode1, a.withWait)}（捜索 ${pc(a.searchIn, a.withWait)}）、送信だけ入る ${pc(a.mode2, a.withWait)}｜浮く時間 全体の ${((a.saved / a.total) * 100).toFixed(1)} %`);
    }
  }
}
