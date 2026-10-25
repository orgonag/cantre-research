/**
 * Scenario-replay harness for the matching state machine (spec §6, §13 done-when: "every status
 * in §6 is reachable and asserted by scenario replays").
 *
 * A scenario is a synthetic network plus a list of steps. Each step feeds one event (or just reads
 * the clock) and asserts the full externally visible result. These are SYNTHETIC replays built
 * from metre offsets or the committed golden tiles; they are not field traces and say nothing
 * about real-world accuracy.
 *
 * Units: metres east/north of `ORIGIN` for positions; milliseconds for every time; miles for
 * mileposts. Time enters only through the step's own numbers (no clock is read).
 */
import { expect, it } from 'vitest';
import { cumulativeLengthsM, fromLocalM } from '../../src/index.js';
import type {
  Fix,
  LatLon,
  Lock,
  MatchEvent,
  MatchReason,
  MatchStatus,
  NetworkChain,
  NetworkView,
  Result,
} from '../../src/index.js';
import { currentResult, initialMatchState, reduce } from '../../src/match/machine.js';
import { ORIGIN } from '../helpers/network.js';
import type { ChainOptions } from '../helpers/network.js';

export { ORIGIN };

/** What a step asserts. Only `status` is required; every other field is checked when present. */
export type Expectation = {
  readonly status: MatchStatus;
  /** The exact reason list, in order. */
  readonly reasons?: readonly MatchReason[];
  /** `result.chosen?.chainId ?? null`: the chain the result is matched on (null when none). */
  readonly chainId?: string | null;
  /** Calibrated milepost in miles within `mpTolMi` (default 0.01 mi), or null for "no milepost". */
  readonly mpApprox?: number | null;
  readonly mpTolMi?: number;
  /** `{lowerMp, upperMp}` in miles within `mpTolMi`, or null for "no range". */
  readonly mpRange?: { readonly lowerMp: number; readonly upperMp: number } | null;
  readonly selectionOrigin?: 'auto' | 'user' | null;
  /** The indistinguishable set I as chain ids (segment key for an unchained one), in result order. */
  readonly candidates?: readonly string[];
  /** The same set compared without order, for equidistant candidates whose order is a float tie. */
  readonly candidatesAnyOrder?: readonly string[];
  readonly lock?: Lock | null;
  /** The fix's own reported accuracy, metres: a user choice must never change it. */
  readonly accuracyM?: number | null;
  /** `nowMs - lastFixTimestampMs`, milliseconds (null before any fix). */
  readonly fixAgeMs?: number | null;
  /** The status of the stored result carried as `historical` (null when there is none). */
  readonly historical?: MatchStatus | null;
  /** The reason `reduce` gave for ignoring the event (null when it was accepted). Event steps only. */
  readonly ignored?: MatchReason | null;
};

/**
 * One step. `event` is applied with `reduce`, then the result is read with `currentResult` at
 * `atMs` (default: the fix's own timestamp for a fix, else the previous step's read time).
 * `{ tick }` applies no event and only reads the clock at `tick` (milliseconds).
 */
export type Step =
  | { readonly event: MatchEvent; readonly atMs?: number; readonly expect: Expectation }
  | { readonly tick: number; readonly expect: Expectation };

/** A named synthetic replay. `after` may add scenario-level checks over every step's result. */
export type Scenario = {
  readonly name: string;
  readonly net: NetworkView;
  readonly steps: readonly Step[];
  readonly after?: (results: readonly Result[]) => void;
};

/** A fix `eastM`/`northM` metres from `origin` (tangent plane at the origin's latitude). */
export function fixAt(
  eastM: number,
  northM: number,
  timestampMs: number,
  accuracyM = 5,
  extra: Partial<Fix> = {},
  origin: LatLon = ORIGIN,
): Fix {
  const p = fromLocalM(origin, { x: eastM, y: northM }, origin.lat);
  return { lat: p.lat, lon: p.lon, timestampMs, accuracyM, ...extra };
}

