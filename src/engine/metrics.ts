import type { DropReason, FixedKind, GapCause, RequestRecord, SimResult, Us } from './types.ts';

export interface Summary {
  total: Us;
  /** Share of time by use. They add up to 1. */
  share: { search: number; fixed: number; gap: number; spare: number };
  /** Time used by two dwells at once (pulse interleaving), as a share of the timeline. The four shares add up to 1 + overlap. */
  overlap: number;
  /** Share of the timeline spent transmitting: the transmit segment of a dwell with a wait, half of any other dwell. */
  txShare: number;
  /** Paper's scheduler efficiency: (total time - gaps) / total time. */
  efficiency: number;
  gapByCause: Record<GapCause, Us>;
  /** Per region: mean frame time, desired frame time, and executed search time over wanted. */
  regions: { name: string; frames: number; meanFrame: Us | null; dft: Us; served: number }[];
  /** upper*: every queue above the ordinary track update (critical, confirm, retry, trackHigh). */
  fixed: { requested: number; done: number; dropped: number; upperRequested: number; upperDropped: number; byReason: Record<DropReason, number>; byKind: Partial<Record<FixedKind, number>> };
  /** Mean |start - requested time| of executed track updates, as a fraction of the slack. */
  meanShift: number;
  lost: number;
  trackedShare: number;
}

export function summarize(r: SimResult): Summary {
  const total = r.end;
  let search = 0, fixed = 0, gap = 0, spare = 0, overlap = 0, tx = 0;
  const gapByCause: Record<GapCause, Us> = { fragment: 0, boundary: 0, window: 0 };
  const perRegion = r.scenario.regions.map(() => 0);
  for (const x of r.timeline) {
    overlap += x.saved ?? 0;
    if (x.type === 'flex') { search += x.len; perRegion[x.region] += x.len; tx += x.len - Math.floor(x.len / 2); }
    else if (x.type === 'fixed') { fixed += x.len; tx += r.requests[x.reqId].seg.tx; }
    else if (x.type === 'gap') { gap += x.len; gapByCause[x.cause] += x.len; }
    else spare += x.len;
  }
  const byReason: Record<DropReason, number> = { timeout: 0, conflict: 0, boundary: 0 };
  const byKind: Partial<Record<FixedKind, number>> = {};
  let done = 0, dropped = 0, shift = 0, nShift = 0, upperRequested = 0, upperDropped = 0;
  for (const q of r.requests) {
    if (q.kind !== 'track') { upperRequested++; if (q.status === 'dropped') upperDropped++; }
    if (q.status === 'done') {
      done++;
      if (q.kind !== 'critical' && q.kind !== 'confirm' && q.kind !== 'retry' && q.latest > q.req) { shift += Math.abs(q.start! - q.req) / (q.latest - q.req); nShift++; }
    } else if (q.status === 'dropped') { dropped++; byReason[q.dropReason!]++; byKind[q.kind] = (byKind[q.kind] ?? 0) + 1; }
  }
  // Time each target spent in track, from its 'track' mark to the next 'lost' mark.
  let tracked = 0, lost = 0;
  const since = new Map<number, Us>();
  for (const m of r.marks) {
    if (m.kind === 'track') since.set(m.target, m.t);
    if (m.kind === 'lost') { lost++; const s = since.get(m.target); if (s !== undefined) { tracked += m.t - s; since.delete(m.target); } }
  }
  for (const s of since.values()) tracked += total - s;
  const n = r.scenario.targets.length;
  return {
    total,
    share: { search: search / total, fixed: fixed / total, gap: gap / total, spare: spare / total },
    overlap: overlap / total, txShare: tx / total,
    efficiency: (total - gap) / total,
    gapByCause,
    regions: r.scenario.regions.map((g, i) => {
      const f = r.frames[i];
      return { name: g.name, frames: f.length, meanFrame: f.length ? f.reduce((a, b) => a + b[1], 0) / f.length : null, dft: g.dft,
        served: perRegion[i] / ((total * g.beams * g.beamLen) / g.dft) };
    }),
    fixed: { requested: r.requests.length, done, dropped, upperRequested, upperDropped, byReason, byKind },
    meanShift: nShift ? shift / nShift : 0,
    lost,
    trackedShare: n ? tracked / (total * n) : 0,
  };
}

