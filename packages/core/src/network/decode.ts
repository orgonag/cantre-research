import { validateInterval } from '../anchors.js';
import type { Anchor, AnchorSource, AnchorTier } from '../anchors.js';
import { CANADA_ENVELOPE } from '../coords.js';
import type { LatLon } from '../coords.js';
import { CoreInputError } from '../errors.js';
import { interpolateMilepost } from '../interpolate.js';
import type {
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
} from './types.js';

/**
 * Decoder from `cantre.tile/1` objects (pipeline/schema/tile.schema.json) to a `NetworkView`.
 *
 * Pure: no fetching, no IO. Callers hand in already-parsed JSON (`unknown`), so every field the
 * decoder reads is validated and a bad one throws `INVALID_TILE` naming its path.
 *
 * Delta encoding (tile schema): `latE6`, `lonE6` and a chain piece's `sMm` store the first value
 * absolute and every later value as the difference from the previous one. Decoding is the running
 * sum. Units: `latE6`/`lonE6` are microdegrees (degrees = value / 1e6), `sMm` is millimetres
 * (metres = value / 1000). All values are integers, so the sums are exact in a double up to 2^53.
 */

export const ANCHOR_SOURCES: readonly string[] = ['crossing', 'station', 'structure', 'markerpost'];
export const ANCHOR_TIERS: readonly string[] = ['posted', 'tc', 'unverified'];
export const ASSET_KINDS: readonly string[] = [
  'crossing',
  'bridge',
  'moveableBridge',
  'tunnel',
  'culvert',
  'station',
  'diamond',
];

/** |latitude| and |longitude| limits in microdegrees. A decoded value beyond them is corrupt. */
const MAX_LAT_E6 = 90_000_000;
const MAX_LON_E6 = 180_000_000;

type Rec = Readonly<Record<string, unknown>>;

/** A chain piece from one tile, decoded to absolute integers. */
type Piece = {
  readonly id: string;
  readonly subdivisionNid: string;
  readonly subdivisionName: string;
  readonly operators: readonly string[];
  readonly cycle: boolean;
  readonly vertexStart: number;
  readonly latE6: readonly number[];
  readonly lonE6: readonly number[];
  readonly sMm: readonly number[];
};

type ParsedTile = {
  readonly datasetVersion: string;
  readonly bounds: TileBounds;
  readonly chains: readonly Piece[];
  /** Validated segments paired with their raw object, for the duplicate check. */
  readonly segments: readonly { readonly raw: Rec; readonly seg: NetworkSegment }[];
  readonly anchors: readonly {
    readonly raw: Rec;
    readonly chainId: string;
    readonly anchor: Anchor;
  }[];
  readonly intervals: readonly {
    readonly raw: Rec;
    /** Where the interval was first read, for an INVALID_TILE message (e.g. tiles[2].intervals[0]). */
    readonly path: string;
    readonly id: string;
    readonly chainId: string;
    readonly anchorIds: readonly string[];
  }[];
  readonly assets: readonly {
    readonly raw: Rec;
    /** The asset's validated parts; built into a NetworkAsset once the intervals are known. */
    readonly parts: AssetParts;
  }[];
};

/** Throws `INVALID_TILE` with the failing path. */
function invalid(path: string, problem: string): never {
  throw new CoreInputError('INVALID_TILE', `${path}: ${problem}`);
}

function isRec(x: unknown): x is Rec {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function recAt(x: unknown, path: string): Rec {
  if (!isRec(x)) {
    return invalid(path, 'expected an object');
  }
  return x;
}

function strAt(o: Rec, key: string, path: string): string {
  const v = o[key];
  if (typeof v !== 'string') {
    return invalid(`${path}.${key}`, 'expected a string');
  }
  return v;
}

function boolAt(o: Rec, key: string, path: string): boolean {
  const v = o[key];
  if (typeof v !== 'boolean') {
    return invalid(`${path}.${key}`, 'expected a boolean');
  }
  return v;
}

function finiteAt(o: Rec, key: string, path: string): number {
  const v = o[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    return invalid(`${path}.${key}`, 'expected a finite number');
  }
  return v;
}

function intAt(o: Rec, key: string, path: string): number {
  const v = o[key];
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) {
    return invalid(`${path}.${key}`, 'expected an integer');
  }
  return v;
}

