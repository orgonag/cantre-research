import { describe, expect, it } from 'vitest';
import { gpsMilepostBandMi } from '../src/index.js';
import type { Anchor } from '../src/index.js';

const a = (id: string, s: number, mp: number): Anchor => ({
  id,
  s,
  mp,
  source: 'crossing',
  tier: 'posted',
});

describe('gpsMilepostBandMi', () => {
  it('propagates GPS accuracy along the interval slope', () => {
    const lo = a('lo', 0, 112.1);
    const hi = a('hi', 0.42 * 1609.344, 112.52);
    expect(gpsMilepostBandMi(6, lo, hi)).toBeCloseTo(6 / 1609.344, 12);
  });

  it('rejects negative or non-finite accuracy', () => {
    const lo = a('lo', 0, 1);
    const hi = a('hi', 1609.344, 2);
    expect(() => gpsMilepostBandMi(-1, lo, hi)).toThrow(
      expect.objectContaining({ code: 'NEGATIVE_ACCURACY' }),
    );
    expect(() => gpsMilepostBandMi(NaN, lo, hi)).toThrow(
      expect.objectContaining({ code: 'NON_FINITE' }),
    );
  });

  it('checks accuracy before the anchors', () => {
    const bad = a('bad', 0, NaN);
    const hi = a('hi', 1609.344, 2);
    expect(() => gpsMilepostBandMi(NaN, bad, hi)).toThrow(
      expect.objectContaining({ code: 'NON_FINITE' }),
    );
  });

  it('rejects an interval that is not ordered by s', () => {
    const lo = a('lo', 100, 1);
    const hi = a('hi', 100, 2);
    expect(() => gpsMilepostBandMi(5, lo, hi)).toThrow(
      expect.objectContaining({ code: 'INVALID_INTERVAL' }),
    );
  });

  it('rejects non-finite anchor values', () => {
    const lo = a('lo', 0, Infinity);
    const hi = a('hi', 1609.344, 2);
    expect(() => gpsMilepostBandMi(5, lo, hi)).toThrow(
      expect.objectContaining({ code: 'INVALID_INTERVAL' }),
    );
  });

  it('rejects a band that overflows to infinity', () => {
    const lo = a('lo', 0, -1e308);
    const hi = a('hi', 1, 1e308);
    expect(() => gpsMilepostBandMi(1, lo, hi)).toThrow(
      expect.objectContaining({ code: 'NON_FINITE' }),
    );
  });
});
