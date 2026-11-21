// Chapters 2 and 3: one 60-second situation, seen second by second, under one scheduler
// (chapter 2) or under all of them (chapter 3). Both chapters share the chosen situation.
import { perSecond, summarize } from '../engine/metrics.ts';
import type { Summary } from '../engine/metrics.ts';
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
const SEED = 11, SEEDS = [11, 12, 13, 14], DURATION = ms(60000);
/** The schedulers the search-lateness convention applies to. */
const SIMPLE = Object.assign(new Set<string>(['fifo', 'template', 'priority', 'edf', 'balance']), { conv: true });
const pc = (x: number, d = 0): string => (x * 100).toFixed(d) + ' %';

interface Preset { id: string; label: string; note: string; opt: Omit<ScenarioOptions, 'seed' | 'duration'> }
const PRESETS: Preset[] = [
  { id: 'light', label: '軽い', note: '目標8。20秒かけて現れます。入れたい量は最後まで上限の内側です。', opt: { targets: 8, ramp: ms(20000) } },
  { id: 'sat', label: '飽和する', note: '目標30。40秒かけて現れ、途中で入れたい量が上限を超えます。', opt: { targets: 30, ramp: ms(40000) } },
  { id: 'high', label: '高機動が多い', note: '目標22、その8割が高機動（更新間隔 0.3 s）。数は少なくても、追尾の仕事が速く増えます。', opt: { targets: 22, ramp: ms(40000), highFrac: 0.8 } },
  { id: 'recover', label: '減って回復する', note: '目標36が20秒で現れ、40秒の時点で8つを残して消えます。あふれたあと、どう立ち直るかを見ます。', opt: { targets: 36, ramp: ms(20000), disappear: { at: ms(40000), keep: 8 } } },
];

const state = { preset: 'sat', method: 'plus' as LabId, a: 'priority' as LabId, b: 'plus' as LabId, sel: 45, swSel: 24, timer: 0, keep: false, win: 100 };
/** The one convention the reader can switch: does a late search beam keep its lateness? */
const conv = (keep = state.keep) => ({ searchBacklog: keep ? Infinity : 0 });
const cfgOf = (id: LabId, keep = state.keep): SimConfig => ({ ...DEFAULT_CONFIG, ...labOf(id).cfg, conv: conv(keep), tsbfWindow: ms(state.win) });
const presetOf = (): Preset => PRESETS.find((p) => p.id === state.preset)!;

interface Run { sim: SimResult; per: StackData; sum: Summary }
const scenarios = new Map<string, { sc: Scenario; demand: number[]; search: number }>();
const runs = new Map<string, Run>();
function situation(): { sc: Scenario; demand: number[]; search: number } {
  let s = scenarios.get(state.preset);
  if (!s) { const sc = makeScenario({ ...presetOf().opt, seed: SEED, duration: DURATION }), d = demandSeries(sc); s = { sc, demand: d.total, search: d.search }; scenarios.set(state.preset, s); }
  return s;
}
function run(id: LabId, keep = state.keep): Run {
  const key = [state.preset, id, keep, id === 'tsbf' ? state.win : 0].join('|');
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
    el.innerHTML = LAB.map((m) => `<option value="${m.id}">${m.label}</option>`).join('');
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
  presetButtons($('presets'), $('presetNote'));
  methodSelect('labMethod', 'method');
  $('labHow').textContent = labOf(state.method).how;
  const r = run(state.method), { demand } = situation(), k = state.sel;
  stackChart($('stack2'), { per: r.per, demand, sel: k, label: '1秒ごとのビームの使い道と、入れたい量', onPick: pick });
  $('verdict2').innerHTML = verdict(r);
  player('play2', 'sel2');
  drawStrip($<HTMLCanvasElement>('strip2'), r.sim, k * 1e6, 1e6);
  $('toSlow').textContent = `この1秒（${k}〜${k + 1} 秒）を、1章のスローモーションで見る ▶`;
  $('toSlowNote').textContent = ['plus', 'paper', 'legacy'].includes(state.method) ? '' : `スローモーションで1手ずつ見られるのは、動的RSIの2つと従来型です。「${labOf(state.method).label}」を選んでいるので、同じ状況を「動的RSI＋先読み」で開きます。`;
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
  const key = [state.preset, state.a, state.b, state.keep, state.win].join('|');
  if (sweep?.key === key) return sweep;
  const highFrac = presetOf().opt.highFrac;
  let full = 0;
  const line = (id: LabId): SweepPoint[] => SWEEP_N.map((n) => {
    const sc = makeScenario({ targets: n, seed: SEED, duration: ms(30000), highFrac });
    const s = summarize(simulate(sc, cfgOf(id)));
    return { n, search: s.share.search / demandSeries(sc).search, drop: s.fixed.requested ? s.fixed.dropped / s.fixed.requested : 0, upper: s.fixed.upperRequested ? s.fixed.upperDropped / s.fixed.upperRequested : 0 };
  });
  // the target count at which the wanted amount reaches 100 %, by linear interpolation
  const d = SWEEP_N.map((n) => nominalDemand(makeScenario({ targets: n, seed: SEED, highFrac })));
  const i = d.findIndex((x) => x >= 1);
  if (i > 0) full = SWEEP_N[i - 1] + ((1 - d[i - 1]) / (d[i] - d[i - 1])) * (SWEEP_N[i] - SWEEP_N[i - 1]);
  return (sweep = { key, a: line(state.a), b: line(state.b), full });
}

