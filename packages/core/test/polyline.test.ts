import { describe, expect, it } from 'vitest';
import {
  NEAR_TIE_TOLERANCE_M,
  cumulativeLengthsM,
  distanceM,
  projectOntoPolyline,
} from '../src/index.js';
import { atMetres } from './helpers/local.js';

// The docs/PROJECTION.md "bending track" example, placed at O = (52.0, -106.0).
const O = { lat: 52, lon: -106 };
const P0 = atMetres(O, 0, 0);
const P1 = atMetres(O, 30, 0);
const P2 = atMetres(O, 30, 40);
const bend = [P0, P1, P2];

describe('cumulativeLengthsM', () => {
  it('sums segment lengths, not the chord', () => {
    const c = cumulativeLengthsM(bend);
    expect(c.at(0)).toBe(0);
    expect(c.at(2)).toBeCloseTo(70, 3);
    expect(distanceM(P0, P2)).toBeCloseTo(50, 3);
  });
  it('skips duplicate vertices without changing length', () => {
    expect(cumulativeLengthsM([P0, P0, P1, P2]).at(3)).toBeCloseTo(70, 3);
  });
  it('returns [0] for a one-vertex line', () => {
    expect(Array.from(cumulativeLengthsM([P0]))).toEqual([0]);
  });
  it('rejects an empty line', () => {
    expect(() => cumulativeLengthsM([])).toThrow(
      expect.objectContaining({ code: 'EMPTY_POLYLINE' }),
    );
  });
  it('validates every vertex', () => {
    expect(() => cumulativeLengthsM([P0, { lat: 0, lon: 0 }])).toThrow(
      expect.objectContaining({ code: 'OUTSIDE_CANADA_ENVELOPE' }),
    );
  });
});

describe('projectOntoPolyline', () => {
  it('projects onto the closest segment of the bend', () => {
    const r = projectOntoPolyline(atMetres(O, 33, 10), bend);
    expect(r.segmentIndex).toBe(1);
    expect(r.alongM).toBeCloseTo(40, 3);
    expect(r.crossTrackM).toBeCloseTo(3, 3);
    expect(r.totalLengthM).toBeCloseTo(70, 3);
    expect(r.nearTieAlongM).toEqual([]);
  });
  it('gives one along value on a shared vertex (Review Focus 1)', () => {
    const r = projectOntoPolyline(P1, bend);
    expect(r.alongM).toBeCloseTo(30, 6);
    expect(r.crossTrackM).toBeCloseTo(0, 6);
    expect(r.nearTieAlongM).toEqual([]);
  });
  it('reports a hairpin near-tie instead of hiding it', () => {
    const hairpin = [
      atMetres(O, 0, 0),
      atMetres(O, 100, 0),
      atMetres(O, 100, 4),
      atMetres(O, 0, 4),
    ];
    const r = projectOntoPolyline(atMetres(O, 50, 2), hairpin);
    expect(r.nearTieAlongM).toHaveLength(1);
    expect(Math.abs((r.nearTieAlongM.at(0) ?? Number.NaN) - r.alongM)).toBeGreaterThan(
      NEAR_TIE_TOLERANCE_M,
    );
  });
  it('reuses a supplied cumulative array', () => {
    const c = cumulativeLengthsM(bend);
    const r = projectOntoPolyline(atMetres(O, 33, 10), bend, c);
    expect(r.alongM).toBeCloseTo(40, 3);
  });
  it('rejects a cumulative array of the wrong length', () => {
    expect(() => projectOntoPolyline(O, bend, new Float64Array(2))).toThrow(
      expect.objectContaining({ code: 'CUMULATIVE_LENGTH_MISMATCH' }),
    );
  });
  it.each([
    [[], 'EMPTY_POLYLINE'],
    [[atMetres(O, 0, 0)], 'ZERO_LENGTH_POLYLINE'],
    [[atMetres(O, 0, 0), atMetres(O, 0, 0)], 'ZERO_LENGTH_POLYLINE'],
  ])('rejects degenerate polyline %#', (line, code) => {
    expect(() => projectOntoPolyline(O, line)).toThrow(expect.objectContaining({ code }));
  });
});
