// SVG charts of chapters 2 and 3. Colours come from the page's CSS variables, so both themes work.

export interface StackData { search: number[]; track: number[]; aux: number[]; gap: number[] }

/**
 * One column per second: how the second was used, stacked, with the wanted amount as a step
 * line. Above 100 % the wanted amount cannot fit; that part is tinted. Tap or drag to pick a second.
 */
export function stackChart(host: HTMLElement, o: { per: StackData; demand: number[]; sel: number; label: string; onPick: (k: number) => void }): void {
  const W = host.clientWidth || 320, H = 190, m = { l: 38, r: 6, t: 8, b: 30 };
  const ns = o.demand.length, dmax = Math.max(...o.demand, 1), ymax = Math.max(1.25, Math.ceil(dmax * 4 + 0.2) / 4);
  const cw = (W - m.l - m.r) / ns, bw = Math.max(cw - 0.8, 0.8);
  const X = (k: number): number => m.l + k * cw, Y = (v: number): number => H - m.b - (v / ymax) * (H - m.t - m.b);
  let s = `<svg width="${W}" height="${H}" role="img" aria-label="${o.label}">`;
  for (let k = 0; k < ns; k++) {
    const d = Math.min(o.demand[k], ymax);
    if (d > 1) s += `<rect x="${X(k)}" y="${Y(d)}" width="${bw}" height="${Y(1) - Y(d)}" fill="var(--over)"/>`;
    s += `<rect x="${X(k)}" y="${Y(1)}" width="${bw}" height="${Y(0) - Y(1)}" fill="var(--s-idle)"/>`;
    let y = 0;
    for (const [v, col] of [[o.per.search[k], '--s-search'], [o.per.track[k], '--s-track'], [o.per.aux[k], '--s-aux'], [o.per.gap[k], '--over']] as const) {
      const v2 = Math.min(v, 1 - y);
      if (v2 <= 0.002) continue;
      s += `<rect x="${X(k)}" y="${Y(y + v2)}" width="${bw}" height="${Y(y) - Y(y + v2)}" fill="var(${col})"/>`;
      y += v2;
    }
  }
  for (let v = 0; v <= ymax + 1e-9; v += 0.5) s += `<text x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end" fill="var(--muted)" font-size="11" font-family="var(--mono)">${v * 100}%</text>`;
  s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(1)}" y2="${Y(1)}" stroke="var(--ink2)"/>`;
  s += `<text x="${m.l + 3}" y="${Y(1) - 4}" fill="var(--ink2)" font-size="11" font-family="var(--font)">時間の上限</text>`;
  let path = '';
  for (let k = 0; k < ns; k++) { const y = Y(Math.min(o.demand[k], ymax)).toFixed(1); path += `${k ? 'L' : 'M'}${X(k).toFixed(1)} ${y}L${X(k + 1).toFixed(1)} ${y}`; }
  s += `<path d="${path}" fill="none" stroke="var(--ink)" stroke-width="2" stroke-linejoin="round"/>`;
  for (let v = 0; v < ns; v += ns > 40 ? 20 : 10) s += `<text x="${X(v)}" y="${H - m.b + 14}" text-anchor="middle" fill="var(--muted)" font-size="11" font-family="var(--mono)">${v}</text>`;
  s += `<text x="${(m.l + W - m.r) / 2}" y="${H - 2}" text-anchor="middle" fill="var(--ink2)" font-size="11.5" font-family="var(--font)">時刻（秒）</text>`;
  s += `<rect x="${X(o.sel)}" y="${m.t}" width="${Math.max(cw, 2)}" height="${H - m.b - m.t}" fill="none" stroke="var(--ink)" stroke-width="1.5"/></svg>`;
  host.innerHTML = s;
  const svg = host.firstElementChild as SVGElement;
  const pick = (ev: PointerEvent): void => {
    const k = Math.max(0, Math.min(ns - 1, Math.floor((ev.clientX - svg.getBoundingClientRect().left - m.l) / cw)));
    if (k !== o.sel) o.onPick(k);
  };
  svg.addEventListener('pointerdown', pick);
  svg.addEventListener('pointermove', (ev) => { if (ev.buttons || ev.pointerType === 'touch') pick(ev); });
}

export interface Series { name: string; dash: boolean; pts: [number, number][] }

