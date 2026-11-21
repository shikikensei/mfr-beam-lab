// Phase 1 report: where the legacy scheduler loses against the dynamic RSI scheduler, and
// whether the difference depends on one particular setting. Run: node scripts/phase1-report.ts
import { summarize } from '../src/engine/metrics.ts';
import { DEFAULT_CONFIG, makeScenario } from '../src/engine/scenario.ts';
import { simulate } from '../src/engine/simulate.ts';
import { ms } from '../src/engine/types.ts';
import type { ModelParams, SimConfig } from '../src/engine/types.ts';

const SEEDS = [11, 12, 13, 14, 15, 16, 17, 18];
const pc = (x: number): string => (x * 100).toFixed(1).padStart(5) + '%';
const num = (x: number): string => x.toFixed(1).padStart(6);

function mean(n: number, cfg: Partial<SimConfig>, params: Partial<ModelParams> = {}) {
  const acc = { search: 0, fixed: 0, gap: 0, spare: 0, frag: 0, bound: 0, s0: 0, s1: 0, f0: 0, f1: 0, req: 0, drop: 0, dTimeout: 0, dConflict: 0, dBoundary: 0, lost: 0, held: 0, shift: 0 };
  for (const seed of SEEDS) {
    const s = summarize(simulate(makeScenario({ targets: n, seed, duration: ms(30000), params }), { ...DEFAULT_CONFIG, ...cfg }));
    acc.search += s.share.search; acc.fixed += s.share.fixed; acc.gap += s.share.gap; acc.spare += s.share.spare;
    acc.frag += s.gapByCause.fragment / s.total; acc.bound += s.gapByCause.boundary / s.total;
    acc.s0 += s.regions[0].served; acc.s1 += s.regions[1].served;
    acc.f0 += (s.regions[0].meanFrame ?? NaN) / s.regions[0].dft; acc.f1 += (s.regions[1].meanFrame ?? NaN) / s.regions[1].dft;
    acc.req += s.fixed.requested; acc.drop += s.fixed.dropped; acc.dTimeout += s.fixed.byReason.timeout; acc.dConflict += s.fixed.byReason.conflict; acc.dBoundary += s.fixed.byReason.boundary;
    acc.lost += s.lost; acc.held += s.trackedShare; acc.shift += s.meanShift;
  }
  for (const k of Object.keys(acc) as (keyof typeof acc)[]) acc[k] /= SEEDS.length;
  return acc;
}
const VARIANTS: [string, Partial<SimConfig>][] = [
  ['動的RSI(論文)  ', { scheduler: 'drsi', protect: 'paper' }],
  ['動的RSI(後続)  ', { scheduler: 'drsi', protect: 'followers' }],
  ['従来型        ', { scheduler: 'legacy' }],
];
function row(name: string, a: ReturnType<typeof mean>): string {
  return `${name} 捜索${pc(a.search)} 固定${pc(a.fixed)} 隙間${pc(a.gap)}(細切れ${pc(a.frag)} 境界${pc(a.bound)}) 余裕${pc(a.spare)} | 充足 水平線${pc(a.s0)} 上空${pc(a.s1)} フレーム比 ${a.f0.toFixed(2)} ${a.f1.toFixed(2)} | 取りこぼし${num(a.drop)}/${a.req.toFixed(0)} (期限${num(a.dTimeout)} 衝突${num(a.dConflict)} 境界${num(a.dBoundary)}) ロスト${num(a.lost)} ずれ${a.shift.toFixed(2)}`;
}
console.log(`30秒 × ${SEEDS.length} 種の平均\n`);
for (const fill of ['pace', 'full'] as const) for (const n of [6, 14, 24]) {
  console.log(`== 目標 ${n}、${fill === 'pace' ? '所望ペースまで' : '埋め切る'}`);
  for (const [name, c] of VARIANTS) console.log(row(name, mean(n, { ...c, fill })));
}
console.log('\n== 感度：従来型の箱の長さ（目標14、所望ペースまで）');
for (const rsi of [50, 100, 200]) console.log(row(`従来型 ${String(rsi).padStart(3)} ms `, mean(14, { scheduler: 'legacy', rsiLen: ms(rsi) })));
console.log('\n== 感度：追尾のスラック幅（更新間隔に対する割合、目標14、所望ペースまで）');
for (const f of [0.04, 0.08, 0.16]) for (const [name, c] of VARIANTS) console.log(row(`±${(f * 100).toFixed(0).padStart(2)}% ${name}`, mean(14, c, { slackFrac: f })));
console.log('\n== 感度：動的RSIの箱の最大長（目標14、所望ペースまで）');
for (const m of [75, 150, 300]) for (const [name, c] of VARIANTS.slice(0, 2)) console.log(row(`${String(m).padStart(3)} ms ${name}`, mean(14, { ...c, maxDrsi: ms(m) })));
