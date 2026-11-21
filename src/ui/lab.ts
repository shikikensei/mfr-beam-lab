// Chapters 2 and 3: one 60-second situation, seen second by second, under one scheduler
// (chapter 2) or under all of them (chapter 3). Both chapters share the chosen situation.
import { perSecond, summarize } from '../engine/metrics.ts';
import type { Summary } from '../engine/metrics.ts';
import { applyAllocation } from '../engine/qram.ts';
import { DEFAULT_CONFIG, demandSeries, makeScenario, nominalDemand } from '../engine/scenario.ts';
import type { ScenarioOptions } from '../engine/scenario.ts';
import { simulate } from '../engine/simulate.ts';
import { ms } from '../engine/types.ts';
import type { Scenario, SimConfig, SimResult } from '../engine/types.ts';
import { lineChart, scatterChart, stackChart } from './charts.ts';
import type { StackData } from './charts.ts';
import { LAB, labOf } from './text.ts';
import type { LabId } from './text.ts';
import { drawStrip } from './timeline.ts';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const DURATION = ms(60000);
/** The schedulers the search-lateness convention applies to. */
const SIMPLE = Object.assign(new Set<string>(['fifo', 'template', 'priority', 'interleave', 'edf', 'balance']), { conv: true });
const pc = (x: number, d = 0): string => (x * 100).toFixed(d) + ' %';

interface Preset { id: string; label: string; note: string; opt: Omit<ScenarioOptions, 'seed' | 'duration'> }
const PRESETS: Preset[] = [
  { id: 'light', label: '軽い', note: '目標8。20秒かけて現れます。入れたい量は最後まで上限の内側です。', opt: { targets: 8, ramp: ms(20000) } },
  { id: 'sat', label: '飽和する', note: '目標30。40秒かけて現れ、途中で入れたい量が上限を超えます。', opt: { targets: 30, ramp: ms(40000) } },
  { id: 'high', label: '高機動が多い', note: '目標22、その8割が高機動（更新間隔 0.3 s）。数は少なくても、追尾の仕事が速く増えます。', opt: { targets: 22, ramp: ms(40000), highFrac: 0.8 } },
  { id: 'far', label: '遠距離が多い', note: '目標30、その8割が遠距離。遠距離の目標の照射には、送信と受信のあいだに待ちがあります。「固定優先度＋インターリーブ」だけがこの待ちを使います。待ち 4〜12 ms は説明用の縮尺です。電波の往復時間に直すと 600〜1800 km に当たり、現実の距離ではありません（ドウェルを長めに置いているのと同じ縮尺の話です）。', opt: { targets: 30, ramp: ms(40000), farFrac: 0.8 } },
  { id: 'recover', label: '減って回復する', note: '目標36が20秒で現れ、40秒の時点で8つを残して消えます。あふれたあと、どう立ち直るかを見ます。', opt: { targets: 36, ramp: ms(20000), disappear: { at: ms(40000), keep: 8 } } },
];

const state = { preset: 'sat', method: 'plus' as LabId, a: 'priority' as LabId, b: 'plus' as LabId, sel: 45, swSel: 24, timer: 0, keep: false, win: 100,
  /** Resource limit of the allocation layer (chapter 4) applied to the situation, or null for the situation as it is. */
  alloc: null as number | null,
  /** Seed of the run that is drawn; the scoreboard averages this seed and the next three. */
  seed: 11 };
/** A scenario of the lab: the preset's options, then the allocation's choices if one is in force. */
const build = (o: ScenarioOptions, alloc = state.alloc): Scenario => { const sc = makeScenario(o); return alloc === null ? sc : applyAllocation(sc, alloc).sc; };
/** The one convention the reader can switch: does a late search beam keep its lateness? */
const conv = (keep = state.keep) => ({ searchBacklog: keep ? Infinity : 0 });
const cfgOf = (id: LabId, keep = state.keep, win = state.win): SimConfig => ({ ...DEFAULT_CONFIG, ...labOf(id).cfg, conv: conv(keep), tsbfWindow: ms(win) });
const presetOf = (): Preset => PRESETS.find((p) => p.id === state.preset)!;