function arrAt(o: Rec, key: string, path: string): readonly unknown[] {
  const v = o[key];
  if (!Array.isArray(v)) {
    return invalid(`${path}.${key}`, 'expected an array');
  }
  return v as readonly unknown[];
}

function strArrAt(o: Rec, key: string, path: string): string[] {
  return arrAt(o, key, path).map((v, i) =>
    typeof v === 'string' ? v : invalid(`${path}.${key}[${String(i)}]`, 'expected a string'),
  );
}

function oneOf(o: Rec, key: string, path: string, allowed: readonly string[]): string {
  const v = strAt(o, key, path);
  if (!allowed.includes(v)) {
    return invalid(`${path}.${key}`, `expected one of ${allowed.join(', ')}`);
  }
  return v;
}

/**
 * Undoes the delta encoding of one array: running sum of integers, first value absolute.
 * Units: the same as the stored values (E6 microdegrees or millimetres).
 */
function decodeDeltas(o: Rec, key: string, path: string): number[] {
  const out: number[] = [];
  let total = 0; // running sum; exact because every delta is a safe integer
  for (const [i, v] of arrAt(o, key, path).entries()) {
    if (typeof v !== 'number' || !Number.isSafeInteger(v)) {
      invalid(`${path}.${key}[${String(i)}]`, 'expected an integer');
    }
    total += v;
    out.push(total);
  }
  return out;
}

/**
 * Decodes a latE6/lonE6 pair into absolute microdegrees. Both arrays must be the same non-zero
 * length and the decoded values must be real coordinates (|lat| <= 90, |lon| <= 180 degrees) that
 * lie inside {@link CANADA_ENVELOPE} (degrees = E6 / 1e6, envelope inclusive). Ruling R28: a vertex
 * outside the envelope would make the matcher's projection throw later, so the tile is rejected
 * here, loudly, with the failing index in the path (spec §8: corrupt tiles are rejected).
 */
function decodeLatLonE6(o: Rec, path: string): { latE6: number[]; lonE6: number[] } {
  const latE6 = decodeDeltas(o, 'latE6', path);
  const lonE6 = decodeDeltas(o, 'lonE6', path);
  if (latE6.length === 0) {
    invalid(`${path}.latE6`, 'expected at least one vertex');
  }
  if (lonE6.length !== latE6.length) {
    invalid(
      `${path}.lonE6`,
      `length ${String(lonE6.length)} differs from latE6 length ${String(latE6.length)}`,
    );
  }
  if (latE6.some((v) => Math.abs(v) > MAX_LAT_E6)) {
    invalid(`${path}.latE6`, 'decoded latitude outside +-90 degrees');
  }
  if (lonE6.some((v) => Math.abs(v) > MAX_LON_E6)) {
    invalid(`${path}.lonE6`, 'decoded longitude outside +-180 degrees');
  }
  const e = CANADA_ENVELOPE;
  latE6.forEach((v, i) => {
    const lat = v / 1e6; // degrees
    if (lat < e.minLat || lat > e.maxLat) {
      invalid(
        `${path}.latE6[${String(i)}]`,
        `decoded latitude ${String(lat)} outside the Canada envelope`,
      );
    }
  });
  lonE6.forEach((v, i) => {
    const lon = v / 1e6; // degrees
    if (lon < e.minLon || lon > e.maxLon) {
      invalid(
        `${path}.lonE6[${String(i)}]`,
        `decoded longitude ${String(lon)} outside the Canada envelope`,
      );
    }
  });
  return { latE6, lonE6 };
}

/** Microdegree arrays to degree points: degrees = E6 / 1e6. */
export function toPoints(latE6: readonly number[], lonE6: readonly number[]): LatLon[] {
  return latE6.map((la, i) => ({ lat: la / 1e6, lon: (lonE6[i] as number) / 1e6 }));
}

