import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { distanceM } from '../src/index.js';
import { geodesicDirect, geodesicDistanceM } from './helpers/geodesic.js';

describe('distanceM', () => {
  it('matches GeographicLib within 1 mm for segments up to 2 km across Canada', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 41.5, max: 83.5, noNaN: true }),
        fc.double({ min: -141, max: -52, noNaN: true }),
        fc.double({ min: 0, max: 360, noNaN: true }),
        fc.double({ min: 0, max: 2000, noNaN: true }),
        (lat, lon, az, d) => {
          const a = { lat, lon };
          const b = geodesicDirect(a, az, d);
          const err = Math.abs(distanceM(a, b) - geodesicDistanceM(a, b));
          expect(err).toBeLessThan(0.001);
        },
      ),
      { numRuns: 2000 },
    );
  });
  it('holds the 1 mm target at 83.5 degrees for an east-west 2 km segment', () => {
    const a = { lat: 83.5, lon: -70 };
    const b = geodesicDirect(a, 90, 2000);
    expect(Math.abs(distanceM(a, b) - 2000)).toBeLessThan(0.001);
  });
  it('subdivides long segments: 50 km within 0.05 %', () => {
    const a = { lat: 52, lon: -106 };
    const b = geodesicDirect(a, 45, 50000);
    expect(Math.abs(distanceM(a, b) - 50000) / 50000).toBeLessThan(0.0005);
  });
  it('is zero for identical points', () => {
    expect(distanceM({ lat: 50, lon: -100 }, { lat: 50, lon: -100 })).toBe(0);
  });
  it('is symmetric', () => {
    const a = { lat: 50, lon: -100 };
    const b = { lat: 50.01, lon: -100.02 };
    expect(distanceM(a, b)).toBeCloseTo(distanceM(b, a), 9);
  });
  it('rejects invalid points', () => {
    expect(() => distanceM({ lat: Number.NaN, lon: -100 }, { lat: 50, lon: -100 })).toThrow(
      expect.objectContaining({ code: 'NON_FINITE' }),
    );
  });
});
