// Dynamic RSI scheduler after Smouse, Liu & Sylvester (2020): one call builds one DRSI.
// Single pass, no look-ahead. Points the paper leaves open are listed in docs/assumptions.md.
import { flexibleTaskDeficit } from './ftd.ts';
import type { Box, FixedRequest, PlanStep, PlanView, Placement, Us } from './types.ts';

const byDeadline = (a: FixedRequest, b: FixedRequest): number => a.latest - b.latest || a.rank - b.rank || a.id - b.id;

/** Can all of these start inside their windows, one after another in deadline order, from `from` on? */
function inTime(from: Us, set: FixedRequest[]): boolean {
  let s = from;
  for (const h of [...set].sort(byDeadline)) {
    s = Math.max(s, h.earliest);
    if (s > h.latest) return false;
    s += h.len;
  }
  return true;
}

export function planDrsi(v: PlanView): Box {
  const t = v.now, { cfg, regions, patterns } = v;
  const items: Placement[] = [], steps: PlanStep[] = [];
  const returned: Box['returned'] = [];
  const setAside = new Set<number>();

  // ---- step 1: next fixed task (NFT). Candidates are the head of each queue, each moved as
  // late as its slack allows; a candidate that would make the DRSI too long is not eligible.
  let pool = v.queues.map((q) => q[0]).filter((r): r is FixedRequest => !!r && r.latest + r.len - t <= cfg.maxDrsi);
  let nft: FixedRequest | null = null, caseNo: 0 | 1 | 2 = 0, limit = 0;
  while (pool.length) {
    const e = [...pool].sort(byDeadline)[0];
    const higher = pool.filter((h) => h.rank < e.rank);
    const first = Math.max(t, e.earliest);
    const blocker = higher.find((h) => first + e.len > h.latest);
    if (!blocker) {
      // case 1: nothing more important is waiting behind it. case 2: it is less important
      // but can begin and end before every more important candidate must start.
      nft = e; caseNo = higher.length ? 2 : 1;
      limit = Math.min(e.latest, ...higher.map((h) => h.latest - e.len));
      break;
    }
    // case 3: it cannot run before the blocker. If it cannot follow the blocker either,
    // it goes back to the task manager; otherwise it just waits for a later DRSI.
    if (e.latest < Math.max(t, blocker.earliest) + blocker.len) returned.push({ req: e, blocker });
    setAside.add(e.id);
    pool = pool.filter((x) => x !== e);
  }
  if (nft) {
    // case 3 for the candidates the loop did not reach: less important than the NFT and
    // unable to run either before it or after it.
    for (const x of pool) {
      if (x === nft || x.rank <= nft.rank) continue;
      const before = Math.max(t, x.earliest) + x.len <= limit;
      const after = x.latest >= Math.max(t, nft.earliest) + nft.len;
      if (!before && !after) { returned.push({ req: x, blocker: nft }); setAside.add(x.id); }
    }
  }
  if (nft && cfg.protect === 'followers') {
    // Not in the paper: keep room behind the NFT for the waiting fixed tasks that would
    // otherwise lose their window, in deadline order, as long as the NFT itself still fits.
    const floor = Math.max(t, nft.earliest);
    let acc = nft.len;
    for (const x of v.queues.flat().filter((r) => r !== nft && !setAside.has(r.id)).sort(byDeadline)) {
      if (x.earliest > limit + acc) continue;
      const cand = x.latest - acc;
      if (cand < floor) continue;
      limit = Math.min(limit, cand);
      acc += x.len;
    }
  }
  let why: 'nft' | 'maxDrsi' | 'none' = 'nft';
  if (!nft) {
    // No eligible fixed task: close the DRSI with flexible tasks only, without running past
    // the latest start of anything that is waiting.
    const pending = v.queues.flat();
    limit = Math.min(t + cfg.maxDrsi, ...pending.map((r) => r.latest));
    why = pending.length ? 'maxDrsi' : 'none';
  }
  steps.push({ kind: 'select', shown: 0, nft: nft ? nft.id : null, caseNo, tentative: nft ? limit : null, limit,
    returned: returned.map((x) => ({ id: x.req.id, blocker: x.blocker.id })), why });

  // ---- step 2: flexible task deficits, computed once for this DRSI
  const ftd = regions.map((r, i) => flexibleTaskDeficit(r.beams * r.beamLen, r.dft, t - patterns[i].pst, patterns[i].done));
  const order = regions.map((_, i) => i).sort((a, b) => ftd[b] - ftd[a] || regions[a].priority - regions[b].priority);
  steps.push({ kind: 'deficit', shown: 0, ftd, order });

  // ---- step 3: fill up to the NFT, largest deficit first, no gaps between events
  let cur = t;
  const placed = regions.map(() => 0);
  const put = (i: number): void => { items.push({ type: 'flex', region: i, start: cur, len: regions[i].beamLen }); cur += regions[i].beamLen; placed[i]++; };
  for (const i of order) {
    if (ftd[i] <= 0) continue;
    for (let n = Math.ceil(ftd[i] / regions[i].beamLen); n > 0 && cur + regions[i].beamLen <= limit; n--) put(i);
  }
  const left = (i: number): number => ftd[i] - placed[i] * regions[i].beamLen;
  if (cfg.fill === 'full') {
    for (;;) {
      const fit = order.filter((i) => cur + regions[i].beamLen <= limit);
      if (!fit.length) break;
      put(fit.reduce((a, b) => (left(b) > left(a) ? b : a)));
    }
  }
  const unmet = cfg.fill === 'full' || order.some((i) => left(i) > 0);
  steps.push({ kind: 'fill', shown: items.length, placed: [...placed], flexEnd: cur });

  // ---- step 4: move the NFT sooner to close the opening, then chain adjacent fixed tasks
  let gap = 0, spare = 0;
  const idle = (to: Us): void => {
    if (to <= cur) return;
    if (unmet) { items.push({ type: 'gap', start: cur, len: to - cur, cause: 'fragment' }); gap += to - cur; }
    else { items.push({ type: 'spare', start: cur, len: to - cur }); spare += to - cur; }
    cur = to;
  };
  if (nft) {
    // If search still wanted the time, close up as far as the slack allows (the paper's rule).
    // If nothing wanted it, the opening is not a gap: run the task at its requested time.
    const start = unmet ? Math.max(cur, nft.earliest) : Math.min(limit, Math.max(cur, nft.req));
    idle(start);
    items.push({ type: 'fixed', req: nft, start: cur, len: nft.len });
    cur += nft.len;
    steps.push({ kind: 'close', shown: items.length, nft: nft.id, from: limit, to: start, gap, spare });
    const used = new Set<number>([nft.id]);
    const wide = cfg.protect === 'followers';
    for (;;) {
      // As described in the paper: the head of each queue. Extension: every waiting request.
      const free = (r: FixedRequest): boolean => !used.has(r.id) && !setAside.has(r.id);
      const heads = wide ? v.queues.flat().filter(free) : v.queues.map((q) => q.find(free)).filter((r): r is FixedRequest => !!r);
      const ok = heads.filter((r) => r.earliest <= cur && r.latest >= cur && cur + r.len - t <= cfg.maxDrsi);
      if (!ok.length) break;
      let e: FixedRequest | undefined = [...ok].sort(byDeadline)[0];
      if (wide) {
        // Extension: e may follow only if every more important waiting request that can still
        // be served now can also be served after it (checked over the whole set, not one step).
        // If not, the most urgent of those takes its turn and is checked the same way.
        while (e) {
          const rank: number = e.rank, len: Us = e.len;
          const keep: FixedRequest[] = [];
          for (const h of heads.filter((x) => x.rank < rank && x.latest >= cur).sort((x, y) => x.rank - y.rank || byDeadline(x, y))) {
            if (inTime(cur, [...keep, h])) keep.push(h);
          }
          if (inTime(cur + len, keep)) break;
          e = keep.filter((x) => ok.includes(x)).sort(byDeadline)[0];
        }
        if (!e) break;
      } else {
        const first = e;
        const hurt = heads.filter((h) => h.rank < first.rank && cur + first.len > h.latest);
        if (hurt.length) {
          const h = hurt.find((x) => ok.includes(x));
          if (!h) break;
          e = h;
        }
      }
      items.push({ type: 'fixed', req: e, start: cur, len: e.len });
      steps.push({ kind: 'chain', shown: items.length, id: e.id, at: cur });
      cur += e.len; used.add(e.id);
    }
  } else {
    if (!items.length) {
      // Nothing to do yet: wait until a pattern falls behind or the limit is reached.
      const due = Math.min(...regions.map((r, i) => patterns[i].pst + Math.ceil((patterns[i].done * r.dft) / (r.beams * r.beamLen)) + 1));
      idle(Math.max(t + 1, unmet ? limit : Math.min(limit, due)));
    }
    steps.push({ kind: 'close', shown: items.length, nft: null, from: null, to: null, gap, spare });
  }
  return { start: t, end: cur, items, returned, dropped: [], steps };
}