function parseBounds(o: Rec, path: string): TileBounds {
  const b = recAt(o.bounds, `${path}.bounds`);
  return {
    south: finiteAt(b, 'south', `${path}.bounds`),
    west: finiteAt(b, 'west', `${path}.bounds`),
    north: finiteAt(b, 'north', `${path}.bounds`),
    east: finiteAt(b, 'east', `${path}.bounds`),
  };
}

function parsePiece(raw: unknown, path: string): Piece {
  const o = recAt(raw, path);
  const { latE6, lonE6 } = decodeLatLonE6(o, path);
  const sMm = decodeDeltas(o, 'sMm', path);
  if (sMm.length !== latE6.length) {
    invalid(
      `${path}.sMm`,
      `length ${String(sMm.length)} differs from latE6 length ${String(latE6.length)}`,
    );
  }
  // Ruling R28: chain position never runs backwards. A negative delta (millimetres) would give a
  // wrong s and a reversed cumulative length; an equal value is a duplicate vertex and is kept.
  for (let i = 1; i < sMm.length; i += 1) {
    if ((sMm[i] as number) < (sMm[i - 1] as number)) {
      invalid(`${path}.sMm[${String(i)}]`, 'decoded chain position decreases');
    }
  }
  const vertexStart = intAt(o, 'vertexStart', path);
  if (vertexStart < 0) {
    invalid(`${path}.vertexStart`, 'expected a non-negative integer');
  }
  return {
    id: strAt(o, 'id', path),
    subdivisionNid: strAt(o, 'subdivisionNid', path),
    subdivisionName: strAt(o, 'subdivisionName', path),
    operators: strArrAt(o, 'operators', path),
    cycle: boolAt(o, 'cycle', path),
    vertexStart,
    latE6,
    lonE6,
    sMm,
  };
}

function parseSegment(raw: unknown, path: string): { raw: Rec; seg: NetworkSegment } {
  const o = recAt(raw, path);
  const { latE6, lonE6 } = decodeLatLonE6(o, path);
  const chainId = o.chainId;
  if (chainId !== null && typeof chainId !== 'string') {
    invalid(`${path}.chainId`, 'expected a string or null');
  }
  const acc = o.geoAccuracyM;
  if (acc !== null && (typeof acc !== 'number' || !Number.isSafeInteger(acc) || acc < 0)) {
    invalid(`${path}.geoAccuracyM`, 'expected a non-negative integer or null');
  }
  return {
    raw: o,
    seg: {
      key: strAt(o, 'key', path),
      chainId,
      trackClass: strAt(o, 'trackClass', path),
      status: strAt(o, 'status', path),
      subdivisionNid: strAt(o, 'subdivisionNid', path),
      subdivisionName: strAt(o, 'subdivisionName', path),
      operator: strAt(o, 'operator', path),
      geoAccuracyM: acc,
      pts: toPoints(latE6, lonE6),
    },
  };
}

function parseAnchor(raw: unknown, path: string): { raw: Rec; chainId: string; anchor: Anchor } {
  const o = recAt(raw, path);
  const chainId = strAt(o, 'chainId', path);
  return {
    raw: o,
    chainId,
    anchor: {
      id: strAt(o, 'id', path),
      // Anchor sMm is absolute (not delta-encoded). millimetres / 1000 = metres.
      s: intAt(o, 'sMm', path) / 1000,
      mp: finiteAt(o, 'mp', path), // miles
      source: oneOf(o, 'source', path, ANCHOR_SOURCES) as AnchorSource,
      tier: oneOf(o, 'tier', path, ANCHOR_TIERS) as AnchorTier,
    },
  };
}

function parseInterval(raw: unknown, path: string): ParsedTile['intervals'][number] {
  const o = recAt(raw, path);
  const anchorIds = strArrAt(o, 'anchorIds', path);
  if (anchorIds.length < 2) {
    invalid(`${path}.anchorIds`, 'expected at least 2 anchor ids');
  }
  return {
    raw: o,
    path,
    id: strAt(o, 'id', path),
    chainId: strAt(o, 'chainId', path),
    anchorIds,
  };
}