interface Run { sim: SimResult; per: StackData; sum: Summary }
const scenarios = new Map<string, { sc: Scenario; demand: number[]; search: number }>();
const runs = new Map<string, Run>();
function situation(): { sc: Scenario; demand: number[]; search: number } {
  const key = [state.preset, state.alloc, state.seed].join('|');
  let s = scenarios.get(key);
  if (!s) { const sc = build({ ...presetOf().opt, seed: state.seed, duration: DURATION }), d = demandSeries(sc); s = { sc, demand: d.total, search: d.search }; scenarios.set(key, s); }
  return s;
}
function run(id: LabId, keep = state.keep): Run {
  const key = [state.preset, state.alloc, state.seed, id, keep, id === 'tsbf' ? state.win : 0].join('|');
  let r = runs.get(key);
  if (!r) { const sim = simulate(situation().sc, cfgOf(id, keep)); r = { sim, per: perSecond(sim), sum: summarize(sim) }; runs.set(key, r); }
  return r;
}

function reading(r: Run, k: number): string {
  const p = r.per, rest = Math.max(0, 1 - p.search[k] - p.track[k] - p.aux[k] - p.gap[k]);
  return `捜索 <b>${pc(p.search[k])}</b>・追尾更新 <b>${pc(p.track[k])}</b>・確認/再照射 <b>${pc(p.aux[k])}</b>・隙間 <b>${pc(p.gap[k])}</b>・余裕 <b>${pc(rest)}</b>`;
}
/** What happened while the wanted amount was above 100 %. */
function verdict(r: Run): string {
  const { demand, search } = situation(), over = demand.map((d, k) => (d > 1 ? k : -1)).filter((k) => k >= 0);
  if (!over.length) return `入れたい量は最後まで上限の内側でした。取りこぼしは ${r.sum.fixed.dropped} 件です。`;
  const done = over.reduce((a, k) => a + r.per.search[k], 0) / (over.length * search);
  const inside = r.sim.requests.filter((q) => demand[Math.floor(q.req / 1e6)] > 1 && q.status !== 'cancelled' && q.status !== 'pending');
  const dropped = inside.filter((q) => q.status === 'dropped').length;
  return `入れたい量が上限を超えたのは ${over.length} 秒間。その間、捜索は頼みたい量の <b>${pc(done)}</b> を実行し、固定タスクは要求の <b>${pc(inside.length ? dropped / inside.length : 0)}</b> を取りこぼしました。`;
}

function presetButtons(host: HTMLElement, note: HTMLElement): void {
  if (!host.childElementCount) {
    host.innerHTML = PRESETS.map((p) => `<button type="button" class="ghost" role="radio" data-preset="${p.id}">${p.label}</button>`).join('');
    host.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b || b.dataset.preset === state.preset) return;
      state.preset = b.dataset.preset!; sweep = null; stop(); redraw();
    });
  }
  host.querySelectorAll('button').forEach((b) => { const on = b.dataset.preset === state.preset; b.setAttribute('aria-pressed', String(on)); b.setAttribute('aria-checked', String(on)); });
  const full = nominalDemand(situation().sc);
  note.textContent = `${presetOf().note}（目標が全部そろったときの入れたい量：${pc(full)}）`;
}
function methodSelect(id: string, key: 'method' | 'a' | 'b'): void {
  const el = $<HTMLSelectElement>(id);
  if (!el.options.length) {
    el.innerHTML = LAB.map((m) => `<option value="${m.id}">${m.label.replace(/（.+）$/, '')}</option>`).join('');
    el.addEventListener('change', () => { state[key] = el.value as LabId; if (key !== 'method') sweep = null; redraw(); });
  }
  el.value = state[key];
}
function player(btn: string, slider: string): void {
  const b = $(btn), s = $<HTMLInputElement>(slider);
  if (!b.dataset.wired) {
    b.dataset.wired = '1';
    b.addEventListener('click', () => {
      if (state.timer) return stop();
      if (state.sel >= 59) state.sel = 0;
      state.timer = window.setInterval(() => { if (state.sel >= 59) return stop(); state.sel++; redraw(); }, 260);
      redraw();
    });
    s.addEventListener('input', () => { stop(); state.sel = Number(s.value); redraw(); });
  }
  b.textContent = state.timer ? '❚❚ 停止' : '▶ 再生';
  s.value = String(state.sel);
  $(slider + 'Out').textContent = `${state.sel}〜${state.sel + 1} 秒`;
}
function stop(): void { clearInterval(state.timer); state.timer = 0; }
const pick = (k: number): void => { stop(); state.sel = k; redraw(); };

