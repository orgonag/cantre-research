/**
 * Scenario: two Class I operators on parallel lines 12 m apart that later diverge (spec §6,
 * owner priority "nearby different Class I routes"; ruling R14).
 *
 * Geometry (metres east/north of ORIGIN, accuracy 5 m, so radius 50 m and margin
 * d_min + max(5, 10) = d_min + 10 m):
 * - Line A: along y = 0, x 0 to 3500, subdivision sub-A, operator CN. mp 100 at s 0.
 * - Line B (north of A): y = 12 for x 0 to 2000, then diverging in a straight run to y = 80 at
 *   x = 2500, then y = 80 to x = 3500. Subdivision sub-B, operator CPKC. mp 200 at s 0.
 * Mileposts rise 1 mile per 1609.344 m of chain length on both (synthetic numbers).
 *
 * Why the ambiguous fixes sit BETWEEN the lines (ruling R14): a fix exactly on A has residuals
 * 0 and 12, and 12 > 0 + 10, so B is outside the indistinguishable set and the result is MATCHED.
 * A fix 3 m from A toward B has residuals 3 and 9, and 9 <= 3 + 10, so both routes are
 * indistinguishable and no route may be chosen without evidence.
 */
import { metresToMiles } from '../../src/index.js';
import { ORIGIN, coverageAround, interval, network, straightChain } from '../helpers/network.js';
import { chainFromXY, eventStep, fixStep } from './harness.js';
import type { Scenario } from './harness.js';

/** Length of the diverging run of B, metres: hypot(500 east, 68 north). */
const DIVERGE_M = Math.hypot(500, 68);
const B_TOTAL_M = 2000 + DIVERGE_M + 1000;

const A = straightChain('A', ORIGIN, 0, 3500, { sub: 'sub-A', op: 'CN' });
const B = chainFromXY(
  'B',
  [
    [0, 12],
    [2000, 12],
    [2500, 80],
    [3500, 80],
  ],
  { sub: 'sub-B', op: 'CPKC' },
);

/** Two operators, one calibrated interval each (the whole chain, so every fix is calibrated). */
export const parallelNet = network({
  coverage: [coverageAround(ORIGIN, 6000)],
  chains: [A, B],
  intervals: [
    interval('iA', 'A', [
      { s: 0, mp: 100 },
      { s: 3500, mp: 100 + metresToMiles(3500) },
    ]),
    interval('iB', 'B', [
      { s: 0, mp: 200 },
      { s: B_TOTAL_M, mp: 200 + metresToMiles(B_TOTAL_M) },
    ]),
  ],
});

/** Milepost (miles) on A at x metres (s = x). */
const mpA = (x: number): number => 100 + metresToMiles(x);
/** Milepost (miles) on B at x metres east, for x >= 2500 (s = 2000 + DIVERGE_M + x - 2500). */
const mpBFar = (x: number): number => 200 + metresToMiles(2000 + DIVERGE_M + (x - 2500));

/** A cold start between the lines is ambiguous; separating the lines gives MATCHED. */
export const parallelDiverge: Scenario = {
  name: 'parallel-class1: ambiguous between 12 m lines, MATCHED once they diverge',
  net: parallelNet,
  steps: [
    // 3 m from A: residuals A 3, B 9. Both within 3 + 10, different routes: no automatic choice.
    fixStep(1000, 200, 3, {
      status: 'AMBIGUOUS_ROUTE',
      reasons: ['MULTIPLE_ROUTES'],
      candidates: ['A', 'B'],
      chainId: null,
      mpApprox: null,
    }),
    fixStep(2000, 600, 4, {
      status: 'AMBIGUOUS_ROUTE',
      reasons: ['MULTIPLE_ROUTES'],
      candidates: ['A', 'B'],
    }),
    // 9 m from A: B is now the nearer line (3 m), A at 9 m is within 3 + 10: still ambiguous.
    // Being nearer to one line is not enough to choose it.
    fixStep(3000, 1000, 9, {
      status: 'AMBIGUOUS_ROUTE',
      reasons: ['MULTIPLE_ROUTES'],
      candidates: ['B', 'A'],
    }),
    fixStep(4000, 1800, 3, { status: 'AMBIGUOUS_ROUTE', reasons: ['MULTIPLE_ROUTES'] }),
    // x = 2000 is still the parallel part (B at y = 12): residuals 3 and 9.
    fixStep(5000, 2000, 3, { status: 'AMBIGUOUS_ROUTE', reasons: ['MULTIPLE_ROUTES'] }),
    // x = 2050: B has moved to y = 18.8. Perpendicular distance from (2050, 3) to B's diverging
    // run is |50 * 68 + 9 * 500| / 504.6 = 15.7 m, above 3 + 10 = 13, so B drops out: MATCHED A.
    fixStep(6000, 2050, 3, {
      status: 'MATCHED',
      chainId: 'A',
      reasons: [],
      candidates: ['A'],
      mpApprox: mpA(2050),
    }),
    // x = 2200: B at y = 39.2, 35.9 m from the fix. Still A only.
    fixStep(7000, 2200, 3, { status: 'MATCHED', chainId: 'A', reasons: [], mpApprox: mpA(2200) }),
    // x = 3000: B at y = 80 is 77 m away, outside the 50 m radius: A alone.
    fixStep(8000, 3000, 3, { status: 'MATCHED', chainId: 'A', reasons: [], mpApprox: mpA(3000) }),
    // The same train on B at x = 3000, y = 80: A is 80 m away (outside the radius). MATCHED on B.
    fixStep(9000, 3000, 80, {
      status: 'MATCHED',
      chainId: 'B',
      reasons: [],
      mpApprox: mpBFar(3000),
    }),
  ],
};

