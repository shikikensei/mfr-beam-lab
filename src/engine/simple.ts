// Five classic one-dwell-at-a-time schedulers, run in the same world as the dynamic RSI:
// the same requests, windows, search patterns and hit/miss draws. Each call decides one dwell
// (or one stretch of idle time). What "ready" means for them is listed in docs/assumptions.md.
import { flexibleTaskDeficit } from './ftd.ts';
import type { Box, Conventions, FixedRequest, GapCause, PlanView, Placement, Planner, Us } from './types.ts';

// searchBacklog 0: a search beam that is behind counts as having just fallen due, so its lateness is
// not carried along. This matches the dynamic RSI, whose deficit starts again with every frame, and
// it does not make these schedulers look worse than they need to (docs/assumptions.md, section 11).
export const DEFAULT_CONVENTIONS: Conventions = { searchGrace: 1, searchBacklog: 0, balanceBy: 'period' };

interface Cand {
  fixed: FixedRequest | null;
  region: number;
  len: Us;
  /** When it became ready: the requested time, or the time the next search beam fell due. */
  release: Us;
  /** When it should be finished. */
  deadline: Us;
  /** Static priority, smaller first: fixed queues, then search regions. */
  prio: number;
  /** Lateness as a fraction of its period. */
  late: number;
}
type Rule = 'fifo' | 'priority' | 'edf' | 'balance';
const KEY: Record<Rule, (c: Cand) => number> = {
  fifo: (c) => c.release,
  priority: (c) => c.prio,
  edf: (c) => c.deadline,
  balance: (c) => -c.late,
};

interface Ready { fixed: Cand[]; search: Cand[]; nextFixed: Us; nextSearch: Us; searchWants: boolean; critical: Cand | null; guard: Us }
function candidates(v: PlanView): Ready {
  const t = v.now, conv = { ...DEFAULT_CONVENTIONS, ...v.cfg.conv };
  const fixed: Cand[] = [], search: Cand[] = [];
  let nextFixed = Infinity, nextSearch = Infinity, searchWants = false, critical: Cand | null = null, guard = Infinity;
  for (const r of v.queues.flat()) {
    // An announced critical task must start exactly on time: nothing may run across it.
    if (r.kind === 'critical' && r.req > t) guard = Math.min(guard, r.req);
    // These schedulers know a requested time and a deadline; they do not run a task early.
    if (r.req > t) { nextFixed = Math.min(nextFixed, r.req); continue; }
    const c: Cand = { fixed: r, region: -1, len: r.len, release: r.req, deadline: r.latest + r.len, prio: r.rank,
      late: (t - r.req) / (conv.balanceBy === 'slack' ? Math.max(1, r.latest - r.req) : r.period) };
    if (r.kind === 'critical') critical ??= c; else fixed.push(c);
  }
  v.regions.forEach((g, i) => {
    const p = v.patterns[i], pl = g.beams * g.beamLen;
    // The next beam falls due when, at the desired pace, the pattern should have finished it
    // by the time it ends: FTD at the end of the beam >= 0. A frame then takes exactly the DFT.
    const slot = Math.round((g.beamLen * g.dft) / pl), due = p.pst + Math.ceil(((p.done + g.beamLen) * g.dft) / pl) - g.beamLen;
    const behind = flexibleTaskDeficit(pl, g.dft, t + g.beamLen - p.pst, p.done + g.beamLen) >= 0;
    if (behind) searchWants = true;
    if (!behind && v.cfg.fill !== 'full') { nextSearch = Math.min(nextSearch, Math.max(due, t + 1)); return; }
    const rel = Math.max(due, t - Math.round(conv.searchBacklog * slot));
    search.push({ fixed: null, region: i, len: g.beamLen, release: rel, deadline: rel + Math.round(conv.searchGrace * slot), prio: 100 + g.priority, late: (t - rel) / slot });
  });
  const fits = (c: Cand): boolean => t + c.len <= guard;
  return { fixed: fixed.filter(fits), search: search.filter(fits), nextFixed, nextSearch, searchWants: searchWants || fixed.length > 0, critical, guard };
}

const best = (list: Cand[], rule: Rule): Cand | null => {
  const key = KEY[rule];
  let b: Cand | null = null;
  // ties: fixed before search, then the earlier deadline, then the order of the lists
  for (const c of list) if (!b || key(c) < key(b) || (key(c) === key(b) && c.deadline < b.deadline)) b = c;
  return b;
};

function box(v: PlanView, c: Cand | null, idleTo: Us, wanted: GapCause | null): Box {
  const t = v.now;
  let item: Placement;
  if (c?.fixed) item = { type: 'fixed', req: c.fixed, start: t, len: c.len };
  else if (c) item = { type: 'flex', region: c.region, start: t, len: c.len };
  else {
    const len = Math.max(1, idleTo - t);
    item = wanted ? { type: 'gap', start: t, len, cause: wanted } : { type: 'spare', start: t, len };
  }
  return { start: t, end: t + item.len, items: [item], returned: [], dropped: [], steps: [{ kind: 'pick', shown: 1 }] };
}

