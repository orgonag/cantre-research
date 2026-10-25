/**
 * Scenario: a branch at a switch (spec §6, plan Decisions 3 and 9).
 *
 * Geometry (metres east/north of ORIGIN, accuracy 5 m, radius 50 m, margin d_min + 10 m):
 * - Main chain M: along y = 0, x 0 to 3000 (s = x), mp 5 at s 0.
 * - Branch chain Br: starts at the switch (1500, 0) and runs 1500 m on the line y = 0.1 (x - 1500),
 *   an angle of atan(0.1) = 5.71 degrees. Its s is 0 at the switch, and its first anchor sits
 *   there with M's own milepost at x = 1500, so both chains agree at the switch (no MP jump).
 * - Perpendicular distance from (x, y) to Br is |y - 0.1 (x - 1500)| / sqrt(1.01). A fix on M at x is
 *   therefore 1.99 m from Br at x = 1520 and 13.93 m from it at x = 1640, so Br falls outside the
 *   10 m margin somewhere between them.
 * Mileposts follow 1 mile per 1609.344 m of chain length (synthetic numbers).
 */
import { metresToMiles } from '../../src/index.js';
import type { NetworkView, Result } from '../../src/index.js';
import { ORIGIN, coverageAround, interval, network, straightChain } from '../helpers/network.js';
import { expect } from 'vitest';
import { fixStep } from './harness.js';
import type { Scenario, Step } from './harness.js';
import { fromLocalM } from '../../src/index.js';

const SLOPE = 0.1;
const BRANCH_BEARING_DEG = 90 - (Math.atan(SLOPE) * 180) / Math.PI; // clockwise from north
const SWITCH = fromLocalM(ORIGIN, { x: 1500, y: 0 }, ORIGIN.lat);
const COS = Math.cos(Math.atan(SLOPE));

/** M's mp at the switch, and the fixed starting point of Br's calibration. */
const MP_SWITCH = 5 + metresToMiles(1500);

/** Milepost on M at x metres. */
const mpM = (x: number): number => 5 + metresToMiles(x);
/** Milepost on Br for a fix on the branch at x metres (s = (x - 1500) / cos(angle)). */
const mpBr = (x: number): number => MP_SWITCH + metresToMiles((x - 1500) / COS);
/** A point on the branch at x metres east: its y. */
const yBr = (x: number): number => SLOPE * (x - 1500);

/** One network; `sameSub` puts both chains on one subdivision and operator. */
function junctionNet(sameSub: boolean): NetworkView {
  const M = straightChain('M', ORIGIN, 0, 3000, { sub: 'sub-main', op: 'CN' });
  const Br = straightChain('Br', SWITCH, 0, 1500, {
    sub: sameSub ? 'sub-main' : 'sub-branch',
    op: 'CN',
    bearingDeg: BRANCH_BEARING_DEG,
  });
  return network({
    coverage: [coverageAround(ORIGIN, 6000)],
    chains: [M, Br],
    intervals: [
      interval('iM', 'M', [
        { s: 0, mp: 5 },
        { s: 3000, mp: 5 + metresToMiles(3000) },
      ]),
      interval('iBr', 'Br', [
        { s: 0, mp: MP_SWITCH },
        { s: 1500, mp: MP_SWITCH + metresToMiles(1500) },
      ]),
    ],
  });
}

/** The mp a result stands for: the milepost, or the middle of a range; null otherwise. */
function representativeMp(r: Result): number | null {
  if (r.milepost?.kind === 'calibrated') {
    return r.milepost.mp;
  }
  if (r.mpRange !== null) {
    return (r.mpRange.lowerMp + r.mpRange.upperMp) / 2;
  }
  return null;
}

/** The mileposts shown while the train drives east never jump or run backwards between chains. */
function noMpJump(results: readonly Result[]): void {
  const shown = results.map(representativeMp).filter((m): m is number => m !== null);
  expect(shown.length).toBeGreaterThan(2);
  for (let i = 1; i < shown.length; i += 1) {
    const step = (shown[i] ?? 0) - (shown[i - 1] ?? 0); // miles
    // Fixes are at most 250 m (0.155 mi) apart along the track; allow 0.2 mi, never backwards.
    expect(step, `mp step ${String(i)}`).toBeGreaterThanOrEqual(-0.005);
    expect(step, `mp step ${String(i)}`).toBeLessThanOrEqual(0.2);
  }
}

