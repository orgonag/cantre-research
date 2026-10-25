import { toLocalM } from './coords.js';
import type { LatLon } from './coords.js';

/**
 * Initial bearing from `a` to `b` on the local tangent plane, in degrees clockwise from north.
 *
 * Formula: with (x, y) = `toLocalM(a, b, midLat)` (x metres east, y metres north, scales taken at
 * the mid-latitude of the two points, the same plane the M1 segment projection uses), the
 * bearing is atan2(x, y), converted to degrees and normalised to [0, 360).
 * Units: degrees in, degrees out. Source: CANTRE v1 spec §6 (heading filter).
 * Limits: a plane bearing, not a geodesic azimuth; the difference is negligible over the
 * sub-kilometre spans used to read a track direction, and it is not meant for long baselines.
 * Coincident points have no direction: the result is 0 (north), never NaN, so callers must not
 * call this on a zero-length span and read meaning into it. Throws `CoreInputError` on invalid
 * positions (via `toLocalM`).
 */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const midLat = (a.lat + b.lat) / 2; // degrees; scale latitude for the tangent plane
  const { x, y } = toLocalM(a, b, midLat);
  if (x === 0 && y === 0) {
    return 0;
  }
  const deg = (Math.atan2(x, y) * 180) / Math.PI; // atan2(east, north): clockwise from north
  const wrapped = ((deg % 360) + 360) % 360; // into [0, 360)
  // A tiny negative `deg` can round `wrapped` up to exactly 360; fold that back to 0.
  return wrapped >= 360 ? 0 : wrapped;
}

/**
 * Axial (direction-agnostic) difference between two bearings, in degrees within [0, 90].
 *
 * Formula: d = |a - b| mod 180, then min(d, 180 - d). A train can run either way along a track,
 * so a bearing and its reverse are the same axis (spec §6 "direction-agnostic").
 * Units: degrees in (any finite values, not required to be normalised), degrees out.
 * Source: CANTRE v1 spec §6 (heading filter); controller decision 2 (heading tolerance).
 * Limits: a non-finite input returns NaN; callers validate bearings first. Two perpendicular
 * axes give exactly 90.
 */
export function axialDifferenceDeg(a: number, b: number): number {
  const d = Math.abs(a - b) % 180; // fold full turns and the reverse direction: [0, 180)
  return Math.min(d, 180 - d);
}
