import type { LatLon } from './coords.js';
import { assertLatLon } from './coords.js';
import { distanceM } from './distance.js';
import { CoreInputError } from './errors.js';
import { projectOntoSegment } from './segment.js';

/** Element `i` of `a`; throws on a hole so indexed access never yields `undefined`. */
function at<T>(a: ArrayLike<T>, i: number): T {
  if (i < 0 || i >= a.length) {
    throw new RangeError(`index ${String(i)} outside 0..${String(a.length - 1)}`);
  }
  return a[i] as T;
}

/** An ordered chain of track vertices, in degrees. */
export type Polyline = readonly LatLon[];

/**
 * Two cross-track residuals closer than this are treated as equal when choosing the best
 * segment (lowest index wins). Metres. Guards against float round-off only.
 */
const TIE_EPSILON_M = 1e-9;

/**
 * Tolerance for reporting a near-tie, in metres. A second segment is reported when its
 * `crossTrackM` is within this of the best AND its `alongM` differs from the best by more than
 * this. It is also the de-duplication distance between reported alternatives. Source: plan
 * Task 4. Limits: a reporting threshold, not a GPS precision or accuracy figure.
 */
export const NEAR_TIE_TOLERANCE_M = 1;

/** Result of projecting a position onto a polyline (one track chain). */
export type PolylineProjection = {
  /** Index i of the best segment, vertex i to vertex i + 1. */
  readonly segmentIndex: number;
  /** Clamped fraction in [0, 1] along the best segment. Dimensionless. */
  readonly t: number;
  /** Projected point on the best segment. Degrees. */
  readonly point: LatLon;
  /** Distance from the position to `point`, metres. A geometric residual, NOT GPS accuracy. */
  readonly crossTrackM: number;
  /** Position along the chain from vertex 0: `cumulative[i] + alongSegmentM`, metres. */
  readonly alongM: number;
  /** Total chain length, metres. */
  readonly totalLengthM: number;
  /**
   * `alongM` of other places in the SAME chain that are about as close as the best one but a
   * different distance along it (hairpin or loop). Empty when unambiguous. Metres.
   */
  readonly nearTieAlongM: readonly number[];
};

/**
 * Cumulative along-chain distance to every vertex.
 *
 * Formula (docs/PROJECTION.md "From one segment to a bending track"; spec §6):
 *   c[0] = 0, c[i] = c[i-1] + distanceM(v[i-1], v[i]).
 * Units: degrees in, metres out; index i is metres from vertex 0 to vertex i. The sum of
 * segment lengths, not the straight chord, so a bend is counted in full. A duplicate vertex adds
 * 0. A one-vertex line returns `[0]` (only {@link projectOntoPolyline} rejects zero length).
 * Error bound: each term is as accurate as {@link distanceM}; float round-off accumulates well
 * below a micrometre over a continental chain.
 * Limits: every vertex is checked with `assertLatLon`. Throws `CoreInputError`
 * (`EMPTY_POLYLINE`, `NON_FINITE`, `LAT_OUT_OF_RANGE`, `LON_OUT_OF_RANGE`,
 * `OUTSIDE_CANADA_ENVELOPE`).
 */
export function cumulativeLengthsM(line: Polyline): Float64Array {
  if (line.length === 0) {
    throw new CoreInputError('EMPTY_POLYLINE', 'polyline has no vertices');
  }
  for (const v of line) {
    assertLatLon(v);
  }
  const c = new Float64Array(line.length);
  for (let i = 1; i < line.length; i += 1) {
    c[i] = at(c, i - 1) + distanceM(at(line, i - 1), at(line, i)); // m
  }
  return c;
}

