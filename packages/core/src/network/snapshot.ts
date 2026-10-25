import { validateInterval } from '../anchors.js';
import type { Anchor, AnchorSource, AnchorTier } from '../anchors.js';
import { CANADA_ENVELOPE } from '../coords.js';
import type { LatLon } from '../coords.js';
import { CoreInputError } from '../errors.js';
import {
  ANCHOR_SOURCES,
  ANCHOR_TIERS,
  ASSET_KINDS,
  buildAsset,
  byString,
  diamondsOf,
  toPoints,
} from './decode.js';
import type {
  AssetKind,
  NetworkAsset,
  NetworkChain,
  NetworkInterval,
  NetworkSegment,
  NetworkView,
  TileBounds,
} from './types.js';

/**
 * Decoder from the national snapshot (pipeline/schema/snapshot.md, format version 1) to the same
 * `NetworkView` that `networkFromTiles` builds. The input is the bytes AFTER gunzip; unzipping is
 * the caller's job (the browser does it with `DecompressionStream`).
 *
 * Pure: no IO, no clock. Every field read is validated, and a bad one throws
 * `CoreInputError('INVALID_SNAPSHOT')` whose message starts `byte N:` with N the offset in the
 * decompressed data where the problem lies (a JSON section problem names the section's first
 * byte, a geometry problem the first byte of the offending varint or vertex). The decoder never
 * repairs: nothing is interpolated, bridged or defaulted (spec §6, snapshot.md section 10).
 *
 * Units: coordinates are integer microdegrees on disk (degrees = E6 / 1e6) and degrees in the
 * view; along-chain distance is integer millimetres on disk (metres = mm / 1000) and metres in
 * the view; mileposts are miles throughout. All running sums are of integers below 2^53, so they
 * are exact in a double.
 */

const MAGIC = [0x43, 0x4e, 0x54, 0x53]; // "CNTS"
const FORMAT_VERSION = 1;
/** A zigzag value below 2^53 needs at most ceil(53 / 7) = 8 LEB128 bytes. */
const MAX_VARINT_BYTES = 8;
/** 2^53: the first integer a double cannot hold exactly; a zigzag value must be below it. */
const TWO_53 = 2 ** 53;

/** Latitude and longitude limits in microdegrees: the real globe, then {@link CANADA_ENVELOPE}. */
const MAX_LAT_E6 = 90_000_000;
const MAX_LON_E6 = 180_000_000;
const ENV = {
  minLat: Math.round(CANADA_ENVELOPE.minLat * 1e6),
  maxLat: Math.round(CANADA_ENVELOPE.maxLat * 1e6),
  minLon: Math.round(CANADA_ENVELOPE.minLon * 1e6),
  maxLon: Math.round(CANADA_ENVELOPE.maxLon * 1e6),
};

/** Throws `INVALID_SNAPSHOT` naming the byte offset. */
function fail(offset: number, problem: string): never {
  throw new CoreInputError('INVALID_SNAPSHOT', `byte ${String(offset)}: ${problem}`);
}

/**
 * Checks a decoded vertex (microdegrees): a real point on the globe (snapshot.md section 6) that
 * also lies inside the Canada envelope, as `networkFromTiles` requires (a vertex outside it would
 * make the matcher's projection throw later, so the snapshot is rejected here, loudly).
 */
function checkVertex(offset: number, latE6: number, lonE6: number, what: string): void {
  if (Math.abs(latE6) > MAX_LAT_E6) {
    fail(offset, `${what}: latitude outside +-90 degrees`);
  }
  if (Math.abs(lonE6) > MAX_LON_E6) {
    fail(offset, `${what}: longitude outside +-180 degrees`);
  }
  if (latE6 < ENV.minLat || latE6 > ENV.maxLat || lonE6 < ENV.minLon || lonE6 > ENV.maxLon) {
    fail(offset, `${what}: vertex outside the Canada envelope`);
  }
}

/** A read position in the decompressed bytes. */
class Cursor {
  pos: number;
  /** Where the varint most recently read started (for error offsets). */
  lastStart = 0;

