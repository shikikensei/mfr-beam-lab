/** Time in integer microseconds, so that equal seeds give bit-identical results. */
export type Us = number;
export const ms = (x: number): Us => Math.round(x * 1000);

/**
 * Fixed task queues, highest priority first. The index in this list is the rank.
 * critical > confirm > retry > trackHigh > track (reasons: see docs/assumptions.md).
 */
export const QUEUES = ['critical', 'confirm', 'retry', 'trackHigh', 'track'] as const;
export type FixedKind = (typeof QUEUES)[number];
export const rankOf = (k: FixedKind): number => QUEUES.indexOf(k);

/** A dwell is transmit, wait, receive. Ordinary dwells have wait = 0. */
export interface Segments { tx: Us; wait: Us; rx: Us }

export interface FixedRequest {
  id: number;
  kind: FixedKind;
  /** Target index, or -1 for a scripted critical task. */
  target: number;
  req: Us;
  earliest: Us;
  latest: Us;
  len: Us;
  seg: Segments;
  rank: number;
  /** Nominal repeat period; only the time-balance scheduler reads it. */
  period: Us;
  /** Hand-built request: always executes as a hit and creates no follow-up. */
  scripted?: boolean;
  createdAt: Us;
  /** Times the scheduler handed it back because of a higher-priority conflict. */
  returns: number;
  /** Times it was pulled out of a box by an interrupt. */
  interrupts: number;
}

export interface SearchRegion {
  name: string;
  beams: number;
  beamLen: Us;
  /** Desired frame time. */
  dft: Us;
  /** Smaller is more important. Used by the legacy scheduler only. */
  priority: number;
}

export interface PatternState {
  /** Pattern start time: when the current frame began (= when the previous one completed). */
  pst: Us;
  /** Sum of event lengths executed in the current frame. */
  done: Us;
  idx: number;
  /** When the region's most recent beam started (0 before the first one). */
  last: Us;
}

export interface TargetSpec {
  /** Lane label for hand-built scenes; default is the target number. */
  name?: string;
  region: number;
  beam: number;
  appear: Us;
  disappear: Us | null;
  high: boolean;
  dwell: Us;
  /** Far target: its track dwells are transmit, a long wait, receive (didactic scale, not a real range). */
  far?: boolean;
}

export interface CriticalSpec { at: Us; len: Us; notice: Us }
/** A fixed request written by hand (known from time 0). Times are absolute. */
export interface ScriptedSpec { kind: FixedKind; target: number; req: Us; lead: Us; trail: Us; len: Us }

export interface ModelParams {
  intervalHigh: Us;
  intervalNormal: Us;
  /** Leading and trailing slack of a track update, as a fraction of its interval. */
  slackFrac: number;
  confirmDelay: Us; confirmLead: Us; confirmTrail: Us; confirmLen: Us;
  retryDelay: Us; retryLead: Us; retryTrail: Us;
  pdSearch: number; pdConfirm: number; pdTrack: number;
  missLimit: number;
}

export interface Scenario {
  regions: SearchRegion[];
  targets: TargetSpec[];
  criticals: CriticalSpec[];
  scripted?: ScriptedSpec[];
  duration: Us;
  seed: number;
  params: ModelParams;
}

export type FillMode = 'pace' | 'full';
export type SchedulerId = 'drsi' | 'legacy' | 'fifo' | 'template' | 'priority' | 'edf' | 'balance' | 'tsbf' | 'interleave';

export interface SimConfig {
  scheduler: SchedulerId;
  /** pace: search only up to its desired rate (as in the paper). full: fill every opening. */
  fill: FillMode;
  maxDrsi: Us;
  /**
   * How far the tentative (latest) position of the next fixed task is pulled forward.
   * paper: only so that more important queue heads can still follow (cases 1 to 3).
   * followers: so that every waiting fixed task that has to follow it still can.
   */
  protect: 'paper' | 'followers';
  rsiLen: Us;
  /** Fixed template: share of each rsiLen cycle reserved for fixed tasks. */
  templateShare: number;
  /** Two-slope benefit scheduler: length of its scheduling window. */
  tsbfWindow: Us;
  trace: boolean;
  /** Conventions of the one-dwell schedulers (simple.ts) that can be varied to test their effect. */
  conv?: Partial<Conventions>;
}

export interface Conventions {
  /** A search beam's deadline is this many beam slots after it falls due. */
  searchGrace: number;
  /** How far behind a search beam may count as: Infinity keeps the whole backlog of the frame, 1 forgets all but one slot. */
  searchBacklog: number;
  /** Time balance divides a fixed task's lateness by its repeat period or by its trailing slack. */
  balanceBy: 'period' | 'slack';
}

