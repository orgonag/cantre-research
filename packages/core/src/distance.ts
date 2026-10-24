import type { LatLon } from './coords.js';
import { assertLatLonRange, toLocalM } from './coords.js';

/** Longest segment treated as a single tangent-plane patch, in metres (spec §6: 2 km). */
const MAX_PATCH_M = 2000;

/** Planar length (m) of a->b on the tangent plane scaled at the pair's mid-latitude. */
function planarLengthM(a: LatLon, b: LatLon): number {
  const midLat = (a.lat + b.lat) / 2; // scale at the mid-latitude cancels the first-order drift
  const { x, y } = toLocalM(a, b, midLat);
  return Math.hypot(x, y);
}

/**
 * Ellipsoidal (GRS80) distance between two positions, in metres.
 *
 * Method: tangent-plane approximation. For a patch a->b, d = sqrt(dx^2 + dy^2) with
 * dx = (lonB - lonA) * N(phi_m) cos(phi_m) * pi/180 and dy = (latB - latA) * M(phi_m) * pi/180,
 * all scales taken at the mid-latitude phi_m = (latA + latB)/2. If that length exceeds 2000 m the
 * segment is split into n = ceil(L/2000) equal parts by linear interpolation in lat/lon and the
 * planar part lengths are summed, so no curvature is invented (spec §6: subdivided for distance
 * only).
 * Units: degrees in, metres out. Source: spec §6 (Geodesy), cross-checked against GeographicLib.
 * Error bound: for a segment along a parallel the tangent-plane error is about
 * L^3 tan^2(phi) / (24 R^2) with R about 6.4e6 m (the same-parallel approximation, not the worst
 * case). Measured worst case against GeographicLib for L = 2 km: 0.734 mm at lat 83.5 deg,
 * azimuth 56 deg (deterministic sweep, lat 80-83.5 x azimuth 0-359; 50000 seeded random draws
 * peaked at 0.660 mm; reproduce with scripts/measure-distance-error.mjs via
 * `npm run measure:distance -w @cantre/core`), so the 1 mm target holds with about 27 % margin at the envelope edge and
 * is far tighter at lower latitudes. Subdividing keeps each patch under 2 km, but the
 * interpolation path is a straight line in lat/lon, which differs from the true geodesic by a
 * second-order amount: 50 km at 45 deg azimuth is within 0.05 % (tested), and 50 km due east at
 * lat 83 measured 1.69e-4 relative (same script).
 * Limits: no antimeridian wrap. Both points are checked with `assertLatLonRange` (finite, |lat| <= 90,
 * |lon| <= 180) but not against the Canada envelope, so a segment may end slightly outside it. The
 * range check also stops unit blunders (E7 integers, swapped lat/lon) before the subdivision count
 * is computed. Throws `CoreInputError` (`NON_FINITE`, `LAT_OUT_OF_RANGE`, `LON_OUT_OF_RANGE`).
 */
export function distanceM(a: LatLon, b: LatLon): number {
  assertLatLonRange(a); // rejects unit blunders before the subdivision count is computed
  assertLatLonRange(b);
  const rough = planarLengthM(a, b);
  if (rough <= MAX_PATCH_M) {
    return rough;
  }
  const n = Math.ceil(rough / MAX_PATCH_M); // number of equal sub-segments
  let total = 0;
  let prev = a;
  for (let i = 1; i <= n; i += 1) {
    const f = i / n; // fraction of the way from a to b
    const next: LatLon =
      i === n ? b : { lat: a.lat + f * (b.lat - a.lat), lon: a.lon + f * (b.lon - a.lon) };
    total += planarLengthM(prev, next);
    prev = next;
  }
  return total;
}
