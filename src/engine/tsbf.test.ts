import { describe, expect, it } from 'vitest';
import { sequence } from './rand.ts';
import { assign, benefit, planTsbf, select, viable } from './tsbf.ts';
import type { TsbfTask } from './tsbf.ts';
import { flexCount, fx, region, startOf, tiles, view } from './testkit.ts';

// Properties that can be stated without the original report (refs/moo-tsbf-notes.md, last section).
// The report's worked examples cannot be reproduced: the summary does not give their inputs.
const T = (want: number, lead: number, trail: number, len: number, peak = 100, slope = 1): TsbfTask =>
  ({ s: want - lead, u: want + trail, want, len, peak, early: slope, late: slope });
const total = (tasks: TsbfTask[], starts: number[]): number => tasks.reduce((a, k, i) => a + benefit(k, starts[i]), 0);

describe('two-slope benefit: start times', () => {
  it('condition I: looks that fit at their desired starts stay there', () => {
    const tasks = [T(10, 5, 5, 8), T(30, 5, 5, 8), T(60, 5, 5, 8)];
    expect(assign(tasks)).toEqual([10, 30, 60]);
  });

  it('condition II: looks never overlap and every start is inside [s, u]', () => {
    const tasks = [T(10, 8, 8, 10), T(14, 8, 8, 10), T(20, 8, 8, 10), T(41, 3, 3, 6)];
    expect(viable(tasks)).toBe(true);
    const st = assign(tasks);
    tasks.forEach((k, i) => {
      expect(st[i]).toBeGreaterThanOrEqual(k.s); expect(st[i]).toBeLessThanOrEqual(k.u);
      if (i) expect(st[i]).toBeGreaterThanOrEqual(st[i - 1] + tasks[i - 1].len);
    });
  });

  it('a steeper slope never moves that look further from its desired start', () => {
    const base = [T(10, 8, 8, 10), T(14, 8, 8, 10), T(20, 8, 8, 10)];
    for (let i = 0; i < base.length; i++) {
      const steep = base.map((k, n) => (n === i ? { ...k, early: 12, late: 12 } : k));
      expect(Math.abs(assign(steep)[i] - base[i].want)).toBeLessThanOrEqual(Math.abs(assign(base)[i] - base[i].want));
    }
  });

  it('finds the same optimum as trying every integer start (small random inputs)', () => {
    const r = sequence(5);
    const int = (lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1));
    let checked = 0;
    for (let trial = 0; trial < 400; trial++) {
      const n = int(1, 4);
      let want = int(0, 4);
      const tasks: TsbfTask[] = [];
      for (let i = 0; i < n; i++) {
        const slope = int(1, 4);
        tasks.push({ s: want - int(0, 4), u: want + int(0, 4), want, len: int(1, 4), peak: int(1, 9) * 10, early: slope, late: int(1, 4) });
        want += int(0, 5);
      }
      if (!viable(tasks)) continue;
      let best = -Infinity;
      const walk = (i: number, free: number, sum: number): void => {
        if (i === n) { best = Math.max(best, sum); return; }
        for (let t = Math.max(tasks[i].s, free); t <= tasks[i].u; t++) walk(i + 1, t + tasks[i].len, sum + benefit(tasks[i], t));
      };
      walk(0, -Infinity, 0);
      const st = assign(tasks);
      st.forEach((t, i) => { expect(t).toBeGreaterThanOrEqual(tasks[i].s); expect(t).toBeLessThanOrEqual(tasks[i].u); if (i) expect(t).toBeGreaterThanOrEqual(st[i - 1] + tasks[i - 1].len); });
      expect(total(tasks, st)).toBe(best);
      checked++;
    }
    expect(checked).toBeGreaterThan(150);
  });
});