  constructor(
    readonly bytes: Uint8Array,
    pos: number,
  ) {
    this.pos = pos;
  }

  get remaining(): number {
    return this.bytes.length - this.pos;
  }

  /**
   * Reads one zigzag LEB128 varint (snapshot.md section 7) with `Number` arithmetic only, never
   * a 32-bit operator.
   *
   * Formula: z = sum of (byte & 0x7f) * 128^i, i = 0.., then v = z / 2 if z is even, else
   * -(z + 1) / 2. Limits: at most 8 bytes, minimal form (no padded last group), and z < 2^53 so
   * that -2^52 <= v <= 2^52 - 1 is exact in a double; anything else is `INVALID_SNAPSHOT`.
   */
  varint(): number {
    const start = this.pos;
    this.lastStart = start;
    let z = 0;
    let scale = 1; // 128^i
    for (let i = 0; i < MAX_VARINT_BYTES; i += 1) {
      const b = this.bytes[this.pos];
      if (b === undefined) {
        return fail(start, 'the data ends inside a varint');
      }
      this.pos += 1;
      z += (b & 0x7f) * scale; // exact while z < 2^53; a larger sum is rejected below
      if (b < 0x80) {
        if (b === 0 && i > 0) {
          return fail(start, 'varint is not in minimal form');
        }
        if (z >= TWO_53) {
          return fail(start, 'varint value outside -2^52..2^52-1');
        }
        return z % 2 === 0 ? z / 2 : -(z + 1) / 2;
      }
      scale *= 128;
    }
    return fail(start, 'varint longer than 8 bytes');
  }
}

/** A `u32` little-endian at `pos`, or `INVALID_SNAPSHOT` when fewer than four bytes remain. */
function readU32(bytes: Uint8Array, pos: number, what: string): number {
  if (pos + 4 > bytes.length) {
    return fail(pos, `the data ends before the ${what}`);
  }
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(pos, true);
}

/** Reads one JSON object section (`u32` length, then that many UTF-8 bytes) at `pos`. */
function readSection(
  bytes: Uint8Array,
  pos: number,
  what: string,
): { readonly value: unknown; readonly start: number; readonly next: number } {
  const length = readU32(bytes, pos, `${what} length`);
  const start = pos + 4;
  const next = start + length;
  if (next > bytes.length) {
    return fail(pos, `the ${what} section (${String(length)} bytes) runs past the end of the data`);
  }
  let value: unknown;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(start, next));
    value = JSON.parse(text) as unknown;
  } catch {
    return fail(start, `the ${what} section is not valid UTF-8 JSON`);
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail(start, `the ${what} section is not a JSON object`);
  }
  return { value, start, next };
}

/** Validators for the JSON sections; every failure names the section's first byte. */
class Check {
  constructor(private readonly offset: number) {}

  bad(path: string, problem: string): never {
    return fail(this.offset, `${path}: ${problem}`);
  }

  obj(x: unknown, path: string): Readonly<Record<string, unknown>> {
    if (typeof x !== 'object' || x === null || Array.isArray(x)) {
      return this.bad(path, 'expected an object');
    }
    return x as Readonly<Record<string, unknown>>;
  }

  arr(x: unknown, path: string): readonly unknown[] {
    if (!Array.isArray(x)) {
      return this.bad(path, 'expected an array');
    }
    return x as readonly unknown[];
  }

  /** A positional record of exactly `length` fields. */
  tuple(x: unknown, path: string, length: number): readonly unknown[] {
    const a = this.arr(x, path);
    if (a.length !== length) {
      return this.bad(path, `expected ${String(length)} fields, got ${String(a.length)}`);
    }
    return a;
  }

  str(x: unknown, path: string): string {
    if (typeof x !== 'string') {
      return this.bad(path, 'expected a string');
    }
    return x;
  }

  nstr(x: unknown, path: string): string | null {
    return x === null ? null : this.str(x, path);
  }

  bool(x: unknown, path: string): boolean {
    if (typeof x !== 'boolean') {
      return this.bad(path, 'expected a boolean');
    }
    return x;
  }

