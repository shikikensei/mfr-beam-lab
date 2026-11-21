// Why does a waiting fixed task lose its place to a less important one? Classifies each case.
import { displacedByLower } from '../src/engine/metrics.ts';
import { DEFAULT_CONFIG, makeScenario } from '../src/engine/scenario.ts';
import { simulate } from '../src/engine/simulate.ts';
import { ms } from '../src/engine/types.ts';
for (const protect of ['paper', 'followers'] as const) for (const n of [14, 18, 24]) {
  const why: Record<string, number> = {}; let total = 0;
  for (const seed of [11, 12, 13, 14, 15, 16, 17, 18]) {
    const r = simulate(makeScenario({ targets: n, seed, duration: ms(30000) }), { ...DEFAULT_CONFIG, scheduler: 'drsi', protect });
    const fixed = r.timeline.filter((x) => x.type === 'fixed');
    for (const q of displacedByLower(r)) {
      total++;
      const lo = Math.max(q.earliest, q.createdAt), hi = q.latest;
      const culprits = fixed.filter((x) => x.type === 'fixed' && r.requests[x.reqId].rank > q.rank && r.boxes[x.box].start >= q.createdAt && x.start < hi + q.len && x.start + x.len > lo);
      // the box in which the first culprit was placed, and the state of q's queue at that moment
      const c = culprits[0]; if (c.type !== 'fixed') continue;
      const b = r.boxes[c.box];
      const ahead = r.requests.filter((o) => o.rank === q.rank && o.id !== q.id && o.createdAt <= b.start && (o.resolvedAt === null || o.resolvedAt > b.start) && (o.latest < q.latest || (o.latest === q.latest && o.id < q.id)));
      const tooFar = q.latest + q.len - b.start > DEFAULT_CONFIG.maxDrsi;
      const sel = b.steps.find((s) => s.kind === 'select');
      const role = sel && sel.kind === 'select' && sel.nft === c.reqId ? 'NFT' : '連結';
      const key = `${ahead.length ? '同じキューの先頭ではなかった' : tooFar ? '最大長の外で候補外だった' : '候補だった'} / 下位は${role}`;
      why[key] = (why[key] ?? 0) + 1;
    }
  }
  console.log(protect, 'n=' + n, 'total', total, why);
}