/** Step builder: a fix event at metre offsets, with its expectation. */
export function fixStep(
  timestampMs: number,
  eastM: number,
  northM: number,
  expectation: Expectation,
  extra: Partial<Fix> & { readonly atMs?: number } = {},
): Step {
  const { atMs, ...fixExtra } = extra;
  return {
    event: {
      type: 'fix',
      fix: fixAt(eastM, northM, timestampMs, fixExtra.accuracyM ?? 5, fixExtra),
    },
    atMs: atMs ?? timestampMs,
    expect: expectation,
  };
}

/** Step builder: a fix at an explicit latitude/longitude (degrees), with its expectation. */
export function fixPointStep(
  timestampMs: number,
  point: LatLon,
  expectation: Expectation,
  extra: Partial<Fix> & { readonly atMs?: number } = {},
): Step {
  const { atMs, ...fixExtra } = extra;
  return {
    event: {
      type: 'fix',
      fix: { lat: point.lat, lon: point.lon, timestampMs, accuracyM: 5, ...fixExtra },
    },
    atMs: atMs ?? timestampMs,
    expect: expectation,
  };
}

/** Step builder: any non-fix event (read at the previous step's time unless `atMs` is given). */
export function eventStep(event: MatchEvent, expectation: Expectation, atMs?: number): Step {
  return atMs === undefined ? { event, expect: expectation } : { event, atMs, expect: expectation };
}

/** Step builder: no event, just the clock at `nowMs`. */
export function tickStep(nowMs: number, expectation: Expectation): Step {
  return { tick: nowMs, expect: expectation };
}

/**
 * A chain through the given (east, north) metre points, `s` starting at 0. For shapes the helper's
 * straight chains cannot express (a gradually diverging parallel track).
 */
export function chainFromXY(
  id: string,
  pointsM: readonly (readonly [number, number])[],
  opts: ChainOptions = {},
): NetworkChain {
  const pts = pointsM.map(([x, y]) => fromLocalM(ORIGIN, { x, y }, ORIGIN.lat));
  const cumulativeM = cumulativeLengthsM(pts);
  return {
    id,
    chainBaseId: opts.chainBaseId ?? id,
    subdivisionNid: opts.sub ?? 'sub-1',
    subdivisionName: opts.subName ?? 'Test Sub',
    operators: [...(opts.operators ?? [opts.op ?? 'CN'])].sort(),
    cycle: opts.cycle ?? false,
    trackClasses: [...(opts.trackClasses ?? ['Main'])].sort(),
    pts,
    sM: Float64Array.from(cumulativeM),
    cumulativeM,
  };
}

/** The identifier a candidate is reported under: its chain id, else its siding key. */
function candidateName(c: { chainId: string | null; segmentKey: string | null }): string {
  return c.chainId ?? c.segmentKey ?? '?';
}

/** Asserts one result against one expectation; `where` names the scenario step in a failure. */
function check(result: Result, e: Expectation, where: string): void {
  expect(result.status, `${where}: status`).toBe(e.status);
  if (e.reasons !== undefined) {
    expect(result.reasons, `${where}: reasons`).toEqual(e.reasons);
  }
  if (e.chainId !== undefined) {
    expect(result.chosen?.chainId ?? null, `${where}: chainId`).toBe(e.chainId);
  }
  const tol = e.mpTolMi ?? 0.01;
  if (e.mpApprox === null) {
    expect(result.milepost, `${where}: milepost`).toBeNull();
  } else if (e.mpApprox !== undefined) {
    expect(result.milepost?.kind, `${where}: milepost kind`).toBe('calibrated');
    const mp = result.milepost?.kind === 'calibrated' ? result.milepost.mp : Number.NaN;
    expect(
      Math.abs(mp - e.mpApprox),
      `${where}: milepost ${String(mp)} vs ${String(e.mpApprox)}`,
    ).toBeLessThanOrEqual(tol);
  }
  if (e.mpRange === null) {
    expect(result.mpRange, `${where}: mpRange`).toBeNull();
  } else if (e.mpRange !== undefined) {
    expect(result.mpRange, `${where}: mpRange present`).not.toBeNull();
    const r = result.mpRange as { lowerMp: number; upperMp: number };
    expect(Math.abs(r.lowerMp - e.mpRange.lowerMp), `${where}: lowerMp`).toBeLessThanOrEqual(tol);
    expect(Math.abs(r.upperMp - e.mpRange.upperMp), `${where}: upperMp`).toBeLessThanOrEqual(tol);
  }
  if (e.selectionOrigin !== undefined) {
    expect(result.selectionOrigin, `${where}: selectionOrigin`).toBe(e.selectionOrigin);
  }
  if (e.candidates !== undefined) {
    expect(result.candidates.map(candidateName), `${where}: candidates`).toEqual(e.candidates);
  }
  if (e.candidatesAnyOrder !== undefined) {
    expect(result.candidates.map(candidateName).sort(), `${where}: candidate set`).toEqual(
      [...e.candidatesAnyOrder].sort(),
    );
  }
  if (e.lock !== undefined) {
    expect(result.lock, `${where}: lock`).toEqual(e.lock);
  }
  if (e.accuracyM !== undefined) {
    expect(result.accuracyM, `${where}: accuracyM`).toBe(e.accuracyM);
  }
  if (e.fixAgeMs !== undefined) {
    expect(result.fixAgeMs, `${where}: fixAgeMs`).toBe(e.fixAgeMs);
  }
  if (e.historical !== undefined) {
    expect(result.historical?.status ?? null, `${where}: historical`).toBe(e.historical);
  }
}

