import { bearingDeg } from '../bearing.js';
import { assertLatLon } from '../coords.js';
import type { LatLon } from '../coords.js';
import { metresPerDegree } from '../ellipsoid.js';
import { CoreInputError } from '../errors.js';
import { cumulativeLengthsM, projectOntoPolyline } from '../polyline.js';
import { assertFinite } from '../units.js';
import type { DiamondPosition, NetworkView, TileBounds } from '../network/types.js';
import type { MatchConfig } from './config.js';

/**
 * One GPS fix as the matcher receives it.
 *
 * Units: `lat`/`lon` degrees (WGS84/NAD83 treated as equal at this scale), `timestampMs`
 * milliseconds since an arbitrary epoch (time enters only through this field), `accuracyM`
 * metres (the device's reported horizontal accuracy, reported not verified), `headingDeg`
 * degrees clockwise from north, `speedMps` metres per second. Source: spec §6.
 * Limits: this type does not validate itself; the reducer filters invalid fixes (Task 6) and
 * the functions here throw `CoreInputError` on the values they use.
 */
export type Fix = {
  readonly lat: number;
  readonly lon: number;
  readonly timestampMs: number;
  readonly accuracyM: number;
  readonly headingDeg?: number;
  readonly speedMps?: number;
};

/**
 * One place the fix could be: the best projection onto one chain, or onto one unchained segment
 * (siding, yard, spur). Decision 4 of the M3 plan.
 *
 * Units: `residualM` is the cross-track distance from the fix to the track, metres. It is a
 * geometric residual, NOT a confidence interval and NOT GPS accuracy. `s` is metres along the
 * chain from the chain's own origin (`sM[0] + alongM`), or null for a segment, which is never
 * given a milepost. `bearingDeg` is the track direction at the projection, degrees clockwise
 * from north in [0, 360), forward in the stored vertex order.
 * Exactly one of `chainId` and `segmentKey` is non-null. `chainBaseId` is the pipeline chain id
 * that intervals, anchors and diamonds refer to (differs from `chainId` for a later piece
 * `id#2`); null for a segment. `operator` and `trackClass` of a chain are its operators and
 * track classes joined with '+' in sorted order (rulings R2, R3).
 */
export type Candidate = {
  readonly chainId: string | null;
  readonly chainBaseId: string | null;
  readonly segmentKey: string | null;
  readonly subdivisionNid: string;
  readonly subdivisionName: string;
  readonly operator: string;
  readonly trackClass: string;
  readonly residualM: number;
  readonly s: number | null;
  readonly bearingDeg: number;
};

/**
 * Multiplier on every metre-to-degree conversion done for pre-filtering and coverage. It makes
 * the bounding-box prefilter over-inclusive (it may keep a track that is just out of range, never
 * drop one in range) and the coverage square slightly larger (so 'covered' is never claimed
 * too easily). Dimensionless; covers the scale drift between the fix latitude and a vertex a
 * few km away (well under 1% at Canadian latitudes) plus the tangent-plane approximation.
 */
const SAFETY_FACTOR = 1.01;

/** Code-point order, so results do not depend on the host locale (same rule as the decoder). */
function byString(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}

/**
 * Search radius around a fix.
 *
 * Formula: radius = max(searchRadiusMinM, searchRadiusAccuracyFactor x accuracyM).
 * Units: metres in, metres out. Source: spec §6 (max(50 m, 3 x accuracy)); both numbers are
 * experimental `MATCH_CONFIG` values.
 * Limits: the radius only grows with accuracy; a poor fix is never given a narrower search.
 * Throws `CoreInputError` (`NON_FINITE`, `NEGATIVE_ACCURACY`) for a bad accuracy.
 */
export function searchRadiusM(accuracyM: number, cfg: MatchConfig): number {
  assertAccuracy(accuracyM);
  return Math.max(cfg.searchRadiusMinM, cfg.searchRadiusAccuracyFactor * accuracyM);
}

