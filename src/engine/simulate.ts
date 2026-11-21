// The world and the executor, shared by every scheduler: targets, requests, hit/miss draws,
// pattern progress, interrupts and the record of what happened. Schedulers only plan boxes.
import { planDrsi } from './drsi.ts';
import { planLegacy } from './legacy.ts';
import { planTsbf } from './tsbf.ts';
import { planBalance, planEdf, planFifo, planInterleave, planPriority, planTemplate } from './simple.ts';
import { draw } from './rand.ts';
import { QUEUES, rankOf } from './types.ts';
import type {
  BoxRecord, DropReason, FixedKind, FixedRequest, Interval, Mark, PatternState, Placement, Planner,
  RequestRecord, Scenario, SchedulerId, SimConfig, SimResult, Us,
} from './types.ts';

export const PLANNERS: Record<SchedulerId, Planner> = { drsi: planDrsi, legacy: planLegacy, fifo: planFifo, template: planTemplate, priority: planPriority, edf: planEdf, balance: planBalance, tsbf: planTsbf, interleave: planInterleave };

/** Transmit and receive lengths of a far target's dwell (didactic scale). */
export const TX = 2000, RX = 2000;

type TState = 'undetected' | 'confirming' | 'tracked' | 'gone';

export function simulate(sc: Scenario, cfg: SimConfig): SimResult {
  const P = sc.params, plan = PLANNERS[cfg.scheduler];
  const targets = sc.targets.map((spec) => ({ spec, state: 'undetected' as TState, miss: 0, looks: 0, dwells: 0 }));
  const patterns: PatternState[] = sc.regions.map(() => ({ pst: 0, done: 0, idx: 0, last: 0 }));
  const frames: [Us, Us][][] = sc.regions.map(() => []);
  const requests: RequestRecord[] = [], timeline: Interval[] = [], marks: Mark[] = [], boxes: BoxRecord[] = [];
  const pending = new Set<RequestRecord>();
  let gs = 0, nextCritical = 0;

  function addRequest(kind: FixedKind, target: number, req: Us, lead: Us, trail: Us, len: Us, at: Us, period: Us, scripted = false): void {
    const half = Math.floor(len / 2);
    // A far target's track dwell: transmit, wait for the echo, receive. Everything else has no wait.
    const far = target >= 0 && !!targets[target].spec.far && (kind === 'track' || kind === 'trackHigh' || kind === 'retry') && !scripted && len >= TX + RX + 2000;
    const r: RequestRecord = {
      id: requests.length, kind, target, req, earliest: req - lead, latest: req + trail, len,
      seg: far ? { tx: TX, wait: len - TX - RX, rx: RX } : { tx: len - half, wait: 0, rx: half }, rank: rankOf(kind), period, ...(scripted ? { scripted } : {}), createdAt: at, returns: 0, interrupts: 0,
      status: 'pending', start: null, hit: null, dropReason: null, resolvedAt: null, createdGs: gs, resolvedGs: null,
    };
    requests.push(r); pending.add(r);
  }
  function trackRequest(i: number, from: Us, at: Us): void {
    const s = targets[i].spec, interval = s.interval ?? (s.high ? P.intervalHigh : P.intervalNormal), slack = Math.round(interval * P.slackFrac);
    addRequest(s.high ? 'trackHigh' : 'track', i, from + interval, slack, slack, s.dwell, at, interval);
  }
  const mark = (t: Us, target: number, kind: Mark['kind']): void => { marks.push({ t, target, kind, gs }); };
  const present = (i: number, t: Us): boolean => { const s = targets[i].spec; return t >= s.appear && (s.disappear === null || t < s.disappear); };

  /** A track update or retry failed or was never run. */
  function onMiss(i: number, at: Us): void {
    const tg = targets[i];
    if (++tg.miss >= P.missLimit) { tg.state = 'undetected'; tg.miss = 0; mark(at, i, 'lost'); return; }
    addRequest('retry', i, at + P.retryDelay, P.retryLead, P.retryTrail, tg.spec.dwell, at, P.retryDelay);
  }
  function resolve(r: RequestRecord, status: RequestRecord['status'], at: Us): void {
    r.status = status; r.resolvedAt = at; r.resolvedGs = gs; pending.delete(r);
  }
  function drop(r: RequestRecord, reason: DropReason, at: Us): void {
    resolve(r, 'dropped', at); r.dropReason = reason;
    if (r.scripted || r.kind === 'critical' || targets[r.target].state === 'gone') return;
    if (r.kind === 'confirm') { targets[r.target].state = 'undetected'; mark(at, r.target, 'unconfirmed'); }
    else onMiss(r.target, at);
  }

  function housekeeping(t: Us): void {
    while (nextCritical < sc.criticals.length && sc.criticals[nextCritical].at - sc.criticals[nextCritical].notice <= t) {
      const c = sc.criticals[nextCritical++];
      addRequest('critical', -1, c.at, 0, 0, c.len, t, 1);
    }
    targets.forEach((tg, i) => {
      if (tg.state === 'gone' || tg.spec.disappear === null || t < tg.spec.disappear) return;
      if (tg.state === 'tracked') mark(t, i, 'lost');
      tg.state = 'gone';
      for (const r of [...pending]) if (r.target === i) resolve(r, 'cancelled', t);
    });
    for (const r of [...pending]) if (r.latest < t) drop(r, r.returns > 0 ? 'conflict' : 'timeout', t);
  }

  function runFlex(p: Extract<Placement, { type: 'flex' }>, box: number): void {
    const reg = sc.regions[p.region], pat = patterns[p.region], end = p.start + p.len;
    timeline.push({ type: 'flex', region: p.region, start: p.start, len: p.len, box, gs, ...(p.saved ? { saved: p.saved } : {}) });
    targets.forEach((tg, i) => {
      if (tg.state !== 'undetected' || tg.spec.region !== p.region || tg.spec.beam !== pat.idx || !present(i, p.start)) return;
      if (draw(sc.seed, 1, i, tg.looks++) >= P.pdSearch) return;
      tg.state = 'confirming'; mark(end, i, 'detect');
      addRequest('confirm', i, end + P.confirmDelay, P.confirmLead, P.confirmTrail, P.confirmLen, end, P.confirmDelay);
    });
    pat.done += p.len; pat.last = p.start;
    if (++pat.idx === reg.beams) { frames[p.region].push([end, end - pat.pst]); pat.pst = end; pat.done = 0; pat.idx = 0; }
  }
  function runFixed(p: Extract<Placement, { type: 'fixed' }>, box: number): void {
    const r = requests[p.req.id], end = p.start + p.len;
    resolve(r, 'done', end); r.start = p.start;
    if (r.kind === 'critical' || r.scripted) { r.hit = true; timeline.push({ type: 'fixed', reqId: r.id, kind: r.kind, target: r.target, hit: true, start: p.start, len: p.len, box, gs }); return; }
    const tg = targets[r.target];
    const hit = present(r.target, p.start) && draw(sc.seed, 2, r.target, tg.dwells++) < (r.kind === 'confirm' ? P.pdConfirm : P.pdTrack);
    r.hit = hit;
    timeline.push({ type: 'fixed', reqId: r.id, kind: r.kind, target: r.target, hit, start: p.start, len: p.len, box, gs, ...(p.saved ? { saved: p.saved } : {}) });
    if (tg.state === 'gone' || !present(r.target, end)) return;
    if (hit) {
      if (r.kind === 'confirm') { tg.state = 'tracked'; mark(end, r.target, 'track'); }
      tg.miss = 0; trackRequest(r.target, p.start, end);
    } else if (r.kind === 'confirm') { tg.state = 'undetected'; mark(end, r.target, 'unconfirmed'); }
    else onMiss(r.target, end);
  }

  for (const s of sc.scripted ?? []) addRequest(s.kind, s.target, s.req, s.lead, s.trail, s.len, 0, Math.max(1, s.lead + s.trail), true);
  let t = 0;
  while (t < sc.duration) {
    housekeeping(t);
    const queues: FixedRequest[][] = QUEUES.map(() => []);
    for (const r of pending) queues[r.rank].push(r);
    for (const q of queues) q.sort((a, b) => a.latest - b.latest || a.id - b.id);
    const box = plan({ now: t, queues, regions: sc.regions, patterns: patterns.map((p) => ({ ...p })), cfg });
    if (!(box.end > t)) throw new Error(`scheduler made no progress at ${t}`);
    const index = boxes.length, gsBase = gs;
    const rec: BoxRecord = { start: t, end: box.end, steps: box.steps, gsBase, interrupted: false };
    boxes.push(rec);
    const stepOf = box.items.map((_, k) => box.steps.findIndex((s) => s.shown > k));

    // A critical task announced while this box runs cuts it short: what has started finishes,
    // the rest goes back to the queues, and the next box is planned around the critical task.
    const c = sc.criticals[nextCritical];
    const cut = c && c.at - c.notice < box.end ? Math.max(t, c.at - c.notice) : Infinity;
    const run = box.items.map((p, k) => ({ p, k })).sort((a, b) => a.p.start - b.p.start);
    let end = t;
    const removed: number[] = [];
    for (const { p, k } of run) {
      if (p.start >= cut) { if (p.type === 'fixed') { requests[p.req.id].interrupts++; removed.push(p.req.id); } continue; }
      gs = gsBase + stepOf[k];
      if (p.type === 'flex') runFlex(p, index);
      else if (p.type === 'fixed') runFixed(p, index);
      else {
        const len = Math.min(p.len, cut - p.start);
        timeline.push(p.type === 'gap' ? { type: 'gap', cause: p.cause, start: p.start, len, box: index, gs } : { type: 'spare', start: p.start, len, box: index, gs });
        end = Math.max(end, p.start + len); continue;
      }
      end = Math.max(end, p.start + p.len);
    }
    gs = gsBase + box.steps.length;
    if (cut < box.end) { rec.interrupted = true; rec.end = end; rec.steps = [...box.steps, { kind: 'interrupt', shown: box.items.length, at: cut, removed }]; gs++; }
    else {
      for (const x of box.returned) requests[x.req.id].returns++;
      for (const d of box.dropped) drop(requests[d.req.id], d.reason, box.end);
    }
    t = Math.max(end, t + 1);
  }
  housekeeping(t);
  return { scenario: sc, config: cfg, end: t, timeline, requests, marks, frames, boxes, steps: gs };
}
