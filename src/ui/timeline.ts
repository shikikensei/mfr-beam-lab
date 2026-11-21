// Canvas drawing of a stretch of the timeline: one lane per target (requests and dwells),
// one lane per search region, and the row of boxes. Used by every slow-motion view.
import { ms } from '../engine/types.ts';
import type { BoxRecord, SimResult, Us } from '../engine/types.ts';

export interface TimelineView {
  sim: SimResult;
  /** Left edge and width of the visible stretch. */
  x0: Us;
  span: Us;
  /** Target lanes to draw, in order. */
  targets: number[];
  /** What already happened: up to a global step (step-by-step) or up to a time (playback). */
  seen: { gs: number } | { t: Us };
  cursor: Us;
  regions: boolean;
  /** The box being assembled and the step inside it; omit to hide the box row. */
  box?: { rec: BoxRecord; k: number } | null;
  boxRow: boolean;
}

const css = (n: string): string => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

export function drawTimeline(cv: HTMLCanvasElement, v: TimelineView): void {
  const { sim } = v, dpr = window.devicePixelRatio || 1;
  const T = v.targets.length, NR = v.regions ? sim.scenario.regions.length : 0;
  const L = 50, Rm = 6, lh = T > 14 ? 15 : T <= 2 ? 30 : 20, top = 4, boxH = 40;
  const yPat = top + T * lh + (NR ? 8 : 0), yBox = yPat + NR * 16 + (v.boxRow ? 10 : 0), yEnd = yBox + (v.boxRow ? boxH : 0), H = yEnd + 22;
  const W = cv.clientWidth;
  if (!W) return;
  cv.style.height = H + 'px'; cv.width = W * dpr; cv.height = H * dpr;
  const c = cv.getContext('2d')!; c.scale(dpr, dpr); c.clearRect(0, 0, W, H);
  const X = (t: Us): number => L + ((t - v.x0) / v.span) * (W - L - Rm);
  const C = { s: css('--s-search'), t: css('--s-track'), a: css('--s-aux'), u: css('--s-urgent'), ink: css('--ink'), ink2: css('--ink2'), mut: css('--muted'),
    line: css('--line'), soft: css('--accent-soft'), crit: css('--crit'), over: css('--over') };
  const font = css('--font'), mono = css('--mono');
  const colour = (kind: string): string => (kind === 'confirm' ? C.a : kind === 'critical' ? C.u : C.t);
  const byGs = 'gs' in v.seen, lim = 'gs' in v.seen ? v.seen.gs : v.seen.t;
  const seenAt = (gs: number, t: Us): boolean => (byGs ? gs <= lim : t <= lim);
  const lane = new Map(v.targets.map((id, row) => [id, row]));
  const yOf = (target: number): number | null => { const r = lane.get(target); return r === undefined ? null : top + r * lh; };

  c.save(); c.beginPath(); c.rect(L, 0, W - L - Rm, H); c.clip();
  v.targets.forEach((id, row) => {
    const y = top + row * lh; let from: Us | null = null;
    for (const m of sim.marks) {
      if (m.target !== id || !seenAt(m.gs, m.t)) continue;
      if (m.kind === 'track') from = m.t;
      if (m.kind === 'lost' && from !== null) { c.fillStyle = C.soft; c.fillRect(X(from), y + 2, X(m.t) - X(from), lh - 4); from = null; }
    }
    if (from !== null) { c.fillStyle = C.soft; c.fillRect(X(from), y + 2, X(v.cursor) - X(from), lh - 4); }
    c.strokeStyle = C.line; c.lineWidth = 1; c.beginPath(); c.moveTo(L, y + lh + 0.5); c.lineTo(W, y + lh + 0.5); c.stroke();
  });
  for (const q of sim.requests) {
    const y = q.target < 0 ? null : yOf(q.target);
    if (y === null || !seenAt(q.createdGs, q.createdAt)) continue;
    const xa = X(q.earliest), xb = X(q.latest + q.len);
    if (xb < L || xa > W) continue;
    const open = q.resolvedGs === null || !seenAt(q.resolvedGs, q.resolvedAt!);
    c.strokeStyle = open ? C.ink2 : C.mut; c.lineWidth = 1; c.setLineDash(open ? [] : [2, 2]);
    c.strokeRect(xa + 0.5, y + 3.5, xb - xa, lh - 7); c.setLineDash([]);
    c.beginPath(); c.moveTo(X(q.req), y + 1); c.lineTo(X(q.req), y + lh - 1); c.stroke();
    if (!open && q.status === 'dropped') { c.fillStyle = C.crit; c.font = '700 12px ' + font; c.textAlign = 'center'; c.fillText('✕', X(q.req), y + lh - 5); }
  }
  for (const e of sim.timeline) {
    if (!seenAt(e.gs, e.start) || e.start + e.len < v.x0 || e.start > v.x0 + v.span) continue;
    const xa = X(e.start), w = Math.max(X(e.start + e.len) - xa - 0.6, 1);
    if (e.type === 'flex') {
      c.fillStyle = C.s;
      if (v.regions) c.fillRect(xa, yPat + e.region * 16 + 2, w, 12);
      if (v.boxRow) c.fillRect(xa, yBox + 4 + e.region * 6, w, boxH - 8 - e.region * 6);
    } else if (e.type === 'fixed') {
      const col = colour(e.kind), y = e.target < 0 ? null : yOf(e.target);
      if (y !== null) {
        if (e.hit) { c.fillStyle = col; c.fillRect(xa, y + 5, w, lh - 10); }
        else { c.strokeStyle = col; c.lineWidth = 1.5; c.strokeRect(xa + 0.75, y + 5.75, w - 1.5, lh - 11.5);
          c.fillStyle = C.crit; c.font = '700 10px ' + font; c.textAlign = 'center'; c.fillText('✕', xa + w / 2, y + 5); }
      }
      if (v.boxRow) { c.fillStyle = col; c.fillRect(xa, yBox + 4, w, boxH - 8); }
    } else if (e.type === 'gap' && v.boxRow) { c.fillStyle = C.over; c.fillRect(xa, yBox + 4, w + 0.6, boxH - 8); }
  }
  for (const m of sim.marks) {
    const y0 = yOf(m.target);
    if (y0 === null || m.kind !== 'detect' || !seenAt(m.gs, m.t)) continue;
    const x = X(m.t), y = y0 + lh / 2;
    c.fillStyle = C.a; c.beginPath(); c.moveTo(x, y - 5); c.lineTo(x + 5, y); c.lineTo(x, y + 5); c.lineTo(x - 5, y); c.fill();
  }
  if (v.boxRow) {
    const cur = v.box?.rec ?? null, k = v.box?.k ?? 0;
    const sel = cur?.steps[0];
    const planned = !cur || !sel ? 0 : sel.kind === 'select' && sel.nft !== null ? sel.limit + sim.requests[sel.nft].len : sel.kind === 'select' ? sel.limit : cur.end;
    const closed = (b: BoxRecord): boolean => b !== cur || b.steps.slice(0, k + 1).some((s) => s.kind === 'close' || s.kind === 'legacyFill' || s.kind === 'interrupt');
    for (const b of sim.boxes) {
      if (!seenAt(b.gsBase, b.start) || b.end < v.x0) continue;
      const fin = closed(b), end = b !== cur ? b.end : fin ? Math.max(v.cursor, b.start + 1) : planned;
      const xa = X(b.start), xb = X(end);
      c.strokeStyle = b === cur ? C.ink : C.mut; c.lineWidth = b === cur ? 2 : 1; c.setLineDash(fin ? [] : [5, 3]);
      c.strokeRect(xa + 1, yBox + 1, Math.max(xb - xa - 2, 1), boxH - 2); c.setLineDash([]);
    }
    if (cur && sel && sel.kind === 'select' && sel.nft !== null && !closed(cur)) {
      const q = sim.requests[sel.nft], xa = X(sel.limit), w = X(sel.limit + q.len) - xa, y = q.target < 0 ? null : yOf(q.target);
      c.strokeStyle = colour(q.kind); c.lineWidth = 1.5; c.setLineDash([3, 2]);
      if (y !== null) c.strokeRect(xa, y + 5, w, lh - 10);
      c.strokeRect(xa, yBox + 4, w, boxH - 8); c.setLineDash([]);
    }
  }
  c.strokeStyle = C.ink; c.lineWidth = 1; c.beginPath(); c.moveTo(X(v.cursor) + 0.5, 0); c.lineTo(X(v.cursor) + 0.5, yEnd); c.stroke();
  const fine = v.span <= ms(300), tick = v.span > ms(1500) ? ms(500) : fine ? ms(20) : ms(100);
  c.font = '11px ' + mono; c.fillStyle = C.mut; c.textAlign = 'center';
  for (let t = Math.ceil(v.x0 / tick) * tick; t < v.x0 + v.span - tick / 5; t += tick) if (t >= 0) c.fillText(fine ? t / 1000 + (t + tick >= v.x0 + v.span - tick / 5 ? ' ms' : '') : (t / 1e6).toFixed(1) + ' s', X(t), H - 4);
  c.restore();
  c.textAlign = 'left'; c.textBaseline = 'middle';
  v.targets.forEach((id, row) => {
    c.font = (sim.scenario.targets[id].high ? '700 ' : '') + (lh < 20 ? '11px ' : '12px ') + font; c.fillStyle = C.ink;
    c.fillText(sim.scenario.targets[id].name ?? '目標' + (id + 1), 2, top + row * lh + lh / 2);
  });
  if (v.regions) { c.font = '12px ' + font; c.fillStyle = C.ink2; sim.scenario.regions.forEach((r, i) => c.fillText(r.name, 2, yPat + i * 16 + 8)); }
  if (v.boxRow) { c.font = '700 12px ' + font; c.fillStyle = C.ink; c.fillText('箱', 2, yBox + boxH / 2); }
}

