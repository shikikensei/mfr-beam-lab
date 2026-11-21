// Resource allocation in the style of Q-RAM: decide HOW MUCH each task asks for, before any
// scheduler decides WHEN. One resource (share of the timeline). Each task has a few candidate
// settings; each setting costs resource and yields utility.
// Sources: only the outline of the method, as described in two papers that apply it to radar
// (Durst & Brueggenwirth, arXiv:2010.10210; Mueller et al., arXiv:2303.01872): turn the settings
// into (resource, utility) points, keep the upper concave hull, then upgrade the task with the
// largest utility gain per unit of resource until the limit is reached. The original Q-RAM
// papers (Rajkumar et al. 1997; Ghosh et al. 2006) have NOT been read. The quality and utility
// functions below are this tool's own, made up for explanation.
import { ms } from './types.ts';
import type { Scenario, Us } from './types.ts';

export interface Setpoint { r: number; u: number; label: string; interval?: Us; dwell?: Us; dft?: Us }
export interface QTask { id: string; group: string; target?: number; region?: number; points: Setpoint[] }

/** Upper concave hull from the cheapest setting upward: the settings worth upgrading through. */
export function hull(points: Setpoint[]): Setpoint[] {
  const s = [...points].sort((a, b) => a.r - b.r || b.u - a.u);
  const out: Setpoint[] = [];
  for (const p of s) {
    if (out.length && p.u <= out[out.length - 1].u) continue; // costs more, gives no more
    if (out.length && p.r === out[out.length - 1].r) continue;
    while (out.length >= 2) {
      const a = out[out.length - 2], b = out[out.length - 1];
      // drop b if it lies on or below the line from a to p
      if ((b.u - a.u) * (p.r - a.r) <= (p.u - a.u) * (b.r - a.r)) out.pop(); else break;
    }
    out.push(p);
  }
  return out;
}

export interface Allocation { feasible: boolean; choice: Setpoint[]; used: number; utility: number; upgrades: number }

/**
 * Start every task at its cheapest setting, then repeatedly apply the single upgrade (one step
 * along some task's hull) with the largest utility gain per unit of resource. Stop at the first
 * upgrade that does not fit. Not guaranteed optimal.
 */
export function allocate(tasks: QTask[], limit: number): Allocation {
  const hulls = tasks.map((t) => hull(t.points)), at = tasks.map(() => 0);
  let used = hulls.reduce((a, h) => a + h[0].r, 0), upgrades = 0;
  const feasible = used <= limit + 1e-12;
  while (feasible) {
    let best = -1, slope = 0;
    hulls.forEach((h, i) => {
      if (at[i] + 1 >= h.length) return;
      const s = (h[at[i] + 1].u - h[at[i]].u) / (h[at[i] + 1].r - h[at[i]].r);
      if (s > slope) { slope = s; best = i; }
    });
    if (best < 0) break;
    const dr = hulls[best][at[best] + 1].r - hulls[best][at[best]].r;
    if (used + dr > limit + 1e-12) break;
    at[best]++; used += dr; upgrades++;
  }
  const choice = hulls.map((h, i) => h[at[i]]);
  return { feasible, choice, used, utility: choice.reduce((a, p) => a + p.u, 0), upgrades };
}

/** The true optimum over ALL settings (not only the hull), by exhaustive search. Small inputs only. */
export function bruteForce(tasks: QTask[], limit: number): number {
  let best = -Infinity;
  const walk = (i: number, used: number, u: number): void => {
    if (used > limit + 1e-12) return;
    if (i === tasks.length) { if (u > best) best = u; return; }
    for (const p of tasks[i].points) walk(i + 1, used + p.r, u + p.u);
  };
  walk(0, 0, 0);
  return best;
}

// ---- the radar tasks of a scenario, with this tool's made-up quality and utility
export const Q_INTERVALS = [ms(300), ms(400), ms(600), ms(900), ms(1200)];
export const Q_DWELLS = [ms(8), ms(12), ms(16)];
export const Q_DFT_FACTORS = [0.75, 1, 1.5, 2, 3];
/** Track quality: better with a longer dwell, worse with a longer interval; manoeuvring targets degrade faster. */
export const trackQuality = (interval: Us, dwell: Us, high: boolean): number => (1 - Math.exp(-dwell / ms(6))) / (1 + (interval / (high ? ms(350) : ms(800))) ** 2);
/** Search quality: worse the longer a frame takes, relative to the region's nominal frame time. */
export const searchQuality = (dft: Us, nominal: Us): number => 1 / (1 + 0.5 * (dft / nominal) ** 2);
export const WEIGHT = { high: 1.4, normal: 1, search: [6, 4] };

export function radarTasks(sc: Scenario): QTask[] {
  const tasks: QTask[] = [];
  sc.regions.forEach((g, i) => tasks.push({ id: 'r' + i, group: g.name, region: i,
    points: Q_DFT_FACTORS.map((f) => { const dft = Math.round(g.dft * f); return { r: (g.beams * g.beamLen) / dft, u: (WEIGHT.search[i] ?? 3) * searchQuality(dft, g.dft), label: `一巡 ${(dft / 1e6).toFixed(2)} s`, dft }; }) }));
  sc.targets.forEach((t, i) => tasks.push({ id: 't' + i, group: t.high ? '高機動の目標' : '通常の目標', target: i,
    points: Q_INTERVALS.flatMap((interval) => Q_DWELLS.map((dwell) => ({ r: dwell / interval, u: (t.high ? WEIGHT.high : WEIGHT.normal) * trackQuality(interval, dwell, t.high),
      label: `更新 ${(interval / 1e6).toFixed(1)} s・${dwell / 1000} ms`, interval, dwell }))) }));
  return tasks;
}

/** The scenario with the allocation's choices written into it; null if even the cheapest settings do not fit. */
export function applyAllocation(sc: Scenario, limit: number): { sc: Scenario; alloc: Allocation; tasks: QTask[] } {
  const tasks = radarTasks(sc), alloc = allocate(tasks, limit);
  const out: Scenario = { ...sc, regions: sc.regions.map((g) => ({ ...g })), targets: sc.targets.map((t) => ({ ...t })) };
  tasks.forEach((t, k) => {
    const p = alloc.choice[k];
    if (t.region !== undefined) out.regions[t.region].dft = p.dft!;
    if (t.target !== undefined) { out.targets[t.target].interval = p.interval!; out.targets[t.target].dwell = p.dwell!; }
  });
  return { sc: out, alloc, tasks };
}
