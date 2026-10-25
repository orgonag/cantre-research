/** Tunable thresholds of the matching state machine. All fields experimental, see below. */
export type MatchConfig = {
  /** Search radius floor, metres. Spec §6: radius = max(50 m, 3 x accuracy). Experimental. */
  readonly searchRadiusMinM: number;
  /** Multiplier on reported GPS accuracy for the search radius, unitless. Spec §6. Experimental. */
  readonly searchRadiusAccuracyFactor: number;
  /**
   * Floor on the indistinguishability margin, metres. Spec §6: a candidate is indistinguishable
   * when within d_min + max(accuracy, 10 m). Experimental.
   */
  readonly indistinguishableMinM: number;
  /** Age of the last fix after which the result becomes STALE, milliseconds. Experimental. */
  readonly staleAfterMs: number;
  /** Speed above which the heading is trusted for the heading filter, metres per second. Experimental. */
  readonly headingMinSpeedMps: number;
  /** Largest axial difference between heading and track bearing, degrees. Decision 2. Experimental. */
  readonly headingToleranceDeg: number;
  /** Longest hold on a previous match that new fixes contradict, milliseconds. Decision 3. Experimental. */
  readonly continuityMaxMs: number;
  /**
   * How far ahead of the caller's clock a fix timestamp may be before it is treated as coming
   * from the future, milliseconds. Absorbs small clock skew between the device location clock and
   * the caller's clock; beyond it the result is STALE with FIX_FROM_FUTURE (ruling R20). Experimental.
   */
  readonly futureFixToleranceMs: number;
};

/**
 * Default matching thresholds, deeply frozen (every field is a primitive, so one freeze is deep).
 *
 * Experimental: these are engineering starting points from spec §6 and the controller decisions,
 * not validated values. Changing one changes which fixes are called ambiguous, so any change
 * needs a new evidence run. Units are in each field's name (M metres, Ms milliseconds, Mps m/s,
 * Deg degrees).
 */
export const MATCH_CONFIG: MatchConfig = Object.freeze({
  searchRadiusMinM: 50,
  searchRadiusAccuracyFactor: 3,
  indistinguishableMinM: 10,
  staleAfterMs: 15000,
  headingMinSpeedMps: 3,
  headingToleranceDeg: 30,
  continuityMaxMs: 5000,
  futureFixToleranceMs: 1000,
});