/** The input of {@link buildAsset}: one asset with its vertices already made absolute. */
export type AssetParts = {
  readonly id: string;
  readonly kind: AssetKind;
  readonly name: string | null;
  readonly posted: AssetPosted | null;
  readonly positions: readonly {
    readonly chainId: string;
    readonly sStartMm: number;
    readonly sEndMm: number;
    readonly residualMm: number;
    readonly derivedMpStart: number | null;
    readonly derivedMpEnd: number | null;
  }[];
  /** Absolute microdegrees, same length, at least one vertex. */
  readonly latE6: readonly number[];
  readonly lonE6: readonly number[];
};

/** The calibrated intervals of each chain, by chain id (an interval's `chainId`, the base id). */
export type IntervalsByChain = ReadonlyMap<string, readonly NetworkInterval[]>;

/** Groups intervals by their chain id, for {@link buildAsset}. */
export function intervalsByChain(intervals: readonly NetworkInterval[]): IntervalsByChain {
  const out = new Map<string, NetworkInterval[]>();
  for (const iv of intervals) {
    const list = out.get(iv.chainId) ?? [];
    list.push(iv);
    out.set(iv.chainId, list);
  }
  return out;
}

/**
 * The derived milepost of one asset position, miles, or null.
 *
 * - Either stored end has no milepost: null (the pipeline found no calibrated interval there).
 * - A point asset (`sStartMm === sEndMm`): the pipeline's own value at that point.
 * - A line asset (bridge, tunnel): the milepost at its midpoint `sM` (metres), interpolated
 *   linearly between the anchors of the ONE calibrated interval of the chain that contains both
 *   ends (`interpolateMilepost`, the M1 rule). When no single interval contains both ends, for
 *   example across a milepost equation or a gap between intervals, it is null: averaging the two
 *   ends would interpolate across a discontinuity and give a milepost that is posted nowhere.
 * Limits: the interval list is the decoded network's; an interval dropped for missing anchors
 * makes the line asset's milepost null rather than guessed.
 */
function derivedMpOf(
  p: AssetParts['positions'][number],
  sM: number,
  intervals: IntervalsByChain,
): number | null {
  if (p.derivedMpStart === null || p.derivedMpEnd === null) {
    return null;
  }
  if (p.sStartMm === p.sEndMm) {
    return p.derivedMpStart; // a point: start and end are the same place
  }
  const startM = p.sStartMm / 1000; // millimetres -> metres
  const endM = p.sEndMm / 1000;
  const holder = (intervals.get(p.chainId) ?? []).find((iv) => {
    const first = iv.anchors[0];
    const last = iv.anchors[iv.anchors.length - 1];
    return first !== undefined && last !== undefined && first.s <= startM && endM <= last.s;
  });
  if (holder === undefined) {
    return null;
  }
  const mp = interpolateMilepost(sM, holder.anchors);
  return mp.kind === 'calibrated' ? mp.mp : null; // miles
}

/**
 * Builds the app-facing {@link NetworkAsset} from stored integers. Shared by the tile and
 * snapshot decoders so the two views are deep-equal.
 *
 * Formulas (units): `sM = (sStartMm + sEndMm) / 2 / 1000` metres (midpoint of the stored start
 * and end, as for diamonds); `residualM = residualMm / 1000` metres; `derivedMp` in miles by
 * {@link derivedMpOf} (a line asset's milepost is interpolated at its midpoint inside one
 * interval, or null across an interval boundary); `at` = vertex floor((n - 1) / 2) in degrees
 * (E6 / 1e6). `intervals` are the decoded network's calibrated intervals.
 */
