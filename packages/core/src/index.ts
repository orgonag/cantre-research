export { CoreInputError } from './errors.js';
export type { CoreInputCode } from './errors.js';
export { METRES_PER_MILE, metresToMiles, milesToKilometres, milesToMetres } from './units.js';
export { GRS80, meridionalRadiusM, metresPerDegree, primeVerticalRadiusM } from './ellipsoid.js';
export {
  CANADA_ENVELOPE,
  assertLatLon,
  assertLatLonRange,
  fromLocalM,
  toLocalM,
} from './coords.js';
export type { LatLon } from './coords.js';
export { distanceM } from './distance.js';
export { projectOntoSegment } from './segment.js';
export type { SegmentProjection } from './segment.js';
