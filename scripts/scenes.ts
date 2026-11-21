// Which settings show each special scene of chapter 1? Lists the first box per scene.
import { DEFAULT_CONFIG, makeScenario } from '../src/engine/scenario.ts';
import { simulate } from '../src/engine/simulate.ts';
import { ms } from '../src/engine/types.ts';
const crit = [{ at: ms(1500), len: ms(20), notice: ms(40) }, { at: ms(3200), len: ms(20), notice: ms(40) }];
for (const protect of ['followers', 'paper'] as const) for (const n of [4, 6, 8, 10, 12, 14]) {
  const r = simulate(makeScenario({ targets: n, seed: 11, criticals: n % 4 === 0 ? crit : [] }), { ...DEFAULT_CONFIG, protect, trace: true });
  const first = (f: (b: (typeof r.boxes)[number]) => boolean): string => { const b = r.boxes.find((x) => x.start > ms(800) && f(x)); return b ? (b.start / 1e6).toFixed(2) : '-'; };
  const sel = (b: (typeof r.boxes)[number]) => b.steps[0].kind === 'select' ? b.steps[0] : null;
  console.log(protect.padEnd(9), 'n=' + String(n).padStart(2),
    'case1', first((b) => sel(b)?.caseNo === 1 && sel(b)!.returned.length === 0),
    'case2', first((b) => sel(b)?.caseNo === 2),
    'case3', first((b) => (sel(b)?.returned.length ?? 0) > 0),
    'max', first((b) => sel(b)?.why === 'maxDrsi'),
    'chain', first((b) => b.steps.filter((s) => s.kind === 'chain').length >= 2),
    'gap', first((b) => b.steps.some((s) => s.kind === 'close' && s.gap > 0)),
    'shift', first((b) => { const s = sel(b); return !!s && s.nft !== null && s.caseNo === 1 && s.tentative! < r.requests[s.nft].latest; }),
    'intr', first((b) => b.interrupted),
    'drops', r.requests.filter((q) => q.status === 'dropped').length);
}