const single = (rule: Rule): Planner => (v) => {
  const c = candidates(v);
  const pick = c.critical ?? best([...c.fixed, ...c.search], rule);
  // Idle time is a gap only when something was ready but could not finish before a critical task.
  return box(v, pick, Math.min(c.nextFixed, c.nextSearch, c.guard, v.now + v.cfg.maxDrsi), !pick && c.searchWants ? 'fragment' : null);
};

export const planFifo = single('fifo');
export const planPriority = single('priority');
export const planEdf = single('edf');
export const planBalance = single('balance');

/**
 * Fixed template: every cycle of rsiLen starts with a window for fixed tasks, the rest is for
 * search. Neither side may use the other's window, and a dwell must end inside its window.
 */
export const planTemplate: Planner = (v) => {
  const t = v.now, cycle = v.cfg.rsiLen, cut = Math.round(cycle * v.cfg.templateShare);
  const base = Math.floor(t / cycle) * cycle, inFixed = t - base < cut;
  const c = candidates(v);
  if (c.critical) return box(v, c.critical, 0, null);
  const end = Math.min(inFixed ? base + cut : base + cycle, c.guard);
  const mine = inFixed ? c.fixed : c.search, next = inFixed ? c.nextFixed : c.nextSearch;
  const pick = best(mine.filter((x) => t + x.len <= end), 'edf');
  if (pick) return box(v, pick, 0, null);
  // Nothing of this window's kind can run. It is a gap if anyone wanted the time.
  const otherWants = inFixed ? c.search.length > 0 : c.fixed.length > 0;
  const cause: GapCause | null = mine.length ? 'boundary' : otherWants ? 'window' : null;
  return box(v, null, mine.length ? end : Math.min(end, next), cause);
};

/**
 * Fixed priority with pulse interleaving, simplified from Han (arXiv:2409.19201): a dwell is
 * transmit, wait, receive, and another dwell may use the wait of the dwell just before it.
 * Two ways: the whole guest inside the wait, or only the guest's transmit inside the wait with
 * its receive after the host's receive. One guest per host. No transmitter energy limit.
 * With no waits anywhere this is exactly planPriority.
 */
export const planInterleave: Planner = (v) => {
  const t = v.now, c = candidates(v);
  const all = [...c.fixed, ...c.search];
  const host = c.critical ?? best(all, 'priority');
  const idleTo = Math.min(c.nextFixed, c.nextSearch, c.guard, t + v.cfg.maxDrsi);
  if (!host) return box(v, null, idleTo, c.searchWants ? 'fragment' : null);
  const b = box(v, host, 0, null);
  const seg = host.fixed?.seg, wait = seg?.wait ?? 0;
  const steps: Box['steps'] = [{ kind: 'ilPick', shown: 1, id: host.fixed?.id ?? null, region: host.fixed ? null : host.region }];
  let mode: 'whole' | 'tx' | 'none' = 'none', saved = 0, guest: Cand | null = null, end = t + host.len;
  if (seg && wait > 0) {
    const txEnd = t + seg.tx, rxStart = t + host.len - seg.rx, hostEnd = t + host.len;
    // candidates in priority order; the first one that fits either way is the guest
    for (const g of all.filter((x) => x !== host).sort((a, z) => a.prio - z.prio || a.deadline - z.deadline)) {
      const gs = g.fixed?.seg ?? { tx: g.len, wait: 0, rx: 0 };
      let start = -1, gain = 0;
      if (g.len <= wait) { start = txEnd; gain = g.len; mode = 'whole'; }
      else if (gs.wait > 0) {
        const s = Math.max(txEnd, hostEnd - gs.tx - gs.wait); // its receive must not begin before the host's has ended
        if (s + gs.tx <= rxStart) { start = s; gain = hostEnd - s; mode = 'tx'; }
      }
      if (start < 0) continue;
      if ((g.fixed && start > g.fixed.latest) || start + g.len > c.guard) { mode = 'none'; continue; }
      guest = g; saved = gain; end = Math.max(hostEnd, start + g.len);
      b.items.push(g.fixed ? { type: 'fixed', req: g.fixed, start, len: g.len, saved } : { type: 'flex', region: g.region, start, len: g.len, saved });
      break;
    }
    if (!guest) mode = 'none';
  }
  steps.push({ kind: 'ilCheck', shown: 1, wait, guestId: guest?.fixed?.id ?? null, guestRegion: guest && !guest.fixed ? guest.region : null, mode, saved });
  steps.push({ kind: 'ilPlace', shown: b.items.length, end });
  return { ...b, end, steps };
};
