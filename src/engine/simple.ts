// Five classic one-dwell-at-a-time schedulers, run in the same world as the dynamic RSI:
// the same requests, windows, search patterns and hit/miss draws. Each call decides one dwell
// (or one stretch of idle time). What "ready" means for them is listed in docs/assumptions.md.
import { flexibleTaskDeficit } from './ftd.ts';
import type { Box, FixedRequest, GapCause, PlanView, Placement, Planner, Us } from './types.ts';

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
  const t = v.now;
  const fixed: Cand[] = [], search: Cand[] = [];
  let nextFixed = Infinity, nextSearch = Infinity, searchWants = false, critical: Cand | null = null, guard = Infinity;
  for (const r of v.queues.flat()) {
    // An announced critical task must start exactly on time: nothing may run across it.
    if (r.kind === 'critical' && r.req > t) guard = Math.min(guard, r.req);
    // These schedulers know a requested time and a deadline; they do not run a task early.
    if (r.req > t) { nextFixed = Math.min(nextFixed, r.req); continue; }
    const c: Cand = { fixed: r, region: -1, len: r.len, release: r.req, deadline: r.latest + r.len, prio: r.rank, late: (t - r.req) / r.period };
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
    search.push({ fixed: null, region: i, len: g.beamLen, release: due, deadline: due + slot, prio: 100 + g.priority, late: (t - due) / slot });
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