  num(x: unknown, path: string): number {
    if (typeof x !== 'number' || !Number.isFinite(x)) {
      return this.bad(path, 'expected a finite number');
    }
    return x;
  }

  nnum(x: unknown, path: string): number | null {
    return x === null ? null : this.num(x, path);
  }

  int(x: unknown, path: string): number {
    if (typeof x !== 'number' || !Number.isSafeInteger(x)) {
      return this.bad(path, 'expected an integer');
    }
    return x;
  }

  nonNeg(x: unknown, path: string): number {
    const v = this.int(x, path);
    if (v < 0) {
      return this.bad(path, 'expected a non-negative integer');
    }
    return v;
  }

  strs(x: unknown, path: string): string[] {
    return this.arr(x, path).map((v, i) => this.str(v, `${path}[${String(i)}]`));
  }

  oneOf(x: unknown, path: string, allowed: readonly string[]): string {
    const v = this.str(x, path);
    if (!allowed.includes(v)) {
      return this.bad(path, `expected one of ${allowed.join(', ')}`);
    }
    return v;
  }

  /** Records `id` in `seen`, failing on a repeat. */
  unique(seen: Set<string>, id: string, path: string): void {
    if (seen.has(id)) {
      this.bad(path, `duplicate id ${JSON.stringify(id)}`);
    }
    seen.add(id);
  }
}

type Meta = {
  readonly datasetVersion: string;
  readonly coverage: readonly TileBounds[];
};

/**
 * Meta (snapshot.md section 4). `coverage` cells are microdegrees on disk and become degrees
 * (E6 / 1e6), strictly increasing by (south, west, north, east), each with south < north and
 * west < east, which also rules out duplicates.
 */
function parseMeta(value: unknown, offset: number): Meta {
  const c = new Check(offset);
  const o = c.obj(value, 'meta');
  const datasetVersion = c.str(o.datasetVersion, 'meta.datasetVersion');
  if (datasetVersion === '') {
    c.bad('meta.datasetVersion', 'expected a non-empty string');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.str(o.snapshotDate, 'meta.snapshotDate'))) {
    c.bad('meta.snapshotDate', 'expected YYYY-MM-DD');
  }
  c.str(o.attribution, 'meta.attribution');
  const versions = c.obj(o.packageVersions, 'meta.packageVersions');
  for (const [k, v] of Object.entries(versions)) {
    c.str(v, `meta.packageVersions.${k}`);
  }
  let prev: readonly number[] | null = null;
  const coverage = c.arr(o.coverage, 'meta.coverage').map((cell, i): TileBounds => {
    const path = `meta.coverage[${String(i)}]`;
    const v = c.tuple(cell, path, 4).map((x, j) => c.int(x, `${path}[${String(j)}]`));
    const [south, west, north, east] = v as [number, number, number, number];
    if (south >= north || west >= east) {
      c.bad(path, 'expected south < north and west < east');
    }
    if (prev !== null && !isAfter(v, prev)) {
      c.bad(path, 'cells must be sorted with no duplicates');
    }
    prev = v;
    return { south: south / 1e6, west: west / 1e6, north: north / 1e6, east: east / 1e6 };
  });
  return { datasetVersion, coverage };
}

/** True when tuple `a` sorts strictly after tuple `b` (lexicographic, numbers). */
function isAfter(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i += 1) {
    if ((a[i] as number) !== (b[i] as number)) {
      return (a[i] as number) > (b[i] as number);
    }
  }
  return false;
}

type ChainRec = {
  readonly id: string;
  readonly subdivisionNid: string;
  readonly subdivisionName: string;
  readonly operators: readonly string[];
  readonly cycle: boolean;
  readonly trackClasses: readonly string[];
};

type SegmentRec = {
  readonly key: string;
  readonly trackClass: string;
  readonly status: string;
  readonly subdivisionNid: string;
  readonly subdivisionName: string;
  readonly operator: string;
  readonly geoAccuracyM: number | null;
};

type AnchorRec = { readonly chainId: string; readonly anchor: Anchor; readonly sMm: number };

