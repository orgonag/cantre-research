import { describe, expect, it } from 'vitest';
import { projectOntoSegment } from '../src/index.js';
import { geodesicDirect, geodesicDistanceM } from './helpers/geodesic.js';
import { atMetres } from './helpers/local.js';

// The docs/PROJECTION.md worked examples, placed at O = (52.0, -106.0).
const O = { lat: 52, lon: -106 };
const A = atMetres(O, 0, 0);
const B = atMetres(O, 6, 8);

describe('projectOntoSegment', () => {
  it('interior projection: worked example', () => {
    const r = projectOntoSegment(atMetres(O, 6, 2), A, B);
    expect(r.t).toBeCloseTo(0.52, 6);
    expect(r.alongSegmentM).toBeCloseTo(5.2, 3);
    expect(r.crossTrackM).toBeCloseTo(3.6, 3);
    expect(r.segmentLengthM).toBeCloseTo(10, 3);
    expect(r.clamped).toBe('none');
  });
  it('clamps past the end', () => {
    const r = projectOntoSegment(atMetres(O, 12, 16), A, B);
    expect(r.t).toBe(1);
    expect(r.clamped).toBe('end');
    expect(r.crossTrackM).toBeCloseTo(10, 3);
  });
  it('clamps before the start', () => {
    const r = projectOntoSegment(atMetres(O, -3, -4), A, B);
    expect(r.t).toBe(0);
    expect(r.clamped).toBe('start');
    expect(r.crossTrackM).toBeCloseTo(5, 3);
  });
  it('treats a zero-length segment as a point', () => {
    const r = projectOntoSegment(atMetres(O, 3, 4), A, A);
    expect(r).toMatchObject({ t: 0, alongSegmentM: 0, segmentLengthM: 0 });
    expect(r.crossTrackM).toBeCloseTo(5, 3);
  });
  it('rejects non-finite input', () => {
    expect(() => projectOntoSegment({ lat: NaN, lon: -106 }, A, B)).toThrow(
      expect.objectContaining({ code: 'NON_FINITE' }),
    );
  });
  it('stays accurate 5 km off the track (Review Focus 4)', () => {
    const a = { lat: 55, lon: -110 };
    const b = geodesicDirect(a, 90, 1500);
    const p = geodesicDirect(geodesicDirect(a, 90, 750), 0, 5000);
    const r = projectOntoSegment(p, a, b);
    expect(Math.abs(r.crossTrackM - geodesicDistanceM(p, r.point)) / 5000).toBeLessThan(0.001);
    expect(r.clamped).toBe('none');
  });
});
