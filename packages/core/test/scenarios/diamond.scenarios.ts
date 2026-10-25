/**
 * Scenario: approaching, stopping at and leaving a diamond (spec §6; owner priority "diamonds /
 * perpendicular crossings"; review focus 1 and 2).
 *
 * Geometry (metres east/north of ORIGIN, accuracy 5 m so the search radius is max(50, 15) = 50 m
 * and the indistinguishable margin is d_min + 10 m):
 * - Line A: due east along y = 0 from x = 0 to 4000 (s = x), subdivision sub-A, operator CN,
 *   mp 10 at s 0 rising 1 mile per 1609.344 m.
 * - Line B: due north along x = 2000 (it crosses A at (2000, 0)), 1000 m long starting at y = -500
 *   (so B's s = 500 + y), subdivision sub-B, operator CPKC, mp 30 at s 0 rising the same way.
 * - A diamond is registered on A only, at s = 2000 (like the golden diamond, which is registered
 *   on one chain only; ruling R7).
 * The diamond blocks automatic selection while it is within 50 m along A of the projection of ANY
 * candidate, i.e. while A is itself a candidate and |s - 2000| <= 50.
 */
import { fromLocalM, metresToMiles } from '../../src/index.js';
import {
  ORIGIN,
  coverageAround,
  interval,
  network,
  straightChain,
  withDiamond,
} from '../helpers/network.js';
import { eventStep, fixStep } from './harness.js';
import type { Scenario, Step } from './harness.js';

const A = straightChain('A', ORIGIN, 0, 4000, { sub: 'sub-A', op: 'CN' });
const crossingStart = fromLocalM(ORIGIN, { x: 2000, y: -500 }, ORIGIN.lat);
const B = straightChain('B', crossingStart, 0, 1000, { sub: 'sub-B', op: 'CPKC', bearingDeg: 0 });

/** The synthetic network shared by both scenarios. */
export const diamondNet = withDiamond(
  network({
    coverage: [coverageAround(ORIGIN, 6000)],
    chains: [A, B],
    intervals: [
      interval('iA', 'A', [
        { s: 0, mp: 10 },
        { s: 4000, mp: 10 + metresToMiles(4000) },
      ]),
      interval('iB', 'B', [
        { s: 0, mp: 30 },
        { s: 1000, mp: 30 + metresToMiles(1000) },
      ]),
    ],
  }),
  'J-X',
  'A',
  2000,
);

/** Milepost (miles) on A at x metres (mp = 10 + s in miles). */
const mpA = (x: number): number => 10 + metresToMiles(x);
/** Milepost (miles) on B at y metres north of the crossing (s = 500 + y). */
const mpB = (y: number): number => 30 + metresToMiles(500 + y);

const moving = { speedMps: 20, headingDeg: 90 } as const;
const standing = { speedMps: 0, headingDeg: 90 } as const; // stopped, but the OLD heading remains
const northbound = { speedMps: 15, headingDeg: 0 } as const;

/** Steps up to and through the diamond on A, then leaving north on B. */
const autoSteps: Step[] = [
  // 200 m before the crossing: B is 200 m away (outside the 50 m radius), so A is alone.
  fixStep(
    1000,
    1800,
    0,
    { status: 'MATCHED', chainId: 'A', reasons: [], mpApprox: mpA(1800) },
    moving,
  ),
  // 40 m before the crossing: the diamond (s 2000) is within 50 m of A's projection (s 1960).
  // B is a candidate at 40 m but outside I (residual 40 > 0 + 10), so I is {A}. Still blocked.
  fixStep(2000, 1960, 0, {
    status: 'AMBIGUOUS_ROUTE',
    reasons: ['DIAMOND_NEARBY'],
    chainId: null,
    mpApprox: null,
    candidates: ['A'],
  }),
  // 5 m before the crossing: B (5 m) is now inside I as well; still blocked by the diamond.
  fixStep(3000, 1995, 0, {
    status: 'AMBIGUOUS_ROUTE',
    reasons: ['DIAMOND_NEARBY'],
    candidates: ['A', 'B'],
  }),
  // Standstill on the crossing: three fixes at 0 m/s with the old heading 90. Speed is under the
  // 3 m/s heading floor, so the stale heading is not used; the diamond keeps blocking.
  fixStep(4000, 2000, 0, { status: 'AMBIGUOUS_ROUTE', reasons: ['DIAMOND_NEARBY'] }, standing),
  fixStep(5000, 2000, 0, { status: 'AMBIGUOUS_ROUTE', reasons: ['DIAMOND_NEARBY'] }, standing),
  fixStep(6000, 2000, 0, { status: 'AMBIGUOUS_ROUTE', reasons: ['DIAMOND_NEARBY'] }, standing),
  // Leaving north on B at 15 m/s, heading 0. The heading removes A (bearing 90 differs by 90
  // degrees), so I = {B}, but the diamond is measured over ALL candidates (ruling R7), so it
  // still blocks: a heading never bypasses a diamond.
  fixStep(
    7000,
    2000,
    20,
    { status: 'AMBIGUOUS_ROUTE', reasons: ['HEADING_USED', 'DIAMOND_NEARBY'], candidates: ['B'] },
    northbound,
  ),
  fixStep(
    8000,
    2000,
    40,
    { status: 'AMBIGUOUS_ROUTE', reasons: ['HEADING_USED', 'DIAMOND_NEARBY'], candidates: ['B'] },
    northbound,
  ),
  // 60 m past the crossing A is outside the 50 m radius, so it is no longer a candidate and the
  // diamond (registered on A) is no longer near any candidate. B is alone: MATCHED from evidence.
  // The previous result was AMBIGUOUS, so there is no continuity to carry over from A.
  fixStep(
    9000,
    2000,
    60,
    { status: 'MATCHED', chainId: 'B', reasons: [], mpApprox: mpB(60), selectionOrigin: 'auto' },
    northbound,
  ),
  // 200 m past the crossing: still B.
  fixStep(
    10000,
    2000,
    200,
    { status: 'MATCHED', chainId: 'B', reasons: [], mpApprox: mpB(200) },
    northbound,
  ),
];

