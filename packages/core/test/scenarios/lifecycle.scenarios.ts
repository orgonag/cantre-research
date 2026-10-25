/**
 * Scenario: the life cycle of a session (spec §6, plan Decisions 10 and rulings R12, R13, R20).
 *
 * Geometry (metres east/north of ORIGIN, accuracy 5 m, radius 50 m, margin d_min + 10 m):
 * - Line A along y = 0 and line B along y = 12 (north of A), both x 0 to 2000, different
 *   subdivisions and operators. A fix exactly on A is MATCHED (0 vs 12 > 10); a fix 3 m north of A
 *   is between the lines (3 vs 9, within 3 + 10) and is ambiguous when there is no continuity.
 * - Times are milliseconds on one clock; `staleAfterMs` is 15000 and a result is STALE only when
 *   the age is strictly greater, so age 15000 is still current and age 16000 is STALE.
 */
import { metresToMiles } from '../../src/index.js';
import { ORIGIN, coverageAround, interval, network, straightChain } from '../helpers/network.js';
import { eventStep, fixAt, fixStep, tickStep } from './harness.js';
import type { Scenario } from './harness.js';

/** Two routes 12 m apart, each calibrated over its whole length. */
export const lifecycleNet = network({
  coverage: [coverageAround(ORIGIN, 6000)],
  chains: [
    straightChain('A', ORIGIN, 0, 2000, { sub: 'sub-A', op: 'CN' }),
    straightChain('B', ORIGIN, 0, 2000, { sub: 'sub-B', op: 'CPKC', lateralM: -12 }),
  ],
  intervals: [
    interval('iA', 'A', [
      { s: 0, mp: 10 },
      { s: 2000, mp: 10 + metresToMiles(2000) },
    ]),
    interval('iB', 'B', [
      { s: 0, mp: 20 },
      { s: 2000, mp: 20 + metresToMiles(2000) },
    ]),
  ],
});

const mpA = (x: number): number => 10 + metresToMiles(x);