// ---- chapter 2
function drawLoad(): void {
  allocBanner('allocNote2'); seedInput('seed2');
  presetButtons($('presets'), $('presetNote'));
  methodSelect('labMethod', 'method');
  const paren = /（(.+)）$/.exec(labOf(state.method).label);
  $('labHow').textContent = (paren ? `【${paren[1]}】` : '') + labOf(state.method).how;
  const r = run(state.method), { demand } = situation(), k = state.sel;
  stackChart($('stack2'), { per: r.per, demand, sel: k, label: '1秒ごとのビームの使い道と、入れたい量', onPick: pick });
  $('verdict2').innerHTML = verdict(r);
  player('play2', 'sel2');
  drawStrip($<HTMLCanvasElement>('strip2'), r.sim, k * 1e6, 1e6);
  $('toSlow').textContent = `${k}〜${k + 1} 秒を1手ずつ見る（1章）▶`;
  $('toSlowNote').textContent = ['plus', 'paper', 'legacy', 'tsbf', 'interleave'].includes(state.method) ? '' : `スローモーションで1手ずつ見られるのは、動的RSIの2つ、従来型、2勾配ベネフィット、固定優先度＋インターリーブです。「${labOf(state.method).label}」を選んでいるので、同じ状況を「動的RSI＋先読み」で開きます。`;
  $('read2').innerHTML = `${k}〜${k + 1} 秒：入れたい量 <b>${pc(demand[k])}</b> → ${reading(r, k)}`;
  const s = r.sum, row = (a: string, b: string): string => `<dt>${a}</dt><dd>${b}</dd>`;
  $('kpi2').innerHTML =
    s.regions.map((g) => row(`${g.name}の一巡（所望 ${(g.dft / 1e6).toFixed(1)} s）`, g.meanFrame === null ? '—' : `平均 ${(g.meanFrame / 1e6).toFixed(2)} s`)).join('') +
    row('隙間', pc(s.share.gap, 1)) +
    row('固定タスクの取りこぼし', `${s.fixed.dropped} 件 / ${s.fixed.requested} 件`) +
    row('うち上位タスク', `${s.fixed.upperDropped} 件 / ${s.fixed.upperRequested} 件`) +
    row('追尾を失った回数（ロスト）', `${s.lost} 回`) +
    row('目標を追尾できていた時間', pc(s.trackedShare));
}

// ---- chapter 3
const SWEEP_N = [4, 8, 12, 16, 20, 24, 28, 32, 36, 40];
interface SweepPoint { n: number; search: number; drop: number; upper: number }
let sweep: { key: string; a: SweepPoint[]; b: SweepPoint[]; full: number } | null = null;
function sweepOf(): NonNullable<typeof sweep> {
  const key = [state.preset, state.alloc, state.seed, state.a, state.b, state.keep, state.win].join('|');
  if (sweep?.key === key) return sweep;
  const { highFrac, farFrac } = presetOf().opt;
  let full = 0;
  const line = (id: LabId): SweepPoint[] => SWEEP_N.map((n) => {
    const sc = build({ targets: n, seed: state.seed, duration: ms(30000), highFrac, farFrac });
    const s = summarize(simulate(sc, cfgOf(id)));
    return { n, search: s.share.search / demandSeries(sc).search, drop: s.fixed.requested ? s.fixed.dropped / s.fixed.requested : 0, upper: s.fixed.upperRequested ? s.fixed.upperDropped / s.fixed.upperRequested : 0 };
  });
  // the target count at which the wanted amount reaches 100 %, by linear interpolation
  const d = SWEEP_N.map((n) => nominalDemand(build({ targets: n, seed: state.seed, highFrac })));
  const i = d.findIndex((x) => x >= 1);
  if (i > 0) full = SWEEP_N[i - 1] + ((1 - d[i - 1]) / (d[i] - d[i - 1])) * (SWEEP_N[i] - SWEEP_N[i - 1]);
  return (sweep = { key, a: line(state.a), b: line(state.b), full });
}