/** The auto-selection replay: MATCHED, AMBIGUOUS_ROUTE (DIAMOND_NEARBY) throughout, MATCHED on B. */
export const diamondAuto: Scenario = {
  name: 'diamond: approach on A, ambiguous in the diamond radius and at standstill, leave on B',
  net: diamondNet,
  steps: autoSteps,
};

const lockA = { kind: 'chain', chainId: 'A' } as const;

/**
 * The same drive with the user's lock on A. A lock replaces the diamond rule (the user decided),
 * so A stays MATCHED (user) through the diamond; once the fixes are on B the lock no longer fits
 * and the result is LOCK_CONFLICT, never a silent switch to B and never a dropped lock.
 */
export const diamondLocked: Scenario = {
  name: 'diamond: with a lock on A it stays MATCHED (user), then LOCK_CONFLICT on B, lock kept',
  net: diamondNet,
  steps: [
    eventStep(
      { type: 'lock', lock: lockA },
      { status: 'NO_FIX', reasons: ['NO_FIX_YET'], lock: lockA },
      0,
    ),
    fixStep(
      1000,
      1800,
      0,
      {
        status: 'MATCHED',
        chainId: 'A',
        reasons: ['LOCKED_BY_USER'],
        selectionOrigin: 'user',
        lock: lockA,
        mpApprox: mpA(1800),
        accuracyM: 5,
      },
      moving,
    ),
    // Inside the diamond radius: the lock decides, so MATCHED (user), not AMBIGUOUS_ROUTE.
    fixStep(2000, 1960, 0, {
      status: 'MATCHED',
      chainId: 'A',
      reasons: ['LOCKED_BY_USER'],
      selectionOrigin: 'user',
      mpApprox: mpA(1960),
    }),
    // Standstill on the crossing: both lines are at 0 m, the lock picks A.
    fixStep(
      3000,
      2000,
      0,
      { status: 'MATCHED', chainId: 'A', reasons: ['LOCKED_BY_USER'] },
      standing,
    ),
    fixStep(
      4000,
      2000,
      0,
      { status: 'MATCHED', chainId: 'A', reasons: ['LOCKED_BY_USER'] },
      standing,
    ),
    fixStep(
      5000,
      2000,
      0,
      { status: 'MATCHED', chainId: 'A', reasons: ['LOCKED_BY_USER'] },
      standing,
    ),
    // 20 m north on B: B is at 0 m, A at 20 m (> 0 + 10): A, the best of the lock, is outside I.
    fixStep(6000, 2000, 20, {
      status: 'LOCK_CONFLICT',
      reasons: ['LOCK_NOT_SUPPORTED'],
      chainId: null,
      mpApprox: null,
      candidates: ['B'],
      lock: lockA,
      selectionOrigin: null,
    }),
    // 60 m north: A is outside the radius, so the lock has no candidate at all: still a conflict.
    fixStep(
      7000,
      2000,
      60,
      { status: 'LOCK_CONFLICT', reasons: ['LOCK_NOT_SUPPORTED'], lock: lockA, mpApprox: null },
      northbound,
    ),
    fixStep(
      8000,
      2000,
      200,
      {
        status: 'LOCK_CONFLICT',
        reasons: ['LOCK_NOT_SUPPORTED'],
        lock: lockA,
        chainId: null,
        mpApprox: null,
        candidates: ['B'],
        accuracyM: 5,
      },
      northbound,
    ),
    // Only the user clears a lock. Unlock re-evaluates the last fix: MATCHED on B by evidence.
    eventStep(
      { type: 'unlock' },
      {
        status: 'MATCHED',
        chainId: 'B',
        reasons: [],
        lock: null,
        selectionOrigin: 'auto',
        mpApprox: mpB(200),
      },
    ),
  ],
};

export const scenarios: readonly Scenario[] = [diamondAuto, diamondLocked];
