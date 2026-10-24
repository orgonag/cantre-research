import type { Anchor } from './anchors.js';
import { CoreInputError } from './errors.js';
import { assertFinite } from './units.js';

/**
 * GPS-propagated milepost band, in miles: the milepost change that the reported GPS accuracy
 * radius could produce over the calibration interval.
 *
 * Formula (spec §6, "GPS-propagated MP band"): band = accuracyM · |mp₂ − mp₁| / (s₂ − s₁).
 * Units: `accuracyM` and `s` in metres; `mp` in miles; result in miles.
 *
 * This band is from GPS accuracy only; not a confidence interval. It does not model the
 * cross-track residual, the survey accuracy of the anchors, or the chance that the true position
 * lies outside the accuracy circle. Those are shown separately and never combined into one
 * interval (spec §6, "Uncertainty shown").
 *
 * Limits: assumes the position error moves the fix along the chain by `accuracyM`, with the
 * milepost slope taken over the bracketing interval. Throws `CoreInputError`, checked in this
 * order: `NON_FINITE` if `accuracyM` is NaN or infinite; `NEGATIVE_ACCURACY` if it is below 0;
 * `INVALID_INTERVAL` if an anchor's `s` or `mp` is not finite or if `upper.s` is not greater
 * than `lower.s`.
 */
export function gpsMilepostBandMi(accuracyM: number, lower: Anchor, upper: Anchor): number {
  assertFinite(accuracyM, 'accuracyM');
  if (accuracyM < 0) {
    throw new CoreInputError(
      'NEGATIVE_ACCURACY',
      `accuracyM must be >= 0, got ${String(accuracyM)}`,
    );
  }
  const finite = [lower.s, lower.mp, upper.s, upper.mp].every((v) => Number.isFinite(v));
  if (!finite || !(upper.s > lower.s)) {
    throw new CoreInputError(
      'INVALID_INTERVAL',
      'anchors need finite s and mp, with upper.s greater than lower.s',
    );
  }
  return (accuracyM * Math.abs(upper.mp - lower.mp)) / (upper.s - lower.s); // miles
}