export function buildAsset(a: AssetParts, intervals: IntervalsByChain): NetworkAsset {
  const mid = Math.floor((a.latE6.length - 1) / 2); // index of the representative vertex
  const positions: AssetPosition[] = a.positions.map((p) => {
    const sM = (p.sStartMm + p.sEndMm) / 2 / 1000; // millimetres -> metres
    return {
      chainId: p.chainId,
      sM,
      residualM: p.residualMm / 1000, // millimetres -> metres
      derivedMp: derivedMpOf(p, sM, intervals),
    };
  });
  return {
    id: a.id,
    kind: a.kind,
    name: a.name,
    posted: a.posted,
    positions,
    at: { lat: (a.latE6[mid] as number) / 1e6, lon: (a.lonE6[mid] as number) / 1e6 },
  };
}

/**
 * One diamond position per `positions` entry of each asset of kind `diamond`, sorted by
 * (asset id, chain id, s). Same midpoint rule as {@link buildAsset}: metres along the base chain.
 */
export function diamondsOf(assets: readonly NetworkAsset[]): DiamondPosition[] {
  const out: DiamondPosition[] = [];
  for (const asset of assets) {
    if (asset.kind === 'diamond') {
      for (const p of asset.positions) {
        out.push({ assetId: asset.id, chainId: p.chainId, sM: p.sM });
      }
    }
  }
  return out.sort(
    (a, b) => byString(a.assetId, b.assetId) || byString(a.chainId, b.chainId) || a.sM - b.sM,
  );
}

function nullableNumberAt(o: Rec, key: string, path: string): number | null {
  if (o[key] === null) {
    return null;
  }
  return finiteAt(o, key, path);
}

function parsePosted(o: Rec, path: string): AssetPosted | null {
  const v = o.posted;
  if (v === null) {
    return null;
  }
  const r = recAt(v, `${path}.posted`);
  return {
    mp: finiteAt(r, 'mp', `${path}.posted`),
    subdivisionNid: strAt(r, 'subdivisionNid', `${path}.posted`),
    tier: oneOf(r, 'tier', `${path}.posted`, ANCHOR_TIERS) as AnchorTier,
  };
}

/**
 * Decodes an asset's `latE6` / `lonE6` into absolute microdegrees: same length, at least one
 * vertex, a real point on the globe (|lat| <= 90, |lon| <= 180 degrees). Unlike chain and segment
 * vertices there is no Canada-envelope check: the matcher never projects onto an asset, so an
 * odd asset position cannot make it throw, and M3's tests build tiles with placeholder assets.
 */
function decodeAssetVertices(o: Rec, path: string): { latE6: number[]; lonE6: number[] } {
  const latE6 = decodeDeltas(o, 'latE6', path);
  const lonE6 = decodeDeltas(o, 'lonE6', path);
  if (latE6.length === 0) {
    invalid(`${path}.latE6`, 'expected at least one vertex');
  }
  if (lonE6.length !== latE6.length) {
    invalid(`${path}.lonE6`, 'length differs from latE6');
  }
  if (latE6.some((v) => Math.abs(v) > MAX_LAT_E6)) {
    invalid(`${path}.latE6`, 'decoded latitude outside +-90 degrees');
  }
  if (lonE6.some((v) => Math.abs(v) > MAX_LON_E6)) {
    invalid(`${path}.lonE6`, 'decoded longitude outside +-180 degrees');
  }
  return { latE6, lonE6 };
}

function parseAsset(raw: unknown, path: string): ParsedTile['assets'][number] {
  const o = recAt(raw, path);
  const positions = arrAt(o, 'positions', path).map((p, i) => {
    const pp = `${path}.positions[${String(i)}]`;
    const r = recAt(p, pp);
    const residualMm = intAt(r, 'residualMm', pp);
    if (residualMm < 0) {
      invalid(`${pp}.residualMm`, 'expected a non-negative integer');
    }
    return {
      chainId: strAt(r, 'chainId', pp),
      sStartMm: intAt(r, 'sStartMm', pp),
      sEndMm: intAt(r, 'sEndMm', pp),
      residualMm,
      derivedMpStart: nullableNumberAt(r, 'derivedMpStart', pp),
      derivedMpEnd: nullableNumberAt(r, 'derivedMpEnd', pp),
    };
  });
  const name = o.name;
  if (name !== null && typeof name !== 'string') {
    invalid(`${path}.name`, 'expected a string or null');
  }
  const { latE6, lonE6 } = decodeAssetVertices(o, path);
  return {
    raw: o,
    parts: {
      id: strAt(o, 'id', path),
      kind: oneOf(o, 'kind', path, ASSET_KINDS) as AssetKind,
      name,
      posted: parsePosted(o, path),
      positions,
      latE6,
      lonE6,
    },
  };
}