/** Throws `NON_FINITE` or `NEGATIVE_ACCURACY` unless `accuracyM` is a finite value >= 0. */
function assertAccuracy(accuracyM: number): void {
  assertFinite(accuracyM, 'accuracyM');
  if (accuracyM < 0) {
    throw new CoreInputError(
      'NEGATIVE_ACCURACY',
      `accuracyM must be >= 0, got ${String(accuracyM)}`,
    );
  }
}

/** Throws unless `radiusM` is a finite number >= 0. A radius comes from an accuracy, so it
 * reuses the accuracy codes. */
function assertRadius(radiusM: number): void {
  assertFinite(radiusM, 'radiusM');
  if (radiusM < 0) {
    throw new CoreInputError('NEGATIVE_ACCURACY', `radiusM must be >= 0, got ${String(radiusM)}`);
  }
}

/** Half-widths, in degrees, of the square that bounds a disc of `radiusM` metres at `lat`. */
function radiusDegrees(lat: number, radiusM: number): { dLat: number; dLon: number } {
  // Degrees = metres / (metres per degree). lonM shrinks with cos(lat), so it gives the larger
  // east-west span; both are inflated by SAFETY_FACTOR (see its comment).
  const scale = metresPerDegree(lat);
  return {
    dLat: (radiusM / scale.latM) * SAFETY_FACTOR,
    dLon: (radiusM / scale.lonM) * SAFETY_FACTOR,
  };
}

/** Bounding box of a vertex list, degrees. The list is non-empty (callers check). */
function boundsOf(pts: readonly LatLon[]): TileBounds {
  let south = Infinity;
  let north = -Infinity;
  let west = Infinity;
  let east = -Infinity;
  for (const p of pts) {
    south = Math.min(south, p.lat);
    north = Math.max(north, p.lat);
    west = Math.min(west, p.lon);
    east = Math.max(east, p.lon);
  }
  return { south, west, north, east };
}

/** A vertex list that can be projected onto: two or more vertices and non-zero length. */
function isProjectable(pts: readonly LatLon[], cumulative: Float64Array): boolean {
  return pts.length >= 2 && (cumulative[cumulative.length - 1] ?? 0) > 0;
}

/** True when the fix's search square misses the line's bounding box. Cheap prefilter. */
function missesBox(fix: Fix, box: TileBounds, dLat: number, dLon: number): boolean {
  return (
    fix.lat < box.south - dLat ||
    fix.lat > box.north + dLat ||
    fix.lon < box.west - dLon ||
    fix.lon > box.east + dLon
  );
}

/**
 * Every chain and unchained segment within the search radius of the fix, nearest first.
 *
 * Rule (spec §6, Decision 4): one candidate per chain (the best projection onto the chain's full
 * geometry, M1 `projectOntoPolyline`) and one per unchained segment; a track is a candidate when
 * its cross-track residual is <= `searchRadiusM(fix.accuracyM)`. Each track is first screened by
 * its bounding box inflated by the radius in degrees (see `radiusDegrees`); the screen is
 * conservative, so it never drops a track the exact projection would keep.
 * Chain `s` = `sM[0] + alongM` (metres along the full chain); a segment has `s: null`.
 * Bearing = direction of the polyline segment the projection lies on.
 * Order: `(residualM, chainId ?? '', segmentKey ?? '')`, code-point string order, so the same
 * network in any array order gives deep-equal output.
 * Units: degrees in (fix), metres out. Limits: residual is a geometric distance, not a
 * confidence; tracks with fewer than two vertices or zero length cannot be projected onto and are
 * skipped (they have no direction). Cost: O(vertices of tracks whose box is hit); no spatial
 * index. Throws `CoreInputError` for a non-finite or out-of-envelope position or a bad accuracy.
 */
