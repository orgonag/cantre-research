import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { axialDifferenceDeg, bearingDeg } from '../src/index.js';
import { atMetres } from './helpers/local.js';

describe('bearingDeg', () => {
  const o = { lat: 52, lon: -106 };

  it('bearing east is 90 deg, north 0 deg, axial difference folds 180 deg', () => {
    expect(bearingDeg(o, atMetres(o, 100, 0))).toBeCloseTo(90, 6);
    expect(bearingDeg(o, atMetres(o, 0, 100))).toBeCloseTo(0, 6);
    expect(axialDifferenceDeg(10, 190)).toBeCloseTo(0, 9);
    expect(axialDifferenceDeg(350, 20)).toBeCloseTo(30, 9);
    expect(axialDifferenceDeg(0, 90)).toBe(90);
  });

  it('south is 180 deg and west is 270 deg, normalised to [0, 360)', () => {
    expect(bearingDeg(o, atMetres(o, 0, -100))).toBeCloseTo(180, 6);
    expect(bearingDeg(o, atMetres(o, -100, 0))).toBeCloseTo(270, 6);
    expect(bearingDeg(o, atMetres(o, -1, 100))).toBeLessThan(360);
  });

  it('north-east is 45 deg on the tangent plane', () => {
    // atMetres scales at the origin latitude, bearingDeg at the mid-latitude: they differ by
    // about 0.0003 deg over 100 m, so compare to 3 decimals, not 6.
    expect(bearingDeg(o, atMetres(o, 100, 100))).toBeCloseTo(45, 3);
  });

  it('never returns 360: a vanishingly small westward offset of north rounds to 0', () => {
    const b = { lat: o.lat + 0.001, lon: o.lon - 1e-15 };
    expect(bearingDeg(o, b)).toBeLessThan(360);
  });

  it('is 0 for coincident points (no direction), never NaN', () => {
    expect(bearingDeg(o, o)).toBe(0);
  });
});

describe('axialDifferenceDeg properties', () => {
  it('is symmetric under a 180 deg flip and lies in [0, 90]', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 360, noNaN: true }),
        fc.double({ min: 0, max: 360, noNaN: true }),
        (a, b) => {
          const d = axialDifferenceDeg(a, b);
          expect(d).toBeGreaterThanOrEqual(0);
          expect(d).toBeLessThanOrEqual(90);
          expect(d).toBeCloseTo(axialDifferenceDeg(b, a + 180), 6);
          expect(d).toBeCloseTo(axialDifferenceDeg(b, a), 9);
        },
      ),
    );
  });
});
