import { describe, expect, it } from 'vitest';
import { lowerTier, milepostFor } from '../src/index.js';
import type { Candidate } from '../src/index.js';
import { interval, network, ORIGIN, straightChain, withIntervals } from './helpers/network.js';

const MI = 1609.344; // metres per mile

function cand(s: number | null, over: Partial<Candidate> = {}): Candidate {
  return {
    chainId: 'c1',
    chainBaseId: 'c1',
    segmentKey: null,
    subdivisionNid: 'sub-1',
    subdivisionName: 'Test Sub',
    operator: 'CN',
    trackClass: 'Main',
    residualM: 1,
    s,
    bearingDeg: 90,
    ...over,
  };
}

const base = network({ chains: [straightChain('c1', ORIGIN, 0, 10000)] });

describe('lowerTier', () => {
  it('returns the worse tier, order posted > tc > unverified', () => {
    expect(lowerTier('posted', 'posted')).toBe('posted');
    expect(lowerTier('posted', 'tc')).toBe('tc');
    expect(lowerTier('tc', 'posted')).toBe('tc');
    expect(lowerTier('tc', 'unverified')).toBe('unverified');
    expect(lowerTier('unverified', 'posted')).toBe('unverified');
    expect(lowerTier('tc', 'tc')).toBe('tc');
  });
});

describe('milepostFor input checks', () => {
  it('T4: a non-finite s throws NON_FINITE instead of reading as DISCONTINUITY_GAP', () => {
    const net = withIntervals(
      base,
      interval('i1', 'c1', [
        { s: 0, mp: 0 },
        { s: 1000, mp: 1 },
      ]),
      interval('i2', 'c1', [
        { s: 3000, mp: 3 },
        { s: 4000, mp: 4 },
      ]),
    );
    for (const bad of [Number.NaN, Infinity, -Infinity]) {
      expect(() => milepostFor(net, cand(bad), 5)).toThrow(/s/);
      try {
        milepostFor(net, cand(bad), 5);
      } catch (e) {
        expect((e as { code: string }).code).toBe('NON_FINITE');
      }
    }
  });
});

