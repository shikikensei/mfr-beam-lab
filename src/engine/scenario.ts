import { sequence } from './rand.ts';
import { ms } from './types.ts';
import type { CriticalSpec, ModelParams, Scenario, SearchRegion, SimConfig, TargetSpec, Us } from './types.ts';

/** Didactic values (few targets, long dwells). Not taken from any real system. */
export const DEFAULT_REGIONS: SearchRegion[] = [
  { name: '水平線', beams: 12, beamLen: ms(15), dft: ms(600), priority: 0 },
  { name: '上空', beams: 20, beamLen: ms(10), dft: ms(1000), priority: 1 },
];

export const DEFAULT_PARAMS: ModelParams = {
  intervalHigh: ms(300),
  intervalNormal: ms(600),
  slackFrac: 0.08,
  confirmDelay: ms(100), confirmLead: ms(90), confirmTrail: ms(100), confirmLen: ms(12),
  retryDelay: ms(30), retryLead: ms(25), retryTrail: ms(60),
  pdSearch: 0.85, pdConfirm: 0.92, pdTrack: 0.88,
  missLimit: 3,
};

export const DEFAULT_CONFIG: SimConfig = {
  scheduler: 'drsi',
  fill: 'pace',
  maxDrsi: ms(150),
  protect: 'followers',
  rsiLen: ms(100),
  templateShare: 0.4,
  tsbfWindow: ms(100),
  trace: false,
};

export interface ScenarioOptions {
  targets: number;
  seed: number;
  duration?: Us;
  /** Targets appear evenly over this span. 0 = all present from the start. */
  ramp?: Us;
  /** Every target with index >= keep disappears at this time. */
  disappear?: { at: Us; keep: number };
  /** Share of highly manoeuvring targets (short update interval). Default 0.35. */
  highFrac?: number;
  /** Share of far targets (dwells with a wait between transmit and receive). Default 0.4. */
  farFrac?: number;
  criticals?: CriticalSpec[];
  regions?: SearchRegion[];
  params?: Partial<ModelParams>;
}

export function makeScenario(o: ScenarioOptions): Scenario {
  const regions = o.regions ?? DEFAULT_REGIONS;
  const r = sequence(o.seed);
  const targets: TargetSpec[] = [];
  for (let i = 0; i < o.targets; i++) {
    const region = r() < 0.6 ? 0 : Math.min(1, regions.length - 1);
    const high = r() < (o.highFrac ?? 0.35);
    const beam = Math.floor(r() * regions[region].beams);
    const dwell = ms(8 + 2 * Math.floor(r() * 5));
    targets.push({
      region, beam, high, dwell,
      // by index, not by a random draw, so that adding the attribute changed nothing else
      far: (i * 7 + 3) % 10 < (o.farFrac ?? 0.4) * 10,
      appear: o.ramp ? Math.round((i / o.targets) * o.ramp) : 0,
      disappear: o.disappear && i >= o.disappear.keep ? o.disappear.at : null,
    });
  }
  return {
    regions, targets,
    criticals: [...(o.criticals ?? [])].sort((a, b) => a.at - b.at),
    duration: o.duration ?? ms(6000),
    seed: o.seed,
    params: { ...DEFAULT_PARAMS, ...o.params },
  };
}

/** A target's update interval: the allocation's choice if there is one, else the interval of its class. */
export const intervalOf = (sc: Scenario, t: TargetSpec): Us => t.interval ?? (t.high ? sc.params.intervalHigh : sc.params.intervalNormal);

/**
 * Nominal demand as a fraction of the timeline: every search region at its desired frame time
 * plus every target tracked at its update interval. Confirmations and re-illuminations are not
 * included (they depend on what the scheduler did).
 */
export function nominalDemand(sc: Scenario): number {
  const search = sc.regions.reduce((a, g) => a + (g.beams * g.beamLen) / g.dft, 0);
  const track = sc.targets.reduce((a, t) => a + t.dwell / intervalOf(sc, t), 0);
  return search + track;
}

/** Nominal demand second by second, counting only the targets present in that second. */
export function demandSeries(sc: Scenario): { search: number; total: number[] } {
  const search = sc.regions.reduce((a, g) => a + (g.beams * g.beamLen) / g.dft, 0);
  const total: number[] = [];
  for (let k = 0; k * 1e6 < sc.duration; k++) {
    const t = k * 1e6;
    total.push(search + sc.targets.reduce((a, x) => a + (x.appear <= t && (x.disappear === null || t < x.disappear) ? x.dwell / intervalOf(sc, x) : 0), 0));
  }
  return { search, total };
}