function parseTile(raw: unknown, index: number): ParsedTile {
  const path = `tiles[${String(index)}]`;
  const o = recAt(raw, path);
  if (o.schema !== 'cantre.tile/1') {
    invalid(`${path}.schema`, "expected 'cantre.tile/1'");
  }
  strAt(o, 'key', path);
  const list = (key: string): readonly unknown[] => arrAt(o, key, path);
  return {
    datasetVersion: strAt(o, 'datasetVersion', path),
    bounds: parseBounds(o, path),
    chains: list('chains').map((c, i) => parsePiece(c, `${path}.chains[${String(i)}]`)),
    segments: list('segments').map((s, i) => parseSegment(s, `${path}.segments[${String(i)}]`)),
    anchors: list('anchors').map((a, i) => parseAnchor(a, `${path}.anchors[${String(i)}]`)),
    intervals: list('intervals').map((v, i) => parseInterval(v, `${path}.intervals[${String(i)}]`)),
    assets: list('assets').map((a, i) => parseAsset(a, `${path}.assets[${String(i)}]`)),
  };
}

/** Structural equality of two parsed-JSON values (objects ignore key order). */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return (
    ka.length === kb.length &&
    ka.every(
      (k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual((a as Rec)[k], (b as Rec)[k]),
    )
  );
}

/** Code-point order, so results do not depend on the host locale. */
export function byString(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}

/**
 * Adds `item` under `key`, or checks it equals the item already there. Equal duplicates are the
 * same object seen from two tiles (tiles carry buffered geometry, so neighbours overlap); an
 * unequal one means the tiles disagree and nothing may be guessed.
 */
function addUnique<T>(map: Map<string, T>, key: string, item: T, raw: unknown, what: string): void {
  const prior = map.get(key);
  if (prior === undefined) {
    map.set(key, item);
    return;
  }
  const priorRaw = (prior as { raw?: unknown }).raw;
  if (!deepEqual(priorRaw, raw)) {
    throw new CoreInputError('TILE_MISMATCH', `${what} ${key} differs between tiles`);
  }
}

/**
 * Merges the pieces of one chain, ordered by `vertexStart`, into one or more chains.
 *
 * Rule: a piece joins the current run when it starts at or before the run's end (contiguous or
 * overlapping vertex indices). Overlapping vertices must agree exactly in `latE6`, `lonE6` and
 * `sMm`, else `TILE_MISMATCH`; they are kept once. A piece that starts beyond the run's end leaves
 * a gap of unloaded vertices, so it starts a new run: the decoder never bridges a gap.
 */
