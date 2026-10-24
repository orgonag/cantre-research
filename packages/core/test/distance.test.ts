import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { distanceM } from '../src/index.js';
import { geodesicDirect, geodesicDistanceM } from './helpers/geodesic.js';

describe('distanceM', () => {
  it('matches GeographicLib within 1 mm for segments up to 2 km across Canada', () => {
    fc.assert(
      fc.property(
        // fc.double samples bit patterns, which piles almost every draw near zero; mapping
        // integers instead spreads draws evenly over the stated domain.
        fc.integer({ min: 41_500_000, max: 83_500_000 }).map((x) => x / 1e6), // lat, deg
        fc.integer({ min: -141_000_000, max: -52_000_000 }).map((x) => x / 1e6), // lon, deg
        fc.integer({ min: 0, max: 360_000_000 }).map((x) => x / 1e6), // azimuth, deg
        fc.integer({ min: 0, max: 2_000_000 }).map((x) => x / 1e3), // distance, m (1 mm steps)
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
  it('stays within 1 mm on a sweep: lat 80-83.5 (0.5 deg) x azimuth 0-359 (1 deg), d = 2 km', () => {
    for (let lat = 80; lat <= 83.5; lat += 0.5) {
      for (let az = 0; az < 360; az += 1) {
        const a = { lat, lon: -100 };
        const b = geodesicDirect(a, az, 2000);
        const err = Math.abs(distanceM(a, b) - geodesicDistanceM(a, b));
        expect(err, `lat ${String(lat)} az ${String(az)}`).toBeLessThan(0.001);
      }
    }
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
  it('rejects a swapped lat/lon point', () => {
    expect(() => distanceM({ lat: -106.67, lon: 52.13 }, { lat: 52.13, lon: -106.67 })).toThrow(
      expect.objectContaining({ code: 'LAT_OUT_OF_RANGE' }),
    );
  });
  it('rejects E7-integer coordinates promptly instead of subdividing forever', () => {
    const e7 = { lat: 521300000, lon: -1066700000 };
    const start = Date.now();
    expect(() => distanceM(e7, { lat: 52.13, lon: -106.67 })).toThrow(
      expect.objectContaining({ code: 'LAT_OUT_OF_RANGE' }),
    );
    expect(Date.now() - start).toBeLessThan(100);
  });
  it('rejects invalid points', () => {
    expect(() => distanceM({ lat: Number.NaN, lon: -100 }, { lat: 50, lon: -100 })).toThrow(
      expect.objectContaining({ code: 'NON_FINITE' }),
    );
  });
});
