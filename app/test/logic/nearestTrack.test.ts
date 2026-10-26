import { describe, expect, it } from 'vitest';
import { fromLocalM } from '@cantre/core';
import { nearestTrack } from '../../src/logic/nearestTrack.js';
import { chain, interval, net, ORIGIN } from './netfixture.js';

const a = chain('a', 'wilkie', 'Wilkie', 0, 1000);
const b = chain('b', 'other', 'Other', 0, 1000, 6000);
const sample = net({
  chains: [a, b],
  intervals: [
    interval('ia', 'a', [
      [0, 3.94],
      [1000, 4.94],
    ]),
    interval('ib', 'b', [
      [0, 10],
      [1000, 11],
    ]),
  ],
});
const point = (x: number, y: number) => ({
  ...fromLocalM(ORIGIN, { x, y }, ORIGIN.lat),
  accuracyM: 5,
});
describe('nearest track independently of on-track matching', () => {
  it('finds a calibrated projection two miles away even outside coverage tiles', () => {
    const found = nearestTrack(net({ ...sample, chains: [a] }), point(500, 3218), null);
    expect(found?.candidate.subdivisionName).toBe('Wilkie');
    expect(found?.candidate.residualM).toBeGreaterThan(3200);
    expect(found?.milepost?.kind).toBe('calibrated');
    if (found?.milepost?.kind === 'calibrated') expect(found.milepost.mp).toBeCloseTo(4.44, 2);
  });
  it('selects the geographically nearest track, not the first or nearest calibrated one', () => {
    expect(nearestTrack(sample, point(500, 4000), null)?.candidate.chainId).toBe('b');
    const uncalibrated = nearestTrack({ ...sample, intervals: [] }, point(500, 4000), null);
    expect(uncalibrated?.candidate.chainId).toBe('b');
    expect(uncalibrated?.milepost).toBeNull();
  });
  it('honours a selected subdivision or chain even when another track is closer', () => {
    for (const lock of [
      { kind: 'subdivision', subdivisionNid: 'wilkie' },
      { kind: 'chain', chainId: 'a' },
    ] as const)
      expect(nearestTrack(sample, point(500, 4000), lock)?.candidate.chainId).toBe('a');
  });
  it('does not fabricate data for a missing route or empty network', () => {
    expect(nearestTrack(net(), point(0, 0), null)).toBeNull();
    expect(nearestTrack(sample, point(0, 0), { kind: 'chain', chainId: 'absent' })).toBeNull();
    expect(
      nearestTrack(
        net({
          chains: [{ ...a, pts: [], sM: new Float64Array(), cumulativeM: new Float64Array() }],
        }),
        point(0, 0),
        null,
      ),
    ).toBeNull();
  });
  it('does not interpolate across a calibration gap', () => {
    const gap = {
      ...sample,
      intervals: [
        interval('lo', 'a', [
          [0, 1],
          [200, 2],
        ]),
        interval('hi', 'a', [
          [800, 8],
          [1000, 9],
        ]),
      ],
    };
    const found = nearestTrack(gap, point(500, 1000), null);
    expect(found?.milepost).toBeNull();
    expect(found?.reasons).toContain('DISCONTINUITY_GAP');
  });
});
