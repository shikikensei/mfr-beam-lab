// Check of the paper's qualitative claims (Smouse, Liu & Sylvester 2020, p. 103-104).
// The paper gives NO simulation conditions and NO result table: every number below is ours.
// Only the structure follows the paper's figures: two fixed queues (A high, B low; Figs. 4-7)
// and four flexible queues with different event lengths (Figs. 3, 5-7).
// Run: node scripts/paper-check.ts
import { summarize, unexplainedDrops } from '../src/engine/metrics.ts';
import { DEFAULT_CONFIG, makeScenario } from '../src/engine/scenario.ts';
import { simulate } from '../src/engine/simulate.ts';
import { ms } from '../src/engine/types.ts';
import type { ModelParams, SearchRegion, SimConfig } from '../src/engine/types.ts';

const SEEDS = [11, 12, 13, 14, 15, 16, 17, 18];
const DURATION = ms(60000);
// Four flexible queues, 58.4 % of the timeline wanted in total (our values).
const REGIONS: SearchRegion[] = [
  { name: 'F1', beams: 10, beamLen: ms(20), dft: ms(1000), priority: 0 },
  { name: 'F2', beams: 25, beamLen: ms(12), dft: ms(1500), priority: 1 },
  { name: 'F3', beams: 30, beamLen: ms(8), dft: ms(2000), priority: 2 },
  { name: 'F4', beams: 16, beamLen: ms(16), dft: ms(4000), priority: 3 },
];
// Every look hits: after the first detection only the two track queues carry requests,
// unless a drop triggers this tool's re-illumination (our model, not the paper's).
const TWO_QUEUES: Partial<ModelParams> = { pdSearch: 1, pdConfirm: 1, pdTrack: 1 };

function mean(n: number, cfg: Partial<SimConfig>, params: Partial<ModelParams> = {}) {
  const a = { demand: 0, fixed: 0, search: 0, eff: 0, req: 0, drop: 0, unexplained: 0, shift: 0, frame: REGIONS.map(() => 0), served: REGIONS.map(() => 0) };
  for (const seed of SEEDS) {
    const sc = makeScenario({ targets: n, seed, duration: DURATION, regions: REGIONS, params: { ...TWO_QUEUES, ...params } });
    const P = sc.params;
    a.demand += sc.targets.reduce((x, t) => x + t.dwell / (t.high ? P.intervalHigh : P.intervalNormal), 0);
    const r = simulate(sc, { ...DEFAULT_CONFIG, scheduler: 'drsi', fill: 'pace', protect: 'paper', ...cfg });
    const s = summarize(r);
    a.fixed += s.share.fixed; a.search += s.share.search; a.eff += s.efficiency;
    a.req += s.fixed.requested; a.drop += s.fixed.dropped; a.unexplained += unexplainedDrops(r).length; a.shift += s.meanShift;
    s.regions.forEach((g, i) => { a.frame[i] += (g.meanFrame ?? NaN) / g.dft; a.served[i] += g.served; });
  }
  const k = SEEDS.length;
  return { demand: a.demand / k, fixed: a.fixed / k, search: a.search / k, eff: a.eff / k, req: a.req / k, drop: a.drop / k, unexplained: a.unexplained / k, shift: a.shift / k,
    frame: a.frame.map((x) => x / k), served: a.served.map((x) => x / k) };
}
const pc = (x: number): string => (x * 100).toFixed(1) + '%';
function row(label: string, m: ReturnType<typeof mean>): string {
  return `${label.padEnd(26)} 固定の需要 ${pc(m.demand).padStart(6)} 合計需要 ${pc(m.demand + 0.584).padStart(6)} | フレームタイム/所望 ${m.frame.map((x) => x.toFixed(2)).join(' ')} | 効率 ${pc(m.eff)} | 取りこぼし ${m.drop.toFixed(1).padStart(6)} / ${m.req.toFixed(0).padStart(5)} (${pc(m.drop / m.req)}) うち上位で説明できない ${m.unexplained.toFixed(1)} | ずれ ${m.shift.toFixed(2)}`;
}

console.log(`60秒 × ${SEEDS.length} 種の平均。動的RSI（論文の記述どおり）、固定2キュー・柔軟4キュー\n`);
console.log('== 負荷の3水準（水準の定義は本ツール。論文には値がない）');
for (const [name, n] of [['軽', 4], ['中', 10], ['中の上', 14], ['重', 22]] as const) console.log(row(`${name}（目標${n}）`, mean(n, {})));
console.log('\n== 取りこぼしに効く仮定：スラック幅（更新間隔に対する割合）');
for (const f of [0.04, 0.08, 0.16, 0.32]) for (const n of [10, 14]) console.log(row(`±${f * 100}% 目標${n}`, mean(n, {}, { slackFrac: f })));
console.log('\n== 取りこぼしに効く仮定：箱の最大長');
for (const m of [75, 150, 300]) for (const n of [10, 14]) console.log(row(`${m} ms 目標${n}`, mean(n, { maxDrsi: ms(m) })));
console.log('\n== 取りこぼしに効く仮定：取りこぼし後の再照射をやめる（再照射の許容範囲を0にはできないので、外れ上限1で即ロスト扱い）');
for (const n of [10, 14]) console.log(row(`再照射なし 目標${n}`, mean(n, {}, { missLimit: 1 })));
console.log('\n== 参考：後続に場所を空ける（本ツールの拡張）');
for (const n of [4, 10, 14, 22]) console.log(row(`拡張 目標${n}`, mean(n, { protect: 'followers' })));
console.log('\n== 参考：余った時間を埋め切る');
for (const n of [4, 10, 14, 22]) console.log(row(`埋め切る 目標${n}`, mean(n, { fill: 'full' })));
console.log('\n== 一致しなくなる条件：外れ（探知確率 < 1）を入れ、確認・再照射のキューが加わる場合（本ツールの説明用シナリオと同じ確率）');
const PD = { pdSearch: 0.85, pdConfirm: 0.92, pdTrack: 0.88 };
for (const n of [4, 10, 14, 22]) console.log(row(`外れあり 目標${n}`, mean(n, {}, PD)));
console.log('  うち再照射の許容範囲を広げる（後 60 → 150 ms）');
for (const n of [14, 22]) console.log(row(`外れあり・広い 目標${n}`, mean(n, {}, { ...PD, retryTrail: ms(150) })));