interface Spread { mean: number; min: number; max: number }
interface Stats { search: Spread; hi: number; lo: number; gap: number; drop: Spread; upper: Spread; share: Spread }
const spread = (v: number[]): Spread => ({ mean: v.reduce((a, b) => a + b, 0) / v.length, min: Math.min(...v), max: Math.max(...v) });
const statCache = new Map<string, Stats>();
/** The scoreboard numbers over several seeds, so that seed-to-seed scatter is not read as a ranking. */
function stats(id: LabId, keep = state.keep): Stats {
  const key = [state.preset, id, SIMPLE.has(id) ? keep : '-', id === 'tsbf' ? state.win : 0].join('|');
  let st = statCache.get(key);
  if (!st) {
    const all = SEEDS.map((seed) => {
      const sc = seed === SEED ? situation().sc : makeScenario({ ...presetOf().opt, seed, duration: DURATION });
      return seed === SEED ? run(id, keep).sum : summarize(simulate(sc, cfgOf(id, keep)));
    });
    const want = situation().search, avg = (f: (s: Summary) => number): number => spread(all.map(f)).mean;
    st = { search: spread(all.map((s) => (s.share.search / want) * 100)), hi: avg((s) => s.regions[0].served * 100), lo: avg((s) => s.regions[s.regions.length - 1].served * 100),
      gap: avg((s) => s.share.gap * 100), drop: spread(all.map((s) => s.fixed.dropped)), upper: spread(all.map((s) => s.fixed.upperDropped)),
      share: spread(all.map((s) => (s.fixed.requested ? (s.fixed.dropped / s.fixed.requested) * 100 : 0))) };
    statCache.set(key, st);
  }
  return st;
}
const short = (label: string): string => label.replace(/（(.+)）$/, '<small>$1</small>');
function drawCompare(): void {
  presetButtons($('presets3'), $('presetNote3'));
  $('score').innerHTML = '<thead><tr><th>並べ方</th><th>捜索</th><th>隙間</th><th>取りこぼし</th><th>うち上位</th></tr></thead><tbody>' +
    LAB.map((m) => {
      const s = stats(m.id), tag = m.id === state.a ? 'A ' : m.id === state.b ? 'B ' : '', n0 = (x: number): string => x.toFixed(0);
      return `<tr><td>${tag ? `<b>${tag}</b>` : ''}${short(m.label)}</td><td>${n0(s.search.mean)} %<small>${n0(s.hi)}／${n0(s.lo)}</small></td>` +
        `<td>${s.gap.toFixed(1)} %</td><td>${n0(s.drop.mean)}<small>${n0(s.drop.min)}〜${n0(s.drop.max)}</small></td><td>${n0(s.upper.mean)}<small>${n0(s.upper.min)}〜${n0(s.upper.max)}</small></td></tr>`;
    }).join('') + '</tbody>';
  const kb = $<HTMLSelectElement>('keep');
  if (!kb.dataset.wired) { kb.dataset.wired = '1'; kb.addEventListener('change', () => { state.keep = kb.value === 'keep'; sweep = null; redraw(); }); }
  kb.value = state.keep ? 'keep' : 'forget';
  const wb = $<HTMLSelectElement>('tsbfWin');
  if (!wb.dataset.wired) { wb.dataset.wired = '1'; wb.addEventListener('change', () => { state.win = Number(wb.value); sweep = null; redraw(); }); }
  wb.value = String(state.win);
  scatterChart($('scatter'), {
    label: '並べ方ごとの、捜索の実行率と固定タスクの取りこぼしの割合（乱数4種の平均と幅）',
    points: LAB.map((m) => {
      const now = stats(m.id), other = 'conv' in SIMPLE && SIMPLE.has(m.id) ? stats(m.id, !state.keep) : now;
      return { name: m.label.replace(/（.+）$/, '').replace('動的RSI＋先読み', '＋先読み').replace('固定テンプレート', 'テンプレート').replace('最早期限優先', '最早期限').replace('2勾配ベネフィット', '2勾配'),
        x: now.search.mean, y: now.share.mean, xr: [now.search.min, now.search.max], yr: [now.share.min, now.share.max], fromX: other.search.mean, fromY: other.share.mean };
    }),
  });
  methodSelect('labA', 'a'); methodSelect('labB', 'b');
  const A = run(state.a), B = run(state.b), { demand } = situation(), k = state.sel;
  $('nameA').textContent = 'A　' + labOf(state.a).label; $('nameB').textContent = 'B　' + labOf(state.b).label;
  stackChart($('stackA'), { per: A.per, demand, sel: k, label: 'A：1秒ごとのビームの使い道と、入れたい量', onPick: pick });
  stackChart($('stackB'), { per: B.per, demand, sel: k, label: 'B：1秒ごとのビームの使い道と、入れたい量', onPick: pick });
  player('play3', 'sel3');
  drawStrip($<HTMLCanvasElement>('stripA'), A.sim, k * 1e6, 1e6);
  drawStrip($<HTMLCanvasElement>('stripB'), B.sim, k * 1e6, 1e6);
  $('read3').innerHTML = `${k}〜${k + 1} 秒：入れたい量 <b>${pc(demand[k])}</b><br><b>A</b>　${reading(A, k)}<br><b>B</b>　${reading(B, k)}`;
  $('hows').innerHTML = LAB.map((m) => `<dt>${m.label}</dt><dd>${m.how}</dd>`).join('');
  drawSweep();
}
function drawSweep(): void {
  const sw = sweepOf(), n = state.swSel;
  $('swA').textContent = labOf(state.a).label; $('swB').textContent = labOf(state.b).label;
  const series = (f: (p: SweepPoint) => number) => [{ name: 'A', dash: false, pts: sw.a.map((p): [number, number] => [p.n, f(p) * 100]) }, { name: 'B', dash: true, pts: sw.b.map((p): [number, number] => [p.n, f(p) * 100]) }];
  const ref = sw.full ? { x: sw.full, label: '入れたい量 100 %' } : undefined;
  const onPick = (x: number): void => { state.swSel = x; drawSweep(); };
  const dmax = Math.max(10, ...[...sw.a, ...sw.b].map((p) => p.drop * 100));
  const top = Math.ceil(dmax / 10) * 10;
  lineChart($('swSearch'), { label: '目標数ごとの、捜索を実行できた割合', series: series((p) => p.search), yMax: 100, yStep: 25, unit: '%', ref, sel: n, onPick });
  lineChart($('swDrop'), { label: '目標数ごとの、固定タスクを取りこぼした割合', series: series((p) => p.drop), yMax: top, yStep: top / (top > 40 ? 4 : 2), unit: '%', ref, sel: n, onPick });
  const at = (l: SweepPoint[]): SweepPoint => l.find((p) => p.n === n)!;
  const txt = (p: SweepPoint): string => `捜索 <b>${pc(p.search)}</b>、取りこぼし <b>${pc(p.drop, 1)}</b>（上位タスクだけなら ${pc(p.upper, 1)}）`;
  $('swRead').innerHTML = `目標 ${n}：<b>A</b> ${txt(at(sw.a))}<br>　　　　<b>B</b> ${txt(at(sw.b))}<br>グラフをなぞると、読む目標数を変えられます。`;
  $('swTable').innerHTML = '<thead><tr><th>目標数</th><th>A 捜索</th><th>A 取りこぼし</th><th>B 捜索</th><th>B 取りこぼし</th></tr></thead><tbody>' +
    sw.a.map((p, i) => `<tr><td>${p.n}</td><td>${pc(p.search)}</td><td>${pc(p.drop, 1)}</td><td>${pc(sw.b[i].search)}</td><td>${pc(sw.b[i].drop, 1)}</td></tr>`).join('') + '</tbody>';
}

/** What chapter 2 is showing, for the jump into the slow-motion view of chapter 1. */
export function labView(): { sc: Scenario; at: number; method: LabId; label: string; conv: SimConfig['conv'] } {
  return { sc: situation().sc, at: state.sel * 1e6, method: state.method, label: `2章「${presetOf().label}」の ${state.sel}〜${state.sel + 1} 秒`, conv: conv() };
}
let shown = 0;
function redraw(): void { if (shown === 2) drawLoad(); else if (shown === 3) drawCompare(); }
export function drawLab(chapter: number): void {
  if (chapter !== shown) stop();
  shown = chapter;
  redraw();
}