describe('milepostFor', () => {
  const one = withIntervals(
    base,
    interval('i1', 'c1', [
      { s: 0, mp: 10, tier: 'posted' },
      { s: MI, mp: 11, tier: 'unverified' },
    ]),
  );

  it('inside an interval: interpolated MP, GPS band and the lower tier of the bracket', () => {
    const r = milepostFor(one, cand(804.672), 5);
    expect(r.milepost).toMatchObject({ kind: 'calibrated', mp: 10.5 });
    expect(r.mpBandMi).toBeCloseTo(5 / MI, 12);
    expect(r.tier).toBe('unverified');
    expect(r.anchorIds).toEqual(['i1-a0', 'i1-a1']);
    expect(r.reasons).toEqual([]);
  });

  it('MP 0 at s = 0 is kept as 0, not null', () => {
    const net = withIntervals(
      base,
      interval('z', 'c1', [
        { s: 0, mp: 0 },
        { s: MI, mp: 1 },
      ]),
    );
    const r = milepostFor(net, cand(0), 5);
    expect(r.milepost).toMatchObject({ kind: 'calibrated', mp: 0 });
    expect(r.tier).toBe('posted');
  });

  it('before the first interval is BEFORE_FIRST_ANCHOR, never extrapolated', () => {
    const net = withIntervals(
      base,
      interval('i1', 'c1', [
        { s: 1000, mp: 10 },
        { s: 1000 + MI, mp: 11 },
      ]),
    );
    const r = milepostFor(net, cand(500), 5);
    expect(r.milepost).toEqual({ kind: 'uncalibrated', reason: 'BEFORE_FIRST_ANCHOR' });
    expect(r.mpBandMi).toBeNull();
    expect(r.tier).toBeNull();
    expect(r.anchorIds).toEqual([]);
    expect(r.reasons).toEqual([]);
  });

  it('after the last interval is AFTER_LAST_ANCHOR, using the last interval', () => {
    const r = milepostFor(one, cand(MI + 50), 5);
    expect(r.milepost).toEqual({ kind: 'uncalibrated', reason: 'AFTER_LAST_ANCHOR' });
    expect(r.mpBandMi).toBeNull();
    expect(r.tier).toBeNull();
    expect(r.anchorIds).toEqual([]);
  });

  it('between two intervals is null with DISCONTINUITY_GAP', () => {
    const net = withIntervals(
      base,
      // given out of order on purpose: they are sorted by first anchor
      interval('b', 'c1', [
        { s: 5000, mp: 50 },
        { s: 6000, mp: 51 },
      ]),
      interval('a', 'c1', [
        { s: 0, mp: 10 },
        { s: 1000, mp: 11 },
      ]),
    );
    const r = milepostFor(net, cand(3000), 5);
    expect(r.milepost).toBeNull();
    expect(r.mpBandMi).toBeNull();
    expect(r.tier).toBeNull();
    expect(r.anchorIds).toEqual([]);
    expect(r.reasons).toEqual(['DISCONTINUITY_GAP']);
    // each side still calibrates from its own interval
    expect(milepostFor(net, cand(5500), 5).milepost).toMatchObject({ mp: 50.5 });
    expect(milepostFor(net, cand(500), 5).milepost).toMatchObject({ mp: 10.5 });
  });

  it('two intervals sharing an end position: the later one wins', () => {
    const net = withIntervals(
      base,
      interval('a', 'c1', [
        { s: 0, mp: 10, tier: 'tc' },
        { s: 1000, mp: 11, tier: 'tc' },
      ]),
      interval('b', 'c1', [
        { s: 1000, mp: 40, tier: 'posted' },
        { s: 2000, mp: 41, tier: 'posted' },
      ]),
    );
    const r = milepostFor(net, cand(1000), 5);
    expect(r.milepost).toMatchObject({ kind: 'calibrated', mp: 40 });
    expect(r.anchorIds).toEqual(['b-a0', 'b-a1']);
    expect(r.tier).toBe('posted');
  });

  it('a chain with no intervals is null with CHAIN_UNCALIBRATED', () => {
    const r = milepostFor(base, cand(100), 5);
    expect(r.milepost).toBeNull();
    expect(r.reasons).toEqual(['CHAIN_UNCALIBRATED']);
    expect(r.anchorIds).toEqual([]);
  });

  it('intervals of another chain do not count', () => {
    const net = withIntervals(
      base,
      interval('x', 'other', [
        { s: 0, mp: 1 },
        { s: 1000, mp: 2 },
      ]),
    );
    expect(milepostFor(net, cand(100), 5).reasons).toEqual(['CHAIN_UNCALIBRATED']);
  });

  it('a later piece (id#2) looks up intervals by chainBaseId', () => {
    const r = milepostFor(one, cand(MI / 2, { chainId: 'c1#2', chainBaseId: 'c1' }), 5);
    expect(r.milepost).toMatchObject({ kind: 'calibrated', mp: 10.5 });
  });

  it('a segment candidate is null with UNCHAINED_TRACK', () => {
    const r = milepostFor(
      one,
      cand(null, { chainId: null, chainBaseId: null, segmentKey: 'seg-1' }),
      5,
    );
    expect(r.milepost).toBeNull();
    expect(r.mpBandMi).toBeNull();
    expect(r.tier).toBeNull();
    expect(r.reasons).toEqual(['UNCHAINED_TRACK']);
  });

  it('a chain candidate with null s is treated as unchained', () => {
    expect(milepostFor(one, cand(null), 5).reasons).toEqual(['UNCHAINED_TRACK']);
  });

  it('rejects a negative accuracy through the M1 band function', () => {
    expect(() => milepostFor(one, cand(100), -1)).toThrow();
  });
});
