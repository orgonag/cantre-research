import type { Anchor, AnchorTier } from '../anchors.js';
import { interpolateMilepost } from '../interpolate.js';
import type { MilepostResult } from '../interpolate.js';
import type { NetworkInterval, NetworkView } from '../network/types.js';
import { gpsMilepostBandMi } from '../uncertainty.js';
import type { Candidate } from './candidates.js';
import type { MatchReason } from './reasons.js';

/**
 * Milepost outcome for one match candidate.
 *
 * `milepost` is M1's {@link MilepostResult} (miles when calibrated), or null when no milepost can
 * be given at all (a reason is then in `reasons`). `mpBandMi` is the GPS-propagated band in miles
 * and `tier` the lower tier of the two bracketing anchors; both are null unless `milepost` is
 * calibrated. `anchorIds` are the ids of the bracketing anchors, `[lower, upper]`, or empty.
 * Limits: the band is from GPS accuracy only; not a confidence interval. It excludes the
 * cross-track residual and the survey accuracy of the anchors (spec §6, "Uncertainty shown").
 */
export type CandidateMilepost = {
  readonly milepost: MilepostResult | null;
  readonly mpBandMi: number | null;
  readonly tier: AnchorTier | null;
  readonly anchorIds: readonly string[];
  readonly reasons: readonly MatchReason[];
};

/** Rank of each tier: higher is better. Order posted > tc > unverified (anchor tiers, spec §6). */
const TIER_RANK: Readonly<Record<AnchorTier, number>> = { posted: 2, tc: 1, unverified: 0 };

/**
 * The worse of two anchor tiers. A milepost interpolated between two anchors is only as good as
 * the weaker of them. Order: posted > tc > unverified. Limits: a rank, not an accuracy.
 */
export function lowerTier(a: AnchorTier, b: AnchorTier): AnchorTier {
  return TIER_RANK[a] <= TIER_RANK[b] ? a : b;
}

const NO_MILEPOST = (reason: MatchReason): CandidateMilepost => ({
  milepost: null,
  mpBandMi: null,
  tier: null,
  anchorIds: [],
  reasons: [reason],
});

/** First and last anchor positions of an interval, metres along the base chain. */
function span(iv: NetworkInterval): { readonly first: number; readonly last: number } {
  const first = iv.anchors[0] as Anchor;
  const last = iv.anchors[iv.anchors.length - 1] as Anchor;
  return { first: first.s, last: last.s };
}

/**
 * Milepost, GPS band and tier for one candidate (plan Decision 8, ruling R4; spec §6 milepost
 * and uncertainty).
 *
 * Rules, in order. A segment candidate (no chain, or no `s`) is unchained track: `milepost` null,
 * `UNCHAINED_TRACK`. Otherwise the chain's intervals are found by `candidate.chainBaseId` (the
 * intervals carry the BASE chain id; `s` is absolute along that chain, so it applies directly) and
 * sorted by first-anchor position `s` in metres:
 *  - none: null, `CHAIN_UNCALIBRATED`.
 *  - `s` inside [first, last] of an interval: calibrated by {@link interpolateMilepost}; the band
 *    is `gpsMilepostBandMi(accuracyM, lower, upper)` in miles for the returned bracket; the tier
 *    is the lower of the bracket's tiers. If two intervals both contain `s` (they share an end
 *    position), the one whose first anchor is greatest wins, so the choice is deterministic and
 *    the later interval takes over exactly at the shared anchor.
 *  - `s` before the first interval or after the last: M1's `BEFORE_FIRST_ANCHOR` or
 *    `AFTER_LAST_ANCHOR` (uncalibrated, no `mp`; band, tier and anchor ids empty).
 *  - `s` strictly between two intervals: null, `DISCONTINUITY_GAP`.
 * Units: `s` and `accuracyM` in metres; milepost and band in miles.
 * Limits: never extrapolates and never bridges a gap between intervals; MP 0 is a valid value.
 * The band is from GPS accuracy only; not a confidence interval. Throws `CoreInputError` as the
 * M1 functions do (negative or non-finite `accuracyM`, invalid interval), only when a milepost
 * is actually computed.
 */
export function milepostFor(
  net: NetworkView,
  candidate: Candidate,
  accuracyM: number,
): CandidateMilepost {
  const { chainBaseId, s } = candidate;
  if (candidate.chainId === null || chainBaseId === null || s === null) {
    return NO_MILEPOST('UNCHAINED_TRACK');
  }

  const intervals = net.intervals
    .filter((iv) => iv.chainId === chainBaseId && iv.anchors.length > 0)
    .sort((a, b) => span(a).first - span(b).first);
  const firstInterval = intervals[0];
  const lastInterval = intervals[intervals.length - 1];
  if (firstInterval === undefined || lastInterval === undefined) {
    return NO_MILEPOST('CHAIN_UNCALIBRATED');
  }

  // Sorted ascending, so the last containing interval has the greatest first anchor.
  const containing = intervals.filter((iv) => span(iv).first <= s && s <= span(iv).last);
  const chosen = containing[containing.length - 1];
  if (chosen !== undefined) {
    return fromResult(interpolateMilepost(s, chosen.anchors), accuracyM);
  }
  if (s < span(firstInterval).first) {
    return fromResult(interpolateMilepost(s, firstInterval.anchors), accuracyM);
  }
  if (s > Math.max(...intervals.map((iv) => span(iv).last))) {
    return fromResult(interpolateMilepost(s, lastInterval.anchors), accuracyM);
  }
  return NO_MILEPOST('DISCONTINUITY_GAP');
}

/**
 * Wraps an M1 result. Calibrated: band in miles from the GPS accuracy over the bracket, tier the
 * lower of the bracket's, anchor ids `[lower, upper]`. Uncalibrated: no band, tier or anchors.
 */
function fromResult(milepost: MilepostResult, accuracyM: number): CandidateMilepost {
  if (milepost.kind === 'uncalibrated') {
    return { milepost, mpBandMi: null, tier: null, anchorIds: [], reasons: [] };
  }
  const { lower, upper } = milepost;
  return {
    milepost,
    mpBandMi: gpsMilepostBandMi(accuracyM, lower, upper),
    tier: lowerTier(lower.tier, upper.tier),
    anchorIds: [lower.id, upper.id],
    reasons: [],
  };
}
