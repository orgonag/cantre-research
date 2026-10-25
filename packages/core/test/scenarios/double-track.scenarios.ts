/**
 * Scenario: double track on one subdivision (spec §6, plan Decision 9).
 *
 * Geometry (metres east/north of ORIGIN, accuracy 5 m, radius 50 m, margin d_min + 10 m):
 * - Track T1 along y = 0, x 0 to 3000; track T2 5 m north of it (y = 5). Same subdivision and
 *   operator, so they form ONE group of parallel tracks.
 * - Two tracks 5 m apart are always both inside the margin (even a fix exactly on T1 has
 *   residuals 0 and 5, and 5 <= 0 + 10), so the position alone can never separate them.
 * - GPS milepost band at 5 m accuracy = 5 m / 1609.344 m per mile = 0.0031 mi. A range is shown
 *   only when the tracks' mileposts differ by no more than that band.
 */
import { metresToMiles } from '../../src/index.js';
import type { NetworkView } from '../../src/index.js';
import { ORIGIN, coverageAround, interval, network, straightChain } from '../helpers/network.js';
import { eventStep, fixStep } from './harness.js';
import type { Scenario } from './harness.js';

const T1 = straightChain('T1', ORIGIN, 0, 3000, { sub: 'sub-1', op: 'CN' });
const T2 = straightChain('T2', ORIGIN, 0, 3000, { sub: 'sub-1', op: 'CN', lateralM: -5 });

/** T1 mp 10 at s 0. T2's mp offset (miles) and calibration are varied per scenario. */
function doubleTrack(t2Offset: number | null): NetworkView {
  const t1 = interval('iT1', 'T1', [
    { s: 0, mp: 10 },
    { s: 3000, mp: 10 + metresToMiles(3000) },
  ]);
  const t2 =
    t2Offset === null
      ? []
      : [
          interval('iT2', 'T2', [
            { s: 0, mp: 10 + t2Offset },
            { s: 3000, mp: 10 + t2Offset + metresToMiles(3000) },
          ]),
        ];
  return network({
    coverage: [coverageAround(ORIGIN, 6000)],
    chains: [T1, T2],
    intervals: [t1, ...t2],
  });
}

const mp = (x: number, offset = 0): number => 10 + offset + metresToMiles(x);
const lockT1 = { kind: 'chain', chainId: 'T1' } as const;

/** Tracks agree to 0.002 mi (3.2 m) < 0.0031 mi band: MATCHED_SUBDIVISION with a range. */
export const doubleTrackCalibrated: Scenario = {
  name: 'double-track: calibrated tracks within the band give MATCHED_SUBDIVISION with mpRange',
  net: doubleTrack(0.002),
  steps: [
    fixStep(1000, 500, 1, {
      status: 'MATCHED_SUBDIVISION',
      reasons: ['MULTIPLE_TRACKS'],
      chainId: null,
      mpApprox: null,
      mpRange: { lowerMp: mp(500), upperMp: mp(500, 0.002) },
      mpTolMi: 0.0005,
      candidates: ['T1', 'T2'],
      selectionOrigin: 'auto',
    }),
    // Exactly on T1 (0 m vs 5 m): the tracks are still indistinguishable.
    fixStep(2000, 900, 0, {
      status: 'MATCHED_SUBDIVISION',
      reasons: ['MULTIPLE_TRACKS'],
      mpRange: { lowerMp: mp(900), upperMp: mp(900, 0.002) },
      mpTolMi: 0.0005,
    }),
    // South of T1 (3 m vs 8 m): same.
    fixStep(3000, 1500, -3, {
      status: 'MATCHED_SUBDIVISION',
      reasons: ['MULTIPLE_TRACKS'],
      mpRange: { lowerMp: mp(1500), upperMp: mp(1500, 0.002) },
      mpTolMi: 0.0005,
    }),
    // The user picks T1. This changes the candidate set, never the accuracy: accuracyM stays 5.
    eventStep(
      { type: 'lock', lock: lockT1 },
      {
        status: 'MATCHED',
        reasons: ['LOCKED_BY_USER'],
        chainId: 'T1',
        selectionOrigin: 'user',
        lock: lockT1,
        mpApprox: mp(1500),
        mpRange: null,
        accuracyM: 5,
      },
    ),
    eventStep(
      { type: 'unlock' },
      {
        status: 'MATCHED_SUBDIVISION',
        reasons: ['MULTIPLE_TRACKS'],
        lock: null,
        mpRange: { lowerMp: mp(1500), upperMp: mp(1500, 0.002) },
        mpTolMi: 0.0005,
      },
    ),
  ],
};

/** The second track has no calibration: no range, and the reason says why. */
export const doubleTrackUncalibrated: Scenario = {
  name: 'double-track: an uncalibrated second track gives mpRange null with TRACK_UNCALIBRATED',
  net: doubleTrack(null),
  steps: [
    fixStep(1000, 500, 1, {
      status: 'MATCHED_SUBDIVISION',
      reasons: ['MULTIPLE_TRACKS', 'TRACK_UNCALIBRATED'],
      chainId: null,
      mpApprox: null,
      mpRange: null,
      candidates: ['T1', 'T2'],
    }),
    fixStep(2000, 900, 4, {
      status: 'MATCHED_SUBDIVISION',
      reasons: ['MULTIPLE_TRACKS', 'TRACK_UNCALIBRATED'],
      mpRange: null,
      mpApprox: null,
    }),
  ],
};

/** Both calibrated but 0.5 mi apart (a bad calibration): no range is invented. */
export const doubleTrackDisagree: Scenario = {
  name: 'double-track: calibrated tracks that disagree give mpRange null with TRACK_MP_DISAGREE',
  net: doubleTrack(0.5),
  steps: [
    fixStep(1000, 500, 1, {
      status: 'MATCHED_SUBDIVISION',
      reasons: ['MULTIPLE_TRACKS', 'TRACK_MP_DISAGREE'],
      mpRange: null,
      mpApprox: null,
    }),
  ],
};

export const scenarios: readonly Scenario[] = [
  doubleTrackCalibrated,
  doubleTrackUncalibrated,
  doubleTrackDisagree,
];
