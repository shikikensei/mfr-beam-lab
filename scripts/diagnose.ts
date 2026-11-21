// Why were requests dropped although higher-priority tasks alone do not explain it?
import { unexplainedDrops } from '../src/engine/metrics.ts';
import { DEFAULT_CONFIG, makeScenario } from '../src/engine/scenario.ts';
import { simulate } from '../src/engine/simulate.ts';
import { ms } from '../src/engine/types.ts';
import type { SimConfig, SimResult } from '../src/engine/types.ts';

export function classify(r: SimResult): Record<string, number> {
  const out: Record<string, number> = {};
  for (const q of unexplainedDrops(r)) {
    const lo = Math.max(q.earliest, q.createdAt), hi = q.latest;
    const plans = r.boxes.filter((b) => b.start >= lo && b.start <= hi);
    let why: string;
    if (!plans.length) why = '窓の間に計画の機会なし（箱が実行中）';
    else {
      // what was running at the last moment it could have started
      const x = r.timeline.find((i) => i.start <= hi && hi < i.start + i.len);
      if (!x) why = 'その他';
      else if (x.type === 'fixed') {
        const o = r.requests[x.reqId];
        why = o.rank < q.rank ? '上位の固定タスク（後ろに余地はあった）' : o.rank === q.rank ? '同じキューの固定タスクが先に最遅位置を取った' : '下位の固定タスクが先に置かれた';
      } else why = x.type === 'flex' ? '捜索が置かれた' : '空き時間のまま';
    }
    const key = `${q.kind}: ${why}`;
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

if (process.argv[1]?.endsWith('diagnose.ts')) {
  const variants: [string, Partial<SimConfig>][] = [['drsi pace followers', { scheduler: 'drsi', fill: 'pace', protect: 'followers' }], ['drsi full followers', { scheduler: 'drsi', fill: 'full', protect: 'followers' }]];
  for (const [name, c] of variants) for (const n of [14, 24, 40]) {
    const r = simulate(makeScenario({ targets: n, seed: 11, duration: ms(30000) }), { ...DEFAULT_CONFIG, ...c });
    console.log(`\n${name} n=${n}: requests ${r.requests.length}, dropped ${r.requests.filter((q) => q.status === 'dropped').length}, unexplained ${unexplainedDrops(r).length}`);
    for (const [k, v] of Object.entries(classify(r)).sort((a, b) => b[1] - a[1])) console.log('  ', String(v).padStart(4), k);
  }
}
