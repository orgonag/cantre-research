/**
 * Test-only reference geodesy. Never import this from `src/`: `@cantre/core` has zero runtime
 * dependencies, and GeographicLib is a dev dependency used purely as an independent oracle.
 *
 * Source: GeographicLib (Karney 2013, "Algorithms for geodesics", J. Geodesy 87, 43-55), which
 * solves the direct and inverse geodesic problems to about 15 nm on any ellipsoid.
 * Limits: results are only as good as the ellipsoid parameters passed in; GRS80 is built
 * explicitly here (a = 6378137 m, f = 1/298.257222101) and WGS84 is deliberately not used.
 */
import { Geodesic } from 'geographiclib-geodesic';
import type { LatLon } from '../../src/index.js';

/** GRS80 geodesic solver: a = 6378137 m, f = 1/298.257222101. */
const grs80 = new Geodesic.Geodesic(6378137, 1 / 298.257222101);

/**
 * Exact (to ~15 nm) geodesic distance between two points on GRS80.
 * Units: degrees in, metres out.
 */
export function geodesicDistanceM(a: LatLon, b: LatLon): number {
  const r = grs80.Inverse(a.lat, a.lon, b.lat, b.lon, Geodesic.DISTANCE);
  if (r.s12 === undefined) {
    throw new Error('GeographicLib returned no distance');
  }
  return r.s12;
}

/**
 * Point reached from `a` after travelling `distanceM` metres along a geodesic that leaves at
 * `azimuthDeg` (degrees clockwise from true north) on GRS80.
 */
export function geodesicDirect(a: LatLon, azimuthDeg: number, distanceM: number): LatLon {
  const r = grs80.Direct(
    a.lat,
    a.lon,
    azimuthDeg,
    distanceM,
    Geodesic.LATITUDE | Geodesic.LONGITUDE,
  );
  if (r.lat2 === undefined || r.lon2 === undefined) {
    throw new Error('GeographicLib returned no endpoint');
  }
  return { lat: r.lat2, lon: r.lon2 };
}
