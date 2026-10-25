/**
 * Test-only helpers: build `NetworkView`s directly from metre offsets, without tiles.
 *
 * Method: every point is placed with the tangent-plane inverse `fromLocalM` at the origin's own
 * latitude (the same plane M1 projects in), so a chain built "30 m north of the origin" is 30 m
 * away to well under a millimetre. Units: metres in, degrees out. Source: spec §6.
 * Limits: tangent-plane placement, fine for kilometre-scale scenarios, not survey-grade baselines.
 * Chain `sM` is the real `cumulativeLengthsM` of the built points offset by `fromM`, so the
 * stored positions agree exactly with what the matcher computes.
 */
import { cumulativeLengthsM, fromLocalM } from '../../src/index.js';
import type {
  Anchor,
  DiamondPosition,
  LatLon,
  NetworkAsset,
  NetworkChain,
  NetworkInterval,
  NetworkSegment,
  NetworkView,
  TileBounds,
} from '../../src/index.js';

/** A convenient origin well inside the Canada envelope (southern Manitoba prairie). */
export const ORIGIN: LatLon = { lat: 50, lon: -100 };

/** Options shared by chains and sidings. */
export type LineOptions = {
  /** Subdivision NID. Default `'sub-1'`. */
  readonly sub?: string;
  /** Subdivision name. Default `'Test Sub'`. */
  readonly subName?: string;
  /** Operators of the chain (sorted by the helper). Default `['CN']`. Use `op` for one. */
  readonly operators?: readonly string[];
  /** Shorthand for a single operator. */
  readonly op?: string;
  /** Track classes of a chain. Default `['Main']`. A siding takes the first as its class. */
  readonly trackClasses?: readonly string[];
  /** Bearing of travel, degrees clockwise from north. Default 90 (due east). */
  readonly bearingDeg?: number;
  /** Offset to the RIGHT of the direction of travel, metres (negative is left). Default 0. */
  readonly lateralM?: number;
  /** Distance between vertices along the line, metres. Default 100. */
  readonly stepM?: number;
};

/** Extra options for chains only. */
export type ChainOptions = LineOptions & {
  /** The pipeline chain id when `id` is a later piece (`id#2`). Default `id`. */
  readonly chainBaseId?: string;
  readonly cycle?: boolean;
};

/**
 * Vertices of a straight line starting `fromM` metres along `bearingDeg` from `origin` and ending
 * `toM` metres along it, offset sideways by `lateralM`. Vertices are `stepM` apart, plus the end.
 */
export function straightPoints(
  origin: LatLon,
  fromM: number,
  toM: number,
  opts: LineOptions = {},
): LatLon[] {
  const bearing = ((opts.bearingDeg ?? 90) * Math.PI) / 180; // degrees to radians
  const lateralM = opts.lateralM ?? 0;
  const stepM = opts.stepM ?? 100;
  const at = (d: number): LatLon => {
    // Along-line unit vector (east, north) = (sin b, cos b); right-hand unit vector = (cos b, -sin b).
    const x = d * Math.sin(bearing) + lateralM * Math.cos(bearing); // m east
    const y = d * Math.cos(bearing) - lateralM * Math.sin(bearing); // m north
    return fromLocalM(origin, { x, y }, origin.lat);
  };
  const ds: number[] = [];
  for (let d = fromM; d < toM - 1e-9; d += stepM) {
    ds.push(d);
  }
  ds.push(toM);
  return ds.map(at);
}

/**
 * A chain along a straight line from `fromM` to `toM` metres from `origin`. `sM[0]` is `fromM`
 * and `sM[i] = fromM + cumulative length`, so chain position equals distance along the line.
 */
export function straightChain(
  id: string,
  origin: LatLon,
  fromM: number,
  toM: number,
  opts: ChainOptions = {},
): NetworkChain {
  const pts = straightPoints(origin, fromM, toM, opts);
  const cumulativeM = cumulativeLengthsM(pts);
  const sM = Float64Array.from(cumulativeM, (c) => fromM + c);
  const operators = [...(opts.operators ?? [opts.op ?? 'CN'])].sort();
  return {
    id,
    chainBaseId: opts.chainBaseId ?? id,
    subdivisionNid: opts.sub ?? 'sub-1',
    subdivisionName: opts.subName ?? 'Test Sub',
    operators,
    cycle: opts.cycle ?? false,
    trackClasses: [...(opts.trackClasses ?? ['Main'])].sort(),
    pts,
    sM,
    cumulativeM,
  };
}

