import type { LatLon } from './coords.js';
import { assertLatLon, fromLocalM, toLocalM } from './coords.js';
import { distanceM } from './distance.js';

/** Result of projecting a position onto one straight track segment. */
export type SegmentProjection = {
  /** Clamped projection fraction in [0, 1]: 0 is `a`, 1 is `b`. Dimensionless. */
  readonly t: number;
  /** The projected point Q on the segment (equals `a` or `b` when clamped). Degrees. */
  readonly point: LatLon;
  /**
   * Straight-line distance from the position to `point`, in metres. A geometric residual only:
   * it is NOT GPS precision, a confidence interval or survey accuracy.
   */
  readonly crossTrackM: number;
  /** Distance from `a` to `point` along the segment, `t * segmentLengthM`, in metres. */
  readonly alongSegmentM: number;
  /** Length of the segment a->b, in metres (from {@link distanceM}). */
  readonly segmentLengthM: number;
  /** Which end the raw projection was clamped to; `'none'` for an interior projection. */
  readonly clamped: 'none' | 'start' | 'end';
};

/**
 * Projects position `p` onto the straight segment `a`->`b`, clamped to the segment.
 *
 * Method (docs/PROJECTION.md "One segment, step by step", steps 1-6; spec §6): work in the
 * tangent plane centred on `a` with scales taken at the segment mid-latitude, in metres.
 *   D = B - A, V = P - A, t_raw = (V . D) / (D . D), t = clamp(t_raw, 0, 1),
 *   Q = A + t D, crossTrackM = |P - Q|, alongSegmentM = t * segmentLengthM.
 * Clamping stops the projection inventing a point beyond the represented segment: `clamped` is
 * `'start'` when t_raw < 0 and `'end'` when t_raw > 1. For an interior projection (P - Q) is
 * perpendicular to D.
 * Units: degrees in (`p`, `a`, `b`), metres out (`crossTrackM`, `alongSegmentM`,
 * `segmentLengthM`), `t` dimensionless, `point` in degrees.
 * Zero-length segment (D . D = 0, i.e. `a` equals `b`): no division; the pair is treated as the
 * point candidate Q = A with t = 0, `alongSegmentM` = 0, `clamped` = `'none'` (there is no
 * direction to clamp against), and `crossTrackM` is the distance to `a`.
 * Error bound: the tangent-plane approximation is the same as {@link toLocalM}, below 1 mm for
 * segments up to 2 km at the mid-latitude scale. `segmentLengthM` uses {@link distanceM}, which
 * subdivides long segments. Test: 5 km off a 1.5 km segment at 55 deg N, the residual agrees with
 * GeographicLib within 0.1 % of the offset.
 * Limits: valid for track-scale segments (the plane is not a survey-grade projection); the
 * residual is a geometric quantity, not survey accuracy. No antimeridian wrap. All three points
 * are checked with `assertLatLon` (finite, in range, inside the Canada envelope). Throws
 * `CoreInputError` (`NON_FINITE`, `LAT_OUT_OF_RANGE`, `LON_OUT_OF_RANGE`,
 * `OUTSIDE_CANADA_ENVELOPE`).
 */
export function projectOntoSegment(p: LatLon, a: LatLon, b: LatLon): SegmentProjection {
  assertLatLon(p);
  assertLatLon(a);
  assertLatLon(b);

  const scaleLat = (a.lat + b.lat) / 2; // segment mid-latitude, deg
  const segmentLengthM = distanceM(a, b); // m, subdivided for long segments

  // Step 1: direction D = B - A and offset V = P - A, in metres east (x) and north (y) of A.
  const d = toLocalM(a, b, scaleLat);
  const v = toLocalM(a, p, scaleLat);

  // Step 2: squared segment length D . D (m^2); zero means a degenerate (point) segment.
  const dd = d.x * d.x + d.y * d.y;

  // Steps 3 and 4: unbounded fraction t_raw = (V . D) / (D . D), then clamp to the segment.
  let t = 0;
  let clamped: SegmentProjection['clamped'] = 'none';
  if (dd > 0) {
    const tRaw = (v.x * d.x + v.y * d.y) / dd;
    if (tRaw < 0) {
      t = 0;
      clamped = 'start';
    } else if (tRaw > 1) {
      t = 1;
      clamped = 'end';
    } else {
      t = tRaw;
    }
  }

  // Step 5: projected point Q = A + t D (exactly a or b when clamped, avoiding round-off).
  const q = { x: t * d.x, y: t * d.y };
  const point: LatLon = t === 0 ? a : t === 1 ? b : fromLocalM(a, q, scaleLat);

  // Step 6: residual |P - Q| (m) and distance along the segment, t * length (m).
  const crossTrackM = Math.hypot(v.x - q.x, v.y - q.y);
  const alongSegmentM = t * segmentLengthM;

  return { t, point, crossTrackM, alongSegmentM, segmentLengthM, clamped };
}
