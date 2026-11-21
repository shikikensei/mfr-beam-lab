// MFR beam scheduling lab: simulation engine (public-literature toy model)
const SECTORS = [
  { name: '水平線', beams: 150, dwell: 5, frame: 3000 },
  { name: '中高度', beams: 200, dwell: 3, frame: 6000 },
  { name: '高仰角', beams: 150, dwell: 2, frame: 10000 },
];
const CLASSES = [
  { name: '高機動', tvk: 800 },
  { name: '中機動', tvk: 2000 },
  { name: '低機動', tvk: 4000 },
];
const SCHEDULERS = [
  { id: 'fifo', name: '到着順 (FIFO)' },
  { id: 'template', name: '固定テンプレート' },
  { id: 'priority', name: '固定優先度' },
  { id: 'edf', name: '最早期限優先 (EDF)' },
  { id: 'tb', name: 'タイムバランス' },
  { id: 'drsi', name: '動的RSI' },
];
const V0 = 0.15, PD0 = 0.97, PD_SEARCH = 0.8, PD_CONFIRM = 0.9, MISS_LIMIT = 3;
const TEMPLATE_CYCLE = 100;
// dwell type codes: 0..2 search sector, 3 track, 4 confirm, 5 retry

function rng32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeTargets(n, highFrac, seed, ramp) {
  const r = rng32(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = r(), b = r(), c = r(), d = r();
    const sector = a < 0.5 ? 0 : a < 0.85 ? 1 : 2;
    const cls = b < highFrac ? 0 : b < highFrac + (1 - highFrac) / 2 ? 1 : 2;
    out.push({
      sector, cls, beam: Math.floor(c * SECTORS[sector].beams),
      dwell: Math.round((2 + 6 * d) * 2) / 2, appear: n ? (i / n) * ramp : 0,
      state: 0, release: 0, deadline: 0, lastUpd: 0, miss: 0, interval: 0, retry: false,
    });
  }
  return out;
}

