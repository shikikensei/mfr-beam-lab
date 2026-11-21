// Sequential scheduler with two-slope benefit functions, after Moo (DRDC Ottawa TM 2010-259).
// IMPORTANT: written from a second-hand summary of the report (refs/moo-tsbf-notes.md); the
// original has not been checked. Per window: (1) track looks are selected and given start
// times that maximise the total benefit, (2) the openings left are filled with search looks.
// The report solves (1) with the simplex method; here the same optimum is found by dynamic
// programming. What this tool added or changed is listed in docs/assumptions.md, section 14.
import { flexibleTaskDeficit } from './ftd.ts';
import type { Box, DropReason, FixedRequest, GapCause, PlanView, Placement, Planner, Us } from './types.ts';

/** One track look: earliest/latest start, desired start, length, peak benefit and the two slopes. */
export interface TsbfTask { s: Us; u: Us; want: Us; len: Us; peak: number; early: number; late: number }

/** Peak at the desired start, falling linearly on both sides. */
export const benefit = (k: TsbfTask, t: Us): number => k.peak + (t <= k.want ? k.early * (t - k.want) : -k.late * (t - k.want));

/** Can all of these run in the given order (desired start order), each inside [s, u]? */
export function viable(tasks: TsbfTask[]): boolean {
  let free = -Infinity;
  for (const k of tasks) {
    const t = Math.max(k.s, free); // conditional earliest start
    if (t > k.u) return false;
    free = t + k.len;
  }
  return true;
}

/**
 * Overload: take the looks in order of peak benefit and keep each one that leaves the set
 * viable. `tasks` are in desired start order; the result says which ones stay.
 */
export function select(tasks: TsbfTask[]): boolean[] {
  const keep = tasks.map(() => false);
  const order = tasks.map((_, i) => i).sort((a, b) => tasks[b].peak - tasks[a].peak || tasks[a].want - tasks[b].want || a - b);
  for (const i of order) {
    keep[i] = true;
    if (!viable(tasks.filter((_, k) => keep[k]))) keep[i] = false;
  }
  return keep;
}

/**
 * Start times that maximise the sum of benefits, for a viable set in desired start order,
 * with no overlap and no reordering. With x_n = t_n - (sum of the lengths before n) the
 * constraint is x_1 <= x_2 <= ... and each benefit is concave and piecewise linear in x_n, so
 * an optimum exists in which every x_n is one of the bounds or desired starts (shifted the
 * same way). The dynamic programme runs over those values only, and is exact.
 */
export function assign(tasks: TsbfTask[]): Us[] {
  const N = tasks.length;
  if (!N) return [];
  const off: Us[] = [];
  let acc = 0;
  for (const k of tasks) { off.push(acc); acc += k.len; }
  const C = [...new Set(tasks.flatMap((k, n) => [k.s - off[n], k.u - off[n], k.want - off[n]]))].sort((a, b) => a - b);
  const M = C.length;
  let prev = new Array<number>(M).fill(0);
  const from: Int32Array[] = [];
  for (let n = 0; n < N; n++) {
    const k = tasks[n], cur = new Array<number>(M).fill(-Infinity), arg = new Int32Array(M).fill(-1);
    let best = -Infinity, bestAt = -1;
    for (let c = 0; c < M; c++) {
      if (prev[c] > best) { best = prev[c]; bestAt = c; } // earliest position among equals
      const t = C[c] + off[n];
      if (t < k.s || t > k.u || best === -Infinity) continue;
      cur[c] = best + benefit(k, t); arg[c] = bestAt;
    }
    from.push(arg); prev = cur;
  }
  let c = 0;
  for (let i = 1; i < M; i++) if (prev[i] > prev[c]) c = i;
  if (prev[c] === -Infinity) throw new Error('assign() needs a viable set');
  const out = new Array<Us>(N);
  for (let n = N - 1; n >= 0; n--) { out[n] = C[c] + off[n]; c = from[n][c]; }
  return out;
}

/** Peak benefit by queue rank (critical, confirm, retry, trackHigh, track). This tool's values. */
export const TSBF_PEAK = [1000, 400, 300, 200, 100];
/** The same slope on both sides for every look, as in the report's examples. This tool's value. */
export const TSBF_SLOPE = 1;