/** fragment: too short for what was wanted. boundary: would cross a box/window edge. window: the template reserved the time for the other kind. */
export type GapCause = 'fragment' | 'boundary' | 'window';
export type DropReason = 'timeout' | 'conflict' | 'boundary';

export type Placement =
  /** `saved`: set on a dwell interleaved into the wait of the dwell before it; the time the two share. */
  | { type: 'flex'; region: number; start: Us; len: Us; saved?: Us }
  | { type: 'fixed'; req: FixedRequest; start: Us; len: Us; saved?: Us }
  /** gap: something was wanted but did not fit. spare: nothing was wanted. */
  | { type: 'gap'; start: Us; len: Us; cause: GapCause }
  | { type: 'spare'; start: Us; len: Us };

export type PlanStep = { shown: number } & (
  | { kind: 'select'; nft: number | null; caseNo: 0 | 1 | 2; tentative: Us | null; limit: Us; returned: { id: number; blocker: number }[]; why: 'nft' | 'maxDrsi' | 'none' }
  | { kind: 'deficit'; ftd: number[]; order: number[] }
  | { kind: 'fill'; placed: number[]; flexEnd: Us }
  | { kind: 'close'; nft: number | null; from: Us | null; to: Us | null; gap: Us; spare: Us }
  /** One more fixed task placed directly behind the previous one. */
  | { kind: 'chain'; id: number; at: Us }
  | { kind: 'legacyBox'; candidates: number[] }
  | { kind: 'legacyFixed'; placed: number[]; carried: number[]; dropped: { id: number; reason: DropReason }[] }
  | { kind: 'legacyFill'; placed: number[]; gap: Us; spare: Us }
  | { kind: 'interrupt'; at: Us; removed: number[] }
  /** Two-slope benefit scheduler: collect the looks of the window, select, assign all start times at once, fill. */
  | { kind: 'tsbfCollect'; end: Us; cands: number[] }
  | { kind: 'tsbfSelect'; kept: number[]; out: { id: number; fate: 'carry' | DropReason }[] }
  | { kind: 'tsbfAssign'; starts: { id: number; start: Us }[] }
  | { kind: 'tsbfFill'; placed: number[]; gap: Us; spare: Us }
  /** Fixed priority + pulse interleaving: pick the next dwell, test whether another fits into its wait, place. */
  | { kind: 'ilPick'; id: number | null; region: number | null }
  | { kind: 'ilCheck'; wait: Us; guestId: number | null; guestRegion: number | null; mode: 'whole' | 'tx' | 'none'; saved: Us }
  | { kind: 'ilPlace'; end: Us }
  /** One-dwell-at-a-time schedulers: the single decision of this call. */
  | { kind: 'pick' }
);

export interface Box {
  start: Us;
  end: Us;
  /** Contiguous partition of [start, end). */
  items: Placement[];
  returned: { req: FixedRequest; blocker: FixedRequest }[];
  dropped: { req: FixedRequest; reason: DropReason }[];
  steps: PlanStep[];
}

export interface PlanView {
  now: Us;
  /** Pending fixed requests by rank, each sorted by latest start. */
  queues: FixedRequest[][];
  regions: SearchRegion[];
  patterns: PatternState[];
  cfg: SimConfig;
}

export type Planner = (view: PlanView) => Box;

/** `gs` is the global step index at which the item becomes visible in a step-by-step view. */
export type Interval = { start: Us; len: Us; box: number; gs: number; saved?: Us } & (
  | { type: 'flex'; region: number }
  | { type: 'fixed'; reqId: number; kind: FixedKind; target: number; hit: boolean }
  | { type: 'gap'; cause: GapCause }
  | { type: 'spare' }
);

export interface RequestRecord extends FixedRequest {
  status: 'pending' | 'done' | 'dropped' | 'cancelled';
  start: Us | null;
  hit: boolean | null;
  dropReason: DropReason | null;
  resolvedAt: Us | null;
  createdGs: number;
  resolvedGs: number | null;
}

export interface Mark { t: Us; target: number; kind: 'detect' | 'track' | 'lost' | 'unconfirmed'; gs: number }

export interface BoxRecord { start: Us; end: Us; steps: PlanStep[]; gsBase: number; interrupted: boolean }

export interface SimResult {
  scenario: Scenario;
  config: SimConfig;
  end: Us;
  timeline: Interval[];
  requests: RequestRecord[];
  marks: Mark[];
  /** Completed frames per region: [completion time, frame time]. */
  frames: [Us, Us][][];
  boxes: BoxRecord[];
  /** Total number of global steps. */
  steps: number;
}