function simulate(cfg) {
  const dur = cfg.duration || 95000, warm = cfg.warmup || 60000;
  const ramp = cfg.ramp == null ? 50000 : cfg.ramp;
  const targets = makeTargets(cfg.nTargets, cfg.highFrac, cfg.seed || 7, ramp);
  const nsec = Math.ceil(dur / 1000);
  const perSec = [new Float32Array(nsec), new Float32Array(nsec), new Float32Array(nsec)];
  const rnd = rng32((cfg.seed || 7) * 31 + 1);
  const N = targets.length;
  const sec = SECTORS.map((s, i) => {
    const frame = s.frame * cfg.searchScale;
    return { i, beams: s.beams, dwell: s.dwell, frame, I: frame / s.beams, idx: 0,
      release: 0, deadline: frame / s.beams, lastFrameStart: -1, frames: [], at: [] };
  });
  for (const s of sec) for (let b = 0; b < s.beams; b++) s.at.push(null);
  targets.forEach((tg) => { const a = sec[tg.sector].at; (a[tg.beam] || (a[tg.beam] = [])).push(tg); });

  const cap = Math.ceil(dur / 1.5) + 16;
  const logS = new Float32Array(cap), logD = new Float32Array(cap), logT = new Uint8Array(cap);
  let nLog = 0;
  const occ = [0, 0, 0, 0, 0, 0];
  let t = 0, tracked = 0, heldInt = 0, drops = 0, uSum = 0, lateSum = 0, nUpd = 0, missCnt = 0;
  const series = [];
  let nextSample = 0;
  const sched = cfg.scheduler;
  const trackFrac = cfg.trackFrac == null ? 0.4 : cfg.trackFrac;

  const prio = (tg) => (tg.state === 1 ? 0 : tg.retry ? 1 : 2 + tg.cls);
  function key(kind, o) {
    // smaller is better
    if (sched === 'fifo') return o.release;
    if (sched === 'priority') return (kind === 0 ? 5 + o.i : prio(o)) * 1e9 + o.deadline;
    if (sched === 'tb') {
      // relative lateness; a late search stream restarts its clock at the previous
      // beam start, so one interval is subtracted to compare like with like
      if (kind === 0) return 1 - (t - o.release) / o.I;
      const period = o.state === 1 ? 200 : o.retry ? o.interval * 0.25 : o.interval;
      return -(t - o.release) / period;
    }
    return o.deadline; // edf, template
  }

  let guard = 0;
  while (t < dur && guard++ < 400000) {
    while (nextSample <= t) { series.push(tracked); nextSample += 1000; }
    let allowSearch = true, allowTrack = true, windowEnd = Infinity;
    if (sched === 'template') {
      const ph = t % TEMPLATE_CYCLE, cut = TEMPLATE_CYCLE * trackFrac;
      if (ph < cut) { allowSearch = false; windowEnd = t - ph + cut; }
      else { allowTrack = false; windowEnd = t - ph + TEMPLATE_CYCLE; }
    }
    let best = null, bestKind = 0, bestKey = Infinity, nextRel = Infinity;
    if (sched === 'drsi') {
      // fixed tasks (track, confirm) go as late as their window allows; until then the
      // timeline is filled with the search pattern that is furthest behind (largest deficit)
      let fs = null, bf = -Infinity, e = null;
      for (const x of sec) {
        const f = (t - Math.max(x.lastFrameStart, 0)) / x.frame - x.idx / x.beams; // deficit as a fraction of the pattern
        if (f > bf) { bf = f; fs = x; }
      }
      for (let i = 0; i < N; i++) { const tg = targets[i]; if (tg.state !== 0 && tg.release <= t && (!e || tg.deadline < e.deadline)) e = tg; }
      if (e && t + fs.dwell > e.deadline) { best = e; bestKind = 1; } else { best = fs; bestKind = 0; }
      allowSearch = allowTrack = false;
    }
    if (allowSearch) for (const s of sec) {
      if (s.release <= t) { const k = key(0, s); if (k < bestKey) { bestKey = k; best = s; bestKind = 0; } }
      else if (s.release < nextRel) nextRel = s.release;
    }
    if (allowTrack) for (let i = 0; i < N; i++) {
      const tg = targets[i];
      if (tg.state === 0) continue;
      if (tg.release <= t) { const k = key(1, tg); if (k < bestKey) { bestKey = k; best = tg; bestKind = 1; } }
      else if (tg.release < nextRel) nextRel = tg.release;
    }
    if (!best) {
      const nt = Math.min(nextRel, windowEnd, dur);
      heldInt += tracked * (Math.max(nt, warm) - Math.max(t, warm) > 0 ? Math.max(nt, warm) - Math.max(t, warm) : 0);
      t = nt > t ? nt : t + 0.5;
      continue;
    }
    let d, type;
    if (bestKind === 0) {
      const s = best; d = s.dwell; type = s.i;
      if (s.idx === 0) {
        if (s.lastFrameStart >= 0) s.frames.push([t, t - s.lastFrameStart]);
        s.lastFrameStart = t;
      }
      const here = s.at[s.idx];
      if (here) for (const tg of here) if (tg.state === 0 && t >= tg.appear && rnd() < PD_SEARCH) {
        tg.state = 1; tg.release = t + d; tg.deadline = t + d + 100; tg.retry = false;
      }
      s.idx = (s.idx + 1) % s.beams;
      s.release = Math.max(s.release + s.I, t);
      s.deadline = s.release + s.I;
    } else {
      const tg = best; d = tg.dwell;
      if (tg.state === 1) {
        type = 4;
        if (rnd() < PD_CONFIRM) {
          tg.state = 2; tracked++; tg.miss = 0; tg.lastUpd = t;
          tg.interval = cfg.adaptive ? CLASSES[tg.cls].tvk : cfg.fixedInterval;
          tg.release = t + tg.interval; tg.deadline = tg.release + tg.interval * 0.25;
        } else tg.state = 0;
      } else {
        type = tg.retry ? 5 : 3;
        const u = V0 * Math.pow((t - tg.lastUpd) / CLASSES[tg.cls].tvk, 1.5);
        const pd = PD0 * Math.exp(-2.77 * u * u);
        if (t >= warm) {
          nUpd++; uSum += Math.min(u, 3);
          if (!tg.retry) lateSum += (sched === 'drsi' ? Math.max(0, t - tg.deadline) : t - tg.release) / tg.interval;
        }
        if (rnd() < pd) {
          const grid = sched === 'drsi' && !tg.retry ? Math.max(tg.release + tg.interval, t + tg.interval * 0.5) : t + tg.interval;
          tg.miss = 0; tg.retry = false; tg.lastUpd = t;
          tg.release = grid; tg.deadline = tg.release + tg.interval * 0.25;
        } else {
          if (t >= warm) missCnt++;
          if (++tg.miss >= MISS_LIMIT) { tg.state = 0; tg.retry = false; tracked--; if (t >= warm) drops++; }
          else { tg.retry = true; tg.release = t + d; tg.deadline = t + d + 50; }
        }
      }
    }
    const a = Math.max(t, warm), b = Math.min(t + d, dur);
    if (b > a) { occ[type] += b - a; }
    // tracked count changed inside dwell is negligible for the integral
    if (b > a) heldInt += tracked * (b - a);
    { const ps = perSec[type < 3 ? 0 : type === 3 ? 1 : 2]; let a0 = t; const e = Math.min(t + d, dur);
      while (a0 < e) { const k = Math.floor(a0 / 1000), nx = Math.min(e, (k + 1) * 1000); ps[k] += (nx - a0) / 1000; a0 = nx; } }
    if (nLog < cap) { logS[nLog] = t; logD[nLog] = d; logT[nLog] = type; nLog++; }
    t += d;
  }
  while (nextSample <= dur) { series.push(tracked); nextSample += 1000; }

  const span = dur - warm;
  const frameMean = sec.map((s) => {
    const v = s.frames.filter((f) => f[0] >= warm).map((f) => f[1]);
    const open = dur - Math.max(s.lastFrameStart, 0);
    if (open > s.frame) v.push(open);
    return v.length ? v.reduce((x, y) => x + y, 0) / v.length : s.frame;
  });
  const search = occ[0] + occ[1] + occ[2];
  return {
    cfg, dur, warm, nTargets: N,
    occ: { search: search / span, track: occ[3] / span, aux: (occ[4] + occ[5]) / span,
      idle: Math.max(0, 1 - (search + occ[3] + occ[4] + occ[5]) / span) },
    frameMean, frameReq: sec.map((s) => s.frame), frames: sec.map((s) => s.frames),
    held: N ? heldInt / span / N : 0, drops, dropRate: drops / (span / 60000),
    uMean: nUpd ? uSum / nUpd : 0, lateMean: nUpd ? lateSum / nUpd : 0,
    missRate: nUpd ? missCnt / nUpd : 0, series, perSec,
    log: { s: logS, d: logD, t: logT, n: nLog },
  };
}

// requested share of radar time (1.0 = the whole timeline), before any scheduling
function demand(cfg) {
  const dur = cfg.duration || 95000, ramp = cfg.ramp == null ? 50000 : cfg.ramp;
  const targets = makeTargets(cfg.nTargets, cfg.highFrac, cfg.seed || 7, ramp);
  let search = 0, track = 0;
  for (const s of SECTORS) search += (s.beams * s.dwell) / (s.frame * cfg.searchScale);
  const series = [], nsec = Math.ceil(dur / 1000);
  let i = 0;
  for (let k = 0; k < nsec; k++) {
    while (i < targets.length && targets[i].appear <= k * 1000) {
      track += targets[i].dwell / (cfg.adaptive ? CLASSES[targets[i].cls].tvk : cfg.fixedInterval); i++;
    }
    series.push(search + track);
  }
  for (; i < targets.length; i++) track += targets[i].dwell / (cfg.adaptive ? CLASSES[targets[i].cls].tvk : cfg.fixedInterval);
  return { search, track, series };
}

if (typeof module !== 'undefined') module.exports = { simulate, demand, SECTORS, CLASSES, SCHEDULERS };
