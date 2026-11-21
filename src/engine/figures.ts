// Hand-built inputs for the three ways of choosing the next fixed task (paper figures 5 to 7):
// a more important task A and a less important task B. The paper's figures carry no numbers;
// these values are this tool's. Used by the unit tests and shown as scenes in chapter 1.
import { DEFAULT_PARAMS } from './scenario.ts';
import { ms } from './types.ts';
import type { Scenario, SearchRegion, SimConfig } from './types.ts';

/** [requested time, leading slack, trailing slack, length], in ms. */
export type HandTask = readonly [req: number, lead: number, trail: number, len: number];
export const HAND_CASES = {
  case1: { a: [60, 10, 10, 10], b: [85, 10, 10, 10] },
  case2: { a: [75, 5, 5, 10], b: [50, 10, 10, 10] },
  case3: { a: [60, 2, 2, 10], b: [58, 3, 3, 20] },
} as const satisfies Record<string, { a: HandTask; b: HandTask }>;
export type HandCaseId = keyof typeof HAND_CASES;

/** One search region of 10 ms beams, so positions are easy to read. */
export const HAND_REGION: SearchRegion = { name: '捜索', beams: 100, beamLen: ms(10), dft: ms(2000), priority: 0 };
/** The tests fill every opening with search; the scenes do the same. */
export const HAND_CONFIG: Pick<SimConfig, 'fill'> = { fill: 'full' };

export function handScenario(id: HandCaseId): Scenario {
  const c: { a: HandTask; b: HandTask } = HAND_CASES[id], never = Number.MAX_SAFE_INTEGER;
  const spec = (name: string, high: boolean, len: number) => ({ name, region: 0, beam: 0, appear: never, disappear: null, high, dwell: ms(len) });
  const req = (kind: 'trackHigh' | 'track', target: number, [r, lead, trail, len]: HandTask) =>
    ({ kind, target, req: ms(r), lead: ms(lead), trail: ms(trail), len: ms(len) });
  return {
    regions: [HAND_REGION],
    targets: [spec('タスクA', true, c.a[3]), spec('タスクB', false, c.b[3])],
    criticals: [],
    scripted: [req('trackHigh', 0, c.a), req('track', 1, c.b)],
    duration: ms(100), seed: 1, params: DEFAULT_PARAMS,
  };
}
