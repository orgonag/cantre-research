/**
 * Scenario: loaded-tile coverage and off-network fixes (spec §6, plan Decision 5).
 *
 * Geometry (metres east/north of ORIGIN, accuracy 5 m so the search radius is 50 m; the matcher
 * inflates the radius by a 1% safety factor to 50.5 m when testing coverage):
 * - One loaded tile: the square 1000 m either side of ORIGIN (x and y in [-1000, 1000]).
 * - Line A along y = 0 from x = 0 to 1100. Its last 100 m lies beyond the tile, as the buffered
 *   geometry of a real tile does; the tile BOUNDS stay unbuffered (Decision 5).
 */
import { metresToMiles } from '../../src/index.js';
import { ORIGIN, coverageAround, interval, network, straightChain } from '../helpers/network.js';
import { fixStep } from './harness.js';
import type { Scenario } from './harness.js';

export const coverageNet = network({
  coverage: [coverageAround(ORIGIN, 1000)],
  chains: [straightChain('A', ORIGIN, 0, 1100, { sub: 'sub-A', op: 'CN' })],
  intervals: [
    interval('iA', 'A', [
      { s: 0, mp: 10 },
      { s: 1100, mp: 10 + metresToMiles(1100) },
    ]),
  ],
});

const mpA = (x: number): number => 10 + metresToMiles(x);

export const coverageEdges: Scenario = {
  name: 'coverage: inside, at the tile edge, outside the tiles, and off the network',
  net: coverageNet,
  steps: [
    // Well inside: the whole 50.5 m disk is covered. MATCHED.
    fixStep(1000, 900, 0, { status: 'MATCHED', chainId: 'A', reasons: [], mpApprox: mpA(900) }),
    // 20 m from the east edge (x = 1000): the disk reaches x = 1030.5, beyond the loaded tile.
    // A is the sole candidate, but an unloaded tile might hold a closer track: the sole candidate
    // in a partly loaded tile blocks automatic selection.
    fixStep(2000, 980, 0, {
      status: 'AMBIGUOUS_ROUTE',
      reasons: ['PARTIAL_COVERAGE'],
      chainId: null,
      mpApprox: null,
      candidates: ['A'],
    }),
    // Beyond the tile edge: outside every loaded tile.
    fixStep(3000, 1500, 0, {
      status: 'NO_COVERAGE',
      reasons: ['OUTSIDE_LOADED_TILES'],
      chainId: null,
      mpApprox: null,
      candidates: [],
    }),
    // Far away in another direction.
    fixStep(4000, -5000, 3000, {
      status: 'NO_COVERAGE',
      reasons: ['OUTSIDE_LOADED_TILES'],
    }),
    // Inside the tile but 400 m from A: covered, and no track within 50 m: OFF_NETWORK.
    fixStep(5000, 500, 400, {
      status: 'OFF_NETWORK',
      reasons: ['NO_CANDIDATE_IN_RADIUS'],
      chainId: null,
      mpApprox: null,
      candidates: [],
    }),
    // Back on the line: MATCHED again.
    fixStep(6000, 500, 0, { status: 'MATCHED', chainId: 'A', reasons: [], mpApprox: mpA(500) }),
  ],
};

export const scenarios: readonly Scenario[] = [coverageEdges];
