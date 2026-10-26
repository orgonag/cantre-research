import { describe, expect, it } from 'vitest';
import { fromLocalM } from '@cantre/core';
import { mainlines } from '../../src/logic/mainlines.js';
import { chain, interval, net, ORIGIN } from './netfixture.js';
const a = chain('a', 's1', 'First', 0, 1000, 328);
const b = chain('b', 's2', 'Second', 0, 1000, 422);
const c = chain('c', 's3', 'Third', 0, 1000, 2400);
const spur = {
  key: 'spur',
  chainId: null,
  trackClass: 'Spur',
  status: 'Operational',
  subdivisionNid: 'spur',
  subdivisionName: 'Spur',
  operator: 'CN',
  geoAccuracyM: null,
  pts: chain('spur', 'spur', 'Spur', 0, 1000, 20).pts,
};
const sample = net({
  chains: [a, b, c],
  segments: [spur],
  intervals: [
    interval('ia', 'a', [
      [0, 113],
      [1000, 114],
    ]),
    interval('ic', 'c', [
      [0, 3],
      [1000, 4],
    ]),
  ],
});
const point = (x = 500, y = 0) => ({ ...fromLocalM(ORIGIN, { x, y }, ORIGIN.lat), accuracyM: 5 });

describe('nearest usable mainline and explicit alternatives', () => {
  it('bypasses a closer spur, lists an uncalibrated mainline and selects the closest usable one', () => {
    const found = mainlines(sample, point(), null);
    expect(found.selected?.candidate.chainId).toBe('a');
    expect(found.selected?.candidate.residualM).toBeCloseTo(328, 0);
    expect(found.selected?.milepost?.kind).toBe('calibrated');
    expect(found.choices.map((o) => o.candidate.chainId)).toEqual(['a', 'b', 'c']);
    expect(found.choices[1]?.milepost).toBeNull();
  });
  it('skips an uncalibrated closest mainline in Auto, but keeps it selectable', () => {
    const found = mainlines({ ...sample, intervals: sample.intervals.slice(1) }, point(), null);
    expect(found.selected?.candidate.chainId).toBe('c');
    expect(found.choices[0]?.candidate.chainId).toBe('a');
  });
  it('locks to a chosen route even without mileage and keeps other options available', () => {
    for (const lock of [
      { kind: 'chain', chainId: 'b' },
      { kind: 'subdivision', subdivisionNid: 's2' },
    ] as const) {
      const found = mainlines(sample, point(), lock);
      expect(found.selected?.candidate.chainId).toBe('b');
      expect(found.selected?.milepost).toBeNull();
      expect(found.choices.filter((o) => o.selected).map((o) => o.candidate.chainId)).toEqual([
        'b',
      ]);
      expect(found.choices).toHaveLength(3);
    }
    expect(mainlines(sample, point(), null).selected?.candidate.chainId).toBe('a');
  });
  it('does not silently replace a missing or non-mainline lock', () => {
    const found = mainlines(sample, point(), { kind: 'chain', chainId: 'missing' });
    expect(found.selected).toBeNull();
    expect(found.choices).toHaveLength(3);
    expect(found.choices.some((o) => o.selected)).toBe(false);
  });
  it('does not extrapolate; a manually selected gap remains unavailable', () => {
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
        ...sample.intervals.slice(1),
      ],
    };
    expect(mainlines(gap, point(), null).selected?.candidate.chainId).toBe('c');
    expect(mainlines(gap, point(), { kind: 'chain', chainId: 'a' }).selected?.reasons).toContain(
      'DISCONTINUITY_GAP',
    );
  });
  it('retains unverified calibration evidence', () => {
    const intervals = sample.intervals.map((i) => ({
      ...i,
      anchors: i.anchors.map((anchor) => ({ ...anchor, tier: 'unverified' as const })),
    }));
    expect(mainlines({ ...sample, intervals }, point(), null).selected?.tier).toBe('unverified');
  });
  it('returns the closest mainline without fabricating mileage when all are uncalibrated', () => {
    const found = mainlines({ ...sample, intervals: [] }, point(), null);
    expect(found.selected?.candidate.chainId).toBe('a');
    expect(found.selected?.milepost).toBeNull();
  });
  it('handles empty, spur-only and rapid-transit-only networks', () => {
    for (const n of [
      net(),
      net({ segments: [spur] }),
      net({ chains: [{ ...a, trackClasses: ['Rapid Transit'] }] }),
      net({ chains: [{ ...a, pts: [] }] }),
    ])
      expect(mainlines(n, point(), null)).toEqual({ selected: null, choices: [] });
  });
  it('expands beyond 10 km and always includes a distant locked route', () => {
    const distant = chain('d', 's4', 'Distant', 0, 1000, 50000);
    const n = net({
      chains: [a, distant],
      intervals: [
        interval('id', 'd', [
          [0, 40],
          [1000, 41],
        ]),
      ],
    });
    expect(mainlines(n, point(), null).selected?.candidate.chainId).toBe('d');
    const locked = mainlines({ ...sample, chains: [...sample.chains, distant] }, point(), {
      kind: 'chain',
      chainId: 'd',
    });
    expect(locked.selected?.candidate.chainId).toBe('d');
    expect(locked.choices.some((o) => o.candidate.chainId === 'd')).toBe(true);
  });
  it('deduplicates loaded pieces of a base chain without hiding distinct routes', () => {
    const found = mainlines(
      { ...sample, chains: [...sample.chains, { ...a, id: 'a#2' }] },
      point(),
      null,
    );
    expect(found.choices).toHaveLength(3);
  });
});
