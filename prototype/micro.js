// Slow-motion view: a simplified dynamic-RSI scheduler after Smouse, Liu & Sylvester (2020),
// run on a small didactic scenario and recorded step by step.
const M_PAT = [
  { name: '水平線', beams: 12, len: 15, dft: 600 },
  { name: '上空', beams: 20, len: 10, dft: 1000 },
];
const M_MAXD = 150, M_DUR = 6000;

const M_RSI = 100;
function microBuild(nT, seed, mode) {
  let a = seed | 0;
  const r = () => { a = (a + 0x6d2b79f5) | 0; let x = Math.imul(a ^ (a >>> 15), 1 | a); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  const pats = M_PAT.map((p) => Object.assign({}, p, { PL: p.beams * p.len, pst: 0, done: 0, idx: 0, frames: [] }));
  const tg = [];
  for (let i = 0; i < nT; i++) {
    const pat = r() < 0.6 ? 0 : 1, fast = r() < 0.35;
    tg.push({ id: i, pat, beam: Math.floor(r() * M_PAT[pat].beams), len: 8 + 2 * Math.floor(r() * 5),
      interval: fast ? 300 : 600, fast, prio: fast ? 1 : 2, state: 0, miss: 0 });
  }
  const events = [], reqs = [], steps = [], drsis = [], marks = [], gapList = [];
  let pending = [], inbox = [], t = 0, gaps = 0, drops = 0;
  const S = () => steps.length;
  const sec = (ms) => (ms / 1000).toFixed(3) + ' s';
  const nm = (q) => `目標${q.target + 1}の${q.kind === 'confirm' ? '確認照射' : q.retry ? '再照射' : '追尾更新'}`;
  const addReq = (o) => { o.created = S(); o.earliest = o.req - o.lead; o.latest = o.req + o.trail; o.res = null; reqs.push(o); inbox.push(o); };
  const flush = () => { if (inbox.length) { pending.push(...inbox); inbox = []; } };
  const trackReq = (g, from) => addReq({ target: g.id, kind: 'track', req: from + g.interval, lead: g.interval * 0.08, trail: g.interval * 0.08, len: g.len, prio: g.prio });
  function onFail(q, at) {
    const g = tg[q.target];
    if (q.kind === 'confirm') { g.state = 0; marks.push({ t: at, target: g.id, kind: 'lost', step: S() }); return '探知を確認できず、捜索からやり直し'; }
    if (++g.miss >= 3) { g.state = 0; g.miss = 0; marks.push({ t: at, target: g.id, kind: 'lost', step: S() }); return '3回連続で失敗し追尾ロスト'; }
    addReq({ target: g.id, kind: 'track', retry: true, req: at + 30, lead: 25, trail: 60, len: g.len, prio: g.prio });
    return 'すぐに再照射を要求';
  }
  function exec(q, st) {
    pending = pending.filter((x) => x !== q);
    const g = tg[q.target], hit = r() < (q.kind === 'confirm' ? 0.92 : 0.88);
    q.res = 'exec'; q.start = st; q.resStep = S();
    events.push({ kind: 'fixed', type: q.kind, target: g.id, start: st, len: q.len, step: S(), hit });
    if (hit) {
      if (q.kind === 'confirm') { g.state = 2; marks.push({ t: st + q.len, target: g.id, kind: 'trk', step: S() }); }
      g.miss = 0; trackReq(g, st);
      return `${nm(q)}は命中${q.kind === 'confirm' ? '、追尾開始' : ''}。次の要求は ${sec(st + g.interval)}`;
    }
    return `${nm(q)}は外れ。${onFail(q, st + q.len)}`;
  }
  const stats = () => ({
    eff: t > 0 ? 1 - gaps / t : 1, drops,
    frames: pats.map((p) => (p.frames.length ? p.frames.reduce((x, y) => x + y[1], 0) / p.frames.length : null)),
  });
  let lastFtd = [0, 0];
  const push = (o) => { o.stats = stats(); o.ftd = lastFtd; steps.push(o); };

  // ---- legacy: fixed-length RSI filled greedily in priority order
  while (mode === 'legacy' && t < M_DUR) {
    const d0 = t, end = d0 + M_RSI, notes = [];
    flush();
    for (const q of pending.filter((x) => x.latest < t)) {
      pending = pending.filter((x) => x !== q); q.res = 'drop'; q.resStep = S(); drops++;
      notes.push(`${nm(q)}は許容時間を過ぎて取りこぼし。${onFail(q, t)}`);
    }
    flush();
    const box = [d0, end], drsi = { start: d0, end, first: S(), last: 0 };
    drsis.push(drsi);
    lastFtd = pats.map((p) => (p.PL / p.dft) * (end - p.pst) - p.done);
    const cands = pending.filter((x) => x.earliest < end).sort((x, y) => x.prio - y.prio || x.req - y.req);
    push({ ph: 1, cut: d0, box, ghost: null,
      text: (notes.length ? notes.join('。') + '。' : '') + `長さ ${M_RSI} ms の箱を用意。この箱で扱う固定タスクは${cands.length ? cands.map((q) => `目標${q.target + 1}`).join('・') : 'なし'}。` });
    // step 2: fixed tasks in priority order, each at its earliest possible time
    let cur = d0, txt = ''; const slots = [];
    for (const q of cands) {
      const st = Math.max(cur, q.earliest);
      if (st > q.latest) { pending = pending.filter((x) => x !== q); q.res = 'drop'; q.resStep = S(); drops++; txt += `${nm(q)}は優先度の高いタスクの後ろに回り、間に合わず取りこぼし。${onFail(q, st)}。`; continue; }
      if (st + q.len > end) { txt += `${nm(q)}はこの箱に収まらず次へ持ち越し。`; continue; }
      slots.push([cur, st]); txt += exec(q, st) + '。'; cur = st + q.len;
    }
    slots.push([cur, end]);
    push({ ph: 2, cut: d0, box, ghost: null, text: txt || '置く固定タスクなし。' });
    // step 3: search in priority order, only while a pattern is behind its desired rate
    const placed = [0, 0]; let idle = 0;
    for (const [a0, b0] of slots) {
      let c = a0;
      for (;;) {
        const i = pats.findIndex((p) => c + p.len <= b0 + 1e-9 && (p.PL / p.dft) * (end - p.pst) - p.done > 0);
        if (i < 0) break;
        const p = pats[i];
        events.push({ kind: 'flex', pat: i, start: c, len: p.len, step: S() });
        for (const g of tg) if (g.state === 0 && g.pat === i && g.beam === p.idx && r() < 0.85) {
          g.state = 1; marks.push({ t: c + p.len, target: g.id, kind: 'det', step: S() });
          addReq({ target: g.id, kind: 'confirm', req: c + p.len + 100, lead: 90, trail: 100, len: 12, prio: 0 });
        }
        c += p.len; p.done += p.len; placed[i]++;
        if (++p.idx === p.beams) { p.frames.push([c, c - p.pst]); p.pst = c; p.done = 0; p.idx = 0; }
      }
      if (b0 - c > 0.01) { gaps += b0 - c; idle += b0 - c; gapList.push({ start: c, len: b0 - c, step: S() }); }
    }
    t = end; drsi.last = S();
    push({ ph: 3, cut: end, box, ghost: null,
      text: `空いた所を捜索で埋める。優先度の高い水平線が先で、${pats.map((p, i) => `${p.name} ${placed[i]}本`).join('、')}。` + (idle > 0.01 ? `${idle.toFixed(0)} ms は使われずに残った。` : '隙間なし。') });
  }
  while (mode !== 'legacy' && t < M_DUR) {
    const d0 = t, notes = [];
    flush();
    // ---- step 1: pick the next fixed task (earliest deadline, higher priority wins a conflict)
    for (const q of pending.filter((x) => x.latest < t)) {
      pending = pending.filter((x) => x !== q); q.res = 'drop'; q.resStep = S(); drops++;
      notes.push(`${nm(q)}は許容時間を過ぎて取りこぼし。${onFail(q, t)}`);
    }
    let nft = null;
    for (;;) {
      flush();
      const c = pending.filter((x) => x.earliest - t <= M_MAXD).sort((x, y) => x.latest - y.latest);
      if (!c.length) break;
      const e = c[0], st = Math.max(t, e.earliest);
      const blocker = pending.find((x) => x !== e && x.prio < e.prio && st + e.len > x.latest);
      if (blocker) {
        pending = pending.filter((x) => x !== e); e.res = 'drop'; e.resStep = S(); drops++;
        notes.push(`${nm(e)}は優先度の高い${nm(blocker)}と重なるため見送り。${onFail(e, e.latest)}`);
        continue;
      }
      nft = e; break;
    }
    let limit = t + M_MAXD;
    if (nft) {
      limit = nft.latest;
      // leave room for the fixed tasks that must follow back to back
      const floor = Math.max(t, nft.earliest); let acc = nft.len;
      for (const x of pending.filter((y) => y !== nft).sort((y, z) => y.latest - z.latest)) {
        if (x.earliest > limit + acc) continue; // not reachable back to back
        const cand = x.latest - acc;
        if (cand < limit && !(cand >= floor || x.prio < nft.prio)) continue; // cannot be saved
        limit = Math.min(limit, cand); acc += x.len;
      }
      limit = Math.max(limit, floor);
    }
    const box = [d0, limit + (nft ? nft.len : 0)];
    const drsi = { start: d0, end: box[1], first: S(), last: 0 };
    drsis.push(drsi);
    push({ ph: 1, cut: t, box, ghost: nft ? { req: nft, start: limit } : null,
      text: (notes.length ? notes.join('。') + '。' : '') + (nft
        ? `${nm(nft)}を選択。要求時刻 ${sec(nft.req)}、許容範囲 ${sec(nft.earliest)}〜${sec(nft.latest)}。いちばん遅い位置に仮置きして、そこまでを1つの箱にする。`
        : `近くに固定タスクがないので、上限 ${M_MAXD} ms の箱を捜索だけで作る。`) });
    // ---- step 2: flexible task deficits
    lastFtd = pats.map((p) => (p.PL / p.dft) * (t - p.pst) - p.done);
    const lead = lastFtd[0] >= lastFtd[1] ? 0 : 1;
    push({ ph: 2, cut: t, box, ghost: nft ? { req: nft, start: limit } : null,
      text: `捜索の不足量を計算。${pats.map((p, i) => `${p.name} ${lastFtd[i] >= 0 ? '+' : '−'}${Math.abs(lastFtd[i]).toFixed(0)} ms`).join('、')}。不足が大きい${pats[lead].name}から詰める。` });
    // ---- step 3: fill the box with flexible events, largest deficit first
    let cur = t; const placed = [0, 0];
    for (;;) {
      let best = -1, bv = -Infinity;
      pats.forEach((p, i) => { if (cur + p.len > limit + 1e-9) return; const f = (p.PL / p.dft) * (t - p.pst) - p.done; if (f > bv) { bv = f; best = i; } });
      if (best < 0) break;
      const p = pats[best];
      events.push({ kind: 'flex', pat: best, start: cur, len: p.len, step: S() });
      for (const g of tg) if (g.state === 0 && g.pat === best && g.beam === p.idx && r() < 0.85) {
        g.state = 1; marks.push({ t: cur + p.len, target: g.id, kind: 'det', step: S() });
        addReq({ target: g.id, kind: 'confirm', req: cur + p.len + 100, lead: 90, trail: 100, len: 12, prio: 0 });
      }
      cur += p.len; p.done += p.len; placed[best]++;
      if (++p.idx === p.beams) { p.frames.push([cur, cur - p.pst]); p.pst = cur; p.done = 0; p.idx = 0; }
    }
    push({ ph: 3, cut: cur, box, ghost: nft ? { req: nft, start: limit } : null,
      text: `箱を捜索で埋める。${pats.map((p, i) => `${p.name} ${placed[i]}本`).join('、')}。` + (inbox.length ? `捜索ビームが${inbox.map((q) => `目標${q.target + 1}`).join('・')}を探知し、確認照射を要求。` : '') });
    // ---- step 4: slide the fixed task forward to close the gap, then chain adjacent fixed tasks
    let txt;
    if (nft) {
      const st = Math.max(cur, nft.earliest), gap = st - cur;
      if (gap > 0.01) { gaps += gap; gapList.push({ start: cur, len: gap, step: S() }); }
      txt = (limit - st > 0.5 ? `仮置きの ${sec(limit)} から ${sec(st)} へ前に寄せる。` : '仮置きの位置のまま実行。') +
        (gap > 0.01 ? `許容範囲より前には動かせず、${gap.toFixed(0)} ms の隙間が残った。` : '隙間なし。') + exec(nft, st) + '。';
      cur = st + nft.len;
      for (;;) {
        flush();
        const c = pending.filter((x) => x.earliest <= cur && x.latest >= cur).sort((x, y) => x.latest - y.latest)[0];
        if (!c) break;
        txt += `続けて、${exec(c, cur)}。`; cur += c.len;
      }
    } else txt = '固定タスクなしで箱を閉じる。';
    t = cur > d0 ? cur : d0 + 1;
    drsi.end = t; drsi.last = S();
    push({ ph: 4, cut: t, box: [d0, t], ghost: null, text: txt });
  }
  return { tg, pats, events, reqs, steps, drsis, marks, gapList };
}

if (typeof module !== 'undefined') module.exports = { microBuild };

if (typeof document !== 'undefined') (function () {
  const $ = (id) => document.getElementById(id);
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  let sim = null, k = 0, timer = 0;
  const SPAN = 600, BACK = 200;

  function draw() {
    const st = sim.steps[k], cv = $('mCanvas'), dpr = window.devicePixelRatio || 1;
    const nT = sim.tg.length, L = 50, R = 6, lh = 20, top = 4;
    const yPat = top + nT * lh + 8, yBox = yPat + 2 * 16 + 10, boxH = 40, H = yBox + boxH + 22;
    const W = cv.clientWidth; cv.style.height = H + 'px'; cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, W, H);
    const x0 = st.box[0] - BACK, X = (t) => L + ((t - x0) / SPAN) * (W - L - R);
    const C = { s: css('--s-search'), t: css('--s-track'), a: css('--s-aux'), ink: css('--ink'), ink2: css('--ink2'), mut: css('--muted'),
      line: css('--line'), soft: css('--accent-soft'), crit: css('--crit'), over: css('--over'), idle: css('--s-idle'), surf: css('--surface') };
    const font = css('--font'), mono = css('--mono');
    g.save(); g.beginPath(); g.rect(L, 0, W - L - R, H); g.clip();
    // lane backgrounds: tracked intervals
    for (let i = 0; i < nT; i++) {
      const y = top + i * lh; let from = null;
      for (const m of sim.marks) {
        if (m.target !== i || m.step > k) continue;
        if (m.kind === 'trk') from = m.t;
        if (m.kind === 'lost' && from !== null) { g.fillStyle = C.soft; g.fillRect(X(from), y + 2, X(m.t) - X(from), lh - 4); from = null; }
      }
      if (from !== null) { g.fillStyle = C.soft; g.fillRect(X(from), y + 2, X(st.cut) - X(from), lh - 4); }
      g.strokeStyle = C.line; g.lineWidth = 1; g.beginPath(); g.moveTo(L, y + lh + 0.5); g.lineTo(W, y + lh + 0.5); g.stroke();
    }
    // requests: allowed window as an outline, requested time as a tick
    for (const q of sim.reqs) {
      if (q.created > k) continue;
      const y = top + q.target * lh, xa = X(q.earliest), xb = X(q.latest + q.len);
      if (xb < L || xa > W) continue;
      const open = q.res === null || q.resStep > k;
      g.strokeStyle = open ? C.ink2 : C.mut; g.lineWidth = 1; g.setLineDash(open ? [] : [2, 2]);
      g.strokeRect(xa + 0.5, y + 3.5, xb - xa, lh - 7); g.setLineDash([]);
      g.beginPath(); g.moveTo(X(q.req), y + 1); g.lineTo(X(q.req), y + lh - 1); g.stroke();
      if (!open && q.res === 'drop') { g.fillStyle = C.crit; g.font = '700 12px ' + font; g.textAlign = 'center'; g.fillText('✕', X(q.req), y + lh - 5); }
    }
    // executed events
    for (const e of sim.events) {
      if (e.step > k) continue;
      const xa = X(e.start), w = Math.max(X(e.start + e.len) - xa - 0.6, 1);
      if (xa > W || xa + w < L) continue;
      if (e.kind === 'flex') {
        g.fillStyle = C.s;
        g.fillRect(xa, yPat + e.pat * 16 + 2, w, 12);
        g.fillRect(xa, yBox + (e.pat ? 12 : 4), w, boxH - (e.pat ? 16 : 8));
      } else {
        const y = top + e.target * lh, col = e.type === 'confirm' ? C.a : C.t;
        if (e.hit) { g.fillStyle = col; g.fillRect(xa, y + 5, w, lh - 10); }
        else { g.strokeStyle = col; g.lineWidth = 1.5; g.strokeRect(xa + 0.75, y + 5.75, w - 1.5, lh - 11.5);
          g.fillStyle = C.crit; g.font = '700 10px ' + font; g.textAlign = 'center'; g.fillText('✕', xa + w / 2, y + 4); }
        g.fillStyle = col; g.fillRect(xa, yBox + 4, w, boxH - 8);
      }
    }
    for (const m of sim.marks) {
      if (m.step > k || m.kind !== 'det') continue;
      const x = X(m.t), y = top + m.target * lh + lh / 2;
      g.fillStyle = C.a; g.beginPath(); g.moveTo(x, y - 5); g.lineTo(x + 5, y); g.lineTo(x, y + 5); g.lineTo(x - 5, y); g.fill();
    }
    for (const gp of sim.gapList) if (gp.step <= k) { g.fillStyle = C.over; g.fillRect(X(gp.start), yBox + 4, X(gp.start + gp.len) - X(gp.start), boxH - 8); }
    // boxes (DRSI)
    for (const d of sim.drsis) {
      if (d.first > k) continue;
      const fin = d.last <= k, a = X(d.start), b = X(fin ? d.end : st.box[1]);
      const cur = k >= d.first && k <= d.last;
      g.strokeStyle = cur ? C.ink : C.mut; g.lineWidth = cur ? 2 : 1; g.setLineDash(fin ? [] : [5, 3]);
      g.strokeRect(a + 1, yBox + 1, b - a - 2, boxH - 2); g.setLineDash([]);
    }
    if (st.ghost) {
      const q = st.ghost.req, xa = X(st.ghost.start), w = X(st.ghost.start + q.len) - xa;
      g.strokeStyle = q.kind === 'confirm' ? C.a : C.t; g.lineWidth = 1.5; g.setLineDash([3, 2]);
      g.strokeRect(xa, top + q.target * lh + 5, w, lh - 10); g.strokeRect(xa, yBox + 4, w, boxH - 8); g.setLineDash([]);
    }
    g.strokeStyle = C.ink; g.lineWidth = 1; g.beginPath(); g.moveTo(X(st.cut) + 0.5, 0); g.lineTo(X(st.cut) + 0.5, yBox + boxH); g.stroke();
    g.font = '11px ' + mono; g.fillStyle = C.mut; g.textAlign = 'center';
    for (let t = Math.ceil(x0 / 100) * 100; t <= x0 + SPAN; t += 100) if (t >= 0) g.fillText((t / 1000).toFixed(1) + ' s', X(t), H - 4);
    g.restore();
    g.textAlign = 'left'; g.textBaseline = 'middle';
    sim.tg.forEach((tgt, i) => { g.font = (tgt.fast ? '700 ' : '') + '12px ' + font; g.fillStyle = C.ink; g.fillText('目標' + (i + 1), 2, top + i * lh + lh / 2); });
    g.font = '12px ' + font; g.fillStyle = C.ink2;
    sim.pats.forEach((p, i) => g.fillText(p.name, 2, yPat + i * 16 + 8));
    g.font = '700 12px ' + font; g.fillStyle = C.ink; g.fillText('箱', 2, yBox + boxH / 2);

    const names = $('mMode').value === 'legacy' ? ['固定長の箱を用意', '固定タスクを優先度順に置く', '残りを捜索で埋める'] : ['次の固定タスクを選ぶ', '捜索の不足量を計算', '箱を捜索で埋める', '固定タスクを寄せて実行'];
    $('mCaption').innerHTML = `<div class="phases">${names.map((n, i) => `<span class="${i + 1 === st.ph ? 'on' : ''}">${'①②③④'[i]} ${n}</span>`).join('')}</div><p>${st.text}</p>`;
    const mx = Math.max(60, ...st.ftd.map(Math.abs));
    $('mFtd').innerHTML = sim.pats.map((p, i) => {
      const v = st.ftd[i], w = (Math.abs(v) / mx) * 50;
      return `<span>${p.name}の不足量</span><div class="ftd"><i style="${v >= 0 ? 'left:50%' : `right:50%`};width:${w}%;background:var(${v >= 0 ? '--s-search' : '--muted'})"></i></div><b>${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(0)} ms</b>`;
    }).join('');
    const s = st.stats, f = (v, i) => (v === null ? '計測中' : (v / 1000).toFixed(2) + ' s') + `（所望 ${(M_PAT[i].dft / 1000).toFixed(1)} s）`;
    $('mStats').innerHTML = `ここまでの成績：占有率 <b>${(s.eff * 100).toFixed(1)} %</b>・取りこぼし <b>${s.drops} 件</b>・フレームタイム 水平線 <b>${f(s.frames[0], 0)}</b>、上空 <b>${f(s.frames[1], 1)}</b>`;
    $('mStep').value = k; $('mStepOut').textContent = `${k + 1} / ${sim.steps.length}`;
  }
  function stop() { clearInterval(timer); timer = 0; $('mPlay').textContent = '▶ 再生'; }
  function go(n) { k = Math.max(0, Math.min(sim.steps.length - 1, n)); draw(); }
  function rebuild() {
    stop(); $('mNOut').textContent = $('mN').value;
    const n = +$('mN').value, mode = $('mMode').value;
    sim = microBuild(n, 11, mode);
    const row = (label, b) => { const s = b.steps[b.steps.length - 1].stats, lost = b.marks.filter((m) => m.kind === 'lost').length;
      return `<tr><td>${label}</td><td>${(s.eff * 100).toFixed(1)} %</td><td>${s.drops}</td><td>${lost}</td>` + s.frames.map((v) => `<td>${v === null ? '—' : (v / 1000).toFixed(2) + ' s'}</td>`).join('') + '</tr>'; };
    $('mCompare').innerHTML = '<thead><tr><th>6秒間の成績</th><th>占有率</th><th>取りこぼし</th><th>ロスト</th><th>水平線<br>所望 0.6 s</th><th>上空<br>所望 1.0 s</th></tr></thead><tbody>' +
      row('動的RSI', mode === 'legacy' ? microBuild(n, 11, 'drsi') : sim) + row('従来型', mode === 'legacy' ? sim : microBuild(n, 11, 'legacy')) + '</tbody>';
    $('mStep').max = sim.steps.length - 1;
    go(Math.max(0, sim.steps.findIndex((s, i) => i > 30 && s.ph === 1 && (s.ghost || mode === 'legacy'))));
  }
  $('mN').addEventListener('input', rebuild);
  $('mMode').addEventListener('change', rebuild);
  $('mPrev').addEventListener('click', () => { stop(); go(k - 1); });
  $('mNext').addEventListener('click', () => { stop(); go(k + 1); });
  $('mStep').addEventListener('input', () => { stop(); go(+$('mStep').value); });
  $('mPlay').addEventListener('click', () => {
    if (timer) return stop();
    if (k >= sim.steps.length - 1) go(0);
    $('mPlay').textContent = '❚❚ 停止';
    timer = setInterval(() => { if (k >= sim.steps.length - 1) return stop(); go(k + 1); }, 1100);
  });
  let rz = 0; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(draw, 120); });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', draw);
  new MutationObserver(draw).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(draw);
  rebuild();
})();
