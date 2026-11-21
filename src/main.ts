import './style.css';
import { HAND_CASES, HAND_CONFIG, handScenario } from './engine/figures.ts';
import type { HandCaseId } from './engine/figures.ts';
import { summarize } from './engine/metrics.ts';
import { DEFAULT_CONFIG, makeScenario } from './engine/scenario.ts';
import { simulate } from './engine/simulate.ts';
import { ms } from './engine/types.ts';
import type { BoxRecord, PlanStep, SimConfig, SimResult, Us } from './engine/types.ts';
import { METHODS, PHASES, STATES, describe, lifeOf, msTxt, phaseOf } from './ui/text.ts';
import type { LifeEvent, MethodId } from './ui/text.ts';
import { drawLab, labView } from './ui/lab.ts';
import { drawStrip, drawTimeline } from './ui/timeline.ts';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const SEED = 11;
const CRITICALS = [{ at: ms(1500), len: ms(20), notice: ms(40) }, { at: ms(3200), len: ms(20), notice: ms(40) }];
const configOf = (id: MethodId, fill: SimConfig['fill'] = 'pace'): SimConfig =>
  ({ ...DEFAULT_CONFIG, scheduler: METHODS[id].scheduler, protect: METHODS[id].protect, fill, trace: true });

// ================= chapters =================
const chapters = [...document.querySelectorAll<HTMLElement>('.chapter')];
let chapter = 0;
function showChapter(i: number, scroll = true): void {
  chapter = Math.max(0, Math.min(chapters.length - 1, i));
  chapters.forEach((c, k) => { c.hidden = k !== chapter; });
  $('chapnav').querySelectorAll('a').forEach((a, k) => { if (k === chapter) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  $('chNow').textContent = `${chapter} ${chapters[chapter].dataset.title}`;
  $<HTMLButtonElement>('chPrev').disabled = chapter === 0;
  $<HTMLButtonElement>('chNext').disabled = chapter === chapters.length - 1;
  if (location.hash !== '#ch' + chapter) history.replaceState(null, '', '#ch' + chapter);
  if (scroll) window.scrollTo(0, 0);
  redraw();
}
$('chapnav').innerHTML = chapters.map((c, k) => `<a href="#ch${k}"><b>${k}</b> ${c.dataset.title}</a>`).join('');
$('chapnav').addEventListener('click', (e) => {
  const a = (e.target as HTMLElement).closest('a');
  if (!a) return;
  e.preventDefault();
  showChapter([...$('chapnav').querySelectorAll('a')].indexOf(a));
});
$('chPrev').addEventListener('click', () => showChapter(chapter - 1));
$('chNext').addEventListener('click', () => showChapter(chapter + 1));
window.addEventListener('hashchange', () => { const m = /^#ch(\d)$/.exec(location.hash); if (m && Number(m[1]) !== chapter) showChapter(Number(m[1])); });

// ================= chapter 0: the strip =================
function drawIntro(): void {
  const n = Number($<HTMLInputElement>('n0').value);
  $('n0Out').textContent = String(n);
  const r = simulate(makeScenario({ targets: n, seed: SEED, duration: ms(3000) }), configOf('plus'));
  drawStrip($<HTMLCanvasElement>('strip'), r, ms(1500), ms(1200));
  const s = summarize(r), pc = (x: number): string => (x * 100).toFixed(0) + ' %';
  const want = r.scenario.regions.reduce((a, g) => a + (g.beams * g.beamLen) / g.dft, 0);
  $('stripOut').innerHTML = `3秒間の平均：捜索 <b>${pc(s.share.search)}</b>（頼みたい量は ${pc(want)}）、追尾と確認 <b>${pc(s.share.fixed)}</b>、空き <b>${pc(s.share.spare + s.share.gap)}</b>`;
}
$('n0').addEventListener('input', drawIntro);

// ================= chapter 1, part 1: the life of one target =================
const life = { sim: null as SimResult | null, target: 0, events: [] as LifeEvent[], i: 0 };
function buildLife(): void {
  const sim = simulate(makeScenario({ targets: 4, seed: SEED, duration: ms(6000) }), configOf('plus'));
  // the target whose first seconds show the most: a miss and a re-illumination if possible
  let best = 0, bestScore = -1;
  sim.scenario.targets.forEach((_, t) => {
    const ev = lifeOf(sim, t).slice(0, 14);
    const score = (ev.some((e) => e.title.includes('外れ')) ? 4 : 0) + (ev.some((e) => e.title.includes('再照射')) ? 2 : 0) + (ev.some((e) => e.title.includes('ロスト')) ? 1 : 0) - (ev[1]?.t ?? 9e9) / 9e9;
    if (score > bestScore) { bestScore = score; best = t; }
  });
  life.sim = sim; life.target = best; life.events = lifeOf(sim, best).slice(0, 14); life.i = 0;
}
function drawLife(): void {
  if (!life.sim) buildLife();
  const e = life.events[life.i], span = ms(1600);
  const x0 = Math.max(-ms(100), Math.min(e.t - span * 0.7, life.sim!.end - span));
  drawTimeline($<HTMLCanvasElement>('lifeCv'), { sim: life.sim!, x0, span, targets: [life.target], seen: { t: e.t }, cursor: e.t, regions: false, boxRow: false });
  $('lifeStates').innerHTML = STATES.map((s, k) => `<li${k === e.state ? ' aria-current="step"' : ''}>${s}</li>`).join('');
  $('lifeTitle').textContent = `${(e.t / 1e6).toFixed(2)} s　${e.title}`;
  $('lifeBody').textContent = e.body;
  $('lifeCount').textContent = `${life.i + 1} / ${life.events.length}`;
  $<HTMLButtonElement>('lifePrev').disabled = life.i === 0;
  $<HTMLButtonElement>('lifeNext').disabled = life.i === life.events.length - 1;
}
$('lifePrev').addEventListener('click', () => { life.i = Math.max(0, life.i - 1); drawLife(); });
$('lifeNext').addEventListener('click', () => { life.i = Math.min(life.events.length - 1, life.i + 1); drawLife(); });

// ================= chapter 1, part 2: one request =================
function drawRequest(): void {
  const lead = 24, trail = 24, len = 12, pos = Number($<HTMLInputElement>('reqPos').value);
  const X = (t: number): number => 152 + t * 3;
  const inside = pos >= -lead && pos <= trail;
  const fill = inside ? 'var(--s-track)' : 'none', stroke = inside ? 'var(--s-track)' : 'var(--crit)';
  const mid = Math.max(60, Math.min(280, X(pos) + len * 1.5));
  $('reqFig').innerHTML =
    `<rect x="${X(-lead)}" y="44" width="${(lead + trail + len) * 3}" height="30" fill="none" stroke="var(--ink2)"/>` +
    `<line x1="${X(0)}" y1="36" x2="${X(0)}" y2="82" stroke="var(--ink2)"/>` +
    `<rect x="${X(pos)}" y="50" width="${len * 3}" height="18" fill="${fill}" stroke="${stroke}" stroke-width="1.5" ${inside ? '' : 'stroke-dasharray="4 3"'}/>` +
    `<g font-size="11" fill="var(--ink2)" text-anchor="middle" font-family="var(--font)">` +
    `<text x="${X(0)}" y="32">要求時刻</text>` +
    `<text x="${X(-lead)}" y="98">最早開始</text><text x="${X(trail)}" y="98">最遅開始</text>` +
    `<line x1="${X(-lead)}" y1="76" x2="${X(-lead)}" y2="86" stroke="var(--ink2)"/><line x1="${X(trail)}" y1="76" x2="${X(trail)}" y2="86" stroke="var(--ink2)"/>` +
    `<text x="${X(-lead / 2)}" y="114">← スラック</text><text x="${X(trail / 2)}" y="114">スラック →</text>` +
    `<text x="${mid}" y="12" fill="${inside ? 'var(--ink)' : 'var(--crit)'}">ドウェル（長さ ${len} ms）</text></g>`;
  $('reqPosOut').textContent = pos === 0 ? '要求時刻どおり' : `要求時刻の ${Math.abs(pos)} ms ${pos < 0 ? '前' : '後'}`;
  $('reqOut').innerHTML = inside
    ? `許容範囲（前 ${lead} ms、後 ${trail} ms）の中なので、<b>実行できます</b>。`
    : `許容範囲の外です。${pos < 0 ? 'ここまで前には動かせません。' : 'ここまで待たせると<b>取りこぼし</b>になります。'}`;
}
$('reqPos').addEventListener('input', drawRequest);

// ================= chapter 1, parts 3-5: the stage =================
const SPAN = ms(600), BACK = ms(200), HAND_SPAN = ms(125), HAND_BACK = ms(5);
const st = { method: 'plus' as MethodId, sim: null as SimResult | null, g: 0, timer: 0, hand: null as HandCaseId | null,
  /** A situation handed over from chapter 2 (same targets, same seed, same 60 seconds). */
  ext: null as ReturnType<typeof labView> | null };
const fillMode = (): SimConfig['fill'] => (st.hand ? HAND_CONFIG.fill : $<HTMLSelectElement>('fill').value as SimConfig['fill']);
const scenario = () => st.ext ? st.ext.sc : st.hand ? handScenario(st.hand) : makeScenario({ targets: Number($<HTMLInputElement>('n').value), seed: SEED, criticals: $<HTMLInputElement>('crit').checked ? CRITICALS : [] });

function current(): { box: BoxRecord; step: PlanStep; k: number } {
  const sim = st.sim!;
  let lo = 0, hi = sim.boxes.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (sim.boxes[m].gsBase <= st.g) lo = m; else hi = m - 1; }
  const box = sim.boxes[lo], k = Math.min(st.g - box.gsBase, box.steps.length - 1);
  return { box, step: box.steps[k], k };
}
function drawStage(): void {
  const sim = st.sim;
  if (!sim) return;
  const { box, step, k } = current(), bi = sim.boxes.indexOf(box), last = k === box.steps.length - 1;
  const cursor: Us = sim.config.scheduler === 'legacy' ? (last ? box.end : box.start)
    : Math.max(box.start, ...sim.timeline.filter((x) => x.box === bi && x.gs <= st.g).map((x) => x.start + x.len));
  drawTimeline($<HTMLCanvasElement>('cv'), { sim, x0: st.hand ? -HAND_BACK : box.start - BACK, span: st.hand ? HAND_SPAN : SPAN, targets: sim.scenario.targets.map((_, i) => i),
    seen: { gs: st.g }, cursor, regions: true, box: { rec: box, k }, boxRow: true });
  const phases = PHASES[sim.config.scheduler === 'legacy' ? 'legacy' : 'drsi'], on = phaseOf(step), cap = describe(sim, step, box);
  const row = (label: string, lines: string[]): string => (lines.length ? `<dt>${label}</dt><dd>${lines.join('<br>')}</dd>` : '');
  $('caption').innerHTML = `<ol class="phases">${phases.map((p, i) => `<li${i === on ? ' aria-current="step"' : ''}>${'①②③④'[i]} ${p}</li>`).join('')}</ol>` +
    `<dl class="cap">${row('何をした', cap.did)}${row('なぜ', cap.why)}${row('結果', cap.result)}</dl>`;
  $<HTMLInputElement>('step').value = String(st.g);
  $('stepOut').textContent = `${st.g + 1} / ${sim.steps}`;
}
function stop(): void { clearInterval(st.timer); st.timer = 0; $('play').textContent = '▶ 再生'; }
function go(n: number): void { st.g = Math.max(0, Math.min(st.sim!.steps - 1, n)); drawStage(); }

function compare(): void {
  const sc = scenario(), ids = Object.keys(METHODS) as MethodId[];
  const rows = ids.map((id) => summarize(simulate(sc, { ...configOf(id, fillMode()), trace: false })));
  const pc = (x: number): string => (x * 100).toFixed(1) + ' %';
  const line = (label: string, f: (s: (typeof rows)[number]) => string): string => `<tr><td>${label}</td>${rows.map((s) => `<td>${f(s)}</td>`).join('')}</tr>`;
  $('cmp').innerHTML = `<thead><tr><th></th>${ids.map((id) => `<th>${METHODS[id].label.replace('＋', '<br>＋')}<br><small>${METHODS[id].note}</small></th>`).join('')}</tr></thead><tbody>` +
    line('捜索', (s) => pc(s.share.search)) + line('隙間', (s) => pc(s.share.gap)) + line('余裕', (s) => pc(s.share.spare)) +
    line('固定タスク', (s) => pc(s.share.fixed)) +
    sc.regions.map((r, i) => line(`${r.name}の一巡<br><small>所望 ${(r.dft / 1e6).toFixed(1)} s</small>`, (s) => (s.regions[i].meanFrame === null ? '—' : (s.regions[i].meanFrame! / 1e6).toFixed(2) + ' s'))).join('') +
    line('取りこぼし<br><small>設定に強く依存</small>', (s) => `${s.fixed.dropped} 件`) +
    line('うち上位タスク<br><small>通常の追尾更新より上</small>', (s) => `${s.fixed.upperDropped} 件`) + '</tbody>';
}

/** Re-run with the current settings and show the box that covers time `at` (or a typical one). */
function rebuild(at: Us | null = null, pick: ((sim: SimResult) => BoxRecord | undefined) | null = null): void {
  stop();
  $('nOut').textContent = $<HTMLInputElement>('n').value;
  const sim = st.sim = simulate(scenario(), { ...configOf(st.method, st.ext ? 'pace' : fillMode()), conv: st.ext?.conv });
  $('fromLab').hidden = !st.ext;
  if (st.ext) $('fromLabText').textContent = `${st.ext.label}を表示しています（目標 ${st.ext.sc.targets.length}）。`;
  $<HTMLElement>('stage').querySelector('details')!.hidden = !!st.ext;
  $<HTMLInputElement>('step').max = String(sim.steps - 1);
  $('methods').querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.method === st.method)));
  $('lgTentative').hidden = st.method === 'legacy'; // the legacy scheduler has no tentative placement
  const typical = (b: BoxRecord): boolean => b.start >= ms(1200) && (sim.config.scheduler === 'legacy' || (b.steps[0].kind === 'select' && b.steps[0].nft !== null));
  const box = pick?.(sim) ?? (at !== null ? [...sim.boxes].reverse().find((b) => b.start <= at) : sim.boxes.find(typical));
  go(box ? box.gsBase : 0);
  compare();
}
$('methods').innerHTML = (Object.keys(METHODS) as MethodId[]).map((id) =>
  `<button type="button" role="radio" data-method="${id}">${METHODS[id].label}<small>${METHODS[id].note}</small></button>`).join('');
