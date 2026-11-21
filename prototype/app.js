// MFR beam scheduling lab: UI
(function () {
  const $ = (id) => document.getElementById(id);
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const DUR = 95000, WARM = 60000;
  const SWEEP_N = [20, 40, 60, 80, 100, 120, 140, 160, 180, 200, 220];
  let resA, resB, sweep = null, sweepTimer = 0, sweepRun = 0;

  for (const id of ['schedA', 'schedB']) {
    $(id).innerHTML = SCHEDULERS.map((s) => `<option value="${s.id}">${s.name}</option>`).join('');
  }
  $('schedA').value = 'priority'; $('updA').value = 'fixed';
  $('schedB').value = 'tb'; $('updB').value = 'fixed';
  $('sweepLegend').innerHTML = SCHEDULERS.map((s, i) =>
    `<span><span class="box" style="background:var(--m${i + 1})"></span>${s.name}</span>`).join('');

  function base() {
    return {
      nTargets: +$('nTargets').value, highFrac: +$('highFrac').value / 100,
      searchScale: +$('frameReq').value / 3, fixedInterval: +$('fixedInt').value * 1000,
      trackFrac: +$('trackFrac').value / 100, duration: DUR, warmup: WARM, seed: 7,
    };
  }
  const cfgOf = (side) => Object.assign(base(), { scheduler: $('sched' + side).value, adaptive: $('upd' + side).value === 'adaptive' });

  function outputs() {
    $('nTargetsOut').textContent = $('nTargets').value;
    $('highFracOut').textContent = $('highFrac').value + ' %';
    $('frameReqOut').textContent = (+$('frameReq').value).toFixed(1) + ' s';
    $('fixedIntOut').textContent = (+$('fixedInt').value).toFixed(2) + ' s';
    $('trackFracOut').textContent = $('trackFrac').value + ' %';
  }

  // ---------- KPI table
  const chip = (lvl) => {
    const m = { good: ['●', '要求内'], warn: ['▲', '遅れ'], crit: ['✕', '超過'] }[lvl];
    return `<span class="chip ${lvl}"><i>${m[0]}</i>${m[1]}</span>`;
  };
  const heldChip = (h) => {
    const lvl = h >= 0.97 ? 'good' : h >= 0.9 ? 'warn' : 'crit';
    const m = { good: ['●', '良好'], warn: ['▲', '低下'], crit: ['✕', '劣化'] }[lvl];
    return `<span class="chip ${lvl}"><i>${m[0]}</i>${m[1]}</span>`;
  };
  function frameCell(r, i) {
    const ratio = r.frameMean[i] / r.frameReq[i];
    const lvl = ratio <= 1.1 ? 'good' : ratio <= 1.5 ? 'warn' : 'crit';
    return `${(r.frameMean[i] / 1000).toFixed(1)} <small>/ ${(r.frameReq[i] / 1000).toFixed(1)} s</small>${chip(lvl)}`;
  }
  function renderKpi() {
    const name = (r) => SCHEDULERS.find((s) => s.id === r.cfg.scheduler).name + (r.cfg.adaptive ? '＋適応' : '');
    const rows = [
      ...SECTORS.map((s, i) => [`捜索フレームタイム：${s.name}`, (r) => frameCell(r, i)]),
      ['追尾維持率', (r) => (r.held * 100).toFixed(1) + ' %' + heldChip(r.held)],
      ['追尾ロスト', (r) => r.dropRate.toFixed(1) + ' <small>回/分</small>'],
      ['追尾更新の遅れ <small>（更新間隔比）</small>', (r) => (r.lateMean * 100).toFixed(0) + ' %'],
      ['更新時の予測誤差 <small>（ビーム幅比）</small>', (r) => r.uMean.toFixed(2)],
      ['照射ミス率', (r) => (r.missRate * 100).toFixed(1) + ' %'],
      ['空き時間', (r) => (r.occ.idle * 100).toFixed(0) + ' %'],
    ];
    $('kpi').innerHTML =
      `<thead><tr><th>指標</th><th><span class="tag"><span class="sw"></span>A</span><br>${name(resA)}</th><th><span class="tag"><span class="sw b"></span>B</span><br>${name(resB)}</th></tr></thead><tbody>` +
      rows.map(([l, f]) => `<tr><td>${l}</td><td>${f(resA)}</td><td>${f(resB)}</td></tr>`).join('') + '</tbody>';
  }

  // ---------- per-second boxes over time (stacked columns) with demand line
  const stackMarks = [];
  function renderStacks() {
    stackMarks.length = 0;
    const host = $('stacks'); host.innerHTML = '';
    [['A', resA, ''], ['B', resB, ' b']].forEach(([n, r, cl]) => {
      const dm = demand(r.cfg), ns = r.perSec[0].length;
      const fs = Math.min(1, r.occ.search / dm.search), ft = dm.track ? Math.min(1, r.occ.track / dm.track) : 1;
      const tot = dm.search + dm.track;
      let verdict;
      if (tot <= 1 && fs > 0.93 && ft > 0.93) verdict = '最後まで箱に収まり、捜索も追尾も要求どおり';
      else if (fs < ft - 0.15) verdict = 'あふれた分は捜索が削られる';
      else if (ft < fs - 0.15) verdict = 'あふれた分は追尾が削られる';
      else verdict = 'あふれた分は捜索と追尾が同じくらい削られる';
      if (r.occ.idle > 0.05 && (fs < 0.93 || ft < 0.93)) verdict += '（空きは残る）';
      verdict += `　<span class="mname">60秒以降：捜索 ${(fs * 100).toFixed(0)} %・追尾 ${(ft * 100).toFixed(0)} % を実行</span>`;
      const name = SCHEDULERS.find((s) => s.id === r.cfg.scheduler).name + (r.cfg.adaptive ? '＋適応更新' : '');
      const wrap = document.createElement('div');
      wrap.innerHTML = `<div class="stackhead"><span class="tag"><span class="sw${cl}"></span>手法 ${n}</span><span class="mname">${name}</span><span class="verdict">${verdict}</span></div><div class="chart"></div>`;
      host.appendChild(wrap);
      const ch = wrap.lastChild, W = ch.clientWidth || 320, H = 190, m = { l: 38, r: 8, t: 8, b: 30 };
      const dmax = Math.max(...dm.series), ymax = dmax <= 1 ? 1.25 : Math.ceil(dmax * 4 + 0.2) / 4;
      const cw = (W - m.l - m.r) / ns, X = (k) => m.l + k * cw, Y = (v) => H - m.b - (v / ymax) * (H - m.t - m.b);
      let s = `<svg width="${W}" height="${H}" role="img" aria-label="手法${n}：1秒ごとの占有率と要求量の推移">`;
      const bw = Math.max(cw - 0.6, 0.8);
      for (let k = 0; k < ns; k++) {
        const a = r.perSec[0][k], b = r.perSec[1][k], c = r.perSec[2][k], d = Math.min(dm.series[k], ymax);
        if (d > 1) s += `<rect x="${X(k)}" y="${Y(d)}" width="${bw}" height="${Y(1) - Y(d)}" style="fill:var(--over)"/>`;
        s += `<rect x="${X(k)}" y="${Y(1)}" width="${bw}" height="${Y(0) - Y(1)}" style="fill:var(--s-idle)"/>`;
        let y = 0;
        for (const [v, col] of [[a, '--s-search'], [b, '--s-track'], [c, '--s-aux']]) {
          const v2 = Math.min(v, 1 - y); if (v2 <= 0.002) continue;
          s += `<rect x="${X(k)}" y="${Y(y + v2)}" width="${bw}" height="${Y(y) - Y(y + v2)}" style="fill:var(${col})"/>`; y += v2;
        }
      }
      for (let v = 0; v <= ymax + 1e-9; v += 0.5) s += `<text x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end" style="fill:var(--muted);font:11px var(--mono)">${v * 100}%</text>`;
      s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(1)}" y2="${Y(1)}" style="stroke:var(--ink2);stroke-width:1"/>`;
      s += `<text x="${m.l + 3}" y="${Y(1) - 4}" style="fill:var(--ink2);font:11px var(--font)">箱の上限</text>`;
      let dpath = '';
      for (let k = 0; k < ns; k++) { const yy = Y(Math.min(dm.series[k], ymax)).toFixed(1); dpath += (k ? 'L' : 'M') + X(k).toFixed(1) + ' ' + yy + 'L' + X(k + 1).toFixed(1) + ' ' + yy; }
      s += `<path d="${dpath}" fill="none" style="stroke:var(--ink);stroke-width:2;stroke-linejoin:round"/>`;
      for (const v of [0, 20, 40, 60, 80]) s += `<text x="${X(v)}" y="${H - m.b + 14}" text-anchor="middle" style="fill:var(--muted);font:11px var(--mono)">${v}</text>`;
      s += `<text x="${(m.l + W - m.r) / 2}" y="${H - 2}" text-anchor="middle" style="fill:var(--ink2);font:11.5px var(--font)">時刻（秒）</text>`;
      s += `<rect class="mark" y="${m.t}" width="${Math.max(cw, 2)}" height="${H - m.b - m.t}" style="fill:none;stroke:var(--ink);stroke-width:1.5"/></svg>`;
      ch.innerHTML = s;
      const svg = ch.firstChild;
      stackMarks.push({ el: svg.querySelector('.mark'), X });
      const pick = (ev) => {
        const px = ev.clientX - svg.getBoundingClientRect().left;
        setSel(Math.max(0, Math.min(ns - 1, Math.floor((px - m.l) / cw))));
      };
      svg.addEventListener('pointerdown', (ev) => { stopPlay(); pick(ev); });
      svg.addEventListener('pointermove', (ev) => { if (ev.buttons || ev.pointerType === 'touch') pick(ev); });
    });
  }
  let playTimer = 0;
  function stopPlay() { clearInterval(playTimer); playTimer = 0; $('play').textContent = '▶ 再生'; }
  function setSel(k) {
    $('sel').value = k; $('selOut').textContent = k + '〜' + (k + 1) + ' 秒';
    for (const mk of stackMarks) mk.el.setAttribute('x', mk.X(k));
    renderTimeline();
    const pc = (v) => (v * 100).toFixed(0);
    $('secRead').innerHTML = [['A', resA], ['B', resB]].map(([n, r]) => {
      const a = r.perSec[0][k], b = r.perSec[1][k], c = r.perSec[2][k], d = demand(r.cfg).series[k];
      return `<b>${n}</b>　入れたい量 <b>${pc(d)}%</b> → 捜索 <b>${pc(a)}%</b>・追尾 <b>${pc(b)}%</b>・確認/再照射 <b>${pc(c)}%</b>・空き <b>${pc(Math.max(0, 1 - a - b - c))}%</b>`;
    }).join('<br>');
  }
  $('play').addEventListener('click', () => {
    if (playTimer) return stopPlay();
    if (+$('sel').value >= 94) setSel(0);
    $('play').textContent = '❚❚ 停止';
    playTimer = setInterval(() => { const k = +$('sel').value + 1; if (k > 94) return stopPlay(); setSel(k); }, 220);
  });
  $('sel').addEventListener('input', () => { stopPlay(); setSel(+$('sel').value); });

  // ---------- timeline canvas
  function renderTimeline() {
    const cv = $('timeline'), dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth, H = 96;
    cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, W, H);
    const t0 = +$('sel').value * 1000, span = 1000, L = 22, R = 4;
    const X = (t) => L + ((t - t0) / span) * (W - L - R);
    const col = [css('--s-search'), css('--s-search'), css('--s-search'), css('--s-track'), css('--s-aux'), css('--s-aux')];
    const ink = css('--ink'), muted = css('--muted'), idle = css('--s-idle');
    g.font = '700 13px ' + css('--font'); g.textBaseline = 'middle';
    [[resA, 6, 'A'], [resB, 44, 'B']].forEach(([r, y, n]) => {
      g.fillStyle = ink; g.fillText(n, 2, y + 15);
      g.fillStyle = idle; g.fillRect(L, y, W - L - R, 30);
      const lg = r.log;
      for (let i = 0; i < lg.n; i++) {
        const s = lg.s[i], e = s + lg.d[i];
        if (e < t0) continue; if (s > t0 + span) break;
        const x0 = Math.max(X(s), L), x1 = Math.min(X(e), W - R);
        g.fillStyle = col[lg.t[i]];
        const h = lg.t[i] < 3 ? 30 - lg.t[i] * 5 : 30; // sector shown by bar height
        const w = x1 - x0; g.fillRect(x0, y + 30 - h, w > 3 ? w - 0.6 : w, h);
      }
    });
    g.font = '11px ' + css('--mono'); g.fillStyle = muted; g.textBaseline = 'alphabetic';
    for (let k = 0; k <= 4; k++) {
      const t = t0 + k * 250, x = X(t);
      g.textAlign = k === 0 ? 'left' : k === 4 ? 'right' : 'center';
      g.fillText((t / 1000).toFixed(2) + ' s', x, 92);
    }
  }

  // ---------- generic line chart with crosshair tooltip
  function niceStep(max, n) {
    const raw = max / n, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  }
  function lineChart(host, o) {
    const W = host.clientWidth || 320, H = 210, m = { l: 38, r: 12, t: 10, b: 34 };
    let ymax = o.yMax || 0;
    if (!o.yMax) { for (const s of o.series) for (const p of s.pts) if (p[1] > ymax) ymax = p[1]; if (o.ref) ymax = Math.max(ymax, o.ref.y); ymax = ymax || 1; }
    const step = niceStep(ymax, 4); if (!o.yMax) ymax = Math.ceil(ymax / step - 1e-9) * step;
    const [x0, x1] = o.x;
    const X = (v) => m.l + ((v - x0) / (x1 - x0)) * (W - m.l - m.r);
    const Y = (v) => H - m.b - (Math.min(v, ymax) / ymax) * (H - m.t - m.b);
    const dec = step < 1 ? 1 : 0;
    let s = `<svg width="${W}" height="${H}" role="img" aria-label="${o.label}">`;
    for (let v = 0; v <= ymax + 1e-9; v += step) {
      s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" style="stroke:var(${v === 0 ? '--axis' : '--line'})"/>` +
        `<text x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end" style="fill:var(--muted);font:11px var(--mono)">${v.toFixed(dec)}</text>`;
    }
    for (const v of o.xTicks) s += `<text x="${X(v)}" y="${H - m.b + 15}" text-anchor="middle" style="fill:var(--muted);font:11px var(--mono)">${v}</text>`;
    s += `<text x="${(m.l + W - m.r) / 2}" y="${H - 3}" text-anchor="middle" style="fill:var(--ink2);font:11.5px var(--font)">${o.xLabel}</text>`;
    if (o.ref) s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(o.ref.y)}" y2="${Y(o.ref.y)}" style="stroke:var(--muted);stroke-dasharray:2 3"/>` +
      `<text x="${W - m.r}" y="${Y(o.ref.y) - 4}" text-anchor="end" style="fill:var(--ink2);font:11px var(--font)">${o.ref.label}</text>`;
    for (const se of o.series) {
      if (!se.pts.length) continue;
      const d = se.pts.map((p, i) => (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1)).join('');
      s += `<path d="${d}" fill="none" style="stroke:var(${se.color});stroke-width:2;stroke-linejoin:round${se.dash ? ';stroke-dasharray:6 4' : ''}"/>`;
      if (o.dots) for (const p of se.pts) s += `<circle cx="${X(p[0])}" cy="${Y(p[1])}" r="3" style="fill:var(${se.color});stroke:var(--surface);stroke-width:1.5"/>`;
    }
    s += `<line class="xh" y1="${m.t}" y2="${H - m.b}" style="stroke:var(--axis);display:none"/></svg><div class="tip"></div>`;
    host.innerHTML = s;
    const svg = host.firstChild, xh = svg.querySelector('.xh'), tip = host.lastChild;
    const move = (ev) => {
      const b = svg.getBoundingClientRect(), px = ev.clientX - b.left;
      const xv = x0 + ((px - m.l) / (W - m.l - m.r)) * (x1 - x0);
      if (xv < x0 || xv > x1) return leave();
      let snap = null; const rows = [];
      for (const se of o.series) {
        let best = null, bd = Infinity;
        for (const p of se.pts) { const dd = Math.abs(p[0] - xv); if (dd < bd) { bd = dd; best = p; } }
        if (!best) continue;
        if (snap === null) snap = best[0];
        rows.push(`<span class="box" style="background:var(${se.color})"></span> ${se.name} <b>${o.fmt(best[1])}</b>`);
      }
      if (!rows.length) return leave();
      const sx = X(o.snap ? snap : xv);
      xh.setAttribute('x1', sx); xh.setAttribute('x2', sx); xh.style.display = '';
      tip.innerHTML = `<div style="color:var(--muted)">${o.xFmt(o.snap ? snap : xv)}</div>` + rows.join('<br>');
      tip.style.display = 'block';
      const tw = tip.offsetWidth;
      tip.style.left = Math.max(0, Math.min(W - tw, sx + (sx > W / 2 ? -tw - 10 : 10))) + 'px';
      tip.style.top = m.t + 'px';
    };
    const leave = () => { xh.style.display = 'none'; tip.style.display = 'none'; };
    svg.addEventListener('pointermove', move); svg.addEventListener('pointerdown', move);
    svg.addEventListener('pointerleave', leave);
  }

  function renderSeries() {
    const t0 = 0, t1 = DUR / 1000, ticks = [0, 20, 40, 60, 80];
    const tr = (r) => r.series.map((v, i) => [i, v]).filter((p) => p[0] >= t0 && p[0] <= t1);
    lineChart($('chTracked'), {
      label: '追尾中の目標数の時間推移', x: [t0, t1], xTicks: ticks, xLabel: '時刻（秒）',
      yMax: Math.max(10, Math.ceil(resA.nTargets / 20) * 20),
      series: [{ name: 'A', color: '--a', pts: tr(resA) }, { name: 'B', color: '--b', dash: true, pts: tr(resB) }],
      fmt: (v) => v.toFixed(0), xFmt: (v) => v.toFixed(0) + ' s',
    });
    const fr = (r) => r.frames[0].map((f) => [f[0] / 1000, f[1] / 1000]);
    lineChart($('chFrame'), {
      label: '水平線フレームタイムの時間推移', x: [t0, t1], xTicks: ticks, xLabel: '時刻（秒）',
      ref: { y: resA.frameReq[0] / 1000, label: '要求' },
      series: [{ name: 'A', color: '--a', pts: fr(resA) }, { name: 'B', color: '--b', dash: true, pts: fr(resB) }],
      fmt: (v) => v.toFixed(2) + ' s', xFmt: (v) => v.toFixed(0) + ' s',
    });
  }

  // ---------- sweep over target count
  function renderSweep() {
    if (!sweep) return;
    const mk = (f) => SCHEDULERS.map((s, i) => ({ name: s.name, color: '--m' + (i + 1), pts: (sweep[s.id] || []).map((r) => [r.nTargets, f(r)]) }));
    const x = [SWEEP_N[0], SWEEP_N[SWEEP_N.length - 1]], ticks = [20, 60, 100, 140, 180, 220];
    lineChart($('chSweepHeld'), { label: '目標数ごとの追尾維持率', x, xTicks: ticks, xLabel: '目標数', yMax: 100, dots: true, snap: true,
      series: mk((r) => r.held * 100), fmt: (v) => v.toFixed(1) + ' %', xFmt: (v) => '目標数 ' + v });
    lineChart($('chSweepFrame'), { label: '目標数ごとの水平線フレームタイム比', x, xTicks: ticks, xLabel: '目標数', dots: true, snap: true,
      ref: { y: 1, label: '要求' }, series: mk((r) => r.frameMean[0] / r.frameReq[0]), fmt: (v) => '×' + v.toFixed(2), xFmt: (v) => '目標数 ' + v });
    const done = SCHEDULERS.filter((s) => sweep[s.id] && sweep[s.id].length === SWEEP_N.length);
    $('sweepTable').innerHTML = '<thead><tr><th>目標数</th>' + done.map((s) => `<th>${s.name}<br>維持率 / フレーム比</th>`).join('') + '</tr></thead><tbody>' +
      SWEEP_N.map((n, k) => `<tr><td>${n}</td>` + done.map((s) => { const r = sweep[s.id][k]; return `<td>${(r.held * 100).toFixed(0)} % / ×${(r.frameMean[0] / r.frameReq[0]).toFixed(2)}</td>`; }).join('') + '</tr>').join('') + '</tbody>';
  }
  function startSweep() {
    clearTimeout(sweepTimer);
    const run = ++sweepRun;
    $('sweepStatus').textContent = ' 計算中…';
    sweepTimer = setTimeout(() => {
      const b = base(), adaptive = $('updA').value === 'adaptive', acc = {};
      let i = 0;
      const stepFn = () => {
        if (run !== sweepRun) return;
        const s = SCHEDULERS[i];
        acc[s.id] = SWEEP_N.map((n) => { const r = simulate(Object.assign({}, b, { nTargets: n, scheduler: s.id, adaptive })); r.log = null; return r; });
        sweep = acc; renderSweep();
        if (++i < SCHEDULERS.length) setTimeout(stepFn, 0); else $('sweepStatus').textContent = '';
      };
      stepFn();
    }, 350);
  }

  // ---------- wiring
  function runAB() {
    outputs();
    resA = simulate(cfgOf('A')); resB = simulate(cfgOf('B'));
    renderStacks(); renderKpi(); setSel(+$('sel').value); renderSeries();
  }
  const redraw = () => { if (!resA) return; renderStacks(); setSel(+$('sel').value); renderSeries(); renderSweep(); };
  ['nTargets', 'highFrac', 'frameReq', 'fixedInt', 'trackFrac'].forEach((id) => $(id).addEventListener('input', () => { runAB(); startSweep(); }));
  ['schedA', 'schedB', 'updB'].forEach((id) => $(id).addEventListener('change', runAB));
  $('updA').addEventListener('change', () => { runAB(); startSweep(); });
  let rz = 0; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(redraw, 120); });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redraw);
  new MutationObserver(redraw).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(redraw);
  runAB(); startSweep();
})();
