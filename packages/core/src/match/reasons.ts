/**
 * Every reason code a match result can carry. A closed union: callers branch on the code and
 * never parse free text. Source: CANTRE v1 spec §6 and the M3 plan (Task 1).
 *
 * Availability:
 * - `PERMISSION_DENIED`: the user denied location permission.
 * - `LOCATION_UNAVAILABLE`: the device reported a location error (no hardware or signal).
 * - `NO_FIX_YET`: permission is granted but no accepted fix has arrived.
 * - `FIX_STALE`: the last accepted fix is older than `staleAfterMs`.
 * - `FIX_FROM_FUTURE`: the last accepted fix is timestamped more than `futureFixToleranceMs` ahead of the
 *   caller's clock (bad device clock); the result is STALE, never a current match.
 * - `FIX_IGNORED_OUT_OF_ORDER`: a fix's timestamp did not increase; it was ignored.
 * - `FIX_IGNORED_INVALID`: a fix had non-finite, out-of-envelope or negative-accuracy values; ignored.
 *
 * Network:
 * - `OUTSIDE_LOADED_TILES`: the fix lies outside every loaded tile.
 * - `PARTIAL_COVERAGE`: the search disk is only partly covered by loaded tiles.
 * - `NO_CANDIDATE_IN_RADIUS`: tiles are loaded but no track lies within the search radius.
 *
 * Selection:
 * - `DIAMOND_NEARBY`: a diamond (crossing of two lines) lies within the search radius.
 * - `MULTIPLE_ROUTES`: indistinguishable candidates belong to different subdivisions or operators.
 * - `MULTIPLE_TRACKS`: indistinguishable candidates are parallel tracks of one subdivision.
 * - `HEADING_USED`: the heading filter removed at least one candidate.
 * - `HEADING_INCONSISTENT`: the heading filter would remove every candidate, so it was not applied.
 * - `CONTINUITY`: the previous match resolved an ambiguity.
 * - `CONTINUITY_HOLD`: the previous match is held for a bounded time against contradicting fixes.
 *
 * Lock:
 * - `LOCKED_BY_USER`: the result came from the user's route or subdivision choice.
 * - `LOCK_NOT_SUPPORTED`: the lock names a chain or subdivision absent from the loaded network.
 *
 * Milepost:
 * - `DISCONTINUITY_GAP`: the position lies between two milepost intervals; nothing is bridged.
 * - `CHAIN_UNCALIBRATED`: the chain has no valid anchor interval.
 * - `TRACK_MP_DISAGREE`: parallel tracks of one subdivision give mileposts that differ too much.
 * - `TRACK_UNCALIBRATED`: at least one parallel track has no calibrated milepost.
 * - `UNCHAINED_TRACK`: the candidate is an unchained segment (siding, yard, spur) with no milepost.
 */
export type MatchReason =
  | 'PERMISSION_DENIED'
  | 'LOCATION_UNAVAILABLE'
  | 'NO_FIX_YET'
  | 'FIX_STALE'
  | 'FIX_FROM_FUTURE'
  | 'FIX_IGNORED_OUT_OF_ORDER'
  | 'FIX_IGNORED_INVALID'
  | 'OUTSIDE_LOADED_TILES'
  | 'PARTIAL_COVERAGE'
  | 'NO_CANDIDATE_IN_RADIUS'
  | 'DIAMOND_NEARBY'
  | 'MULTIPLE_ROUTES'
  | 'MULTIPLE_TRACKS'
  | 'HEADING_USED'
  | 'HEADING_INCONSISTENT'
  | 'CONTINUITY'
  | 'CONTINUITY_HOLD'
  | 'LOCKED_BY_USER'
  | 'LOCK_NOT_SUPPORTED'
  | 'DISCONTINUITY_GAP'
  | 'CHAIN_UNCALIBRATED'
  | 'TRACK_MP_DISAGREE'
  | 'TRACK_UNCALIBRATED'
  | 'UNCHAINED_TRACK';

/** Every {@link MatchReason}, each once, in declaration order. Source: spec §6. */
export const MATCH_REASONS: readonly MatchReason[] = [
  'PERMISSION_DENIED',
  'LOCATION_UNAVAILABLE',
  'NO_FIX_YET',
  'FIX_STALE',
  'FIX_FROM_FUTURE',
  'FIX_IGNORED_OUT_OF_ORDER',
  'FIX_IGNORED_INVALID',
  'OUTSIDE_LOADED_TILES',
  'PARTIAL_COVERAGE',
  'NO_CANDIDATE_IN_RADIUS',
  'DIAMOND_NEARBY',
  'MULTIPLE_ROUTES',
  'MULTIPLE_TRACKS',
  'HEADING_USED',
  'HEADING_INCONSISTENT',
  'CONTINUITY',
  'CONTINUITY_HOLD',
  'LOCKED_BY_USER',
  'LOCK_NOT_SUPPORTED',
  'DISCONTINUITY_GAP',
  'CHAIN_UNCALIBRATED',
  'TRACK_MP_DISAGREE',
  'TRACK_UNCALIBRATED',
  'UNCHAINED_TRACK',
];

/**
 * The nine match statuses of spec §6, a closed union.
 *
 * - `NO_PERMISSION`: location permission denied.
 * - `NO_FIX`: permitted, but no usable fix yet (or a location error).
 * - `STALE`: the last fix is too old; the last result is kept only as history.
 * - `NO_COVERAGE`: the fix is outside every loaded tile.
 * - `OFF_NETWORK`: covered, but no track within the search radius.
 * - `AMBIGUOUS_ROUTE`: more than one route is plausible (or a diamond is near); none is chosen.
 * - `MATCHED_SUBDIVISION`: one subdivision is certain but the parallel track is not.
 * - `MATCHED`: one track is selected by evidence or by the user.
 * - `LOCK_CONFLICT`: the user's lock does not fit the fix; the lock is kept, no milepost shown.
 */
export type MatchStatus =
  | 'NO_PERMISSION'
  | 'NO_FIX'
  | 'STALE'
  | 'NO_COVERAGE'
  | 'OFF_NETWORK'
  | 'AMBIGUOUS_ROUTE'
  | 'MATCHED_SUBDIVISION'
  | 'MATCHED'
  | 'LOCK_CONFLICT';

/** Every {@link MatchStatus}, each once. Source: spec §6. */
export const MATCH_STATUSES: readonly MatchStatus[] = [
  'NO_PERMISSION',
  'NO_FIX',
  'STALE',
  'NO_COVERAGE',
  'OFF_NETWORK',
  'AMBIGUOUS_ROUTE',
  'MATCHED_SUBDIVISION',
  'MATCHED',
  'LOCK_CONFLICT',
];