/** Same subdivision: approach on M, both branches kept at the switch, then separate onto Br. */
export const junctionSameSubdivision: Scenario = {
  name: 'junction: same subdivision keeps both branches (MATCHED_SUBDIVISION) until they separate',
  net: junctionNet(true),
  steps: [
    // 100 m before the switch: Br's start is 100 m away (outside the radius): M alone.
    fixStep(1000, 1400, 0, { status: 'MATCHED', chainId: 'M', reasons: [], mpApprox: mpM(1400) }),
    // 20 m before: Br's start is 20 m away (residual 20 > 0 + 10): M alone.
    fixStep(2000, 1480, 0, { status: 'MATCHED', chainId: 'M', reasons: [], mpApprox: mpM(1480) }),
    // On the switch: both chains at 0 m. One subdivision and operator: MATCHED_SUBDIVISION, and
    // both calibrate to the same mp, so the range has zero width.
    fixStep(3000, 1500, 0, {
      status: 'MATCHED_SUBDIVISION',
      reasons: ['MULTIPLE_TRACKS'],
      chainId: null,
      mpApprox: null,
      mpRange: { lowerMp: MP_SWITCH, upperMp: MP_SWITCH },
      mpTolMi: 0.001,
    }),
    // 20 m past: Br is 1.99 m away from a fix on M: still both.
    fixStep(4000, 1520, 0, {
      status: 'MATCHED_SUBDIVISION',
      reasons: ['MULTIPLE_TRACKS'],
      mpRange: { lowerMp: mpM(1520), upperMp: mpBr(1520) },
      mpTolMi: 0.002,
    }),
    // On Br 60 m past the switch (y = 6): M is 6 m away. Both, still.
    fixStep(5000, 1560, yBr(1560), {
      status: 'MATCHED_SUBDIVISION',
      reasons: ['MULTIPLE_TRACKS'],
      candidates: ['Br', 'M'],
    }),
    // On Br at x = 1650 (y = 15): M is 15 m away (> 0 + 10): evidence separates, MATCHED on Br.
    fixStep(6000, 1650, yBr(1650), {
      status: 'MATCHED',
      chainId: 'Br',
      reasons: [],
      mpApprox: mpBr(1650),
      mpRange: null,
    }),
    fixStep(7000, 1900, yBr(1900), {
      status: 'MATCHED',
      chainId: 'Br',
      reasons: [],
      mpApprox: mpBr(1900),
    }),
  ],
  after: noMpJump,
};

/** Different subdivisions, cold start at the switch, continuing on M. */
export const junctionColdMain: Scenario = {
  name: 'junction: different subdivisions, cold start at the switch is AMBIGUOUS_ROUTE, then M',
  net: junctionNet(false),
  steps: [
    // On the switch: M and Br at 0 m, different subdivisions, no previous match.
    fixStep(1000, 1500, 0, {
      status: 'AMBIGUOUS_ROUTE',
      reasons: ['MULTIPLE_ROUTES'],
      chainId: null,
      mpApprox: null,
    }),
    // 20 m on along M: Br is 1.99 m away.
    fixStep(2000, 1520, 0, {
      status: 'AMBIGUOUS_ROUTE',
      reasons: ['MULTIPLE_ROUTES'],
      candidates: ['M', 'Br'],
    }),
    // 140 m on along M: Br (y = 14 at that x) is 13.93 m away, outside 0 + 10: MATCHED M.
    fixStep(3000, 1640, 0, { status: 'MATCHED', chainId: 'M', reasons: [], mpApprox: mpM(1640) }),
    fixStep(4000, 1900, 0, { status: 'MATCHED', chainId: 'M', reasons: [], mpApprox: mpM(1900) }),
  ],
};

/** Different subdivisions, cold start at the switch, then onto Br. */
export const junctionColdBranch: Scenario = {
  name: 'junction: different subdivisions, cold start at the switch is AMBIGUOUS_ROUTE, then Br',
  net: junctionNet(false),
  steps: [
    fixStep(1000, 1500, 0, {
      status: 'AMBIGUOUS_ROUTE',
      reasons: ['MULTIPLE_ROUTES'],
      chainId: null,
    }),
    // On Br 20 m on (y = 2): Br 0 m, M 2 m: both.
    fixStep(2000, 1520, yBr(1520), {
      status: 'AMBIGUOUS_ROUTE',
      reasons: ['MULTIPLE_ROUTES'],
      candidates: ['Br', 'M'],
    }),
    // On Br at x = 1700 (y = 20): M is 20 m away: MATCHED on Br from evidence.
    fixStep(3000, 1700, yBr(1700), {
      status: 'MATCHED',
      chainId: 'Br',
      reasons: [],
      mpApprox: mpBr(1700),
    }),
  ],
};

