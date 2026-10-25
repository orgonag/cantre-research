import type { Anchor } from '../anchors.js';
import type { LatLon } from '../coords.js';
import { findCandidates } from '../match/candidates.js';
import type { Candidate, Fix } from '../match/candidates.js';
import { MATCH_CONFIG } from '../match/config.js';
import type { MatchConfig } from '../match/config.js';
import { milepostFor } from '../match/milepost.js';
import type { CandidateMilepost } from '../match/milepost.js';
import { byString } from '../network/decode.js';
import type { NetworkChain, NetworkView } from '../network/types.js';
import { assertFinite } from '../units.js';

/** One place a milepost lies, from {@link locateMilepost}. */
export type LocatedMilepost = {
  /** The BASE chain id (the id intervals, anchors and asset positions use). */
  readonly chainId: string;
  /** Position along the base chain, metres. */
  readonly sM: number;
  /** The point on the chain at `sM`, degrees. */
  readonly at: LatLon;
  /** The calibrated interval that holds the milepost. */
  readonly intervalId: string;
};

/**
 * Where, in each calibrated interval of the given subdivision, a milepost lies: the inverse of
 * {@link interpolateMilepost}.
 *
 * Formula, inside one consecutive anchor pair (s1, mp1), (s2, mp2) of an interval, for mp between
 * mp1 and mp2 inclusive:
 *   s = s1 + (mp - mp1) / (mp2 - mp1) * (s2 - s1),
 * with s in metres along the chain and mp in miles. It is the forward interpolation
 * mp = mp1 + (s - s1) / (s2 - s1) * (mp2 - mp1) solved for s. A milepost equal to an anchor's is
 * returned as that anchor's own `s`, with no arithmetic (so it reproduces the forward result
 * exactly there). The interval's mileposts are strictly monotonic (`validateInterval`), rising or
 * falling, so a milepost falls in at most one pair of an interval and gives at most one place.
 *
 * Rules: all chains of the subdivision (`subdivisionNid`) are searched, so double track gives one
 * entry per track that has the milepost. An interval that does not contain the milepost
 * contributes nothing: the lookup NEVER extrapolates before the first or after the last anchor,
 * and never bridges a gap between two intervals. The point `at` is found by walking the polyline
 * at distance `sM`: the segment of the chain piece whose stored `sM` span holds `sM`, then linear
 * interpolation of latitude and longitude along that segment (degrees). Limit: this is a straight
 * line in latitude and longitude, not the geodesic; the difference is negligible for the short
 * segments of mapped track and has not been measured for a multi-kilometre straight segment. If `sM` lies in no loaded piece (a gap in a split chain) the place
 * cannot be drawn and that entry is omitted rather than guessed.
 * Order: by chain id, then interval id (code-point order).
 *
 * Units: `mp` in miles; `sM` in metres; `at` in degrees. Limits: mileposts are calculated from
 * anchors, not surveyed; a milepost may exist on several subdivisions (pass the right one) and in
 * several intervals of a chain (a milepost equation), and every one is returned. Throws
 * `CoreInputError` (`NON_FINITE`) for a non-finite `mp`.
 */
export function locateMilepost(
  net: NetworkView,
  subdivisionNid: string,
  mp: number,
): readonly LocatedMilepost[] {
  assertFinite(mp, 'mp');
  const chainIds = new Set(
    net.chains.filter((c) => c.subdivisionNid === subdivisionNid).map((c) => c.chainBaseId),
  );
  const found: LocatedMilepost[] = [];
  for (const iv of net.intervals) {
    if (!chainIds.has(iv.chainId)) {
      continue;
    }
    const sM = sAtMilepost(iv.anchors, mp);
    if (sM === null) {
      continue;
    }
    const piece = net.chains.find(
      (c) => c.chainBaseId === iv.chainId && sM >= firstS(c) && sM <= lastS(c),
    );
    if (piece === undefined) {
      continue; // in an unloaded gap of a split chain: no point to give
    }
    found.push({ chainId: iv.chainId, sM, at: pointAt(piece, sM), intervalId: iv.id });
  }
  return found.sort(
    (a, b) => byString(a.chainId, b.chainId) || byString(a.intervalId, b.intervalId),
  );
}