export function findCandidates(net: NetworkView, fix: Fix, cfg: MatchConfig): Candidate[] {
  assertLatLon(fix);
  const radiusM = searchRadiusM(fix.accuracyM, cfg);
  const { dLat, dLon } = radiusDegrees(fix.lat, radiusM);
  const here: LatLon = { lat: fix.lat, lon: fix.lon };
  const out: Candidate[] = [];

  for (const chain of net.chains) {
    if (chain.pts.length < 2 || missesBox(fix, boundsOf(chain.pts), dLat, dLon)) {
      continue;
    }
    if (!isProjectable(chain.pts, chain.cumulativeM)) {
      continue;
    }
    const proj = projectOntoPolyline(here, chain.pts, chain.cumulativeM);
    if (proj.crossTrackM > radiusM) {
      continue;
    }
    const a = chain.pts[proj.segmentIndex];
    const b = chain.pts[proj.segmentIndex + 1];
    if (a === undefined || b === undefined) {
      continue; // unreachable: segmentIndex is within 0..n-2
    }
    out.push({
      chainId: chain.id,
      chainBaseId: chain.chainBaseId,
      segmentKey: null,
      subdivisionNid: chain.subdivisionNid,
      subdivisionName: chain.subdivisionName,
      operator: [...chain.operators].sort(byString).join('+'),
      trackClass: chain.trackClasses.join('+'),
      residualM: proj.crossTrackM,
      s: (chain.sM[0] ?? 0) + proj.alongM, // m: absolute chain position of the projection
      bearingDeg: bearingDeg(a, b),
    });
  }

  for (const seg of net.segments) {
    if (seg.pts.length < 2 || missesBox(fix, boundsOf(seg.pts), dLat, dLon)) {
      continue;
    }
    const cumulative = cumulativeLengthsM(seg.pts);
    if (!isProjectable(seg.pts, cumulative)) {
      continue;
    }
    const proj = projectOntoPolyline(here, seg.pts, cumulative);
    if (proj.crossTrackM > radiusM) {
      continue;
    }
    const a = seg.pts[proj.segmentIndex];
    const b = seg.pts[proj.segmentIndex + 1];
    if (a === undefined || b === undefined) {
      continue; // unreachable: segmentIndex is within 0..n-2
    }
    out.push({
      chainId: null,
      chainBaseId: null,
      segmentKey: seg.key,
      subdivisionNid: seg.subdivisionNid,
      subdivisionName: seg.subdivisionName,
      operator: seg.operator,
      trackClass: seg.trackClass,
      residualM: proj.crossTrackM,
      s: null,
      bearingDeg: bearingDeg(a, b),
    });
  }

  return out.sort(compareCandidates);
}

/**
 * Total order on candidates: `(residualM, chainId ?? '', segmentKey ?? '')`, code-point string
 * order. Shared by `findCandidates` and the selection policy so both are independent of input
 * order. Units: residual in metres.
 */
export function compareCandidates(x: Candidate, y: Candidate): number {
  return (
    x.residualM - y.residualM ||
    byString(x.chainId ?? '', y.chainId ?? '') ||
    byString(x.segmentKey ?? '', y.segmentKey ?? '')
  );
}

/** True when `p` lies in `t` (edges inclusive). */
function inTile(t: TileBounds, lat: number, lon: number): boolean {
  return lat >= t.south && lat <= t.north && lon >= t.west && lon <= t.east;
}

/** Sorted unique values of `edges` strictly inside (lo, hi), with lo and hi added. */
function breakpoints(edges: readonly number[], lo: number, hi: number): number[] {
  const inside = edges.filter((e) => e > lo && e < hi);
  return [...new Set([lo, ...inside, hi])].sort((a, b) => a - b);
}