$('methods').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button');
  if (!b || b.dataset.method === st.method) return;
  const at = st.sim ? current().box.start : null;
  st.method = b.dataset.method as MethodId;
  rebuild(at);
});
for (const id of ['fill', 'crit']) $(id).addEventListener('change', () => rebuild(st.sim ? current().box.start : null));
$('n').addEventListener('input', () => { leaveHand(); rebuild(); });
// ---- from chapter 2: the same situation, at the chosen second, one step at a time
$('toSlow').addEventListener('click', () => {
  const v = labView();
  leaveHand(); st.ext = v;
  st.method = v.method === 'paper' || v.method === 'legacy' ? v.method : 'plus';
  showChapter(1, false); showPart(3);
  rebuild(v.at, (sim) => sim.boxes.find((b) => b.end > v.at));
  $('stage').scrollIntoView({ block: 'start' });
});
$('fromLabBack').addEventListener('click', () => showChapter(2));
$('fromLabReset').addEventListener('click', () => { st.ext = null; rebuild(); });
$('prev').addEventListener('click', () => { stop(); go(st.g - 1); });
$('next').addEventListener('click', () => { stop(); go(st.g + 1); });
$('step').addEventListener('input', () => { stop(); go(Number($<HTMLInputElement>('step').value)); });
$('play').addEventListener('click', () => {
  if (st.timer) return stop();
  if (st.g >= st.sim!.steps - 1) go(0);
  $('play').textContent = '❚❚ 停止';
  st.timer = window.setInterval(() => { if (st.g >= st.sim!.steps - 1) return stop(); go(st.g + 1); }, 1400);
});

