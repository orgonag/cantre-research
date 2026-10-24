import { describe, expect, it } from 'vitest';
import {
  METRES_PER_MILE,
  metresToMiles,
  milesToKilometres,
  milesToMetres,
  CoreInputError,
} from '../src/index.js';

describe('units', () => {
  it('uses the exact international mile', () => {
    expect(METRES_PER_MILE).toBe(1609.344);
  });
  it('round-trips miles and metres', () => {
    expect(milesToMetres(112.43)).toBeCloseTo(180938.54592, 6);
    expect(metresToMiles(milesToMetres(112.43))).toBeCloseTo(112.43, 12);
  });
  it('converts miles to kilometres', () => {
    expect(milesToKilometres(1)).toBe(1.609344);
  });
  it('keeps zero as zero', () => {
    expect(metresToMiles(0)).toBe(0);
  });
  it('rejects non-finite input', () => {
    expect(() => milesToMetres(Number.NaN)).toThrow(CoreInputError);
    expect(() => metresToMiles(Infinity)).toThrow(expect.objectContaining({ code: 'NON_FINITE' }));
  });
});