/**
 * Decodes the delta-encoded `latE6` / `lonE6` arrays of an asset (snapshot.md section 5): the
 * first value is absolute, every later one is the difference from the previous. Both arrays must
 * have the same length, at least one vertex, and every decoded vertex a real point on the globe.
 * As in the tile decoder there is no Canada-envelope check for assets (the matcher never projects
 * onto one).
 */
function assetVertices(
  c: Check,
  latDeltas: unknown,
  lonDeltas: unknown,
  path: string,
): { latE6: number[]; lonE6: number[] } {
  const run = (x: unknown, key: string): number[] => {
    let total = 0; // running sum of integers: exact below 2^53
    return c.arr(x, `${path}.${key}`).map((v, i) => {
      total += c.int(v, `${path}.${key}[${String(i)}]`);
      return total;
    });
  };
  const latE6 = run(latDeltas, 'latE6');
  const lonE6 = run(lonDeltas, 'lonE6');
  if (latE6.length === 0) {
    c.bad(`${path}.latE6`, 'expected at least one vertex');
  }
  if (lonE6.length !== latE6.length) {
    c.bad(`${path}.lonE6`, 'length differs from latE6');
  }
  if (latE6.some((v) => Math.abs(v) > MAX_LAT_E6)) {
    c.bad(`${path}.latE6`, 'decoded latitude outside +-90 degrees');
  }
  if (lonE6.some((v) => Math.abs(v) > MAX_LON_E6)) {
    c.bad(`${path}.lonE6`, 'decoded longitude outside +-180 degrees');
  }
  return { latE6, lonE6 };
}

/**
 * Decodes a national snapshot (the bytes after gunzip) into a `NetworkView`.
 *
 * The view is deep-equal to `networkFromTiles` of the tiles the snapshot was written from:
 * chains, segments, intervals, diamonds, assets and coverage are sorted by id (code-point order)
 * and carry the same values. Differences from the tile route, by design: chains arrive whole (so
 * `id === chainBaseId` and there is no `#2` piece), a missing anchor or chain is corruption
 * rather than "not loaded" (the snapshot is the whole country), and `coverage` comes from the
 * snapshot's own cell list.
 *
 * Throws `CoreInputError('INVALID_SNAPSHOT')` with a `byte N:` message for: a short or
 * mis-magicked file, a format version other than 1, a section that runs past the data or is not
 * a JSON object, any record that fails its type check, a duplicate chain, segment, interval or
 * asset id (an anchor id repeated on one chain), an anchor, interval or asset that names a chain
 * or anchor that does not exist, an interval that fails `validateInterval`, a vertex count of 0
 * or one that cannot fit in the remaining bytes, a first chain position other than 0, a position
 * that decreases, a vertex outside the Canada envelope, a cycle chain that is not closed, a
 * varint outside -2^52..2^52-1, longer than 8 bytes, padded or cut off, and bytes left after the
 * geometry. Limits: validates structure, not truth.
 */
