import { describe, expect, it } from 'vitest';
import {
  distanceM,
  fromLocalM,
  interpolateMilepost,
  locateMilepost,
  milepostAtPoint,
} from '../src/index.js';
import type { LatLon, MatchConfig } from '../src/index.js';
import { interval, network, ORIGIN, straightChain, withIntervals } from './helpers/network.js';

/** Tests for `locateMilepost` (inverse interpolation) and `milepostAtPoint`. */
const chain = straightChain('c1', ORIGIN, 0, 3000);
const ivA = interval('A', 'c1', [
  { s: 0, mp: 10 },
  { s: 1000, mp: 10.5 },
  { s: 3000, mp: 11.5 },
]);
const net = withIntervals(network({ chains: [chain] }), ivA);

/** The point `x` metres east and `y` metres north of the origin. */
const place = (x: number, y = 0): LatLon => fromLocalM(ORIGIN, { x, y }, ORIGIN.lat);

describe('locateMilepost', () => {
  it('finds s and the point on the chain for a milepost inside an interval', () => {
    const [hit, ...rest] = locateMilepost(net, 'sub-1', 10.25);
    expect(rest).toEqual([]);
    expect(hit?.chainId).toBe('c1');
    expect(hit?.intervalId).toBe('A');
    expect(hit?.sM).toBeCloseTo(500, 9);
    expect(distanceM(hit?.at ?? ORIGIN, place(500))).toBeLessThan(0.01);
  });

  it('uses the second span of the interval for a later milepost', () => {
    // 10.5 -> 11.5 over 1000 -> 3000 m: mp 11 is a quarter of the way in, s = 2000.
    expect(locateMilepost(net, 'sub-1', 11)[0]?.sM).toBeCloseTo(2000, 9);
  });

  it('reproduces an anchor exactly, once per interval', () => {
    for (const [mp, s] of [
      [10, 0],
      [10.5, 1000],
      [11.5, 3000],
    ] as const) {
      const found = locateMilepost(net, 'sub-1', mp);
      expect(found).toHaveLength(1);
      expect(found[0]?.sM).toBe(s);
    }
  });

  it('round-trips interpolateMilepost within 1e-6 m', () => {
    for (let s = 0; s <= 3000; s += 137.3) {
      const r = interpolateMilepost(s, ivA.anchors);
      if (r.kind !== 'calibrated') {
        throw new Error('expected a calibrated milepost');
      }
      const back = locateMilepost(net, 'sub-1', r.mp);
      expect(back).toHaveLength(1);
      expect(Math.abs((back[0]?.sM ?? Infinity) - s)).toBeLessThan(1e-6);
    }
  });

  it('works when milepost falls as s grows', () => {
    const down = withIntervals(
      network({ chains: [chain] }),
      interval('D', 'c1', [
        { s: 0, mp: 20 },
        { s: 2000, mp: 19 },
      ]),
    );
    expect(locateMilepost(down, 'sub-1', 19.5)[0]?.sM).toBeCloseTo(1000, 9);
    expect(locateMilepost(down, 'sub-1', 20.5)).toEqual([]);
  });

  it('returns [] outside every interval and never extrapolates', () => {
    expect(locateMilepost(net, 'sub-1', 9.99)).toEqual([]);
    expect(locateMilepost(net, 'sub-1', 11.51)).toEqual([]);
    expect(locateMilepost(net, 'sub-9', 10.25)).toEqual([]);
    expect(locateMilepost(network(), 'sub-1', 10.25)).toEqual([]);
  });

  it('returns [] for a milepost in the gap between two intervals', () => {
    const gap = withIntervals(
      network({ chains: [chain] }),
      interval('A', 'c1', [
        { s: 0, mp: 10 },
        { s: 1000, mp: 10.5 },
      ]),
      interval('B', 'c1', [
        { s: 2000, mp: 12 },
        { s: 3000, mp: 12.5 },
      ]),
    );
    expect(locateMilepost(gap, 'sub-1', 11)).toEqual([]);
    expect(locateMilepost(gap, 'sub-1', 10.25)).toHaveLength(1);
    expect(locateMilepost(gap, 'sub-1', 12.25)[0]?.intervalId).toBe('B');
  });

  it('gives one entry per track for double track, and only for the asked subdivision', () => {
    const second = straightChain('c2', ORIGIN, 0, 3000, { lateralM: 5 });
    const other = straightChain('c3', ORIGIN, 0, 3000, { lateralM: 50, sub: 'sub-2' });
    const double = withIntervals(
      network({ chains: [chain, second, other] }),
      ivA,
      interval('A2', 'c2', [
        { s: 0, mp: 10 },
        { s: 3000, mp: 11.5 },
      ]),
      interval('A3', 'c3', [
        { s: 0, mp: 10 },
        { s: 3000, mp: 11.5 },
      ]),
    );
    const found = locateMilepost(double, 'sub-1', 10.5);
    expect(found.map((f) => f.chainId)).toEqual(['c1', 'c2']);
    expect(locateMilepost(double, 'sub-2', 10.5).map((f) => f.chainId)).toEqual(['c3']);
  });

  it('puts the point on the right piece of a split chain, and skips a gap', () => {
    const pieces = network({
      chains: [
        straightChain('c1', ORIGIN, 0, 1000),
        straightChain('c1#2', ORIGIN, 2000, 3000, { chainBaseId: 'c1' }),
      ],
    });
    const split = withIntervals(pieces, ivA);
    const late = locateMilepost(split, 'sub-1', 11);
    expect(late[0]?.chainId).toBe('c1'); // the base id: s is absolute along the full chain
    expect(late[0]?.sM).toBeCloseTo(2000, 9);
    expect(distanceM(late[0]?.at ?? ORIGIN, place(2000))).toBeLessThan(0.01);
    // mp 10.75 is s 1250 m: inside the interval but in the unloaded gap, so no point to give
    expect(locateMilepost(split, 'sub-1', 10.75)).toEqual([]);
  });

  it('follows a bend: the point lies on the polyline, not on the chord', () => {
    const bent = {
      ...straightChain('b', ORIGIN, 0, 200),
      pts: [place(0, 0), place(100, 0), place(100, 100)],
      sM: Float64Array.from([0, 100, 200]),
      cumulativeM: Float64Array.from([0, 100, 200]),
    };
    const view = withIntervals(
      network({ chains: [bent] }),
      interval('B', 'b', [
        { s: 0, mp: 1 },
        { s: 200, mp: 2 },
      ]),
    );
    const hit = locateMilepost(view, 'sub-1', 1.75)[0]; // s = 150: halfway up the second leg
    expect(distanceM(hit?.at ?? ORIGIN, place(100, 50))).toBeLessThan(0.05);
  });

  it('copes with a repeated vertex', () => {
    const p = place(50);
    const dup = {
      ...straightChain('d', ORIGIN, 0, 100),
      pts: [ORIGIN, p, p, place(100)],
      sM: Float64Array.from([0, 50, 50, 100]),
      cumulativeM: Float64Array.from([0, 50, 50, 100]),
    };
    const view = withIntervals(
      network({ chains: [dup] }),
      interval('Dd', 'd', [
        { s: 0, mp: 1 },
        { s: 100, mp: 2 },
      ]),
    );
    const hit = locateMilepost(view, 'sub-1', 1.5)[0];
    expect(hit?.sM).toBe(50);
    expect(hit?.at).toEqual(p);
    const end = locateMilepost(view, 'sub-1', 2)[0];
    expect(end?.at).toEqual(place(100));
  });

  it('rejects a non-finite milepost', () => {
    expect(() => locateMilepost(net, 'sub-1', Number.NaN)).toThrow(
      expect.objectContaining({ code: 'NON_FINITE' }),
    );
  });
});

