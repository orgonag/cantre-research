import { describe, expect, it } from 'vitest';
import { gpsMilepostBandMi, interpolateMilepost } from '../src/index.js';
import type { Anchor, MilepostResult } from '../src/index.js';

const a = (id: string, s: number, mp: number): Anchor => ({
  id,
  s,
  mp,
  source: 'crossing',
  tier: 'posted',
});

function expectCalibrated(r: MilepostResult): Extract<MilepostResult, { kind: 'calibrated' }> {
  if (r.kind !== 'calibrated') {
    throw new Error(`expected a calibrated result, got ${r.reason}`);
  }
  return r;
}

describe('interpolateMilepost exact-hit brackets', () => {
  const iv = [a('A', 0, 10), a('B', 400, 10.25), a('C', 1000, 10.6)];

  it('brackets the first anchor with the first interval', () => {
    const r = expectCalibrated(interpolateMilepost(0, iv));
    expect(r.mp).toBe(10);
    expect(r.lower).toBe(iv[0]);
    expect(r.upper).toBe(iv[1]);
    expect(r.intervalLengthM).toBe(400);
  });

  it('brackets an interior anchor with the interval below it', () => {
    const r = expectCalibrated(interpolateMilepost(400, iv));
    expect(r.mp).toBe(10.25);
    expect(r.lower).toBe(iv[0]);
    expect(r.upper).toBe(iv[1]);
    expect(r.intervalLengthM).toBe(400);
  });

  it('brackets the last anchor with the last interval', () => {
    const r = expectCalibrated(interpolateMilepost(1000, iv));
    expect(r.mp).toBe(10.6);
    expect(r.lower).toBe(iv[1]);
    expect(r.upper).toBe(iv[2]);
    expect(r.intervalLengthM).toBe(600);
  });
});

describe('interpolateMilepost zero milepost', () => {
  it('keeps a zero reached by interpolation at 0', () => {
    const r = expectCalibrated(interpolateMilepost(1609.344, [a('A', 0, -1), a('B', 3218.688, 1)]));
    expect(r.mp).toBeCloseTo(0, 12);
    expect(r.kind).toBe('calibrated');
  });
});

describe('gpsMilepostBandMi validation order', () => {
  it('reports NEGATIVE_ACCURACY before judging bad anchors', () => {
    expect(() => gpsMilepostBandMi(-1, a('A', 5, 1), a('B', 5, 2))).toThrow(
      expect.objectContaining({ code: 'NEGATIVE_ACCURACY' }),
    );
  });
});