export function networkFromSnapshot(bytes: Uint8Array): NetworkView {
  // 1-2. Magic and version.
  if (bytes.length < MAGIC.length || MAGIC.some((m, i) => bytes[i] !== m)) {
    fail(0, 'not a CANTRE snapshot (bad magic)');
  }
  const version = bytes[4];
  if (version === undefined) {
    fail(4, 'the data ends before the format version');
  }
  if (version !== FORMAT_VERSION) {
    fail(4, `unsupported snapshot format version ${String(version)} (expected 1)`);
  }

  // 3-6. Meta and records.
  const metaSection = readSection(bytes, 5, 'meta');
  const recSection = readSection(bytes, metaSection.next, 'records');
  const meta = parseMeta(metaSection.value, metaSection.start);
  const rs = recSection.start; // every record problem is reported at the section's first byte
  const c: Check = new Check(rs);
  const rec = c.obj(recSection.value, 'records');

  const chainRecs: ChainRec[] = [];
  const chainIds = new Set<string>();
  c.arr(rec.chains, 'records.chains').forEach((x, i) => {
    const path = `records.chains[${String(i)}]`;
    const f = c.tuple(x, path, 6);
    const chain: ChainRec = {
      id: c.str(f[0], `${path}[0]`),
      subdivisionNid: c.str(f[1], `${path}[1]`),
      subdivisionName: c.str(f[2], `${path}[2]`),
      operators: c.strs(f[3], `${path}[3]`),
      cycle: c.bool(f[4], `${path}[4]`),
      trackClasses: c.strs(f[5], `${path}[5]`),
    };
    c.unique(chainIds, chain.id, path);
    chainRecs.push(chain);
  });

  const segRecs: SegmentRec[] = [];
  const segKeys = new Set<string>();
  c.arr(rec.segments, 'records.segments').forEach((x, i) => {
    const path = `records.segments[${String(i)}]`;
    const f = c.tuple(x, path, 7);
    const seg: SegmentRec = {
      key: c.str(f[0], `${path}[0]`),
      trackClass: c.str(f[1], `${path}[1]`),
      status: c.str(f[2], `${path}[2]`),
      subdivisionNid: c.str(f[3], `${path}[3]`),
      subdivisionName: c.str(f[4], `${path}[4]`),
      operator: c.str(f[5], `${path}[5]`),
      geoAccuracyM: f[6] === null ? null : c.nonNeg(f[6], `${path}[6]`),
    };
    c.unique(segKeys, seg.key, path);
    segRecs.push(seg);
  });

  // 7. Geometry: chains in record order, then segments.
  const cur = new Cursor(bytes, recSection.next);
  const chains: NetworkChain[] = [];
  const chainEnd = new Map<string, number>(); // chain id -> last position, millimetres
  for (const cr of chainRecs) {
    const read = readChain(cur, cr);
    chains.push(read.chain);
    chainEnd.set(cr.id, read.endMm);
  }
  const segments: NetworkSegment[] = segRecs.map((sr) => readSegment(cur, sr));
  if (cur.remaining !== 0) {
    fail(cur.pos, `${String(cur.remaining)} bytes left after the geometry`);
  }

  // Anchors, intervals, assets: cross-checked against the chains.
  const anchors = new Map<string, Map<string, Anchor>>();
  c.arr(rec.anchors, 'records.anchors').forEach((x, i) => {
    const a = parseAnchor(c, x, `records.anchors[${String(i)}]`);
    const end = chainEnd.get(a.chainId);
    const path = `records.anchors[${String(i)}]`;
    if (end === undefined) {
      c.bad(path, `chain ${JSON.stringify(a.chainId)} does not exist`);
    }
    if (a.sMm > end) {
      c.bad(path, 'anchor lies beyond the end of its chain');
    }
    const onChain = anchors.get(a.chainId) ?? new Map<string, Anchor>();
    if (onChain.has(a.anchor.id)) {
      c.bad(path, `duplicate anchor id ${JSON.stringify(a.anchor.id)} on chain ${a.chainId}`);
    }
    onChain.set(a.anchor.id, a.anchor);
    anchors.set(a.chainId, onChain);
  });

  const intervals: NetworkInterval[] = [];
  const intervalIds = new Set<string>();
  c.arr(rec.intervals, 'records.intervals').forEach((x, i) => {
    const path = `records.intervals[${String(i)}]`;
    const f = c.tuple(x, path, 3);
    const id = c.str(f[0], `${path}[0]`);
    const chainId = c.str(f[1], `${path}[1]`);
    const ids = c.strs(f[2], `${path}[2]`);
    c.unique(intervalIds, id, path);
    if (!chainIds.has(chainId)) {
      c.bad(path, `chain ${JSON.stringify(chainId)} does not exist`);
    }
    if (ids.length < 2) {
      c.bad(`${path}[2]`, 'expected at least 2 anchor ids');
    }
    const list = ids.map((aid) => {
      const a = anchors.get(chainId)?.get(aid);
      return a ?? c.bad(`${path}[2]`, `anchor ${JSON.stringify(aid)} is not on chain ${chainId}`);
    });
    list.sort((a, b) => a.s - b.s || byString(a.id, b.id));
    const issues = validateInterval(list);
    if (issues.length > 0) {
      const detail = issues.map((n) => `${n.code} [${n.anchorIds.join(', ')}]`).join('; ');
      c.bad(path, `interval ${id} fails validateInterval: ${detail}`);
    }
    intervals.push({ id, chainId, anchors: list });
  });

  const assetIds = new Set<string>();
  const assets: NetworkAsset[] = c.arr(rec.assets, 'records.assets').map((x, i) => {
    const path = `records.assets[${String(i)}]`;
    const asset = parseAsset(c, x, path, chainIds);
    c.unique(assetIds, asset.id, path);
    return asset;
  });
  assets.sort((a, b) => byString(a.id, b.id));

  return {
    datasetVersion: meta.datasetVersion,
    coverage: meta.coverage,
    chains: chains.sort((a, b) => byString(a.id, b.id)),
    segments: segments.sort((a, b) => byString(a.key, b.key)),
    intervals: intervals.sort((a, b) => byString(a.id, b.id)),
    diamonds: diamondsOf(assets),
    assets,
  };
}

