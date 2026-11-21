import { describe, expect, it } from 'vitest';
import { planDrsi } from './drsi.ts';
import { HAND_CASES, HAND_CONFIG, HAND_REGION, handScenario } from './figures.ts';
import type { HandCaseId, HandTask } from './figures.ts';
import { DEFAULT_CONFIG } from './scenario.ts';
import { simulate } from './simulate.ts';
import { flexCount, fx, idle, region, startOf, tiles, view } from './testkit.ts';

// One search region of 10 ms beams, so positions are easy to read. Times in ms.
const R10 = [region('S', 100, 10, 2000, 0)];
const R15 = [region('S', 100, 15, 2000, 0)];
/** The hand-built A (more important) and B (less important) of figures.ts, as planner input. */
const hand = (id: HandCaseId) => { const c: { a: HandTask; b: HandTask } = HAND_CASES[id]; return [fx('trackHigh', ...c.a), fx('track', ...c.b)] as const; };
const HR = [HAND_REGION];
const select = (b: ReturnType<typeof planDrsi>) => { const s = b.steps[0]; if (s.kind !== 'select') throw new Error('no select step'); return s; };

describe('dynamic RSI: the four steps', () => {
  it('builds the box up to the NFT at its latest start and fills it with search, leaving no gap', () => {
    const a = fx('trackHigh', 60, 10, 10, 10);
    const b = planDrsi(view(0, [a], R10, { fill: 'full' }));
    expect(select(b).tentative).toBe(70_000);
    expect(flexCount(b)).toBe(7);
    expect(startOf(b, a)).toBe(70);
    expect(idle(b, 'gap')).toBe(0);
    expect(b.end).toBe(80_000);
    expect(tiles(b)).toBe(true);
  });

  it('moves the NFT sooner to close the opening left by the last search beam', () => {
    const a = fx('trackHigh', 60, 10, 10, 10);
    const b = planDrsi(view(0, [a], R15, { fill: 'full' }));
    expect(flexCount(b)).toBe(4); // 4 x 15 ms = 60 ms; a fifth would pass the latest start (70)
    expect(startOf(b, a)).toBe(60);
    expect(idle(b, 'gap')).toBe(0);
  });

  it('leaves a gap when the earliest start is reached first, and reports it', () => {
    const a = fx('trackHigh', 68, 3, 2, 10); // window 65..70
    const b = planDrsi(view(0, [a], R15, { fill: 'full' }));
    expect(startOf(b, a)).toBe(65);
    expect(idle(b, 'gap')).toBe(5);
    expect(tiles(b)).toBe(true);
  });

  it('computes deficits once, serves the largest first, and only as many beams as remove the deficit', () => {
    const regions = [region('X', 10, 10, 1000, 1), region('Y', 10, 10, 1000, 0)];
    // X: wanted (100/1000)*400 = 40 ms, done 10 -> 30 ms behind -> 3 beams. Y: done 35 -> 5 ms behind -> 1 beam.
    const b = planDrsi(view(400, [], regions, { fill: 'pace' }, [{ pst: 0, done: 10_000, idx: 1 }, { pst: 0, done: 35_000, idx: 3 }]));
    const d = b.steps[1];
    expect(d.kind === 'deficit' && d.order).toEqual([0, 1]);
    expect(d.kind === 'deficit' && d.ftd).toEqual([30_000, 5_000]);
    expect(b.items.map((x) => (x.type === 'flex' ? x.region : -1))).toEqual([0, 0, 0, 1]);
  });

  it('in pace mode, runs the fixed task at its requested time when search wants nothing', () => {
    const a = fx('track', 60, 10, 10, 10);
    const b = planDrsi(view(0, [a], R10, { fill: 'pace' })); // deficit is 0 at t = pst
    expect(flexCount(b)).toBe(0);
    expect(startOf(b, a)).toBe(60);
    expect(idle(b, 'spare')).toBe(60);
    expect(idle(b, 'gap')).toBe(0);
  });
});