function mergePieces(
  id: string,
  pieces: readonly Piece[],
  trackClasses: readonly string[],
): NetworkChain[] {
  const first = pieces[0] as Piece;
  for (const p of pieces) {
    if (
      p.subdivisionNid !== first.subdivisionNid ||
      p.subdivisionName !== first.subdivisionName ||
      p.cycle !== first.cycle ||
      !deepEqual(p.operators, first.operators)
    ) {
      throw new CoreInputError(
        'TILE_MISMATCH',
        `chain ${id} has inconsistent attributes between tiles`,
      );
    }
  }
  const ordered = [...pieces].sort((a, b) => a.vertexStart - b.vertexStart);
  type Run = { start: number; latE6: number[]; lonE6: number[]; sMm: number[] };
  const runs: Run[] = [];
  for (const p of ordered) {
    let run = runs.at(-1);
    if (run === undefined || p.vertexStart > run.start + run.latE6.length) {
      run = { start: p.vertexStart, latE6: [], lonE6: [], sMm: [] };
      runs.push(run);
    }
    for (let i = 0; i < p.latE6.length; i += 1) {
      const slot = p.vertexStart + i - run.start; // index of this vertex within the run
      if (slot < run.latE6.length) {
        if (
          run.latE6[slot] !== p.latE6[i] ||
          run.lonE6[slot] !== p.lonE6[i] ||
          run.sMm[slot] !== p.sMm[i]
        ) {
          throw new CoreInputError(
            'TILE_MISMATCH',
            `chain ${id} vertex ${String(p.vertexStart + i)} differs between tiles`,
          );
        }
      } else {
        run.latE6.push(p.latE6[i] as number);
        run.lonE6.push(p.lonE6[i] as number);
        run.sMm.push(p.sMm[i] as number);
      }
    }
  }
  return runs.map((run, n) => {
    // metres = millimetres / 1000, exact to the stored millimetre.
    const sM = Float64Array.from(run.sMm, (mm) => mm / 1000);
    const s0 = sM[0] as number;
    // Rebase so cumulativeM[0] = 0 (metres), the form projectOntoPolyline needs. Subtracting two
    // millimetre-exact metre values is exact to well under 1e-9 m at chain scale (< 1e7 m).
    const cumulativeM = Float64Array.from(sM, (v) => v - s0);
    return {
      id: n === 0 ? id : `${id}#${String(n + 1)}`,
      chainBaseId: id,
      subdivisionNid: first.subdivisionNid,
      subdivisionName: first.subdivisionName,
      operators: first.operators,
      cycle: first.cycle,
      trackClasses,
      pts: toPoints(run.latE6, run.lonE6),
      sM,
      cumulativeM,
    };
  });
}

/**
 * Decodes `cantre.tile/1` tiles into one `NetworkView`.
 *
 * Rules:
 * - Every tile is validated as far as the fields read (`INVALID_TILE`, message names the path,
 *   for example `tiles[3].chains[0].latE6[2]`). Unknown extra fields are ignored.
 * - All tiles must share one `datasetVersion` (`MIXED_DATASET_VERSION`).
 * - Chain pieces with one id are merged by `vertexStart`; overlap must agree (`TILE_MISMATCH`);
 *   non-contiguous pieces stay separate chains `id`, `id#2`, ...
 * - Chains, segments and assets de-duplicate by id, and anchors by (chainId, id) because the
 *   schema makes anchor ids unique per chain only. A duplicate must be deep-equal
 *   (`TILE_MISMATCH`).
 * - An interval is kept only when every one of its anchor ids resolves on its chain among the
 *   loaded tiles; otherwise it is dropped whole (never interpolate on partial evidence). Kept
 *   intervals list their anchors in ascending `s`, and must then pass M1 `validateInterval`
 *   (distinct positions, finite values, strictly monotonic milepost); one that fails throws
 *   `INVALID_TILE` naming the interval's path and the issue codes (ruling R28: the matcher must
 *   never throw on a decoded network, so a bad interval is rejected here, loudly).
 * - Every vertex lies inside `CANADA_ENVELOPE` and chain `sMm` never decreases, else
 *   `INVALID_TILE` (ruling R28).
 * - Every asset becomes a {@link NetworkAsset} (see {@link buildAsset}), sorted by id.
 * - A diamond position is emitted for each `positions` entry of each asset of kind `diamond`,
 *   at the midpoint of its stored start and end: sM = (sStartMm + sEndMm) / 2 / 1000 metres. The
 *   pipeline stores a point diamond with start = end, so the midpoint is that point; if a diamond
 *   ever spans a stretch the midpoint is a representative position, not an extent.
 * - `coverage` lists each tile's unbuffered `bounds`.
 * - Output is sorted by id, so tile order never matters.
 *
 * Units: coordinates in degrees; `sM`, `cumulativeM`, anchor `s` and diamond `sM` in metres.
 * Source: spec §6 (network data), tile schema cantre.tile/1.
 * Limits: validates structure, not truth. It cannot know that a tile is missing from the middle
 * of a chain beyond a gap in vertex indices, and a tile list that is empty gives an empty view.
 */
