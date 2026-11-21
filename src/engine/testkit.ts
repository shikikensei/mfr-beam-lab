import { DEFAULT_CONFIG } from './scenario.ts';
import { ms, QUEUES, rankOf } from './types.ts';
import type { Box, FixedKind, FixedRequest, PatternState, PlanView, SearchRegion, SimConfig } from './types.ts';

let nextId = 0;
/** A fixed request with times in milliseconds. */
export function fx(kind: FixedKind, req: number, lead: number, trail: number, len: number): FixedRequest {
  const l = ms(len), half = Math.floor(l / 2);
  return { id: nextId++, kind, target: 0, req: ms(req), earliest: ms(req - lead), latest: ms(req + trail), len: l,
    seg: { tx: l - half, wait: 0, rx: half }, rank: rankOf(kind), period: ms(Math.max(1, lead + trail)), createdAt: 0, returns: 0, interrupts: 0 };
}
export const region = (name: string, beams: number, beamLen: number, dft: number, priority: number): SearchRegion =>
  ({ name, beams, beamLen: ms(beamLen), dft: ms(dft), priority });

export function view(now: number, reqs: FixedRequest[], regions: SearchRegion[], cfg: Partial<SimConfig> = {}, patterns?: PatternState[]): PlanView {
  const queues: FixedRequest[][] = QUEUES.map(() => []);
  for (const r of reqs) queues[r.rank].push(r);
  for (const q of queues) q.sort((a, b) => a.latest - b.latest || a.id - b.id);
  return { now: ms(now), queues, regions, patterns: patterns ?? regions.map(() => ({ pst: 0, done: 0, idx: 0 })), cfg: { ...DEFAULT_CONFIG, ...cfg } };
}
/** Start time in ms of a fixed request inside a box, or null if it was not placed. */
export function startOf(box: Box, r: FixedRequest): number | null {
  const p = box.items.find((x) => x.type === 'fixed' && x.req.id === r.id);
  return p ? p.start / 1000 : null;
}
export const flexCount = (box: Box, i?: number): number => box.items.filter((x) => x.type === 'flex' && (i === undefined || x.region === i)).length;
export const idle = (box: Box, type: 'gap' | 'spare'): number => box.items.filter((x) => x.type === type).reduce((a, x) => a + x.len, 0) / 1000;
/** Items must tile [start, end) with no overlap and no hole. */
export function tiles(box: Box): boolean {
  let t = box.start;
  for (const x of [...box.items].sort((a, b) => a.start - b.start)) { if (x.start !== t || x.len <= 0) return false; t += x.len; }
  return t === box.end;
}