const onBranch = (t: number, x: number, expectation: Parameters<typeof fixStep>[3]): Step =>
  fixStep(t, x, yBr(x), expectation);

/**
 * Different subdivisions, driving through the switch on M and on to Br. The approach on M gives
 * continuity at the switch. Once the fixes are on Br and M falls outside the margin, I holds only
 * Br, a DIFFERENT railway, so M is not held (ruling R23, amends Decision 3 step 6b): the result
 * moves to Br at once from the evidence, never showing M's milepost against it.
 */
export const junctionApproachThenBranch: Scenario = {
  name: 'junction: approach on M, continuity at the switch, a different-railway branch is not held',
  net: junctionNet(false),
  steps: [
    fixStep(1000, 1300, 0, { status: 'MATCHED', chainId: 'M', reasons: [], mpApprox: mpM(1300) }),
    // On the switch: both chains in I, different subdivisions; the previous match M is in I.
    fixStep(2000, 1500, 0, {
      status: 'MATCHED',
      chainId: 'M',
      reasons: ['CONTINUITY'],
      candidatesAnyOrder: ['M', 'Br'],
      mpApprox: mpM(1500),
    }),
    // On Br 60 m on (M is 6 m away): both in I, M is previous.
    onBranch(3000, 1560, {
      status: 'MATCHED',
      chainId: 'M',
      reasons: ['CONTINUITY'],
      candidates: ['Br', 'M'],
      mpApprox: mpM(1560),
    }),
    // On Br at x = 1650 (y = 15): I = {Br}, another railway; M (15 m) is previous and in the
    // radius, but R23 forbids holding it: MATCHED on Br at once.
    onBranch(4000, 1650, {
      status: 'MATCHED',
      chainId: 'Br',
      reasons: [],
      candidates: ['Br'],
      mpApprox: mpBr(1650),
    }),
    onBranch(5000, 1900, {
      status: 'MATCHED',
      chainId: 'Br',
      reasons: [],
      mpApprox: mpBr(1900),
    }),
  ],
  after: noMpJump,
};

/**
 * Same subdivision and operator: the bounded continuity hold (Decision 3 step 6b as amended by
 * ruling R23). The train is matched on M at x = 1480 (Br's start is 20 m away, outside the
 * margin). The next fix is already on Br at x = 1650: I = {Br}, which is in M's own group (same
 * subdivision and operator), and M is within the radius, so M is HELD from t = 2000 ms. The hold
 * lasts while (t - 2000) < continuityMaxMs = 5000 ms: still held at 6999 ms, re-selected at
 * EXACTLY 7000 ms (the boundary is exclusive), when the evidence wins and the result is Br.
 */
export const junctionSameRailwayHold: Scenario = {
  name: 'junction: same railway, M is held for under 5000 ms, re-selected at exactly 5000 ms',
  net: junctionNet(true),
  steps: [
    fixStep(1000, 1480, 0, { status: 'MATCHED', chainId: 'M', reasons: [], mpApprox: mpM(1480) }),
    onBranch(2000, 1650, {
      status: 'MATCHED',
      chainId: 'M',
      reasons: ['CONTINUITY_HOLD'],
      candidates: ['Br'],
      mpApprox: mpM(1650),
    }),
    onBranch(4000, 1700, { status: 'MATCHED', chainId: 'M', reasons: ['CONTINUITY_HOLD'] }),
    onBranch(6000, 1750, { status: 'MATCHED', chainId: 'M', reasons: ['CONTINUITY_HOLD'] }),
    // 4999 ms after the first contradicting fix: still held.
    onBranch(6999, 1760, {
      status: 'MATCHED',
      chainId: 'M',
      reasons: ['CONTINUITY_HOLD'],
      mpApprox: mpM(1760),
    }),
    // Exactly 5000 ms after it: the hold has run out; the evidence wins.
    onBranch(7000, 1770, {
      status: 'MATCHED',
      chainId: 'Br',
      reasons: [],
      candidates: ['Br'],
      mpApprox: mpBr(1770),
    }),
  ],
};

export const scenarios: readonly Scenario[] = [
  junctionSameSubdivision,
  junctionColdMain,
  junctionColdBranch,
  junctionApproachThenBranch,
  junctionSameRailwayHold,
];
