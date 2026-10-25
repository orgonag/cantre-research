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
export { NEAR_TIE_TOLERANCE_M, cumulativeLengthsM, projectOntoPolyline } from './polyline.js';
export type { Polyline, PolylineProjection } from './polyline.js';
export { validateInterval } from './anchors.js';
export type {
  Anchor,
  AnchorSource,
  AnchorTier,
  IntervalIssue,
  IntervalIssueCode,
} from './anchors.js';
export { interpolateMilepost } from './interpolate.js';
export type { MilepostResult, UncalibratedReason } from './interpolate.js';
export { gpsMilepostBandMi } from './uncertainty.js';
export { axialDifferenceDeg, bearingDeg } from './bearing.js';
export { MATCH_CONFIG } from './match/config.js';
export type { MatchConfig } from './match/config.js';
export { MATCH_REASONS, MATCH_STATUSES } from './match/reasons.js';
export type { MatchReason, MatchStatus } from './match/reasons.js';
export { networkFromTiles } from './network/decode.js';
export { SNAPSHOT_FORMAT_VERSION, networkFromSnapshot } from './network/snapshot.js';
export type {
  AssetKind,
  AssetPosition,
  AssetPosted,
  DiamondPosition,
  NetworkAsset,
  NetworkChain,
  NetworkInterval,
  NetworkSegment,
  NetworkView,
  TileBounds,
} from './network/types.js';
export { assetsAlong } from './lookup/assets.js';
export type { AssetAlong } from './lookup/assets.js';
export { locateMilepost, milepostAtPoint } from './lookup/locate.js';
export type { LocatedMilepost, PointMilepost } from './lookup/locate.js';
export { coverageOf, diamondsNear, findCandidates, searchRadiusM } from './match/candidates.js';
export type { Candidate, Fix } from './match/candidates.js';
export { lowerTier, milepostFor } from './match/milepost.js';
export type { CandidateMilepost } from './match/milepost.js';
export { selectCandidate } from './match/select.js';
export type { Lock, PreviousMatch, Selection, SelectionInput } from './match/select.js';
export type { Result } from './match/result.js';
export { currentResult, initialMatchState, reduce } from './match/machine.js';
export type { MatchEvent, MatchState } from './match/machine.js';