describe('milepostAtPoint', () => {
  it('gives the interpolated milepost for a point on a calibrated chain', () => {
    const found = milepostAtPoint(net, place(500, 3)); // 3 m off the track
    expect(found).toHaveLength(1);
    const [hit] = found;
    expect(hit?.candidate.chainId).toBe('c1');
    expect(hit?.candidate.residualM).toBeCloseTo(3, 2);
    expect(hit?.candidate.s).toBeCloseTo(500, 2);
    const mp = hit?.milepost.milepost;
    expect(mp?.kind).toBe('calibrated');
    expect(mp?.kind === 'calibrated' ? mp.mp : null).toBeCloseTo(10.25, 5);
    expect(hit?.milepost.mpBandMi).toBe(0); // nominal accuracy 0: no GPS band
  });

  it('gives [] for a point off the track, using the default search radius', () => {
    expect(milepostAtPoint(net, place(500, 200))).toEqual([]);
  });

  it('takes the search radius from the config', () => {
    const cfg: MatchConfig = {
      searchRadiusMinM: 300,
      searchRadiusAccuracyFactor: 3,
      indistinguishableMinM: 10,
      staleAfterMs: 15000,
      headingMinSpeedMps: 3,
      headingToleranceDeg: 30,
      continuityMaxMs: 5000,
      futureFixToleranceMs: 1000,
    };
    expect(milepostAtPoint(net, place(500, 200), cfg)).toHaveLength(1);
  });

  it('reports no milepost where the chain is not calibrated', () => {
    const [hit] = milepostAtPoint(network({ chains: [chain] }), place(500));
    expect(hit?.milepost.milepost).toBeNull();
    expect(hit?.milepost.reasons).toEqual(['CHAIN_UNCALIBRATED']);
  });

  it('rejects a point outside Canada', () => {
    expect(() => milepostAtPoint(net, { lat: 0, lon: 0 })).toThrow(
      expect.objectContaining({ code: 'OUTSIDE_CANADA_ENVELOPE' }),
    );
  });
});

