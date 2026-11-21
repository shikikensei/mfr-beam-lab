// Legacy scheduler as the paper describes it: a fixed-length RSI filled queue by queue in
// priority order. Where the paper is silent (where a fixed task sits inside the RSI), the
// choices are listed in docs/assumptions.md and are meant not to handicap it.
import { flexibleTaskDeficit } from './ftd.ts';
import type { Box, DropReason, FixedRequest, GapCause, PlanStep, PlanView, Placement, Us } from './types.ts';

type Free = [Us, Us];

/** Start nearest to `want` inside [lo, hi] such that [start, start + len) lies in a free interval. */
function nearest(free: Free[], lo: Us, hi: Us, len: Us, want: Us): Us | null {
  let best: Us | null = null;
  for (const [a, b] of free) {
    const s0 = Math.max(a, lo), s1 = Math.min(b - len, hi);
    if (s0 > s1) continue;
    const s = Math.min(s1, Math.max(s0, want));
    if (best === null || Math.abs(s - want) < Math.abs(best - want)) best = s;
  }
  return best;
}

function take(free: Free[], s: Us, len: Us): void {
  const i = free.findIndex(([a, b]) => a <= s && s + len <= b);
  const [a, b] = free[i];
  const parts: Free[] = [];
  if (s > a) parts.push([a, s]);
  if (s + len < b) parts.push([s + len, b]);
  free.splice(i, 1, ...parts);
}

export function planLegacy(v: PlanView): Box {
  const t = v.now, { cfg, regions, patterns } = v;
  const end = (Math.floor(t / cfg.rsiLen) + 1) * cfg.rsiLen;
  const steps: PlanStep[] = [], items: Placement[] = [];
  const free: Free[] = [[t, end]];

  // Fixed tasks whose requested time falls in this RSI, most important queue first.
  const cands = v.queues.flat().filter((r) => r.req < end).sort((a, b) => a.rank - b.rank || a.req - b.req || a.id - b.id);
  steps.push({ kind: 'legacyBox', shown: 0, candidates: cands.map((r) => r.id) });
  const placedIds: number[] = [], carried: number[] = [];
  const dropped: { req: FixedRequest; reason: DropReason }[] = [];
  for (const r of cands) {
    const lo = Math.max(t, r.earliest);
    const s = nearest(free, lo, Math.min(r.latest, end - r.len), r.len, r.req);
    if (s !== null) { take(free, s, r.len); items.push({ type: 'fixed', req: r, start: s, len: r.len }); placedIds.push(r.id); continue; }
    if (r.latest >= end) { carried.push(r.id); continue; }
    // It can start neither now nor in the next RSI. Was the RSI edge the only obstacle?
    const open = free.map(([a, b]): Free => [a, b === end ? Infinity : b]);
    dropped.push({ req: r, reason: nearest(open, lo, r.latest, r.len, r.req) !== null ? 'boundary' : 'conflict' });
  }
  const nFixed = items.length;
  steps.push({ kind: 'legacyFixed', shown: nFixed, placed: placedIds, carried, dropped: dropped.map((d) => ({ id: d.req.id, reason: d.reason })) });

  // Search fills what is left, most important region first. The amount each region asks for
  // is computed exactly as in the dynamic RSI scheduler; only the order and the lack of
  // closing-up differ.
  const want = regions.map((r, i) => {
    const f = flexibleTaskDeficit(r.beams * r.beamLen, r.dft, t - patterns[i].pst, patterns[i].done);
    return f > 0 ? Math.ceil(f / r.beamLen) : 0;
  });
  const order = regions.map((_, i) => i).sort((a, b) => regions[a].priority - regions[b].priority);
  const placed = regions.map(() => 0);
  let gap = 0, spare = 0;
  for (const [a, b] of free) {
    let c = a;
    for (;;) {
      let i = order.find((k) => want[k] > 0 && c + regions[k].beamLen <= b);
      if (i === undefined && cfg.fill === 'full') i = order.find((k) => c + regions[k].beamLen <= b);
      if (i === undefined) break;
      items.push({ type: 'flex', region: i, start: c, len: regions[i].beamLen });
      c += regions[i].beamLen; placed[i]++; if (want[i] > 0) want[i]--;
    }
    if (b > c) {
      if (cfg.fill === 'full' || want.some((n) => n > 0)) {
        const cause: GapCause = b === end ? 'boundary' : 'fragment';
        items.push({ type: 'gap', start: c, len: b - c, cause }); gap += b - c;
      } else { items.push({ type: 'spare', start: c, len: b - c }); spare += b - c; }
    }
  }
  // Fixed tasks first, then the rest, so that a step-by-step view can reveal them in that order.
  const fixed = items.slice(0, nFixed), rest = items.slice(nFixed);
  steps.push({ kind: 'legacyFill', shown: items.length, placed, gap, spare });
  return { start: t, end, items: [...fixed, ...rest], returned: [], dropped, steps };
}
