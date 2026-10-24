/**
 * Test-only helper: places a point a given number of metres east and north of an origin.
 *
 * Method: the inverse of the tangent-plane projection, `fromLocalM`, with the scales taken at the
 * origin's own latitude. Units: metres in, degrees out. Source: spec §6.
 * Limits: a tangent-plane placement, not a geodesic one; fine for the few-metre worked examples
 * in docs/PROJECTION.md, not for building long survey-grade baselines (use `geodesicDirect`).
 */
import { fromLocalM } from '../../src/index.js';
import type { LatLon } from '../../src/index.js';

/** Point `eastM` metres east and `northM` metres north of `origin`. */
export function atMetres(origin: LatLon, eastM: number, northM: number): LatLon {
  return fromLocalM(origin, { x: eastM, y: northM }, origin.lat);
}