// ---- part 5: jump to a scene. Each scene sets the conditions under which it shows up.
const selectOf = (b: BoxRecord) => (b.steps[0].kind === 'select' ? b.steps[0] : null);
const late = (b: BoxRecord): boolean => b.start > ms(800);
interface Scene { label: string; note: string; method: MethodId; n: number; crit: boolean; find: (sim: SimResult, b: BoxRecord) => boolean }
const SCENES: Scene[] = [
  { label: '箱の最大長', note: '次の固定タスクが遠い場面です。箱を長くしすぎると、あとから来た要求を待たせるので、捜索だけで箱を閉じます。',
    method: 'paper', n: 6, crit: false, find: (_s, b) => late(b) && selectOf(b)?.why === 'maxDrsi' },
  { label: '連結', note: '固定タスクを隙間なしで続けて置く場面です。箱が延び、長い捜索ドウェルも入りやすくなります。',
    method: 'paper', n: 10, crit: false, find: (_s, b) => late(b) && b.steps.filter((x) => x.kind === 'chain').length >= 2 },
  { label: '割り込み', note: '緊急タスクの通知で、組んだ箱を途中で打ち切る場面です。始まっていないものはキューへ戻します。',
    method: 'paper', n: 8, crit: true, find: (_s, b) => b.interrupted },
  { label: '先読みの違い', note: '本ツールの拡張が、後ろで待つ固定タスクのために仮置きを手前へずらす場面です。「論文の記述どおり」に切り替えると、同じ時刻でずらさない動きを見られます。',
    method: 'plus', n: 10, crit: false, find: (s, b) => { const x = selectOf(b); return late(b) && !!x && x.nft !== null && x.caseNo === 1 && x.tentative! < s.requests[x.nft].latest; } },
];
$('scenes').innerHTML = SCENES.map((s, i) => `<button type="button" class="ghost" data-scene="${i}">${s.label}</button>`).join('');
$('scenes').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button');
  if (!b) return;
  const sc = SCENES[Number(b.dataset.scene)];
  leaveHand(); st.ext = null;
  st.method = sc.method;
  $<HTMLInputElement>('n').value = String(sc.n);
  $<HTMLInputElement>('crit').checked = sc.crit;
  $<HTMLSelectElement>('fill').value = 'pace';
  rebuild(null, (sim) => sim.boxes.find((x) => sc.find(sim, x)));
  $('scenes').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  $('sceneNote').textContent = `${sc.note}（目標 ${sc.n}、${METHODS[sc.method].label}${sc.crit ? '、緊急タスクあり' : ''}。箱の最大長は ${msTxt(DEFAULT_CONFIG.maxDrsi)}）`;
});