/**
 * Projects position `p` onto the closest segment of a polyline, giving the along-chain
 * position s in metres from vertex 0.
 *
 * Method (docs/PROJECTION.md "From one segment to a bending track"; spec §6): project onto every
 * segment with {@link projectOntoSegment}, then alongM = cumulative[i] + alongSegmentM for the
 * segment with the minimum `crossTrackM` (ties within 1e-9 m go to the lowest index). The same
 * {@link distanceM} feeds both the cumulative array and each segment length, so a vertex shared by
 * two segments gives the same `alongM` from either side.
 * Near-ties: `nearTieAlongM` lists the `alongM` of other segments whose `crossTrackM` is within
 * {@link NEAR_TIE_TOLERANCE_M} of the best and whose `alongM` differs from the best by more than
 * that, de-duplicated within 1 m. This keeps adjacent segments that share a vertex out of the
 * list. Choosing between DIFFERENT chains (parallel tracks, diamonds) is milestone M3's job; this
 * function only flags ambiguity WITHIN one chain (a hairpin or loop).
 * Units: degrees in; metres out (`crossTrackM`, `alongM`, `totalLengthM`, `nearTieAlongM`).
 * Cost: O(n) segments per call (no spatial index).
 * Limits: `crossTrackM` is a geometric residual, not GPS accuracy or a confidence interval. If
 * `cumulative` is given it must come from {@link cumulativeLengthsM} for the same `line`; only
 * its length is checked. Throws `CoreInputError`: `EMPTY_POLYLINE`, `ZERO_LENGTH_POLYLINE`
 * (total length 0), `CUMULATIVE_LENGTH_MISMATCH`, plus the coordinate codes for `p` and vertices.
 */
export function projectOntoPolyline(
  p: LatLon,
  line: Polyline,
  cumulative?: Float64Array,
): PolylineProjection {
  assertLatLon(p);
  if (cumulative !== undefined && cumulative.length !== line.length) {
    throw new CoreInputError(
      'CUMULATIVE_LENGTH_MISMATCH',
      `cumulative has ${String(cumulative.length)} entries for ${String(line.length)} vertices`,
    );
  }
  const cum = cumulative ?? cumulativeLengthsM(line); // also validates line (empty, vertices)
  const totalLengthM = at(cum, cum.length - 1);
  if (!(totalLengthM > 0)) {
    throw new CoreInputError('ZERO_LENGTH_POLYLINE', 'polyline has zero total length');
  }

  const candidates: { segmentIndex: number; crossTrackM: number; alongM: number }[] = [];
  let best = 0;
  let bestProjection = projectOntoSegment(p, at(line, 0), at(line, 1));
  candidates.push({
    segmentIndex: 0,
    crossTrackM: bestProjection.crossTrackM,
    alongM: at(cum, 0) + bestProjection.alongSegmentM,
  });
  for (let i = 1; i < line.length - 1; i += 1) {
    const r = projectOntoSegment(p, at(line, i), at(line, i + 1));
    candidates.push({
      segmentIndex: i,
      crossTrackM: r.crossTrackM,
      alongM: at(cum, i) + r.alongSegmentM, // m
    });
    if (r.crossTrackM < at(candidates, best).crossTrackM - TIE_EPSILON_M) {
      best = i;
      bestProjection = r;
    }
  }

  const bestCandidate = at(candidates, best);
  const nearTieAlongM: number[] = [];
  for (const c of candidates) {
    if (c.segmentIndex === best) {
      continue;
    }
    const close = c.crossTrackM - bestCandidate.crossTrackM <= NEAR_TIE_TOLERANCE_M;
    const apart = Math.abs(c.alongM - bestCandidate.alongM) > NEAR_TIE_TOLERANCE_M;
    const duplicate = nearTieAlongM.some((a) => {
      return Math.abs(a - c.alongM) <= NEAR_TIE_TOLERANCE_M;
    });
    if (close && apart && !duplicate) {
      nearTieAlongM.push(c.alongM);
    }
  }

  return {
    segmentIndex: best,
    t: bestProjection.t,
    point: bestProjection.point,
    crossTrackM: bestCandidate.crossTrackM,
    alongM: bestCandidate.alongM,
    totalLengthM,
    nearTieAlongM,
  };
}
