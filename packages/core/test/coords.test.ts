import { describe, expect, it } from 'vitest';
import {
  CANADA_ENVELOPE,
  assertLatLon,
  assertLatLonRange,
  fromLocalM,
  metresPerDegree,
  toLocalM,
} from '../src/index.js';

describe('assertLatLon', () => {
  it('accepts a Canadian point', () => {
    expect(() => {
      assertLatLon({ lat: 52.13, lon: -106.67 });
    }).not.toThrow();
  });
  it('accepts points on the envelope boundary', () => {
    expect(() => {
      assertLatLon({ lat: 41.5, lon: -141.5 });
    }).not.toThrow();
    expect(() => {
      assertLatLon({ lat: 83.5, lon: -52 });
    }).not.toThrow();
  });
  it.each([
    [{ lat: Number.NaN, lon: -100 }, 'NON_FINITE'],
    [{ lat: 50, lon: Infinity }, 'NON_FINITE'],
    [{ lat: 91, lon: -100 }, 'LAT_OUT_OF_RANGE'],
    [{ lat: 50, lon: -181 }, 'LON_OUT_OF_RANGE'],
    [{ lat: -106.67, lon: 52.13 }, 'LAT_OUT_OF_RANGE'], // swapped
    [{ lat: 52.13, lon: 106.67 }, 'OUTSIDE_CANADA_ENVELOPE'], // positive-west mistake
  ])('rejects %j with %s', (p, code) => {
    expect(() => {
      assertLatLon(p);
    }).toThrow(expect.objectContaining({ code }));
  });
});

describe('assertLatLonRange', () => {
  it('accepts a point outside Canada (no envelope check)', () => {
    expect(() => {
      assertLatLonRange({ lat: -33.9, lon: 151.2 });
    }).not.toThrow();
  });
  it.each([
    [{ lat: Number.NaN, lon: 0 }, 'NON_FINITE'],
    [{ lat: 91, lon: 0 }, 'LAT_OUT_OF_RANGE'],
    [{ lat: 0, lon: 181 }, 'LON_OUT_OF_RANGE'],
  ])('rejects %j with %s', (p, code) => {
    expect(() => {
      assertLatLonRange(p);
    }).toThrow(expect.objectContaining({ code }));
  });
});

describe('local tangent plane', () => {
  it('has the documented Canada envelope', () => {
    expect(CANADA_ENVELOPE).toEqual({ minLat: 41.5, maxLat: 83.5, minLon: -141.5, maxLon: -52 });
  });
  it('maps the origin to (0, 0)', () => {
    const o = { lat: 52, lon: -106 };
    expect(toLocalM(o, o, 52)).toEqual({ x: 0, y: 0 });
  });
  it('uses the per-degree scales: east is +x, north is +y', () => {
    const o = { lat: 52, lon: -106 };
    const s = metresPerDegree(52);
    const xy = toLocalM(o, { lat: 52.001, lon: -105.999 }, 52);
    expect(xy.x).toBeCloseTo(0.001 * s.lonM, 9);
    expect(xy.y).toBeCloseTo(0.001 * s.latM, 9);
  });
  it('fromLocalM inverts toLocalM', () => {
    const o = { lat: 60, lon: -120 };
    const p = { lat: 60.01, lon: -120.02 };
    const back = fromLocalM(o, toLocalM(o, p, 60.005), 60.005);
    expect(back.lat).toBeCloseTo(p.lat, 12);
    expect(back.lon).toBeCloseTo(p.lon, 12);
  });
  it('rejects scaleLat of 90 and out-of-range points', () => {
    const o = { lat: 52, lon: -106 };
    const bad = expect.objectContaining({ code: 'LAT_OUT_OF_RANGE' }) as unknown;
    expect(() => toLocalM(o, o, 90)).toThrow(bad);
    expect(() => fromLocalM(o, { x: 0, y: 0 }, -90)).toThrow(bad);
    expect(() => toLocalM(o, { lat: -106.67, lon: 52.13 }, 52)).toThrow(bad);
    expect(() => fromLocalM({ lat: 521300000, lon: 0 }, { x: 0, y: 0 }, 52)).toThrow(bad);
  });
  it('rejects a non-finite scale latitude', () => {
    const o = { lat: 52, lon: -106 };
    expect(() => toLocalM(o, o, Number.NaN)).toThrow(
      expect.objectContaining({ code: 'NON_FINITE' }),
    );
  });
});