/**
 * Replays `steps` against `net` from a fresh state and asserts every step in order. Returns the
 * status seen after each step, every step's result and every reason `reduce` gave for ignoring an
 * event, for the coverage tests and `after` hooks.
 * Honesty checks applied to EVERY step regardless of the expectation: a milepost or range exists
 * only for the statuses that may carry one, and `chosen` only for MATCHED.
 */
export function replay(
  net: NetworkView,
  steps: readonly Step[],
): {
  readonly statuses: readonly MatchStatus[];
  readonly results: readonly Result[];
  readonly ignored: readonly MatchReason[];
} {
  let state = initialMatchState(net);
  let lastAtMs = 0;
  const results: Result[] = [];
  const ignoredSeen: MatchReason[] = [];
  steps.forEach((step, i) => {
    const where = `step ${String(i)}`;
    let ignored: MatchReason | null = null;
    let atMs: number;
    if ('tick' in step) {
      atMs = step.tick;
    } else {
      const r = reduce(state, step.event);
      state = r.state;
      ignored = r.ignored;
      if (ignored !== null) {
        ignoredSeen.push(ignored);
      }
      atMs = step.atMs ?? (step.event.type === 'fix' ? step.event.fix.timestampMs : lastAtMs);
    }
    lastAtMs = atMs;
    const result = currentResult(state, atMs);
    check(result, step.expect, where);
    if ('event' in step && step.expect.ignored !== undefined) {
      expect(ignored, `${where}: ignored`).toBe(step.expect.ignored);
    }
    // Invariants the owner's honesty rules require at every step.
    if (result.milepost !== null) {
      expect(result.status, `${where}: only MATCHED carries a milepost`).toBe('MATCHED');
    }
    if (result.mpRange !== null) {
      expect(result.status, `${where}: only MATCHED_SUBDIVISION carries a range`).toBe(
        'MATCHED_SUBDIVISION',
      );
    }
    if (result.chosen !== null) {
      expect(result.status, `${where}: only MATCHED carries a chosen track`).toBe('MATCHED');
    }
    if (result.status === 'MATCHED_SUBDIVISION') {
      expect(
        result.rangeGroup.length,
        `${where}: a subdivision group has 2+ tracks`,
      ).toBeGreaterThan(1);
      for (const c of result.rangeGroup) {
        expect(result.candidates, `${where}: the range group is inside candidates`).toContain(c);
      }
    } else {
      expect(result.rangeGroup, `${where}: only MATCHED_SUBDIVISION has a range group`).toEqual([]);
    }
    results.push(result);
  });
  return { statuses: results.map((r) => r.status), results, ignored: ignoredSeen };
}

/** Registers one `it` per scenario that replays it (and runs its `after` hook). */
export function runScenarios(scenarios: readonly Scenario[]): void {
  for (const sc of scenarios) {
    it(sc.name, () => {
      const { results } = replay(sc.net, sc.steps);
      sc.after?.(results);
    });
  }
}