/** A one-row strip of who used the beam, for the introduction. */
export function drawStrip(cv: HTMLCanvasElement, sim: SimResult, x0: Us, span: Us): void {
  const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = 54;
  if (!W) return;
  cv.style.height = H + 'px'; cv.width = W * dpr; cv.height = H * dpr;
  const c = cv.getContext('2d')!; c.scale(dpr, dpr); c.clearRect(0, 0, W, H);
  const X = (t: Us): number => ((t - x0) / span) * W;
  c.fillStyle = css('--s-idle'); c.fillRect(0, 0, W, 34);
  for (const e of sim.timeline) {
    if (e.start + e.len < x0 || e.start > x0 + span || e.type === 'spare') continue;
    c.fillStyle = e.type === 'flex' ? css('--s-search') : e.type === 'gap' ? css('--over') : e.kind === 'confirm' ? css('--s-aux') : e.kind === 'critical' ? css('--s-urgent') : css('--s-track');
    const xa = X(e.start); c.fillRect(xa, 0, Math.max(X(e.start + e.len) - xa - 0.5, 1), 34);
  }
  c.font = '11px ' + css('--mono'); c.fillStyle = css('--muted'); c.textBaseline = 'alphabetic';
  const whole = span === 1e6, tick = whole ? ms(250) : ms(200);
  for (let t = Math.ceil(x0 / tick) * tick; t <= x0 + span; t += tick) {
    c.textAlign = t === x0 ? 'left' : t >= x0 + span ? 'right' : 'center';
    c.fillText((t / 1e6).toFixed(whole ? 2 : 1) + (whole && t !== x0 ? '' : ' s'), X(t), H - 4);
  }
}