export const planTsbf: Planner = (v: PlanView): Box => {
  const t = v.now, W = v.cfg.tsbfWindow, end = (Math.floor(t / W) + 1) * W;
  const items: Placement[] = [], dropped: { req: FixedRequest; reason: DropReason }[] = [];
  // Looks whose desired start lies in this window (or was carried over), in desired start order.
  const reqs = v.queues.flat().filter((r) => r.req < end).sort((a, b) => a.req - b.req || a.id - b.id);
  const task = (r: FixedRequest): TsbfTask =>
    ({ s: Math.max(t, r.earliest), u: Math.min(r.latest, end - r.len), want: r.req, len: r.len, peak: TSBF_PEAK[r.rank], early: TSBF_SLOPE, late: TSBF_SLOPE });
  const fits = reqs.map(task).map((k) => k.s <= k.u);
  const cands = reqs.filter((_, i) => fits[i]), tasks = cands.map(task);
  const keep = select(tasks);
  const chosen = cands.filter((_, i) => keep[i]), starts = assign(tasks.filter((_, i) => keep[i]));
  chosen.forEach((r, i) => items.push({ type: 'fixed', req: r, start: starts[i], len: r.len }));
  // Not in the report: a look that is left out waits for the next window if its own window
  // reaches that far; otherwise it is dropped now (the window edge or a better look took its place).
  const placed = new Set(chosen.map((r) => r.id));
  for (const r of reqs) {
    if (placed.has(r.id) || r.latest >= end) continue;
    dropped.push({ req: r, reason: r.latest > end - r.len ? 'boundary' : 'conflict' });
  }
  const fate = new Map(dropped.map((d) => [d.req.id, d.reason]));
  const steps: Box['steps'] = [
    { kind: 'tsbfCollect', shown: 0, end, cands: reqs.map((r) => r.id) },
    { kind: 'tsbfSelect', shown: 0, kept: chosen.map((r) => r.id), out: reqs.filter((r) => !placed.has(r.id)).map((r) => ({ id: r.id, fate: fate.get(r.id) ?? 'carry' })) },
    { kind: 'tsbfAssign', shown: chosen.length, starts: chosen.map((r, i) => ({ id: r.id, start: starts[i] })) },
  ];
  {
  }

  // Search fills the openings. Each region has one pending look; e = time since its last look.
  // Regions whose e has reached their threshold w come first (smaller w first, then larger e),
  // the others follow by larger e. The first one in that order that fits is placed.
  // Two separate roles. WHICH region goes first is the summary's rule above. WHETHER a region may
  // be served is the tool's common setting: "full" serves anything that fits (as the summary says);
  // "pace" serves only regions that are behind their desired pace, measured with the same yardstick
  // as every other scheduler (the flexible task deficit at the end of the beam). The pace test is
  // this tool's mapping, not the report's.
  const w = v.regions.map((g) => g.dft / g.beams), last = v.patterns.map((p) => p.last);
  const pat = v.patterns.map((p) => ({ ...p })), pl = v.regions.map((g) => g.beams * g.beamLen);
  const pace = v.cfg.fill === 'pace';
  const behind = (k: number, at: Us): boolean => flexibleTaskDeficit(pl[k], v.regions[k].dft, at + v.regions[k].beamLen - pat[k].pst, pat[k].done + v.regions[k].beamLen) >= 0;
  const dueAt = (k: number): Us => pat[k].pst + Math.ceil(((pat[k].done + v.regions[k].beamLen) * v.regions[k].dft) / pl[k]) - v.regions[k].beamLen;
  let c = t;
  const fill = (to: Us): void => {
    let wanted = !pace;
    while (c < to) {
      const e = last.map((x) => c - x);
      const order = v.regions.map((_, i) => i).sort((a, b) => {
        const oa = e[a] >= w[a], ob = e[b] >= w[b];
        if (oa !== ob) return oa ? -1 : 1;
        return (oa ? w[a] - w[b] : 0) || e[b] - e[a] || a - b;
      });
      const due = pace ? order.filter((k) => behind(k, c)) : order;
      const i = due.find((k) => c + v.regions[k].beamLen <= to);
      if (i === undefined) {
        if (due.length) { wanted = true; break; } // something is wanted but too long for what is left
        // every region is at its pace: idle until the first one falls behind, then look again
        const next = Math.min(to, ...v.regions.map((_, k) => dueAt(k)));
        if (next <= c) break;
        items.push({ type: 'spare', start: c, len: next - c }); c = next;
        continue;
      }
      const g = v.regions[i];
      items.push({ type: 'flex', region: i, start: c, len: g.beamLen });
      last[i] = c; c += g.beamLen;
      pat[i].done += g.beamLen;
      if (++pat[i].idx === g.beams) { pat[i].pst = c; pat[i].done = 0; pat[i].idx = 0; }
    }
    if (c < to) {
      const cause: GapCause = to === end ? 'boundary' : 'fragment';
      items.push(wanted ? { type: 'gap', start: c, len: to - c, cause } : { type: 'spare', start: c, len: to - c });
      c = to;
    }
  };
  const nFixed = items.length;
  for (let i = 0; i < nFixed; i++) { const p = items[i]; fill(p.start); c = p.start + p.len; }
  fill(end);
  const sum = (type: 'gap' | 'spare'): Us => items.reduce((a, x) => a + (x.type === type ? x.len : 0), 0);
  steps.push({ kind: 'tsbfFill', shown: items.length, placed: v.regions.map((_, i) => items.filter((x) => x.type === 'flex' && x.region === i).length), gap: sum('gap'), spare: sum('spare') });
  return { start: t, end, items, returned: [], dropped, steps };
};
