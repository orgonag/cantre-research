import { CoreInputError } from './errors.js';
import { metresPerDegree } from './ellipsoid.js';
import { assertFinite } from './units.js';

/**
 * A geographic position in decimal degrees: latitude positive north, longitude positive east
 * (so western Canada is negative). Datum NAD83(CSRS) / GRS80.
 */
export type LatLon = { readonly lat: number; readonly lon: number };

/**
 * Deliberate v1 scope guard: a bounding box around Canada, in degrees.
 *
 * Source: CANTRE spec §6 (input validation); v1 covers Canadian rail only.
 * Limits: this is a coarse rectangle, not the national border, so it catches the common blunders
 * (swapped lat/lon, positive-west longitude, a wrong continent) but not a point in the US inside
 * the box. It is a guard against typos, not a geofence; widening it is a spec change.
 */
export const CANADA_ENVELOPE = {
  minLat: 41.5,
  maxLat: 83.5,
  minLon: -141.5,
  maxLon: -52,
} as const;

/**
 * Validates a position, failing loudly instead of repairing it.
 *
 * Check order (the first failure wins, so the code names the most basic problem):
 * 1. both coordinates finite -> else `NON_FINITE`;
 * 2. |lat| <= 90 -> else `LAT_OUT_OF_RANGE` (also what a swapped lat/lon usually trips);
 * 3. |lon| <= 180 -> else `LON_OUT_OF_RANGE`;
 * 4. inside {@link CANADA_ENVELOPE} -> else `OUTSIDE_CANADA_ENVELOPE` (e.g. positive-west lon).
 *
 * Units: degrees. Source: spec §6. Limits: see {@link CANADA_ENVELOPE}. The envelope is
 * inclusive of its boundary. Throws `CoreInputError`.
 */
export function assertLatLon(p: LatLon): void {
  assertFinite(p.lat, 'lat');
  assertFinite(p.lon, 'lon');
  if (Math.abs(p.lat) > 90) {
    throw new CoreInputError(
      'LAT_OUT_OF_RANGE',
      `lat must be within [-90, 90], got ${String(p.lat)}`,
    );
  }
  if (Math.abs(p.lon) > 180) {
    throw new CoreInputError(
      'LON_OUT_OF_RANGE',
      `lon must be within [-180, 180], got ${String(p.lon)}`,
    );
  }
  const e = CANADA_ENVELOPE;
  if (p.lat < e.minLat || p.lat > e.maxLat || p.lon < e.minLon || p.lon > e.maxLon) {
    throw new CoreInputError(
      'OUTSIDE_CANADA_ENVELOPE',
      `(${String(p.lat)}, ${String(p.lon)}) is outside the Canada envelope; longitude is negative west of Greenwich`,
    );
  }
}

/**
 * Projects a position into a local equirectangular tangent plane centred on `origin`.
 *
 * Formulas: x = (lon - lon0) * lonM(scaleLat), y = (lat - lat0) * latM(scaleLat), where lonM and
 * latM are metres per degree from {@link metresPerDegree}. x is metres east, y metres north.
 * Units: degrees in (origin, p and scaleLat), metres out.
 * Source: spec §6 (segment-local tangent plane, scales at the segment mid-latitude).
 * Error bound: for a segment of length L at latitude phi the neglected curvature gives about
 * L^3 tan^2(phi) / (24 R^2) (R about 6.4e6 m); that is below 1 mm for L <= 2 km up to 83.5 deg
 * when `scaleLat` is the mid-latitude. It grows as L^3, so long lines must be subdivided.
 * Limits: no longitude wrap handling (Canada does not straddle the antimeridian); no envelope
 * check, so callers validate with {@link assertLatLon} where required. Throws `NON_FINITE`.
 */
export function toLocalM(origin: LatLon, p: LatLon, scaleLat: number): { x: number; y: number } {
  assertFinite(origin.lat, 'origin.lat');
  assertFinite(origin.lon, 'origin.lon');
  assertFinite(p.lat, 'lat');
  assertFinite(p.lon, 'lon');
  const s = metresPerDegree(scaleLat); // also rejects a non-finite scaleLat
  return { x: (p.lon - origin.lon) * s.lonM, y: (p.lat - origin.lat) * s.latM };
}

/**
 * Inverse of {@link toLocalM}: local metres back to a position.
 *
 * Formulas: lon = lon0 + x / lonM(scaleLat), lat = lat0 + y / latM(scaleLat).
 * Units: metres east/north in, degrees out. Source: spec §6.
 * Error bound: exact inverse of `toLocalM` for the same `origin` and `scaleLat` (rounding only,
 * about 1e-12 degrees); the tangent-plane error bound there applies to the physical meaning.
 * Limits: lonM tends to 0 at the poles, so the result is meaningless at |scaleLat| = 90.
 * Throws `NON_FINITE`.
 */
export function fromLocalM(
  origin: LatLon,
  xy: { readonly x: number; readonly y: number },
  scaleLat: number,
): LatLon {
  assertFinite(origin.lat, 'origin.lat');
  assertFinite(origin.lon, 'origin.lon');
  assertFinite(xy.x, 'x');
  assertFinite(xy.y, 'y');
  const s = metresPerDegree(scaleLat);
  return { lat: origin.lat + xy.y / s.latM, lon: origin.lon + xy.x / s.lonM };
}