/** Two methods over the number of targets. A is solid, B is dashed; the selected x is read out by the caller. */
export function lineChart(host: HTMLElement, o: { label: string; series: Series[]; yMax: number; yStep: number; unit: string; ref?: { x: number; label: string; at: 'top' | 'bottom' }; sel: number; onPick: (x: number) => void }): void {
  const W = host.clientWidth || 320, H = 170, m = { l: 40, r: 12, t: 10, b: 30 };
  const xs = o.series[0].pts.map((p) => p[0]), x0 = xs[0], x1 = xs[xs.length - 1];
  const X = (v: number): number => m.l + ((v - x0) / (x1 - x0)) * (W - m.l - m.r);
  const Y = (v: number): number => H - m.b - (Math.min(v, o.yMax) / o.yMax) * (H - m.t - m.b);
  let s = `<svg width="${W}" height="${H}" role="img" aria-label="${o.label}">`;
  for (let v = 0; v <= o.yMax + 1e-9; v += o.yStep) {
    s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(${v === 0 ? '--axis' : '--line'})"/>` +
      `<text x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end" fill="var(--muted)" font-size="11" font-family="var(--mono)">${v}${o.unit}</text>`;
  }
  for (const x of xs) if ((x - x0) % 8 === 0) s += `<text x="${X(x)}" y="${H - m.b + 14}" text-anchor="middle" fill="var(--muted)" font-size="11" font-family="var(--mono)">${x}</text>`;
  s += `<text x="${(m.l + W - m.r) / 2}" y="${H - 2}" text-anchor="middle" fill="var(--ink2)" font-size="11.5" font-family="var(--font)">目標数</text>`;
  if (o.ref && o.ref.x > x0 && o.ref.x < x1) {
    s += `<line x1="${X(o.ref.x)}" x2="${X(o.ref.x)}" y1="${m.t}" y2="${H - m.b}" stroke="var(--muted)" stroke-dasharray="2 3"/>` +
      // the label goes to the side of the reference line that the selection line is not on
      `<text x="${X(o.ref.x) + (o.sel > o.ref.x ? -4 : 4)}" y="${o.ref.at === 'top' ? m.t + 9 : H - m.b - 6}" text-anchor="${o.sel > o.ref.x ? 'end' : 'start'}" fill="var(--ink2)" font-size="11" font-family="var(--font)">${o.ref.label}</text>`;
  }
  s += `<line x1="${X(o.sel)}" x2="${X(o.sel)}" y1="${m.t}" y2="${H - m.b}" stroke="var(--ink)"/>`;
  o.series.forEach((se, i) => {
    const col = i === 0 ? 'var(--accent)' : 'var(--ink2)';
    s += `<path d="${se.pts.map((p, k) => `${k ? 'L' : 'M'}${X(p[0]).toFixed(1)} ${Y(p[1]).toFixed(1)}`).join('')}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round"${se.dash ? ' stroke-dasharray="6 4"' : ''}/>`;
    for (const p of se.pts) s += `<circle cx="${X(p[0])}" cy="${Y(p[1])}" r="${p[0] === o.sel ? 4.5 : 3}" fill="${i === 0 ? col : 'var(--surface)'}" stroke="${i === 0 ? 'var(--surface)' : col}" stroke-width="1.5"/>`;
  });
  host.innerHTML = s + '</svg>';
  const svg = host.firstElementChild as SVGElement;
  const pick = (ev: PointerEvent): void => {
    const xv = x0 + ((ev.clientX - svg.getBoundingClientRect().left - m.l) / (W - m.l - m.r)) * (x1 - x0);
    const near = xs.reduce((a, b) => (Math.abs(b - xv) < Math.abs(a - xv) ? b : a));
    if (near !== o.sel) o.onPick(near);
  };
  svg.addEventListener('pointerdown', pick);
  svg.addEventListener('pointermove', (ev) => { if (ev.buttons || ev.pointerType === 'touch') pick(ev); });
}

export interface ScatterPoint { name: string; x: number; y: number; xr: [number, number]; yr: [number, number]; fromX: number; fromY: number }

/**
 * Search served (x) against fixed tasks dropped (y). Points whose ranges over the seeds ALL
 * overlap one another are drawn as one larger mark with their names listed together: the chart
 * then says by its shape that they cannot be told apart. (A overlapping B and B overlapping C does
 * not put A and C together unless they overlap too.) Names sit in a column on the right, joined by
 * leader lines, so identity never depends on colour. A point that moved when the convention was
 * switched trails a thin line from where it was (hollow mark). Returns the groups of names.
 */
