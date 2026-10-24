import { describe, expect, it } from 'vitest';
import { GRS80, meridionalRadiusM, metresPerDegree, primeVerticalRadiusM } from '../src/index.js';

describe('ellipsoid', () => {
  it('defines GRS80 with a = 6378137 m and f = 1/298.257222101', () => {
    expect(GRS80.a).toBe(6378137);
    expect(GRS80.f).toBe(1 / 298.257222101);
    expect(GRS80.e2).toBeCloseTo(0.0066943800229, 13);
  });
  it('M and N at the equator and pole', () => {
    expect(meridionalRadiusM(0)).toBeCloseTo(6335439.327, 3);
    expect(primeVerticalRadiusM(0)).toBeCloseTo(6378137.0, 6);
    expect(meridionalRadiusM(90)).toBeCloseTo(primeVerticalRadiusM(90), 6);
  });
  it('metres per degree of longitude shrinks with cos(lat)', () => {
    const s = metresPerDegree(60);
    expect(s.lonM).toBeCloseTo((Math.PI / 180) * primeVerticalRadiusM(60) * 0.5, 9);
  });
  it('metres per degree of latitude is M times pi/180', () => {
    expect(metresPerDegree(45).latM).toBeCloseTo((Math.PI / 180) * meridionalRadiusM(45), 9);
  });
});