describe('two-slope benefit: overload', () => {
  it('drops looks until the rest is viable; the look with the highest peak always stays', () => {
    // five 10 ms looks wanted within 12 ms of each other: at most two or three can run
    const tasks = [T(10, 2, 2, 10, 100), T(12, 2, 2, 10, 300), T(14, 2, 2, 10, 900), T(16, 2, 2, 10, 200), T(22, 2, 2, 10, 100)];
    expect(viable(tasks)).toBe(false);
    const keep = select(tasks);
    expect(keep[2]).toBe(true);
    expect(keep.includes(false)).toBe(true);
    expect(viable(tasks.filter((_, i) => keep[i]))).toBe(true);
  });
});

describe('two-slope benefit: one window', () => {
  const S15 = [region('S', 20, 15, 600, 0)];
  it('places the looks, fills each opening with as many search looks as fit, and leaves the rest empty', () => {
    const a = fx('track', 32, 5, 5, 10), b = fx('track', 70, 5, 5, 8);
    const box = planTsbf(view(0, [a, b], S15, { tsbfWindow: 100_000, fill: 'full' }));
    expect(startOf(box, a)).toBe(32);
    expect(startOf(box, b)).toBe(70);
    // openings 32, 28 and 22 ms long: floor(32/15) + floor(28/15) + floor(22/15) = 2 + 1 + 1
    expect(flexCount(box)).toBe(4);
    expect(box.end).toBe(100_000);
    expect(tiles(box)).toBe(true);
  });

  it('search order: regions past their threshold first (smaller threshold first), then the longest wait', () => {
    const regions = [region('X', 10, 10, 1000, 0), region('Y', 10, 10, 400, 1)]; // thresholds 100 and 40 ms
    const box = planTsbf(view(200, [], regions, { tsbfWindow: 100_000, fill: 'full' }, [{ pst: 0, done: 0, idx: 0, last: 50_000 }, { pst: 0, done: 0, idx: 0, last: 150_000 }]));
    // at 200 ms: X waited 150 (past 100), Y waited 50 (past 40): both past, Y has the smaller threshold
    expect(box.items[0].type === 'flex' && box.items[0].region).toBe(1);
    expect(box.items[1].type === 'flex' && box.items[1].region).toBe(0);
  });

  it('pace setting: a region is served only while it is behind its desired pace; the order stays the summary\'s', () => {
    const regions = [region('X', 10, 10, 1000, 0)]; // pattern 100 ms per 1000 ms: one 10 ms look per 100 ms
    // at 200 ms, 1 look done in this frame: wanted by now 20 ms, done 10 ms -> behind, serve one; then at pace until 290 ms
    const box = planTsbf(view(200, [], regions, { tsbfWindow: 100_000, fill: 'pace' }, [{ pst: 0, done: 10_000, idx: 1, last: 150_000 }]));
    expect(box.items.map((x) => [x.type, x.start / 1000, x.len / 1000])).toEqual([['flex', 200, 10], ['spare', 210, 80], ['flex', 290, 10]]);
    expect(tiles(box)).toBe(true);
  });

  it('pace setting: time is never left as spare while a region is behind and its beam fits', () => {
    const regions = [region('X', 10, 10, 200, 0)]; // wants half of the time
    const box = planTsbf(view(1000, [], regions, { tsbfWindow: 100_000, fill: 'pace' }, [{ pst: 0, done: 0, idx: 0, last: 0 }])); // far behind
    expect(box.items.every((x) => x.type === 'flex')).toBe(true);
  });

  it('never lets a look cross the window edge: it waits for the next window or is dropped as a boundary loss', () => {
    const wait = fx('track', 96, 4, 20, 10), lost = fx('track', 93, 2, 2, 10); // lost: window 91..95, would end at 101..105
    const box = planTsbf(view(0, [wait, lost], S15, { tsbfWindow: 100_000, fill: 'full' }));
    expect(startOf(box, wait)).toBeNull();
    expect(startOf(box, lost)).toBeNull();
    expect(box.dropped.map((d) => [d.req.id, d.reason])).toEqual([[lost.id, 'boundary']]);
  });
});
