import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  interpolateMilepost,
  projectOntoPolyline,
  projectOntoSegment,
  toLocalM,
} from '../src/index.js';
import type { Anchor, LatLon } from '../src/index.js';
import { atMetres } from './helpers/local.js';

/** Generated cases per property (task brief). */
const NUM_RUNS = 1000;

// Arbitraries are linearly mapped integers: fc.double ranges sample by bit pattern and would
// miss most of the domain. Margins keep a 5 km offset inside the Canada envelope.
const latArb = fc.integer({ min: 42_000_000, max: 83_000_000 }).map((x) => x / 1e6);
const lonArb = fc.integer({ min: -140_500_000, max: -53_000_000 }).map((x) => x / 1e6);
const originArb = fc.record({ lat: latArb, lon: lonArb });
const lengthArb = fc.integer({ min: 1_000, max: 2_000_000 }).map((x) => x / 1e3); // m
const azimuthArb = fc.integer({ min: 0, max: 359_999 }).map((x) => (x / 1e3) * (Math.PI / 180)); // rad
const unitArb = fc.integer({ min: 0, max: 1_000_000 }).map((x) => x / 1e6); // [0, 1]
const offsetArb = fc.integer({ min: -5_000_000, max: 5_000_000 }).map((x) => x / 1e3); // m

/** End point of a segment from `a`, `lengthM` metres away on bearing `az` (rad from north). */
function endOf(a: LatLon, lengthM: number, az: number): LatLon {
  return atMetres(a, lengthM * Math.sin(az), lengthM * Math.cos(az));
}

/** Point at fraction `f` along a-to-b (tangent-plane metres) and `off` metres to the left. */
function placeAt(a: LatLon, lengthM: number, az: number, f: number, off: number): LatLon {
  const east = f * lengthM * Math.sin(az) - off * Math.cos(az);
  const north = f * lengthM * Math.cos(az) + off * Math.sin(az);
  return atMetres(a, east, north);
}

describe('property: perpendicular residual', () => {
  it('residual is perpendicular for interior projections', () => {
    fc.assert(
      fc.property(originArb, lengthArb, azimuthArb, unitArb, offsetArb, (a, len, az, f, off) => {
        const b = endOf(a, len, az);
        const p = placeAt(a, len, az, 0.02 + 0.96 * f, off);
        const r = projectOntoSegment(p, a, b);
        fc.pre(r.clamped === 'none');
        const scaleLat = (a.lat + b.lat) / 2;
        const d = toLocalM(a, b, scaleLat);
        const v = toLocalM(a, p, scaleLat);
        const q = toLocalM(a, r.point, scaleLat);
        const res = { x: v.x - q.x, y: v.y - q.y };
        const resLen = Math.hypot(res.x, res.y);
        if (resLen < 1e-6) {
          return;
        }
        const cos = Math.abs(res.x * d.x + res.y * d.y) / (resLen * Math.hypot(d.x, d.y));
        expect(cos).toBeLessThan(1e-6);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('property: monotonic alongM', () => {
  it('alongM is non-decreasing as a point moves forward along a straight line', () => {
    fc.assert(
      fc.property(
        originArb,
        lengthArb,
        azimuthArb,
        fc.array(fc.integer({ min: -200_000, max: 1_200_000 }), { minLength: 2, maxLength: 12 }),
        offsetArb,
        (a, len, az, steps, off) => {
          const b = endOf(a, len, az);
          const line = [a, b];
          const sorted = [...steps].sort((x, y) => x - y);
          let prev = -Infinity;
          for (const s of sorted) {
            const p = placeAt(a, len, az, s / 1e6, off);
            const r = projectOntoPolyline(p, line);
            expect(r.alongM).toBeGreaterThanOrEqual(prev - 1e-6);
            prev = r.alongM;
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

/** Strictly increasing positions with strictly monotonic mileposts, in either direction. */
const intervalArb = fc
  .record({
    s0: fc.integer({ min: 0, max: 1_000_000 }).map((x) => x / 10),
    mp0: fc.integer({ min: -10_000, max: 400_000 }).map((x) => x / 1000),
    sign: fc.constantFrom(1, -1),
    steps: fc.array(
      fc.record({
        ds: fc.integer({ min: 1, max: 5_000_000 }).map((x) => x / 1e3), // m
        dmp: fc.integer({ min: 1, max: 5_000 }).map((x) => x / 1000), // mi
      }),
      { minLength: 1, maxLength: 8 },
    ),
  })
  .map(({ s0, mp0, sign, steps }): Anchor[] => {
    let s = s0;
    let mp = mp0;
    const anchors: Anchor[] = [{ id: 'a0', s, mp, source: 'crossing' }];
    steps.forEach((st, i) => {
      s += st.ds;
      mp += sign * st.dmp;
      anchors.push({ id: `a${String(i + 1)}`, s, mp, source: 'crossing' });
    });
    return anchors;
  });

describe('property: interpolation', () => {
  it('reproduces anchors and stays between bracket mileposts', () => {
    fc.assert(
      fc.property(intervalArb, unitArb, (anchors, u) => {
        for (const x of anchors) {
          const hit = interpolateMilepost(x.s, anchors);
          expect(hit).toMatchObject({ kind: 'calibrated', mp: x.mp });
        }
        const first = anchors[0];
        const last = anchors[anchors.length - 1];
        if (first === undefined || last === undefined) {
          throw new Error('generator produced an empty interval');
        }
        const s = first.s + u * (last.s - first.s);
        const r = interpolateMilepost(s, anchors);
        if (r.kind !== 'calibrated') {
          throw new Error(`expected calibrated, got ${r.reason}`);
        }
        const lo = Math.min(r.lower.mp, r.upper.mp);
        const hi = Math.max(r.lower.mp, r.upper.mp);
        expect(r.mp).toBeGreaterThanOrEqual(lo - 1e-9);
        expect(r.mp).toBeLessThanOrEqual(hi + 1e-9);
        expect(r.lower.s).toBeLessThanOrEqual(s);
        expect(r.upper.s).toBeGreaterThanOrEqual(s);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('property: finite outputs', () => {
  it('never returns NaN or Infinity for valid input', () => {
    fc.assert(
      fc.property(
        originArb,
        fc.array(fc.tuple(lengthArb, azimuthArb), { minLength: 1, maxLength: 5 }),
        unitArb,
        offsetArb,
        (a, legs, f, off) => {
          const line: LatLon[] = [a];
          let last = a;
          for (const [len, az] of legs) {
            last = endOf(last, len, az);
            line.push(last);
          }
          const mid = line[Math.floor(line.length / 2)] ?? a;
          const p = atMetres(mid, off, f * 1000);
          const r = projectOntoPolyline(p, line);
          const numbers = [
            r.t,
            r.point.lat,
            r.point.lon,
            r.crossTrackM,
            r.alongM,
            r.totalLengthM,
            ...r.nearTieAlongM,
          ];
          for (const n of numbers) {
            expect(Number.isFinite(n)).toBe(true);
          }
          const anchors: Anchor[] = [
            { id: 'start', s: 0, mp: 10, source: 'station' },
            { id: 'end', s: r.totalLengthM, mp: 10 + r.totalLengthM / 1609.344, source: 'station' },
          ];
          const m = interpolateMilepost(r.alongM, anchors);
          if (m.kind !== 'calibrated') {
            throw new Error(`expected calibrated, got ${m.reason}`);
          }
          expect(Number.isFinite(m.mp)).toBe(true);
          expect(Number.isFinite(m.intervalLengthM)).toBe(true);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