export function networkFromTiles(tiles: readonly unknown[]): NetworkView {
  const parsed = tiles.map((t, i) => parseTile(t, i));

  const datasetVersion = parsed[0]?.datasetVersion ?? '';
  for (const [i, t] of parsed.entries()) {
    if (t.datasetVersion !== datasetVersion) {
      throw new CoreInputError(
        'MIXED_DATASET_VERSION',
        `tiles[${String(i)}] has datasetVersion '${t.datasetVersion}', expected '${datasetVersion}'`,
      );
    }
  }

  const piecesById = new Map<string, Piece[]>();
  for (const t of parsed) {
    for (const p of t.chains) {
      const list = piecesById.get(p.id) ?? [];
      list.push(p);
      piecesById.set(p.id, list);
    }
  }

  const segments = new Map<string, { raw: Rec; seg: NetworkSegment }>();
  const anchors = new Map<string, { raw: Rec; chainId: string; anchor: Anchor }>();
  const intervals = new Map<string, ParsedTile['intervals'][number]>();
  const assets = new Map<string, ParsedTile['assets'][number]>();
  for (const t of parsed) {
    for (const s of t.segments) {
      addUnique(segments, s.seg.key, s, s.raw, 'segment');
    }
    for (const a of t.anchors) {
      const key = JSON.stringify([a.chainId, a.anchor.id]);
      addUnique(anchors, key, a, a.raw, `anchor (chain ${a.chainId}) id`);
    }
    for (const v of t.intervals) {
      addUnique(intervals, v.id, v, v.raw, 'interval');
    }
    for (const a of t.assets) {
      addUnique(assets, a.parts.id, a, a.raw, 'asset');
    }
  }

  // Track classes per chain from the loaded segments that belong to it.
  const classesByChain = new Map<string, Set<string>>();
  for (const { seg } of segments.values()) {
    if (seg.chainId !== null) {
      const set = classesByChain.get(seg.chainId) ?? new Set<string>();
      set.add(seg.trackClass);
      classesByChain.set(seg.chainId, set);
    }
  }

  const chains = [...piecesById.entries()]
    .flatMap(([id, pieces]) =>
      mergePieces(id, pieces, [...(classesByChain.get(id) ?? [])].sort(byString)),
    )
    .sort((a, b) => byString(a.id, b.id));

  const outIntervals: NetworkInterval[] = [];
  for (const iv of intervals.values()) {
    const resolved = iv.anchorIds.map((id) => anchors.get(JSON.stringify([iv.chainId, id])));
    if (resolved.some((r) => r === undefined)) {
      continue; // R6: drop the whole interval rather than interpolate on partial evidence
    }
    const list = resolved.map((r) => (r as { anchor: Anchor }).anchor);
    list.sort((a, b) => a.s - b.s || byString(a.id, b.id));
    const issues = validateInterval(list);
    if (issues.length > 0) {
      const detail = issues.map((x) => `${x.code} [${x.anchorIds.join(', ')}]`).join('; ');
      invalid(iv.path, `interval ${iv.id} fails validateInterval: ${detail}`);
    }
    outIntervals.push({ id: iv.id, chainId: iv.chainId, anchors: list });
  }
  outIntervals.sort((a, b) => byString(a.id, b.id));

  const byChain = intervalsByChain(outIntervals);
  const outAssets = [...assets.values()]
    .map((a) => buildAsset(a.parts, byChain))
    .sort((a, b) => byString(a.id, b.id));

  const coverage = parsed
    .map((t) => t.bounds)
    .sort((a, b) => a.south - b.south || a.west - b.west || a.north - b.north || a.east - b.east);

  return {
    datasetVersion,
    coverage,
    chains,
    segments: [...segments.values()]
      .map((s) => s.seg)
      .filter((s) => s.chainId === null)
      .sort((a, b) => byString(a.key, b.key)),
    intervals: outIntervals,
    diamonds: diamondsOf(outAssets),
    assets: outAssets,
  };
}
