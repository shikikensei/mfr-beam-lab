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
export function lineChart(host: HTMLElement, o: { label: string; series: Series[]; yMax: number; yStep: number; unit: string; ref?: { x: number; label: string }; sel: number; onPick: (x: number) => void }): void {
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
      `<text x="${X(o.ref.x) + 4}" y="${m.t + 9}" fill="var(--ink2)" font-size="11" font-family="var(--font)">${o.ref.label}</text>`;
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