describe('locateMilepost edge cases', () => {
  it('lists two intervals of one chain that both hold the milepost, ordered by interval id', () => {
    const view = withIntervals(
      network({ chains: [chain] }),
      interval('Z', 'c1', [
        { s: 2000, mp: 10 },
        { s: 2500, mp: 11 },
      ]),
      interval('A', 'c1', [
        { s: 0, mp: 10 },
        { s: 500, mp: 11 },
      ]),
    );
    expect(locateMilepost(view, 'sub-1', 10.5).map((f) => [f.chainId, f.intervalId, f.sM])).toEqual(
      [
        ['c1', 'A', 250],
        ['c1', 'Z', 2250],
      ],
    );
  });

  it('gives the last vertex when the chain ends in a repeated vertex, and the vertex of a one-vertex chain', () => {
    const end = place(100);
    const dupEnd = {
      ...straightChain('d', ORIGIN, 0, 100),
      pts: [ORIGIN, end, end],
      sM: Float64Array.from([0, 100, 100]),
      cumulativeM: Float64Array.from([0, 100, 100]),
    };
    const single = {
      ...straightChain('p', ORIGIN, 0, 100),
      pts: [ORIGIN],
      sM: Float64Array.from([0]),
      cumulativeM: Float64Array.from([0]),
    };
    const view = withIntervals(
      network({ chains: [dupEnd, single] }),
      interval('D', 'd', [
        { s: 0, mp: 1 },
        { s: 100, mp: 2 },
      ]),
      interval('P', 'p', [
        { s: 0, mp: 5 },
        { s: 0.0001, mp: 6 },
      ]),
    );
    expect(locateMilepost(view, 'sub-1', 2)[0]?.at).toEqual(end);
    expect(locateMilepost(view, 'sub-1', 5)[0]?.at).toEqual(ORIGIN);
  });
});