/**
 * Continuity: the first fix is on A (0 m vs 12 m, so MATCHED). Noisy fixes between the lines would
 * be AMBIGUOUS on a cold start (previous scenario) but keep A while A stays in the
 * indistinguishable set (CONTINUITY). A fix that drops A out of the set holds A for under 5 s
 * (CONTINUITY_HOLD, Decision 3), then the evidence wins and the result moves to B.
 */
export const parallelContinuity: Scenario = {
  name: 'parallel-class1: noisy fixes keep A by continuity, a sustained shift moves to B after 5 s',
  net: parallelNet,
  steps: [
    // On A: residuals 0 and 12 -> only A in I.
    fixStep(1000, 200, 0, { status: 'MATCHED', chainId: 'A', reasons: [], mpApprox: mpA(200) }),
    // Noise toward B: residuals 3 and 9. A is in I and was the previous match: CONTINUITY. The
    // reported set is then narrowed to A's own route (B is no longer offered).
    fixStep(2000, 400, 3, {
      status: 'MATCHED',
      chainId: 'A',
      reasons: ['CONTINUITY'],
      candidates: ['A'],
      mpApprox: mpA(400),
    }),
    fixStep(3000, 600, 4, {
      status: 'MATCHED',
      chainId: 'A',
      reasons: ['CONTINUITY'],
      mpApprox: mpA(600),
    }),
    // 9 m north: B (3 m) is the nearer line, but A (9 m <= 3 + 10) is still indistinguishable and
    // is the previous match, so the result does not flip to B.
    fixStep(4000, 800, 9, {
      status: 'MATCHED',
      chainId: 'A',
      reasons: ['CONTINUITY'],
      mpApprox: mpA(800),
    }),
    // Back on A (0.5 m): only A is in I again (B 11.5 > 0.5 + 10); no continuity needed.
    fixStep(5000, 1000, 0.5, {
      status: 'MATCHED',
      chainId: 'A',
      reasons: [],
      mpApprox: mpA(1000),
    }),
    // 14 m north of A, 2 m from B: I = {B} (A at 14 > 2 + 10). A is the previous match and is
    // within the radius, so it is HELD. The contradiction starts at t = 6000 ms.
    fixStep(6000, 1200, 14, {
      status: 'MATCHED',
      chainId: 'A',
      reasons: ['CONTINUITY_HOLD'],
      candidates: ['B'],
      mpApprox: mpA(1200),
    }),
    fixStep(7000, 1400, 14, {
      status: 'MATCHED',
      chainId: 'A',
      reasons: ['CONTINUITY_HOLD'],
      mpApprox: mpA(1400),
    }),
    // 4000 ms after the first contradicting fix (< 5000): still held.
    fixStep(10000, 1800, 14, {
      status: 'MATCHED',
      chainId: 'A',
      reasons: ['CONTINUITY_HOLD'],
      mpApprox: mpA(1800),
    }),
    // Exactly 5000 ms after it: the hold has run out, the evidence wins: MATCHED on B.
    fixStep(11000, 1900, 14, {
      status: 'MATCHED',
      chainId: 'B',
      reasons: [],
      mpApprox: 200 + metresToMiles(1900),
    }),
    // Between the lines again (3 m from A, 9 m from B): B is now the previous match and is in I.
    fixStep(12000, 1950, 3, {
      status: 'MATCHED',
      chainId: 'B',
      reasons: ['CONTINUITY'],
      mpApprox: 200 + metresToMiles(1950),
    }),
  ],
};

/**
 * A withdrawn user choice must not become an automatic match (ruling R24, final review Critical).
 * The fix sits 6 m from each line, so both routes are indistinguishable. The user locks A: MATCHED
 * on A with origin user. On unlock the last fix is re-evaluated with no continuity, so the result
 * is AMBIGUOUS_ROUTE again, and so are later fixes between the lines.
 */
export const parallelLockUnlock: Scenario = {
  name: 'parallel-class1: ambiguous, lock A, unlock is AMBIGUOUS_ROUTE again (no auto match)',
  net: parallelNet,
  steps: [
    fixStep(1000, 200, 6, {
      status: 'AMBIGUOUS_ROUTE',
      reasons: ['MULTIPLE_ROUTES'],
      candidatesAnyOrder: ['A', 'B'],
    }),
    eventStep(
      { type: 'lock', lock: { kind: 'chain', chainId: 'A' } },
      {
        status: 'MATCHED',
        chainId: 'A',
        selectionOrigin: 'user',
        reasons: ['LOCKED_BY_USER'],
        mpApprox: mpA(200),
      },
    ),
    fixStep(2000, 300, 6, { status: 'MATCHED', chainId: 'A', selectionOrigin: 'user' }),
    eventStep(
      { type: 'unlock' },
      {
        status: 'AMBIGUOUS_ROUTE',
        reasons: ['MULTIPLE_ROUTES'],
        chainId: null,
        selectionOrigin: null,
        lock: null,
        candidatesAnyOrder: ['A', 'B'],
      },
    ),
    fixStep(3000, 400, 6, {
      status: 'AMBIGUOUS_ROUTE',
      reasons: ['MULTIPLE_ROUTES'],
      chainId: null,
      candidatesAnyOrder: ['A', 'B'],
    }),
  ],
};

export const scenarios: readonly Scenario[] = [
  parallelDiverge,
  parallelContinuity,
  parallelLockUnlock,
];