/**
 * How much of the fix's search area is inside the loaded tiles (Decision 5).
 *
 * Rule: 'outside' when the fix point lies in no loaded tile; 'covered' when the search square
 * (fix +/- radius, converted to degrees at the fix latitude and inflated by 1%) lies entirely
 * inside the UNION of the loaded tiles' unbuffered bounds; otherwise 'partial'. The square bounds
 * the search disc, so 'covered' is conservative.
 * Method for the union test: coordinate compression. The square's edges and every tile edge that
 * falls inside the square split it into a grid; the square is covered exactly when the centre of
 * every grid cell lies in some tile (tiles are rectangles, so each cell is wholly in or out of
 * each tile). Cost O(k^3) in the k tiles meeting the square, small in practice.
 * Units: degrees (bounds, fix), metres (radius). Limits: tile bounds are taken as given;
 * 'covered' says the tiles are loaded, not that the track data in them is complete or current.
 * Throws `CoreInputError` for a bad position or radius.
 */
export function coverageOf(
  net: NetworkView,
  fix: Pick<Fix, 'lat' | 'lon'>,
  radiusM: number,
): 'outside' | 'partial' | 'covered' {
  assertLatLon(fix);
  assertRadius(radiusM);
  if (!net.coverage.some((t) => inTile(t, fix.lat, fix.lon))) {
    return 'outside';
  }
  const { dLat, dLon } = radiusDegrees(fix.lat, radiusM);
  const south = fix.lat - dLat;
  const north = fix.lat + dLat;
  const west = fix.lon - dLon;
  const east = fix.lon + dLon;
  const lats = breakpoints(
    net.coverage.flatMap((t) => [t.south, t.north]),
    south,
    north,
  );
  const lons = breakpoints(
    net.coverage.flatMap((t) => [t.west, t.east]),
    west,
    east,
  );
  for (let i = 0; i + 1 < lats.length; i += 1) {
    for (let j = 0; j + 1 < lons.length; j += 1) {
      const midLat = ((lats[i] ?? 0) + (lats[i + 1] ?? 0)) / 2; // cell centre, degrees
      const midLon = ((lons[j] ?? 0) + (lons[j + 1] ?? 0)) / 2;
      if (!net.coverage.some((t) => inTile(t, midLat, midLon))) {
        return 'partial';
      }
    }
  }
  return 'covered';
}

/**
 * Diamond positions within `radiusM` (along the chain) of any chain candidate (Decision 6).
 *
 * Rule: returns every `DiamondPosition` whose `chainId` equals some chain candidate's
 * `chainBaseId` and with |diamond.sM - candidate.s| <= radiusM. Along-track distance on the
 * candidate's own chain, in metres; no straight-line distance to the other line is used.
 * Callers pass ALL candidates within the search radius, not only the indistinguishable ones:
 * spec §6 says a diamond junction within the search radius blocks automatic selection, and the
 * golden diamond is registered on one chain only, so a fix closer to the other line must still
 * see it (ruling R7). Segment candidates carry no `s` and are ignored.
 * Output is sorted by (assetId, chainId, sM) in code-point order and has no duplicates, so the
 * result does not depend on candidate or diamond order.
 * Units: metres. Limits: a diamond on a chain piece that is not loaded is not seen. Throws
 * `CoreInputError` for a bad radius.
 */
export function diamondsNear(
  net: NetworkView,
  candidates: readonly Candidate[],
  radiusM: number,
): DiamondPosition[] {
  assertRadius(radiusM);
  const sByChain = new Map<string, number[]>();
  for (const c of candidates) {
    if (c.chainBaseId !== null && c.s !== null) {
      const list = sByChain.get(c.chainBaseId) ?? [];
      list.push(c.s);
      sByChain.set(c.chainBaseId, list);
    }
  }
  const seen = new Set<string>();
  const out: DiamondPosition[] = [];
  for (const d of net.diamonds) {
    const near = (sByChain.get(d.chainId) ?? []).some((s) => Math.abs(d.sM - s) <= radiusM);
    const key = JSON.stringify([d.assetId, d.chainId, d.sM]);
    if (near && !seen.has(key)) {
      seen.add(key);
      out.push(d);
    }
  }
  return out.sort(
    (x, y) => byString(x.assetId, y.assetId) || byString(x.chainId, y.chainId) || x.sM - y.sM,
  );
}
