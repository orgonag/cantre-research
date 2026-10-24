import { assertFinite } from './units.js';

/**
 * Parameters of the GRS80 reference ellipsoid.
 *
 * - `a`: semi-major axis, 6378137 m (exact, by definition).
 * - `f`: flattening, 1/298.257222101 (dimensionless; the GRS80 defining value).
 * - `e2`: first eccentricity squared, e^2 = f * (2 - f) (dimensionless), about 0.00669438.
 *
 * Source: Moritz (1980), "Geodetic Reference System 1980"; CANTRE spec §6 (Geodesy).
 * Limits: NAD83(CSRS), the datum of Canadian track data, uses GRS80. WGS84 differs from GRS80 in
 * the flattening by about 1.6e-10 (sub-millimetre at these scales), but this module is GRS80 only.
 */
export const GRS80: { readonly a: number; readonly f: number; readonly e2: number } = (() => {
  const a = 6378137;
  const f = 1 / 298.257222101;
  // e^2 = 1 - b^2/a^2 with b = a(1 - f)  =>  e^2 = 2f - f^2 = f(2 - f).
  return { a, f, e2: f * (2 - f) };
})();

/**
 * Shared denominator term W^2 = 1 - e^2 sin^2(phi); every radius below is a power of it.
 * Throws `NON_FINITE` if `latDeg` is NaN or infinite. Units: degrees in, dimensionless out.
 */
function w2(latDeg: number): number {
  assertFinite(latDeg, 'latitude');
  const s = Math.sin((latDeg * Math.PI) / 180); // degrees to radians
  return 1 - GRS80.e2 * s * s;
}

/**
 * Meridional radius of curvature M (radius of the north-south arc) at a latitude.
 *
 * Formula: M = a (1 - e^2) / (1 - e^2 sin^2 phi)^(3/2). Units: latitude in degrees, M in metres.
 * Source: standard ellipsoidal geometry (e.g. Torge and Mueller, Geodesy, 4th ed., ch. 3);
 * CANTRE spec §6.
 * Error bound: closed form, so only floating-point rounding (about 1e-9 m).
 * Limits: valid for any finite latitude; M is 6335439.327 m at the equator and equals N at the pole.
 * Throws `CoreInputError('NON_FINITE')` for NaN or infinite input.
 */
export function meridionalRadiusM(latDeg: number): number {
  return (GRS80.a * (1 - GRS80.e2)) / Math.pow(w2(latDeg), 1.5);
}

/**
 * Prime-vertical radius of curvature N (radius of the east-west normal section) at a latitude.
 *
 * Formula: N = a / (1 - e^2 sin^2 phi)^(1/2). Units: latitude in degrees, N in metres.
 * Source: standard ellipsoidal geometry (as for {@link meridionalRadiusM}); CANTRE spec §6.
 * Error bound: closed form, so only floating-point rounding (about 1e-9 m).
 * Limits: valid for any finite latitude; N equals a at the equator.
 * Throws `CoreInputError('NON_FINITE')` for NaN or infinite input.
 */
export function primeVerticalRadiusM(latDeg: number): number {
  return GRS80.a / Math.sqrt(w2(latDeg));
}

/**
 * Local ground scale: metres per degree of latitude and of longitude at a latitude.
 *
 * Formulas: latM = M(phi) * pi/180 (north-south), lonM = N(phi) cos(phi) * pi/180 (east-west).
 * N cos(phi) is the radius of the parallel, so an east-west degree shrinks with cos(phi).
 * Units: latitude in degrees in; both outputs in metres per degree.
 * Source: spec §6 (Geodesy): east-west scale is N(phi) cos(phi), north-south scale is M(phi).
 * Error bound: closed form (rounding only). The scales are exact at `latDeg` and drift away from
 * it; callers pick the segment mid-latitude so the drift cancels to first order.
 * Limits: lonM tends to 0 at the poles. Throws `NON_FINITE` for NaN or infinite input.
 */
export function metresPerDegree(latDeg: number): { latM: number; lonM: number } {
  const radPerDeg = Math.PI / 180;
  return {
    latM: meridionalRadiusM(latDeg) * radPerDeg,
    lonM: primeVerticalRadiusM(latDeg) * Math.cos(latDeg * radPerDeg) * radPerDeg,
  };
}