/** The inverse interpolation inside an interval's anchors (in `s` order); null when outside. */
function sAtMilepost(anchors: readonly Anchor[], mp: number): number | null {
  for (let i = 0; i + 1 < anchors.length; i += 1) {
    const a = anchors[i] as Anchor;
    const b = anchors[i + 1] as Anchor;
    if (mp === a.mp) {
      return a.s;
    }
    if (mp === b.mp) {
      return b.s;
    }
    if (mp > Math.min(a.mp, b.mp) && mp < Math.max(a.mp, b.mp)) {
      // s = s1 + (mp - mp1) / (mp2 - mp1) * (s2 - s1): metres, from miles over miles, inside one pair.
      return a.s + ((mp - a.mp) / (b.mp - a.mp)) * (b.s - a.s);
    }
  }
  return null;
}

const firstS = (c: NetworkChain): number => c.sM[0] as number;
const lastS = (c: NetworkChain): number => c.sM[c.sM.length - 1] as number;

/**
 * The point at distance `s` along one chain piece (precondition: firstS <= s <= lastS).
 * Binary search for the largest i with sM[i] <= s (i <= n - 2), then
 *   t = (s - sM[i]) / (sM[i+1] - sM[i])   (dimensionless, 0..1),
 *   lat = lat_i + t (lat_{i+1} - lat_i), lon likewise (degrees).
 * A zero-length segment (a repeated vertex, equal `sM`) gives its vertex, never a division by 0.
 */
function pointAt(chain: NetworkChain, s: number): LatLon {
  const n = chain.sM.length;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if ((chain.sM[mid] as number) <= s) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  const a = chain.pts[lo] as LatLon;
  const b = chain.pts[hi] as LatLon;
  const span = (chain.sM[hi] as number) - (chain.sM[lo] as number); // metres
  if (n === 1 || span === 0) {
    return a;
  }
  const t = (s - (chain.sM[lo] as number)) / span; // dimensionless
  return { lat: a.lat + t * (b.lat - a.lat), lon: a.lon + t * (b.lon - a.lon) };
}

/** A candidate near a tapped point with the milepost it would give. */
export type PointMilepost = {
  readonly candidate: Candidate;
  readonly milepost: CandidateMilepost;
};

/**
 * The tracks near a point and the milepost each gives there, for desk use ("from map position,
 * no GPS"): the candidates within `cfg.searchRadiusMinM` of `p`, each passed to `milepostFor`
 * with a nominal accuracy of 0.
 *
 * With accuracy 0 the search radius is max(searchRadiusMinM, factor x 0) = `searchRadiusMinM`
 * metres, and the GPS band is 0 miles because there is no GPS. The result is a position on the
 * map, not a measurement: nothing here is a GPS fix, a heading or a time. The label is the
 * caller's to show. Order: the candidates' own order (residual first). Unchained segments are
 * listed too, with no milepost (`UNCHAINED_TRACK`); callers filter.
 *
 * Units: degrees in; metres (residual, `s`) and miles (milepost) out. Throws `CoreInputError`
 * for a point that is non-finite or outside the Canada envelope.
 */
export function milepostAtPoint(
  net: NetworkView,
  p: LatLon,
  cfg: MatchConfig = MATCH_CONFIG,
): readonly PointMilepost[] {
  // timestampMs is not used by the candidate search; this is a point, not a fix in time.
  const fix: Fix = { lat: p.lat, lon: p.lon, timestampMs: 0, accuracyM: 0 };
  return findCandidates(net, fix, cfg).map((candidate) => ({
    candidate,
    milepost: milepostFor(net, candidate, 0),
  }));
}
