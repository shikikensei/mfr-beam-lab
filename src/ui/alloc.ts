// Chapter 4: the allocation layer. Decide how much each task asks for under a resource limit,
// show each task's utility curve with the chosen setting, and hand the result to chapter 2.
import { applyAllocation, hull } from '../engine/qram.ts';
import type { QTask, Setpoint } from '../engine/qram.ts';
import { makeScenario } from '../engine/scenario.ts';
import { labAlloc, labPreset, labPresets, setLabAlloc, setLabPreset } from './lab.ts';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const pc = (x: number, d = 0): string => (x * 100).toFixed(d) + ' %';
let wired = false;

/** One small chart per kind of task: every setting, the hull, and where the tasks of that kind ended up. */
function curve(host: HTMLElement, task: QTask, chosen: Map<Setpoint, number>): void {
  const W = host.clientWidth || 300, H = 132, m = { l: 34, r: 14, t: 10, b: 28 };
  const h = hull(task.points), rmax = Math.max(...task.points.map((p) => p.r)) * 1.08, umax = Math.max(...task.points.map((p) => p.u)) * 1.12;
  const X = (r: number): number => m.l + (r / rmax) * (W - m.l - m.r), Y = (u: number): number => H - m.b - (u / umax) * (H - m.t - m.b);
  const t = (x: number, y: number, s: string, a = 'middle', fill = '--muted'): string => `<text x="${x}" y="${y}" text-anchor="${a}" fill="var(${fill})" font-size="11" font-family="var(--mono)">${s}</text>`;
  let s = `<svg width="${W}" height="${H}" role="img" aria-label="${task.group}の、資源と効用の関係と選ばれた設定">`;
  s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--axis)"/><line x1="${m.l}" x2="${m.l}" y1="${m.t}" y2="${Y(0)}" stroke="var(--axis)"/>`;
  const xs = rmax > 0.2 ? 0.1 : rmax > 0.04 ? 0.02 : 0.01;
  for (let r = 0; r <= rmax; r += xs) s += t(X(r), H - m.b + 14, (r * 100).toFixed(0) + '%');
  s += t(m.l - 5, Y(umax / 1.12) + 4, (umax / 1.12).toFixed(1), 'end') + t(m.l - 5, Y(0) + 4, '0', 'end');
  s += `<text x="${(m.l + W - m.r) / 2}" y="${H - 2}" text-anchor="middle" fill="var(--ink2)" font-size="11" font-family="var(--font)">資源（時間の割合）</text>`;
  s += `<path d="${h.map((p, i) => `${i ? 'L' : 'M'}${X(p.r).toFixed(1)} ${Y(p.u).toFixed(1)}`).join('')}" fill="none" stroke="var(--accent)" stroke-width="2"/>`;
  for (const p of task.points) s += `<circle cx="${X(p.r)}" cy="${Y(p.u)}" r="3" fill="var(--surface)" stroke="var(--muted)" stroke-width="1.2"/>`;
  for (const [p, n] of chosen) s += `<circle cx="${X(p.r)}" cy="${Y(p.u)}" r="8" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/>` +
    `<text x="${X(p.r)}" y="${Y(p.u) + 3.5}" text-anchor="middle" fill="var(--surface)" font-size="10" font-weight="700" font-family="var(--mono)">${n}</text>`;
  host.innerHTML = s + '</svg>';
}

export function drawAlloc(go: (chapter: number) => void): void {
  const limitEl = $<HTMLInputElement>('qLimit');
  if (!wired) {
    wired = true;
    $('qPresets').innerHTML = labPresets().map((p) => `<button type="button" class="ghost" role="radio" data-preset="${p.id}">${p.label}</button>`).join('');
    $('qPresets').addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest('button'); if (b) { setLabPreset(b.dataset.preset!); drawAlloc(go); } });
    limitEl.addEventListener('input', () => drawAlloc(go));
    $('qApply').addEventListener('click', () => { setLabAlloc(Number(limitEl.value) / 100); go(2); });
    if (labAlloc() !== null) limitEl.value = String(Math.round(labAlloc()! * 100));
  }
  const preset = labPresets().find((p) => p.id === labPreset())!, limit = Number(limitEl.value) / 100;
  $('qPresets').querySelectorAll('button').forEach((b) => { const on = b.dataset.preset === preset.id; b.setAttribute('aria-pressed', String(on)); b.setAttribute('aria-checked', String(on)); });
  $('qLimitOut').textContent = pc(limit);
  const base = makeScenario({ ...preset.opt, seed: 11 }), { alloc, tasks } = applyAllocation(base, limit);
  const lowest = tasks.reduce((a, t) => a + hull(t.points)[0].r, 0), top = tasks.reduce((a, t) => a + Math.max(...t.points.map((p) => p.u)), 0), topR = tasks.reduce((a, t) => a + hull(t.points).at(-1)!.r, 0);
  $('qResult').innerHTML = alloc.feasible
    ? `目標 ${base.targets.length}、捜索 ${base.regions.length} 領域。上限 <b>${pc(limit)}</b> のうち <b>${pc(alloc.used, 1)}</b> を配りました。効用の合計は <b>${alloc.utility.toFixed(1)}</b> です（全員が最高の設定なら ${top.toFixed(1)}、それには ${pc(topR)} が必要）。`
    : `目標 ${base.targets.length}、捜索 ${base.regions.length} 領域。全員を最低の設定にしても <b>${pc(lowest, 1)}</b> が必要で、上限 <b>${pc(limit)}</b> に収まりません。下の図は、最低の設定のままです。`;
  const scale = Math.max(1.3, alloc.used, limit);
  $('qMeter').innerHTML = `<i style="width:${(alloc.used / scale) * 100}%"></i><u style="left:${(limit / scale) * 100}%"></u><u style="left:${(1 / scale) * 100}%;border-left-style:dashed;border-color:var(--muted)"></u>`;
  // one chart per kind of task
  const groups = new Map<string, { task: QTask; chosen: Map<Setpoint, number> }>();
  tasks.forEach((t, k) => {
    const g = groups.get(t.group) ?? { task: t, chosen: new Map<Setpoint, number>() };
    // tasks of one kind share the same candidate settings; match the chosen one by its label
    const p = g.task.points.find((x) => x.label === alloc.choice[k].label)!;
    g.chosen.set(p, (g.chosen.get(p) ?? 0) + 1); groups.set(t.group, g);
  });
  const host = $('qGroups');
  host.innerHTML = [...groups].map(([name, g]) => {
    const n = [...g.chosen.values()].reduce((a, b) => a + b, 0);
    const list = [...g.chosen].sort((a, b) => b[0].r - a[0].r).map(([p, c]) => `${p.label}${n > 1 ? `：${c}` : ''}`).join('、');
    return `<div><h3>${name}${n > 1 ? `（${n}）` : ''}</h3><div class="chart" data-group="${name}"></div><p>選ばれた設定：${list}</p></div>`;
  }).join('');
  for (const [name, g] of groups) curve(host.querySelector<HTMLElement>(`[data-group="${name}"]`)!, g.task, g.chosen);
  $<HTMLButtonElement>('qApply').disabled = !alloc.feasible;
  $('qApplyNote').textContent = labAlloc() !== null ? `いま2・3章には、上限 ${pc(labAlloc()!)} の配分が入っています。2章の上の「元の状況に戻す」で外せます。` : '';
}