// ---- part 5: the three hand-built cases, side by side, each with a step-by-step view
const HAND_TEXT: Record<HandCaseId, { title: string; when: string; result: (a: string, b: string) => string }> = {
  case1: { title: 'ケース1', when: '上位のAの期限が先に来る', result: (a, b) => `Aを次の固定タスクに選びます。捜索を詰めたあと A は ${a} に実行、その直後の ${b} に B を連結しました。入れ替えはありません。` },
  case2: { title: 'ケース2', when: '下位のBの期限が先に来て、Aが始まる前に終われる', result: (a, b) => `Bを先に選びます（優先度の順とは逆）。B は ${b}、その直後の ${a} に A を実行しました。A は許容範囲の中です。` },
  case3: { title: 'ケース3', when: '下位のBが、Aの前にも後ろにも入らない', result: (a) => `Aを選び、A は ${a} に実行しました。B はタスク管理へ返します。順番が回らないまま許容範囲を過ぎ、取りこぼし（✕）になりました。` },
};
const HAND_IDS = Object.keys(HAND_CASES) as HandCaseId[];
const handSim = new Map<HandCaseId, SimResult>();
const handRun = (id: HandCaseId): SimResult => {
  if (!handSim.has(id)) handSim.set(id, simulate(handScenario(id), { ...configOf('paper', HAND_CONFIG.fill), trace: false }));
  return handSim.get(id)!;
};
function leaveHand(): void {
  st.hand = null;
  $('hands').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', 'false'));
}
$('hands').innerHTML = HAND_IDS.map((id) => {
  const c = HAND_CASES[id], io = (n: string, [req, lead, trail, len]: readonly number[]): string => `${n}：要求 ${req} ms、スラック 前${lead}・後${trail} ms、長さ ${len} ms`;
  const r = handRun(id), at = (k: number): string => (r.requests[k].start === null ? '—' : msTxt(r.requests[k].start!));
  return `<figure class="hand"><figcaption><b>${HAND_TEXT[id].title}</b>${HAND_TEXT[id].when}</figcaption>` +
    `<div class="io">${io('A（上位）', c.a)}<br>${io('B（下位）', c.b)}</div>` +
    `<canvas data-hand="${id}" role="img" aria-label="${HAND_TEXT[id].title}の結果のタイムライン"></canvas>` +
    `<p>${HAND_TEXT[id].result(at(0), at(1))}</p><button type="button" class="ghost" data-hand="${id}" aria-pressed="false">1手ずつ見る ▼</button></figure>`;
}).join('');
function drawHands(): void {
  for (const id of HAND_IDS) {
    const sim = handRun(id);
    drawTimeline($('hands').querySelector<HTMLCanvasElement>(`canvas[data-hand="${id}"]`)!, { sim, x0: -HAND_BACK, span: HAND_SPAN, targets: [0, 1],
      seen: { t: sim.end }, cursor: sim.end + HAND_SPAN, regions: false, box: null, boxRow: true });
  }
}
$('hands').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button');
  if (!b) return;
  st.ext = null; st.hand = b.dataset.hand as HandCaseId;
  st.method = 'paper';
  $('scenes').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', 'false'));
  $('hands').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  rebuild(null, (sim) => sim.boxes[0]);
  $('sceneNote').textContent = '';
  $('stage').scrollIntoView({ block: 'start', behavior: 'smooth' });
});