/** NO_FIX, NO_PERMISSION, NO_FIX, MATCHED, an out-of-order fix, STALE by time, a fresh re-select. */
export const lifecycleSession: Scenario = {
  name: 'lifecycle: NO_FIX, NO_PERMISSION, NO_FIX, MATCHED, ignored fixes, STALE, fresh re-select',
  net: lifecycleNet,
  steps: [
    tickStep(0, {
      status: 'NO_FIX',
      reasons: ['NO_FIX_YET'],
      chainId: null,
      mpApprox: null,
      accuracyM: null,
      fixAgeMs: null,
    }),
    eventStep(
      { type: 'permission', state: 'denied' },
      { status: 'NO_PERMISSION', reasons: ['PERMISSION_DENIED'], fixAgeMs: null },
      0,
    ),
    // A fix while permission is denied is ignored (R13) and changes nothing.
    {
      event: { type: 'fix', fix: fixAt(500, 0, 500) },
      atMs: 500,
      expect: {
        status: 'NO_PERMISSION',
        reasons: ['PERMISSION_DENIED'],
        ignored: 'FIX_IGNORED_INVALID',
      },
    },
    eventStep(
      { type: 'permission', state: 'granted' },
      { status: 'NO_FIX', reasons: ['NO_FIX_YET'] },
      600,
    ),
    // A device error before any fix says why there is no fix.
    eventStep(
      { type: 'locationError', code: 'TIMEOUT' },
      { status: 'NO_FIX', reasons: ['LOCATION_UNAVAILABLE'], ignored: null },
      700,
    ),
    // A fix with a non-finite latitude is ignored.
    {
      event: { type: 'fix', fix: { ...fixAt(500, 0, 800), lat: Number.NaN } },
      atMs: 800,
      expect: {
        status: 'NO_FIX',
        reasons: ['LOCATION_UNAVAILABLE'],
        ignored: 'FIX_IGNORED_INVALID',
      },
    },
    fixStep(1000, 500, 0, {
      status: 'MATCHED',
      chainId: 'A',
      reasons: [],
      mpApprox: mpA(500),
      accuracyM: 5,
      fixAgeMs: 0,
      historical: null,
    }),
    // An older timestamp, and one equal to the last, are ignored; the result is unchanged.
    {
      event: { type: 'fix', fix: fixAt(520, 0, 900) },
      atMs: 1000,
      expect: {
        status: 'MATCHED',
        chainId: 'A',
        mpApprox: mpA(500),
        ignored: 'FIX_IGNORED_OUT_OF_ORDER',
      },
    },
    {
      event: { type: 'fix', fix: fixAt(520, 0, 1000) },
      atMs: 1000,
      expect: {
        status: 'MATCHED',
        chainId: 'A',
        mpApprox: mpA(500),
        ignored: 'FIX_IGNORED_OUT_OF_ORDER',
      },
    },
    // Age 15000 is not yet stale (the rule is strictly greater); the age is reported.
    tickStep(16000, { status: 'MATCHED', chainId: 'A', fixAgeMs: 15000, historical: null }),
    // Age 16000 is stale: nothing is current, the old result is only history.
    tickStep(17000, {
      status: 'STALE',
      reasons: ['FIX_STALE'],
      chainId: null,
      mpApprox: null,
      mpRange: null,
      candidates: [],
      fixAgeMs: 16000,
      historical: 'MATCHED',
      accuracyM: 5,
    }),
    // A fresh fix 19 s after the last: the gap ends continuity (R12), so a fix between the lines
    // is AMBIGUOUS_ROUTE, not a silent carry-over of A.
    fixStep(20000, 600, 3, {
      status: 'AMBIGUOUS_ROUTE',
      reasons: ['MULTIPLE_ROUTES'],
      candidates: ['A', 'B'],
      fixAgeMs: 0,
      historical: null,
    }),
    // And a fix on A re-selects A.
    fixStep(21000, 700, 0, { status: 'MATCHED', chainId: 'A', reasons: [], mpApprox: mpA(700) }),
  ],
};

/**
 * A fix stamped far in the future (a bad device clock) must not pin a current match (R20). The
 * reducer cannot see the caller's clock, so it accepts the fix; the read at an earlier `now` is
 * STALE with FIX_FROM_FUTURE, and a later real fix is ignored as out of order (a documented limit).
 */
export const lifecycleFutureFix: Scenario = {
  name: 'lifecycle: a fix stamped in the future is STALE with FIX_FROM_FUTURE, never a current match',
  net: lifecycleNet,
  steps: [
    // The device stamps 100000 and the caller's clock agrees: MATCHED.
    fixStep(100000, 500, 0, { status: 'MATCHED', chainId: 'A', mpApprox: mpA(500), fixAgeMs: 0 }),
    // The caller's clock reads 98000: the fix is 2000 ms ahead, beyond the 1000 ms tolerance.
    tickStep(98000, {
      status: 'STALE',
      reasons: ['FIX_STALE', 'FIX_FROM_FUTURE'],
      chainId: null,
      mpApprox: null,
      fixAgeMs: -2000,
      historical: 'MATCHED',
    }),
    // 500 ms ahead is inside the tolerance: still MATCHED, and the negative age shows the skew.
    tickStep(99500, { status: 'MATCHED', chainId: 'A', fixAgeMs: -500, historical: null }),
    // A real fix stamped 60000 is older than the accepted 100000: ignored as out of order.
    {
      event: { type: 'fix', fix: fixAt(600, 0, 60000) },
      atMs: 98000,
      expect: {
        status: 'STALE',
        reasons: ['FIX_STALE', 'FIX_FROM_FUTURE'],
        ignored: 'FIX_IGNORED_OUT_OF_ORDER',
      },
    },
  ],
};

export const scenarios: readonly Scenario[] = [lifecycleSession, lifecycleFutureFix];