interface Spread { mean: number; min: number; max: number }
interface Stats { search: Spread; hi: number; lo: number; gap: number; drop: Spread; upper: Spread; share: Spread; tx: number; overlap: number }
const spread = (v: number[]): Spread => ({ mean: v.reduce((a, b) => a + b, 0) / v.length, min: Math.min(...v), max: Math.max(...v) });
const statCache = new Map<string, Stats>();
/**
 * The scoreboard numbers over several seeds, so that seed-to-seed scatter is not read as a ranking.
 * The first seed is shown at once; the others are computed in the background, one scheduler per
 * tick, and the table and chart are redrawn when they are in.
 */
const statKey = (id: LabId, keep: boolean): string => [state.preset, state.alloc, state.seed, id, SIMPLE.has(id) ? keep : '-', id === 'tsbf' ? state.win : 0].join('|');
const toStats = (all: Summary[], want: number): Stats => {
  const avg = (f: (s: Summary) => number): number => spread(all.map(f)).mean;
  return { tx: avg((s) => s.txShare * 100), overlap: avg((s) => s.overlap * 100), search: spread(all.map((s) => (s.share.search / want) * 100)), hi: avg((s) => s.regions[0].served * 100), lo: avg((s) => s.regions[s.regions.length - 1].served * 100),
    gap: avg((s) => s.share.gap * 100), drop: spread(all.map((s) => s.fixed.dropped)), upper: spread(all.map((s) => s.fixed.upperDropped)),
    share: spread(all.map((s) => (s.fixed.requested ? (s.fixed.dropped / s.fixed.requested) * 100 : 0))) };
};
const queue = new Map<string, () => void>();
let pumping = 0;
function pump(): void {
  const next = queue.entries().next();
  if (next.done) { pumping = 0; if (shown === 3) drawScore(); return; }
  queue.delete(next.value[0]); next.value[1]();
  pumping = window.setTimeout(pump, 0);
}
function stats(id: LabId, keep = state.keep): Stats {
  const key = statKey(id, keep), want = situation().search;
  const full = statCache.get(key);
  if (full) return full;
  if (!queue.has(key)) {
    // capture everything the job needs now: the reader may change the settings before it runs
    const opt = presetOf().opt, win = state.win, alloc = state.alloc, base = state.seed, first = run(id, keep).sum;
    queue.set(key, () => statCache.set(key, toStats([first, ...[base + 1, base + 2, base + 3].map((seed) =>
      summarize(simulate(build({ ...opt, seed, duration: DURATION }, alloc), cfgOf(id, keep, win))))], want)));
    if (!pumping) pumping = window.setTimeout(pump, 30);
  }
  return toStats([run(id, keep).sum], want);
}
const dotName = (label: string): string => label.replace(/（.+）$/, '').replace('動的RSI＋先読み', '＋先読み').replace('固定テンプレート', 'テンプレート').replace('最早期限優先', '最早期限').replace('2勾配ベネフィット', '2勾配').replace('固定優先度＋インターリーブ', 'インターリーブ');
/** The scatter chart, its reading and the table. Redrawn on its own when the background seeds arrive. */
function drawScore(): void {
  const all = LAB.map((m) => ({ m, now: stats(m.id), other: SIMPLE.has(m.id) ? stats(m.id, !state.keep) : null }));
  const waiting = queue.size > 0;
  $('score').innerHTML = '<thead><tr><th>並べ方</th><th>捜索</th><th>隙間</th><th>取りこぼし</th><th>うち上位</th></tr></thead><tbody>' +
    all.map(({ m, now: s }) => {
      const tag = m.id === state.a ? 'A ' : m.id === state.b ? 'B ' : '', n0 = (x: number): string => x.toFixed(0);
      const range = (v: Spread): string => (waiting ? '' : `<small>${n0(v.min)}〜${n0(v.max)}</small>`);
      return `<tr><td>${tag ? `<b>${tag}</b>` : ''}${dotName(m.label)}</td><td>${n0(s.search.mean)} %<small>${n0(s.hi)}／${n0(s.lo)}</small></td>` +
        `<td>${s.gap.toFixed(1)} %</td><td>${n0(s.drop.mean)}${range(s.drop)}</td><td>${n0(s.upper.mean)}${range(s.upper)}</td></tr>`;
    }).join('') + '</tbody>';
  $('scoreNames').textContent = '名前は短くしています。' + LAB.filter((m) => dotName(m.label) !== m.label).map((m) => `${dotName(m.label)}＝${m.label}`).join('、') + '。';
  $('scoreState').textContent = waiting ? '計算中です。いまは乱数1種の結果で、すぐに4種の平均と幅に置き換わります。'
    : `60秒間の合計を、乱数を変えた4回（種 ${state.seed}〜${state.seed + 3}）で平均した値です。小さい字は、捜索が水平線／上空、取りこぼしが4回の最小〜最大です。`;
  const groups = scatterChart($('scatter'), {
    label: '並べ方ごとの、捜索の実行率と固定タスクの取りこぼしの割合（乱数4種の平均と幅）',
    points: all.map(({ m, now, other }) => ({ name: dotName(m.label), x: now.search.mean, y: now.share.mean, xr: [now.search.min, now.search.max], yr: [now.share.min, now.share.max],
      fromX: (other ?? now).search.mean, fromY: (other ?? now).share.mean })),
  });
  const pr = stats('priority'), il = stats('interleave');
  $('duty').innerHTML = `送信している時間の割合（送信デューティ比）：固定優先度 <b>${pr.tx.toFixed(1)} %</b>、固定優先度＋インターリーブ <b>${il.tx.toFixed(1)} %</b>。インターリーブで2つの照射が重なっていた時間は、全体の <b>${il.overlap.toFixed(1)} %</b> です。`;
  // what the chart says, for the situation at hand
  const over = Math.max(...situation().demand) > 1, big = groups.filter((g) => g.length > 1);
  const same = big.length ? `幅が互いに重なって区別できないのは、${big.map((g) => `「${g.join('・')}」`).join('と')}です。` : 'どの並べ方も、ほかとは幅が重なっていません。';
  $('scatterRead').textContent = waiting ? '計算中です（いまは乱数1種の結果）。'
    : !over ? `この状況では、入れたい量が最後まで上限の内側です。どの並べ方でも捜索と固定タスクの両方をほぼ守れるので、点は右下に集まります。${same}違いは、下の表の隙間に出ます。`
      : il.search.mean > 82 && il.share.mean < 3
        ? `入れたい量が上限を超えるので、ほとんどの並べ方は、捜索を守る側（右上）か、固定タスクを守る側（左下）に寄ります。「インターリーブ」だけが右下に近づくのは、照射の待ちの時間を使って、同じ時間により多くの照射を入れているためです。その大きさは、遠距離の目標の割合（本ツールが置いた値）で決まります。${same}`
        : `入れたい量が上限を超えるので、右下（両方を守る）には誰も届きません。点は、捜索を守る側（右上）か、固定タスクを守る側（左下）に寄ります。${same}`;
}
function drawCompare(): void {
  allocBanner('allocNote3');
  presetButtons($('presets3'), $('presetNote3'));
  const kb = $<HTMLSelectElement>('keep');
  if (!kb.dataset.wired) { kb.dataset.wired = '1'; kb.addEventListener('change', () => { state.keep = kb.value === 'keep'; sweep = null; redraw(); }); }
  kb.value = state.keep ? 'keep' : 'forget';
  const wb = $<HTMLSelectElement>('tsbfWin');
  if (!wb.dataset.wired) { wb.dataset.wired = '1'; wb.addEventListener('change', () => { state.win = Number(wb.value); sweep = null; redraw(); }); }
  wb.value = String(state.win);
  drawScore();
  methodSelect('labA', 'a'); methodSelect('labB', 'b');
  const A = run(state.a), B = run(state.b), { demand } = situation(), k = state.sel;
  $('nameA').textContent = 'A　' + labOf(state.a).label; $('nameB').textContent = 'B　' + labOf(state.b).label;
  stackChart($('stackA'), { per: A.per, demand, sel: k, label: 'A：1秒ごとのビームの使い道と、入れたい量', onPick: pick });
  stackChart($('stackB'), { per: B.per, demand, sel: k, label: 'B：1秒ごとのビームの使い道と、入れたい量', onPick: pick });
  player('play3', 'sel3');
  drawStrip($<HTMLCanvasElement>('stripA'), A.sim, k * 1e6, 1e6);
  drawStrip($<HTMLCanvasElement>('stripB'), B.sim, k * 1e6, 1e6);
  $('read3').innerHTML = `${k}〜${k + 1} 秒：入れたい量 <b>${pc(demand[k])}</b><br><b>A</b>　${reading(A, k)}<br><b>B</b>　${reading(B, k)}`;
  const notes = [state.a, state.b].map((id, k) => { const n = /（(.+)）$/.exec(labOf(id).label); return n ? `${'AB'[k]}：${n[1]}` : ''; }).filter(Boolean);
  $('abNote').textContent = notes.join('　');
  $('hows').innerHTML = LAB.map((m) => `<dt>${m.label}</dt><dd>${m.how}</dd>`).join('');
  // the sweep is not needed until its charts scroll into view
  if (!sweepWatch) { sweepWatch = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { sweepSeen = true; if (shown === 3) drawSweep(); } }, { rootMargin: '200px' }); sweepWatch.observe($('swSearch')); }
  if (sweepSeen) drawSweep();
  if (!farWatch) { farWatch = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { farSeen = true; if (shown === 3) drawFar(); } }, { rootMargin: '200px' }); farWatch.observe($('farCurve')); }
  if (farSeen) drawFar();
}
// ---- how the effect of interleaving depends on the share of far targets (a value this tool chose)
const FAR_SHARES = [0, 0.2, 0.4, 0.8, 1];
const farCache = new Map<string, { il: number[]; base: number }>();
let farWatch: IntersectionObserver | null = null, farSeen = false;
function drawFar(): void {
  const host = $('farCurve'), opt = presetOf().opt, key = [state.preset, state.alloc, state.seed].join('|');
  let d = farCache.get(key);
  if (!d) {
    const mean = (id: LabId, farFrac: number): number => [0, 1, 2, 3].reduce((a, k) =>
      a + summarize(simulate(build({ ...opt, farFrac, seed: state.seed + k, duration: DURATION }), cfgOf(id))).fixed.dropped, 0) / 4;
    d = { il: FAR_SHARES.map((f) => mean('interleave', f)), base: mean('priority', 0) };
    farCache.set(key, d);
  }
  const W = host.clientWidth || 300, H = 150, m = { l: 34, r: 16, t: 22, b: 30 }, ymax = Math.max(10, d.base, ...d.il) * 1.15;
  const X = (f: number): number => m.l + f * (W - m.l - m.r), Y = (v: number): number => H - m.b - (v / ymax) * (H - m.t - m.b);
  const t = (x: number, y: number, txt: string, a = 'middle', fill = '--muted', fam = '--mono'): string => `<text x="${x}" y="${y}" text-anchor="${a}" fill="var(${fill})" font-size="11" font-family="var(${fam})">${txt}</text>`;
  const here = opt.farFrac ?? 0.4;
  let g = `<svg width="${W}" height="${H}" role="img" aria-label="遠距離の目標の割合と、固定タスクの取りこぼし件数">`;
  g += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--axis)"/>` + t(m.l - 5, Y(0) + 4, '0', 'end');
  g += `<line x1="${X(here)}" x2="${X(here)}" y1="${m.t - 6}" y2="${Y(0)}" stroke="var(--line)"/>` + t(X(here), m.t - 10, 'この状況', here > 0.7 ? 'end' : 'middle', '--ink2', '--font');
  g += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(d.base)}" y2="${Y(d.base)}" stroke="var(--ink2)" stroke-width="2" stroke-dasharray="6 4"/>` + t(W - m.r, Y(d.base) - 5, `固定優先度 ${d.base.toFixed(0)} 件`, 'end', '--ink2', '--font');
  g += `<path d="${FAR_SHARES.map((f, i) => `${i ? 'L' : 'M'}${X(f).toFixed(1)} ${Y(d!.il[i]).toFixed(1)}`).join('')}" fill="none" stroke="var(--accent)" stroke-width="2"/>`;
  FAR_SHARES.forEach((f, i) => {
    g += `<circle cx="${X(f)}" cy="${Y(d!.il[i])}" r="4" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/>` + (i ? t(X(f), Y(d!.il[i]) - 8, d!.il[i].toFixed(0), 'middle', '--ink') : '') + t(X(f), H - m.b + 14, `${f * 100}%`);
  });
  g += t((m.l + W - m.r) / 2, H - 2, '遠距離の目標の割合', 'middle', '--ink2', '--font');
  host.innerHTML = g + '</svg>';
  $('farRead').textContent = `実線が「固定優先度＋インターリーブ」の取りこぼし件数、破線が固定優先度です（60秒、乱数4種の平均）。遠距離の目標がなければ両者は同じで、割合が増えるほど差が開きます。`;
}
let sweepWatch: IntersectionObserver | null = null, sweepSeen = false;
function drawSweep(): void {
  const sw = sweepOf(), n = state.swSel;
  $('swA').textContent = labOf(state.a).label; $('swB').textContent = labOf(state.b).label;
  const series = (f: (p: SweepPoint) => number) => [{ name: 'A', dash: false, pts: sw.a.map((p): [number, number] => [p.n, f(p) * 100]) }, { name: 'B', dash: true, pts: sw.b.map((p): [number, number] => [p.n, f(p) * 100]) }];
  // the label sits where the lines are not: at the bottom for the falling curves, at the top for the rising ones
  const ref = (at: 'top' | 'bottom') => (sw.full ? { x: sw.full, label: '入れたい量 100 %', at } : undefined);
  const onPick = (x: number): void => { state.swSel = x; drawSweep(); };
  const dmax = Math.max(10, ...[...sw.a, ...sw.b].map((p) => p.drop * 100));
  const step = dmax <= 40 ? 10 : 25, top = Math.ceil(dmax / step) * step;
  lineChart($('swSearch'), { label: '目標数ごとの、捜索を実行できた割合', series: series((p) => p.search), yMax: 100, yStep: 25, unit: '%', ref: ref('bottom'), sel: n, onPick });
  lineChart($('swDrop'), { label: '目標数ごとの、固定タスクを取りこぼした割合', series: series((p) => p.drop), yMax: top, yStep: step, unit: '%', ref: ref('top'), sel: n, onPick });
  const sl = $<HTMLInputElement>('swN');
  if (!sl.dataset.wired) { sl.dataset.wired = '1'; sl.addEventListener('input', () => { state.swSel = Number(sl.value); drawSweep(); }); }
  sl.value = String(n); $('swNOut').textContent = String(n);
  const at = (l: SweepPoint[]): SweepPoint => l.find((p) => p.n === n)!;
  const txt = (p: SweepPoint): string => `捜索 <b>${pc(p.search)}</b>、取りこぼし <b>${pc(p.drop, 1)}</b>（上位タスクだけなら ${pc(p.upper, 1)}）`;
  $('swRead').innerHTML = `目標 ${n}：<b>A</b> ${txt(at(sw.a))}<br>　　　　<b>B</b> ${txt(at(sw.b))}`;
  $('swTable').innerHTML = '<thead><tr><th>目標数</th><th>A 捜索</th><th>A 取りこぼし</th><th>B 捜索</th><th>B 取りこぼし</th></tr></thead><tbody>' +
    sw.a.map((p, i) => `<tr><td>${p.n}</td><td>${pc(p.search)}</td><td>${pc(p.drop, 1)}</td><td>${pc(sw.b[i].search)}</td><td>${pc(sw.b[i].drop, 1)}</td></tr>`).join('') + '</tbody>';
}