// ---- parts
let part = 1;
const PART_NAMES = ['', '① 目標の一生', '② 要求の一生', '③ 箱の組み立て', '④ 従来型と比べる', '⑤ 特別な場面'];
function showPart(p: number, scroll = false): void {
  part = p; stop();
  if (p !== 5 && st.hand) { leaveHand(); st.sim = null; }
  if (p !== 3 && st.ext) { st.ext = null; st.sim = null; }
  document.querySelectorAll<HTMLElement>('.part').forEach((x) => { x.hidden = Number(x.dataset.part) !== p; });
  $('parts').querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(Number(b.dataset.part) === p)));
  $('stage').hidden = p < 3;
  $('partNext').textContent = p < 5 ? `次へ：${PART_NAMES[p + 1]} ▶` : '次の章へ ▶';
  // part 5 starts from the dynamic RSI again, not from the legacy view left over from part 4
  if (p === 5 && st.method === 'legacy' && st.sim && !st.hand) { const at = current().box.start; st.method = 'plus'; rebuild(at); }
  if (p === 4 && st.method !== 'legacy' && st.sim) { const at = current().box.start; st.method = 'legacy'; rebuild(at); }
  if (scroll) $('parts').scrollIntoView({ block: 'start' });
  const tab = $('parts').querySelector<HTMLElement>(`[data-part="${p}"]`);
  if (tab) $('parts').scrollLeft = tab.offsetLeft - $('parts').offsetLeft - 16;
  redraw();
}
$('parts').addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest('button'); if (b) showPart(Number(b.dataset.part)); });
$('partNext').addEventListener('click', () => (part < 5 ? showPart(part + 1, true) : showChapter(2)));

// ================= redraw whatever is visible =================
function redraw(): void {
  if (chapter === 0) drawIntro();
  if (chapter === 2 || chapter === 3) drawLab(chapter);
  if (chapter === 1) {
    if (part === 1) drawLife();
    if (part === 2) drawRequest();
    if (part === 5) drawHands();
    if (part >= 3) { if (!st.sim) rebuild(); else drawStage(); }
  }
}
let rz = 0;
window.addEventListener('resize', () => { clearTimeout(rz); rz = window.setTimeout(redraw, 120); });
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redraw);
new MutationObserver(redraw).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
void document.fonts?.ready.then(redraw);

showPart(1);
const m0 = /^#ch(\d)$/.exec(location.hash);
showChapter(m0 ? Number(m0[1]) : 0, false);
