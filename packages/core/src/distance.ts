import type { LatLon } from './coords.js';
import { toLocalM } from './coords.js';
import { assertFinite } from './units.js';

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
 * Error bound: per patch about L^3 tan^2(phi) / (24 R^2) with R about 6.4e6 m, i.e. below 1 mm for
 * L <= 2 km up to 83.5 deg N (tested against GeographicLib over 2000 random cases). Subdividing
 * keeps each patch under 2 km, but the interpolation path is a straight line in lat/lon, which
 * differs from the true geodesic by a second-order amount: 50 km at 45 deg azimuth is within
 * 0.05 % (tested).
 * Limits: no antimeridian wrap; no Canada-envelope check (only finiteness), so a segment may end
 * slightly outside the envelope. Throws `CoreInputError('NON_FINITE')` for NaN or infinite input.
 */
export function distanceM(a: LatLon, b: LatLon): number {
  assertFinite(a.lat, 'a.lat');
  assertFinite(a.lon, 'a.lon');
  assertFinite(b.lat, 'b.lat');
  assertFinite(b.lon, 'b.lon');
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