export function scatterChart(host: HTMLElement, o: { label: string; points: ScatterPoint[] }): string[][] {
  const W = host.clientWidth || 320, m = { l: 40, r: 100, t: 26, b: 34 }, rowH = 17, XMIN = 40;
  // room for one row per name plus half a row of air between groups (at most one group per name)
  const H = Math.max(230, m.t + m.b + (o.points.length * 1.5 + 0.5) * rowH);
  const ymax = Math.max(10, Math.ceil(Math.max(...o.points.flatMap((p) => [p.yr[1], p.fromY])) / 10) * 10);
  const X = (v: number): number => m.l + ((Math.max(XMIN, Math.min(100, v)) - XMIN) / (100 - XMIN)) * (W - m.l - m.r);
  const Y = (v: number): number => H - m.b - (v / ymax) * (H - m.t - m.b);
  const t = (x: number, y: number, txt: string, anchor = 'middle', fill = '--muted', size = 11, fam = '--mono'): string =>
    `<text x="${x}" y="${y}" text-anchor="${anchor}" fill="var(${fill})" font-size="${size}" font-family="var(${fam})">${txt}</text>`;
  // groups: every member overlaps every other member, in both directions (within one percentage point)
  const PAD = 1;
  const meet = (a: ScatterPoint, b: ScatterPoint): boolean => a.xr[0] <= b.xr[1] + PAD && b.xr[0] <= a.xr[1] + PAD && a.yr[0] <= b.yr[1] + PAD && b.yr[0] <= a.yr[1] + PAD;
  const groups: ScatterPoint[][] = [];
  for (const p of [...o.points].sort((a, b) => b.y - a.y || b.x - a.x)) {
    const g = groups.find((members) => members.every((q) => meet(p, q)));
    if (g) g.push(p); else groups.push([p]);
  }
  const mean = (v: number[]): number => v.reduce((a, b) => a + b, 0) / v.length;
  const marks = groups.map((g) => ({ g, x: mean(g.map((p) => p.x)), y: mean(g.map((p) => p.y)),
    xr: [Math.min(...g.map((p) => p.xr[0])), Math.max(...g.map((p) => p.xr[1]))], yr: [Math.min(...g.map((p) => p.yr[0])), Math.max(...g.map((p) => p.yr[1]))] }))
    .sort((a, b) => b.y - a.y || b.x - a.x);

  let s = `<svg width="${W}" height="${H}" role="img" aria-label="${o.label}">`;
  for (let v = 0; v <= ymax + 1e-9; v += ymax / (ymax > 30 ? 5 : 2)) s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(${v === 0 ? '--axis' : '--line'})"/>` + t(m.l - 6, Y(v) + 4, `${v}%`, 'end');
  for (let v = XMIN; v <= 100; v += 20) s += `<line x1="${X(v)}" x2="${X(v)}" y1="${m.t}" y2="${H - m.b}" stroke="var(--line)"/>` + t(X(v), H - m.b + 14, `${v}%`);
  s += t((m.l + W - m.r) / 2, H - 3, '捜索を実行できた割合（40 % から）→', 'middle', '--ink2', 11.5, '--font');
  s += t(2, 12, '↑ 固定タスク：要求のうち取りこぼした割合', 'start', '--ink2', 11.5, '--font');
  const rows = o.points.length + (marks.length - 1) * 0.5; // half a row of air between groups
  let ly = Math.max(m.t + 10, (m.t + H - m.b) / 2 - (rows * rowH) / 2 + 10);
  const lx = W - m.r + 14;
  for (const k of marks) {
    const px = X(k.x), py = Y(k.y), top = ly - 9, bottom = ly + (k.g.length - 1) * rowH + 3;
    for (const p of k.g) {
      if (Math.hypot(p.x - p.fromX, p.y - p.fromY) > 1.5) {
        s += `<line x1="${X(p.fromX)}" y1="${Y(p.fromY)}" x2="${px}" y2="${py}" stroke="var(--muted)" stroke-dasharray="3 3"/>` +
          `<circle cx="${X(p.fromX)}" cy="${Y(p.fromY)}" r="4" fill="var(--surface)" stroke="var(--muted)" stroke-width="1.5"/>`;
      }
    }
    s += `<path d="M${px} ${py}L${lx - 10} ${(top + bottom) / 2}H${lx - 5}" fill="none" stroke="var(--axis)"/>`;
    if (k.g.length > 1) s += `<path d="M${lx - 3} ${top}H${lx - 5}V${bottom}H${lx - 3}" fill="none" stroke="var(--ink2)"/>`;
    for (const p of k.g) { s += t(lx, ly, p.name, 'start', '--ink', 12, '--font'); ly += rowH; }
    ly += rowH / 2;
  }
  for (const k of marks) s += `<path d="M${X(k.xr[0])} ${Y(k.y)}H${X(k.xr[1])}M${X(k.x)} ${Y(k.yr[0])}V${Y(k.yr[1])}" stroke="var(--accent)" stroke-width="1.5"/>`;
  for (const k of marks) s += `<circle cx="${X(k.x)}" cy="${Y(k.y)}" r="${k.g.length > 1 ? 8 : 5}" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/>` +
    (k.g.length > 1 ? `<text x="${X(k.x)}" y="${Y(k.y) + 3.5}" text-anchor="middle" fill="var(--surface)" font-size="10" font-weight="700" font-family="var(--mono)">${k.g.length}</text>` : '');
  host.innerHTML = s + '</svg>';
  return marks.map((k) => k.g.map((p) => p.name));
}