/**
 * Reads one chain's geometry: `n`, then `n` triples (dLat, dLon, dS), each a delta from the
 * previous vertex of the chain, the first from 0 (snapshot.md section 6).
 *
 * Running sums (exact integers): lat[i] = lat[i-1] + dLat (microdegrees), lon[i] likewise, and
 * s[i] = s[i-1] + dS (millimetres). Invariants enforced: n >= 1 and n * 3 <= bytes left (a vertex
 * needs at least three bytes, so a hostile `n` cannot make us allocate); s[0] = 0; dS >= 0; every
 * vertex passes {@link checkVertex}; a cycle chain ends where it starts.
 * Output units: degrees and metres (`sM` = mm / 1000); `cumulativeM` is `sM` rebased to start at 0,
 * which it already does, so it is a copy.
 */
function readChain(
  cur: Cursor,
  cr: ChainRec,
): { readonly chain: NetworkChain; readonly endMm: number } {
  const n = cur.varint();
  const nAt = cur.lastStart;
  if (n < 1) {
    fail(nAt, `chain ${cr.id}: vertex count must be at least 1`);
  }
  if (n * 3 > cur.remaining) {
    fail(nAt, `chain ${cr.id}: vertex count ${String(n)} runs past the end of the data`);
  }
  const latE6 = new Array<number>(n);
  const lonE6 = new Array<number>(n);
  const sMm = new Float64Array(n);
  let la = 0; // microdegrees
  let lo = 0; // microdegrees
  let s = 0; // millimetres
  for (let i = 0; i < n; i += 1) {
    const vertexAt = cur.pos;
    la += cur.varint();
    lo += cur.varint();
    const ds = cur.varint();
    if (ds < 0) {
      fail(cur.lastStart, `chain ${cr.id}: position decreases (negative distance step)`);
    }
    if (i === 0 && ds !== 0) {
      fail(cur.lastStart, `chain ${cr.id}: the first position must be 0`);
    }
    s += ds;
    if (s > Number.MAX_SAFE_INTEGER) {
      fail(cur.lastStart, `chain ${cr.id}: position exceeds 2^53 - 1 millimetres`);
    }
    checkVertex(vertexAt, la, lo, `chain ${cr.id} vertex ${String(i)}`);
    latE6[i] = la;
    lonE6[i] = lo;
    sMm[i] = s;
  }
  if (cr.cycle && (latE6[0] !== la || lonE6[0] !== lo)) {
    fail(cur.pos, `chain ${cr.id}: cycle chain does not end where it starts`);
  }
  // metres = millimetres / 1000, exact to the stored millimetre; sM[0] = 0 so no rebasing.
  const sM = Float64Array.from(sMm, (mm) => mm / 1000);
  const chain: NetworkChain = {
    id: cr.id,
    chainBaseId: cr.id,
    subdivisionNid: cr.subdivisionNid,
    subdivisionName: cr.subdivisionName,
    operators: cr.operators,
    cycle: cr.cycle,
    trackClasses: cr.trackClasses,
    pts: toPoints(latE6, lonE6),
    sM,
    cumulativeM: Float64Array.from(sM),
  };
  return { chain, endMm: s };
}