/** What chapter 2 is showing, for the jump into the slow-motion view of chapter 1. */
export function labView(): { sc: Scenario; at: number; method: LabId; win: number; label: string; conv: SimConfig['conv'] } {
  return { sc: situation().sc, at: state.sel * 1e6, method: state.method, win: state.win, label: `2章「${presetOf().label}」の ${state.sel}〜${state.sel + 1} 秒`, conv: conv() };
}
// ---- shared with chapter 4 (the allocation layer)
export const labPresets = (): { id: string; label: string; opt: Preset['opt'] }[] => PRESETS;
export const labPreset = (): string => state.preset;
export function setLabPreset(id: string): void { state.preset = id; sweep = null; }
export const labSeed = (): number => state.seed;
export const labAlloc = (): number | null => state.alloc;
// ---- the settings as a URL fragment, so that a view can be shared
const isLab = (x: string | null): x is LabId => !!x && LAB.some((m) => m.id === x);
/** e.g. "p=sat&m=plus&a=priority&b=plus&s=11" (defaults are left out). */
export function labQuery(): string {
  const q = new URLSearchParams();
  q.set('p', state.preset); q.set('m', state.method); q.set('a', state.a); q.set('b', state.b); q.set('s', String(state.seed));
  if (state.keep) q.set('k', '1');
  if (state.win !== 100) q.set('w', String(state.win));
  if (state.alloc !== null) q.set('q', String(Math.round(state.alloc * 100)));
  if (state.sel !== 45) q.set('t', String(state.sel));
  return q.toString();
}
/** Take over what a shared URL says; anything missing or not understood keeps its default. */
export function applyLabQuery(query: string): void {
  const q = new URLSearchParams(query), int = (k: string, lo: number, hi: number): number | null => { const v = Number(q.get(k)); return q.has(k) && Number.isInteger(v) && v >= lo && v <= hi ? v : null; };
  const p = q.get('p'); if (p && PRESETS.some((x) => x.id === p)) state.preset = p;
  const m = q.get('m'), a = q.get('a'), b = q.get('b');
  if (isLab(m)) state.method = m; if (isLab(a)) state.a = a; if (isLab(b)) state.b = b;
  state.seed = int('s', 1, 9999) ?? state.seed; state.keep = q.get('k') === '1'; state.win = int('w', 300, 300) ?? 100;
  const al = int('q', 40, 130); state.alloc = al === null ? null : al / 100;
  state.sel = int('t', 0, 59) ?? state.sel; sweep = null;
}
function seedInput(id: string): void {
  const el = $<HTMLInputElement>(id);
  if (!el.dataset.wired) { el.dataset.wired = '1'; el.addEventListener('change', () => { const v = Math.round(Number(el.value)); state.seed = v >= 1 && v <= 9999 ? v : 11; sweep = null; redraw(); }); }
  el.value = String(state.seed);
}
let onChange: () => void = () => {};
/** Called after every redraw of chapters 2 and 3, so that the page can keep the address in step. */
export function onLabChange(f: () => void): void { onChange = f; }
export function setLabAlloc(limit: number | null): void { state.alloc = limit; sweep = null; }
function allocBanner(id: string): void {
  const el = $(id);
  el.hidden = state.alloc === null;
  if (state.alloc === null) return;
  if (!el.dataset.wired) { el.dataset.wired = '1'; el.querySelector('button')!.addEventListener('click', () => { setLabAlloc(null); redraw(); }); }
  el.querySelector('span')!.textContent = `4章の配分（資源の上限 ${(state.alloc * 100).toFixed(0)} %）を使っています。更新間隔・ドウェルの長さ・捜索の所望フレームタイムが、元の状況と違います。`;
}
let shown = 0;
function redraw(): void { if (shown === 2) drawLoad(); else if (shown === 3) drawCompare(); onChange(); }
export function drawLab(chapter: number): void {
  if (chapter !== shown) stop();
  shown = chapter;
  redraw();
}
