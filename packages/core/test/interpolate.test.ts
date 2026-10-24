import { describe, expect, it } from 'vitest';
import { interpolateMilepost, validateInterval } from '../src/index.js';
import type { Anchor, IntervalIssueCode, MilepostResult } from '../src/index.js';

const a = (id: string, s: number, mp: number): Anchor => ({ id, s, mp, source: 'crossing' });

/** Narrows a result to the calibrated branch, failing the test with the reason otherwise. */
function expectCalibrated(r: MilepostResult): Extract<MilepostResult, { kind: 'calibrated' }> {
  if (r.kind !== 'calibrated') {
    throw new Error(`expected a calibrated result, got ${r.reason}`);
  }
  return r;
}

describe('interpolateMilepost', () => {
  it('interpolates along the path, not the chord (PROJECTION.md bend)', () => {
    const r = interpolateMilepost(40, [a('A', 0, 100), a('C', 70, 100.07)]);
    expect(r).toMatchObject({ kind: 'calibrated' });
    const c = expectCalibrated(r);
    expect(c.mp).toBeCloseTo(100.04, 12);
    expect(c.intervalLengthM).toBe(70);
  });

  it('handles decreasing mileposts', () => {
    const r = expectCalibrated(interpolateMilepost(40, [a('A', 0, 100.07), a('C', 70, 100)]));
    expect(r.mp).toBeCloseTo(100.03, 12);
  });

  it('reproduces each anchor exactly and picks the right bracket on uneven spacing', () => {
    const iv = [a('1', 0, 109.88), a('2', 412.7, 110.14), a('3', 2051.3, 111.15)];
    for (const k of iv) {
      expect(interpolateMilepost(k.s, iv)).toMatchObject({ kind: 'calibrated', mp: k.mp });
    }
    const r = expectCalibrated(interpolateMilepost(1000, iv));
    expect([r.lower.id, r.upper.id]).toEqual(['2', '3']);
  });

  it('keeps a valid zero milepost', () => {
    expect(interpolateMilepost(0, [a('z', 0, 0), a('o', 1609.344, 1)])).toMatchObject({
      kind: 'calibrated',
      mp: 0,
    });
  });

  it('never extrapolates', () => {
    const iv = [a('A', 100, 5), a('B', 200, 5.1)];
    expect(interpolateMilepost(99.999, iv)).toEqual({
      kind: 'uncalibrated',
      reason: 'BEFORE_FIRST_ANCHOR',
    });
    expect(interpolateMilepost(200.001, iv)).toEqual({
      kind: 'uncalibrated',
      reason: 'AFTER_LAST_ANCHOR',
    });
  });

  it('rejects a non-finite position', () => {
    const iv = [a('A', 0, 1), a('B', 10, 2)];
    expect(() => interpolateMilepost(NaN, iv)).toThrow(
      expect.objectContaining({ code: 'NON_FINITE' }),
    );
  });

  it.each<[readonly Anchor[], IntervalIssueCode]>([
    [[a('A', 0, 1)], 'TOO_FEW_ANCHORS'],
    [[a('A', 10, 1), a('B', 0, 2)], 'UNSORTED'],
    [[a('A', 0, 1), a('B', 0, 2)], 'DUPLICATE_POSITION'], // Review Focus 3
    [[a('A', 0, 1), a('B', 10, 2), a('C', 20, 1.5)], 'NON_MONOTONIC_MILEPOST'],
    [[a('A', 0, NaN), a('B', 10, 2)], 'NON_FINITE'],
  ])('flags invalid interval %#', (iv, code) => {
    expect(validateInterval(iv).map((i) => i.code)).toContain(code);
    expect(() => interpolateMilepost(5, iv)).toThrow(
      expect.objectContaining({ code: 'INVALID_INTERVAL' }),
    );
  });
});

describe('validateInterval', () => {
  it('returns no issues for a valid strictly monotonic interval', () => {
    expect(validateInterval([a('A', 0, 1), a('B', 10, 2), a('C', 20, 3)])).toEqual([]);
  });

  it('accepts a strictly decreasing milepost', () => {
    expect(validateInterval([a('A', 0, 3), a('B', 10, 2)])).toEqual([]);
  });

  it('collects every issue rather than stopping at the first', () => {
    const issues = validateInterval([a('A', 0, 1), a('B', 0, 2), a('C', 10, 2)]);
    const codes = issues.map((i) => i.code);
    expect(codes).toContain('DUPLICATE_POSITION');
    expect(codes).toContain('NON_MONOTONIC_MILEPOST');
  });

  it('reports the anchor ids involved in an issue', () => {
    const issues = validateInterval([a('A', 0, 1), a('B', 0, 2)]);
    expect(issues).toContainEqual({
      code: 'DUPLICATE_POSITION',
      anchorIds: ['A', 'B'],
    });
  });
});