/** An unchained segment (siding, yard track, spur) along a straight line. */
export function siding(
  key: string,
  origin: LatLon,
  fromM: number,
  toM: number,
  opts: LineOptions = {},
): NetworkSegment {
  return {
    key,
    chainId: null,
    trackClass: (opts.trackClasses ?? ['Siding'])[0] ?? 'Siding',
    status: 'Operational',
    subdivisionNid: opts.sub ?? 'sub-1',
    subdivisionName: opts.subName ?? 'Test Sub',
    operator: opts.op ?? (opts.operators ?? ['CN']).join('+'),
    geoAccuracyM: null,
    pts: straightPoints(origin, fromM, toM, opts),
  };
}

/** One anchor spec for {@link interval}: position, milepost, optional tier. */
export type AnchorSpec = {
  readonly s: number;
  readonly mp: number;
  readonly tier?: Anchor['tier'];
};

/** An interval of anchors on the BASE chain id; anchor ids are `<id>-a0`, `<id>-a1`, ... */
export function interval(
  id: string,
  chainId: string,
  anchors: readonly AnchorSpec[],
): NetworkInterval {
  return {
    id,
    chainId,
    anchors: anchors.map((a, i) => ({
      id: `${id}-a${String(i)}`,
      s: a.s,
      mp: a.mp,
      source: 'markerpost',
      tier: a.tier ?? 'posted',
    })),
  };
}

/** A rectangle of half-size `halfSizeM` metres centred on `origin`, as one tile's bounds. */
export function coverageAround(origin: LatLon, halfSizeM: number): TileBounds {
  const sw = fromLocalM(origin, { x: -halfSizeM, y: -halfSizeM }, origin.lat);
  const ne = fromLocalM(origin, { x: halfSizeM, y: halfSizeM }, origin.lat);
  return { south: sw.lat, west: sw.lon, north: ne.lat, east: ne.lon };
}

/** Pieces a test composes into a view; every field optional. */
export type NetworkParts = {
  readonly datasetVersion?: string;
  readonly coverage?: readonly TileBounds[];
  readonly chains?: readonly NetworkChain[];
  readonly segments?: readonly NetworkSegment[];
  readonly intervals?: readonly NetworkInterval[];
  readonly diamonds?: readonly DiamondPosition[];
  readonly assets?: readonly NetworkAsset[];
};

/** Composes a `NetworkView`. Order is kept as given (tests shuffle it on purpose). */
export function network(parts: NetworkParts = {}): NetworkView {
  return {
    datasetVersion: parts.datasetVersion ?? 'test-1',
    coverage: parts.coverage ?? [],
    chains: parts.chains ?? [],
    segments: parts.segments ?? [],
    intervals: parts.intervals ?? [],
    diamonds: parts.diamonds ?? [],
    assets: parts.assets ?? [],
  };
}

/** The view with extra intervals appended. */
export function withIntervals(
  net: NetworkView,
  ...intervals: readonly NetworkInterval[]
): NetworkView {
  return { ...net, intervals: [...net.intervals, ...intervals] };
}

/** The view with a diamond registered at `sM` metres along the BASE chain `chainId`. */
export function withDiamond(
  net: NetworkView,
  assetId: string,
  chainId: string,
  sM: number,
): NetworkView {
  return { ...net, diamonds: [...net.diamonds, { assetId, chainId, sM }] };
}

/** A point asset on the BASE chain `chainId` at `sM` metres; other fields default. */
export function pointAsset(
  id: string,
  chainId: string,
  sM: number,
  opts: { readonly kind?: NetworkAsset['kind']; readonly name?: string | null } = {},
): NetworkAsset {
  return {
    id,
    kind: opts.kind ?? 'crossing',
    name: opts.name ?? null,
    posted: null,
    positions: [{ chainId, sM, residualM: 0, derivedMp: null }],
    at: ORIGIN,
  };
}