/** Reads one unchained segment's geometry: `n`, then `n` pairs (dLat, dLon). */
function readSegment(cur: Cursor, sr: SegmentRec): NetworkSegment {
  const n = cur.varint();
  const nAt = cur.lastStart;
  if (n < 1) {
    fail(nAt, `segment ${sr.key}: vertex count must be at least 1`);
  }
  if (n * 2 > cur.remaining) {
    fail(nAt, `segment ${sr.key}: vertex count ${String(n)} runs past the end of the data`);
  }
  const pts: LatLon[] = [];
  let la = 0; // microdegrees
  let lo = 0; // microdegrees
  for (let i = 0; i < n; i += 1) {
    const vertexAt = cur.pos;
    la += cur.varint();
    lo += cur.varint();
    checkVertex(vertexAt, la, lo, `segment ${sr.key} vertex ${String(i)}`);
    pts.push({ lat: la / 1e6, lon: lo / 1e6 });
  }
  return { ...sr, chainId: null, pts };
}

/** One anchor record `[chainId, id, sMm, mp, source, tier]`; `s` is metres = sMm / 1000. */
function parseAnchor(c: Check, x: unknown, path: string): AnchorRec {
  const f = c.tuple(x, path, 6);
  const sMm = c.nonNeg(f[2], `${path}[2]`);
  return {
    chainId: c.str(f[0], `${path}[0]`),
    sMm,
    anchor: {
      id: c.str(f[1], `${path}[1]`),
      s: sMm / 1000, // millimetres -> metres
      mp: c.num(f[3], `${path}[3]`), // miles
      source: c.oneOf(f[4], `${path}[4]`, ANCHOR_SOURCES) as AnchorSource,
      tier: c.oneOf(f[5], `${path}[5]`, ANCHOR_TIERS) as AnchorTier,
    },
  };
}

/**
 * One asset record `[id, kind, name, posted, positions, latE6, lonE6]`. Every position names an
 * existing chain with `sStartMm <= sEndMm` and `residualMm >= 0`; the vertices are delta decoded
 * like the tiles'. The view's asset is made by the same `buildAsset` as the tile route.
 */
function parseAsset(
  c: Check,
  x: unknown,
  path: string,
  chainIds: ReadonlySet<string>,
): NetworkAsset {
  const f = c.tuple(x, path, 7);
  const postedRaw = f[3];
  let posted = null;
  if (postedRaw !== null) {
    const p = c.tuple(postedRaw, `${path}[3]`, 3);
    posted = {
      mp: c.num(p[0], `${path}[3][0]`),
      subdivisionNid: c.str(p[1], `${path}[3][1]`),
      tier: c.oneOf(p[2], `${path}[3][2]`, ANCHOR_TIERS) as AnchorTier,
    };
  }
  const positions = c.arr(f[4], `${path}[4]`).map((q, j) => {
    const pp = `${path}[4][${String(j)}]`;
    const g = c.tuple(q, pp, 6);
    const chainId = c.str(g[0], `${pp}[0]`);
    if (!chainIds.has(chainId)) {
      c.bad(pp, `chain ${JSON.stringify(chainId)} does not exist`);
    }
    const sStartMm = c.nonNeg(g[1], `${pp}[1]`);
    const sEndMm = c.nonNeg(g[2], `${pp}[2]`);
    if (sStartMm > sEndMm) {
      c.bad(pp, 'start is after end');
    }
    return {
      chainId,
      sStartMm,
      sEndMm,
      residualMm: c.nonNeg(g[3], `${pp}[3]`),
      derivedMpStart: c.nnum(g[4], `${pp}[4]`),
      derivedMpEnd: c.nnum(g[5], `${pp}[5]`),
    };
  });
  const { latE6, lonE6 } = assetVertices(c, f[5], f[6], path);
  return buildAsset({
    id: c.str(f[0], `${path}[0]`),
    kind: c.oneOf(f[1], `${path}[1]`, ASSET_KINDS) as AssetKind,
    name: c.nstr(f[2], `${path}[2]`),
    posted,
    positions,
    latE6,
    lonE6,
  });
}