/** Structural invariants every run must satisfy. Returns a list of violations (empty = fine). */
export function validate(r: SimResult): string[] {
  const bad: string[] = [];
  const tl = [...r.timeline].sort((a, b) => a.start - b.start);
  // Every moment is covered, and only an interleaved dwell (`saved`) may share time with another.
  let t = 0;
  for (const x of tl) {
    if (x.len <= 0) bad.push(`empty interval at ${x.start}`);
    if (x.start < t && !x.saved) bad.push(`overlap at ${x.start}`);
    if (x.start > t) bad.push(`unaccounted time ${t}..${x.start}`);
    if (x.saved && x.saved !== Math.min(t, x.start + x.len) - x.start) bad.push(`interleaved dwell at ${x.start} claims ${x.saved} shared, has ${Math.min(t, x.start + x.len) - x.start}`);
    t = Math.max(t, x.start + x.len);
  }
  if (t !== r.end) bad.push(`timeline ends at ${t}, run at ${r.end}`);
  // The beam itself is never used twice: transmit and receive segments do not overlap anything.
  const busy: [Us, Us][] = [];
  for (const x of tl) {
    if (x.type === 'gap' || x.type === 'spare') continue;
    const g = x.type === 'fixed' ? r.requests[x.reqId].seg : null;
    if (g && g.wait > 0) busy.push([x.start, x.start + g.tx], [x.start + x.len - g.rx, x.start + x.len]);
    else busy.push([x.start, x.start + x.len]);
  }
  busy.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < busy.length; i++) if (busy[i][0] < busy[i - 1][1]) bad.push(`transmit/receive overlap at ${busy[i][0]}`);
  const seen = new Set<number>();
  for (const x of tl) {
    if (x.type !== 'fixed') continue;
    const q = r.requests[x.reqId];
    if (seen.has(q.id)) bad.push(`request ${q.id} executed twice`);
    seen.add(q.id);
    if (q.status !== 'done') bad.push(`request ${q.id} executed but ${q.status}`);
    if (x.start < q.earliest || x.start > q.latest) bad.push(`request ${q.id} outside its window`);
    if (x.start < q.createdAt) bad.push(`request ${q.id} executed before it existed`);
    if (x.len !== q.seg.tx + q.seg.wait + q.seg.rx) bad.push(`request ${q.id} segments do not add up`);
  }
  for (const q of r.requests) {
    if (q.status === 'done' && !seen.has(q.id)) bad.push(`request ${q.id} done but not on the timeline`);
    if (q.status === 'pending' && q.latest < r.end) bad.push(`request ${q.id} left pending past its window`);
    if (q.status === 'dropped' && q.dropReason === null) bad.push(`request ${q.id} dropped without a reason`);
  }
  return bad;
}

/**
 * Dropped requests that more important fixed tasks do NOT explain: counting only executed
 * fixed tasks of strictly higher priority as obstacles, the request still had room in its window.
 */
export function unexplainedDrops(r: SimResult): RequestRecord[] {
  const fixed = r.timeline.filter((x) => x.type === 'fixed');
  return r.requests.filter((q) => {
    if (q.status !== 'dropped') return false;
    const lo = Math.max(q.earliest, q.createdAt), hi = q.latest;
    if (lo > hi) return false;
    const obstacles = fixed.filter((x) => x.type === 'fixed' && r.requests[x.reqId].rank < q.rank && x.start < hi + q.len && x.start + x.len > lo)
      .sort((a, b) => a.start - b.start);
    let s = lo;
    for (const o of obstacles) { if (s + q.len <= o.start) break; s = Math.max(s, o.start + o.len); }
    return s <= hi;
  });
}

/**
 * Dropped requests that lost their place to a LESS important fixed task placed while they were
 * already waiting: with those tasks on the timeline the request has no room in its window,
 * without them it has. Search dwells never count as obstacles (fixed tasks always outrank them).
 */
export function displacedByLower(r: SimResult): RequestRecord[] {
  const fixed = r.timeline.filter((x) => x.type === 'fixed').sort((a, b) => a.start - b.start);
  const fits = (lo: Us, hi: Us, len: Us, obstacles: typeof fixed): boolean => {
    let s = lo;
    for (const o of obstacles) { if (s + len <= o.start) break; s = Math.max(s, o.start + o.len); }
    return s <= hi;
  };
  return r.requests.filter((q) => {
    if (q.status !== 'dropped') return false;
    const lo = Math.max(q.earliest, q.createdAt), hi = q.latest;
    if (lo > hi) return false;
    const near = fixed.filter((x) => x.start < hi + q.len && x.start + x.len > lo);
    const later = (x: (typeof fixed)[number]): boolean =>
      x.type === 'fixed' && r.requests[x.reqId].rank > q.rank && r.boxes[x.box].start >= q.createdAt;
    return !fits(lo, hi, q.len, near) && fits(lo, hi, q.len, near.filter((x) => !later(x)));
  });
}

/** Share of each second by use: search, track updates, confirm + retry + critical, gap. The rest was spare. */
export function perSecond(r: SimResult): { search: number[]; track: number[]; aux: number[]; gap: number[] } {
  const n = Math.ceil(r.scenario.duration / 1e6), mk = (): number[] => Array.from({ length: n }, () => 0);
  const out = { search: mk(), track: mk(), aux: mk(), gap: mk() };
  for (const x of r.timeline) {
    if (x.type === 'spare') continue;
    const row = x.type === 'flex' ? out.search : x.type === 'gap' ? out.gap : x.kind === 'track' || x.kind === 'trackHigh' ? out.track : out.aux;
    for (let a = x.start, e = x.start + x.len; a < e;) {
      const k = Math.floor(a / 1e6), nx = Math.min(e, (k + 1) * 1e6);
      if (k < n) row[k] += (nx - a) / 1e6;
      a = nx;
    }
  }
  return out;
}