describe('dynamic RSI: choosing the next fixed task (paper figures 5 to 7)', () => {
  it('case 1: the most important task has the earliest deadline; the other follows with no gap', () => {
    const [a, low] = hand('case1');
    const b = planDrsi(view(0, [a, low], HR, HAND_CONFIG));
    expect(select(b).nft).toBe(a.id);
    expect(select(b).caseNo).toBe(1);
    expect(startOf(b, a)).toBe(70);
    expect(startOf(b, low)).toBe(80);
    expect(idle(b, 'gap')).toBe(0);
  });

  it('case 2: a less important task that ends before the important one must start goes first', () => {
    const [a, low] = hand('case2');
    const b = planDrsi(view(0, [a, low], HR, HAND_CONFIG));
    expect(select(b).nft).toBe(low.id);
    expect(select(b).caseNo).toBe(2);
    expect(startOf(b, low)).toBe(60);
    expect(startOf(b, a)).toBe(70); // immediately after
    expect(select(b).returned).toEqual([]);
  });

  it('case 2 never lets the less important task push the important one past its window', () => {
    const a = fx('trackHigh', 62, 2, 2, 10), low = fx('track', 50, 10, 10, 10); // a must start by 64
    const b = planDrsi(view(0, [a, low], R10, { fill: 'full' }));
    expect(select(b).tentative).toBe(54_000); // 64 - 10, not low's own latest (60)
    expect(startOf(b, low)! + 10).toBeLessThanOrEqual(64);
    expect(startOf(b, a)).not.toBeNull();
  });

  it('case 3: a less important task that fits neither before nor after is handed back', () => {
    const [a, low] = hand('case3');
    const b = planDrsi(view(0, [a, low], HR, HAND_CONFIG));
    expect(select(b).nft).toBe(a.id);
    expect(b.returned.map((x) => [x.req.id, x.blocker.id])).toEqual([[low.id, a.id]]);
    expect(startOf(b, low)).toBeNull();
  });

  it('a critical task outranks everything and starts exactly on time', () => {
    const c = fx('critical', 50, 0, 0, 20), conf = fx('confirm', 55, 5, 5, 12);
    const b = planDrsi(view(0, [c, conf], R10, { fill: 'full' }));
    expect(startOf(b, c)).toBe(50);
    expect(b.returned.map((x) => x.req.id)).toEqual([conf.id]);
  });
});

describe.each(['paper', 'followers'] as const)('the same hand-built cases as scenes, through the executor (%s)', (protect) => {
  const run = (id: HandCaseId) => {
    const r = simulate(handScenario(id), { ...DEFAULT_CONFIG, ...HAND_CONFIG, protect });
    return r.requests.slice(0, 2).map((q) => [q.status, q.start === null ? null : q.start / 1000, q.dropReason]);
  };
  it('case 1: A at 70 ms, B right behind it', () => expect(run('case1')).toEqual([['done', 70, null], ['done', 80, null]]));
  it('case 2: B at 60 ms, A right behind it', () => expect(run('case2')).toEqual([['done', 70, null], ['done', 60, null]]));
  it('case 3: A runs, B is handed back and its window passes', () => expect(run('case3')).toEqual([['done', 60, null], ['dropped', null, 'conflict']]));
});

describe('dynamic RSI: maximum length', () => {
  it('closes the box with search only when the next fixed task would make it too long', () => {
    const a = fx('track', 300, 10, 10, 10);
    const b = planDrsi(view(0, [a], R10, { fill: 'full', maxDrsi: 150_000 }));
    expect(select(b).nft).toBeNull();
    expect(select(b).why).toBe('maxDrsi');
    expect(startOf(b, a)).toBeNull();
    expect(b.end).toBe(150_000);
  });

  it('does not let a search-only box run past the latest start of a waiting task', () => {
    const a = fx('track', 140, 5, 5, 10); // latest 145, ends 155 > 150: not eligible yet
    const b = planDrsi(view(0, [a], R10, { fill: 'full', maxDrsi: 150_000 }));
    expect(select(b).nft).toBeNull();
    expect(b.end).toBeLessThanOrEqual(145_000);
  });

  it('stops chaining fixed tasks at the maximum length', () => {
    const reqs = [fx('track', 120, 10, 10, 10), fx('track', 135, 10, 10, 10), fx('track', 145, 10, 10, 10)];
    const b = planDrsi(view(0, reqs, R10, { fill: 'full', maxDrsi: 150_000 }));
    expect(b.end).toBeLessThanOrEqual(150_000);
  });
});

describe('dynamic RSI: room for followers (option, not in the paper)', () => {
  const mk = () => [fx('track', 60, 10, 10, 10), fx('track', 67, 7, 8, 10)]; // second must start by 75
  it('paper rule: the first task takes its latest start and the second loses its window', () => {
    const [a, f] = mk();
    const b = planDrsi(view(0, [a, f], R10, { fill: 'full', protect: 'paper' }));
    expect(startOf(b, a)).toBe(70);
    expect(startOf(b, f)).toBeNull();
  });
  it('followers rule: the first task is pulled forward just enough for the second to follow', () => {
    const [a, f] = mk();
    const b = planDrsi(view(0, [a, f], R10, { fill: 'full', protect: 'followers' }));
    expect(startOf(b, a)).toBe(60);
    expect(startOf(b, f)).toBe(70);
  });
});
