import type { Anchor } from './anchors.js';
import { validateInterval } from './anchors.js';
import { CoreInputError } from './errors.js';
import { assertFinite } from './units.js';

/**
 * Why a position has no calculated milepost. Nothing is guessed in either case.
 * `BEFORE_FIRST_ANCHOR`: `s` is before the first anchor of the interval.
 * `AFTER_LAST_ANCHOR`: `s` is after the last anchor of the interval.
 */
export type UncalibratedReason = 'BEFORE_FIRST_ANCHOR' | 'AFTER_LAST_ANCHOR';

/**
 * Outcome of {@link interpolateMilepost}.
 *
 * `calibrated`: `mp` is in miles; `lower` and `upper` are the anchors used; `intervalLengthM`
 * is `upper.s - lower.s` in metres, the calibration spacing the user should see.
 * `uncalibrated`: no milepost is given, only the reason.
 */
export type MilepostResult =
  | {
      readonly kind: 'calibrated';
      /** Milepost at `s`, miles. */
      readonly mp: number;
      readonly lower: Anchor;
      readonly upper: Anchor;
      /** Metres between the two anchors used. */
      readonly intervalLengthM: number;
    }
  | { readonly kind: 'uncalibrated'; readonly reason: UncalibratedReason };

/**
 * Milepost at along-chain position `s`, by linear interpolation between the two anchors that
 * bracket it along the path.
 *
 * Formula (spec §6, milepost; docs/PROJECTION.md "From one segment to a bending track"):
 *   mp = mp₁ + (s − s₁) / (s₂ − s₁) · (mp₂ − mp₁),
 * where (s₁, mp₁) and (s₂, mp₂) are consecutive anchors with s₁ ≤ s ≤ s₂. The bracket is found
 * by binary search on `s`. Along the path, not the straight chord, so a bend is not cut.
 * Units: `s` in metres along the chain; `mp` in miles; `intervalLengthM` in metres.
 *
 * Exact hits: an anchor k is reproduced exactly, returning its `mp` with no arithmetic. For
 * k = 0 the bracket is anchors 0 and 1; for k ≥ 1 it is anchors k − 1 and k. So `lower` and
 * `upper` always name the two anchors that define the interval for that anchor.
 *
 * Limits: this never extrapolates. A position before the first anchor or after the last is
 * `uncalibrated`, not extended. The interval must be valid: a list that fails
 * {@link validateInterval} is rejected, so this never crosses an invalid interval (a
 * non-monotonic milepost, a duplicate position, or a non-finite value), and it does not bridge a
 * milepost discontinuity. The interval must be ordered by `s` as given; it is not sorted here.
 * The result is a calculated milepost from anchors. It is not a survey accuracy, and it
 * carries no confidence interval (see {@link gpsMilepostBandMi} for the GPS-only band).
 *
 * Throws `CoreInputError`: `NON_FINITE` if `s` is NaN or infinite; `INVALID_INTERVAL` if
 * {@link validateInterval} reports any issue (including a span that overflows to +-Infinity, as
 * for extreme finite anchors such as +-1e308).
 */
export function interpolateMilepost(s: number, interval: readonly Anchor[]): MilepostResult {
  assertFinite(s, 's');
  const issues = validateInterval(interval);
  if (issues.length > 0) {
    const codes = issues.map((i) => i.code).join(', ');
    throw new CoreInputError('INVALID_INTERVAL', `interval has issues: ${codes}`);
  }

  const first = anchorAt(interval, 0);
  const last = anchorAt(interval, interval.length - 1);
  if (s < first.s) {
    return { kind: 'uncalibrated', reason: 'BEFORE_FIRST_ANCHOR' };
  }
  if (s > last.s) {
    return { kind: 'uncalibrated', reason: 'AFTER_LAST_ANCHOR' };
  }

  // An exact hit on anchor k: k = 0 uses the bracket (0, 1); k ≥ 1 uses (k − 1, k).
  const hit = exactHitIndex(interval, s);
  if (hit !== undefined) {
    const k = hit;
    const lower = anchorAt(interval, k === 0 ? 0 : k - 1);
    const upper = anchorAt(interval, k === 0 ? 1 : k);
    return {
      kind: 'calibrated',
      mp: anchorAt(interval, k).mp,
      lower,
      upper,
      intervalLengthM: upper.s - lower.s,
    };
  }

  // Strictly between anchors: `i` is the largest index with interval[i].s < s.
  const i = bracketIndex(interval, s);
  const lower = anchorAt(interval, i);
  const upper = anchorAt(interval, i + 1);
  const fraction = (s - lower.s) / (upper.s - lower.s); // dimensionless, in (0, 1)
  const mp = lower.mp + fraction * (upper.mp - lower.mp); // miles
  assertFinite(mp, 'mp'); // defensive: finite spans keep mp between the anchors, so never fires
  return {
    kind: 'calibrated',
    mp,
    lower,
    upper,
    intervalLengthM: upper.s - lower.s,
  };
}

/**
 * Index i with `interval[i].s === s` when the position is an anchor exactly, otherwise
 * `undefined`. Precondition: `interval` is valid and `first.s ≤ s ≤ last.s`.
 */
function exactHitIndex(interval: readonly Anchor[], s: number): number | undefined {
  const i = bracketIndex(interval, s);
  if (anchorAt(interval, i).s === s) {
    return i;
  }
  if (anchorAt(interval, interval.length - 1).s === s) {
    return interval.length - 1;
  }
  return undefined;
}

/**
 * Binary search: the largest index i in [0, n − 2] with `interval[i].s ≤ s`, for a valid interval
 * with `first.s ≤ s < last.s`. Requires at least two anchors.
 */
function bracketIndex(interval: readonly Anchor[], s: number): number {
  let lo = 0;
  let hi = interval.length - 1;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (anchorAt(interval, mid).s <= s) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return lo;
}

/** Element `i` of `interval`; throws on a hole so indexed access never yields `undefined`. */
function anchorAt(interval: readonly Anchor[], i: number): Anchor {
  if (i < 0 || i >= interval.length) {
    throw new RangeError(`anchor index ${String(i)} outside 0..${String(interval.length - 1)}`);
  }
  return interval[i] as Anchor;
}
