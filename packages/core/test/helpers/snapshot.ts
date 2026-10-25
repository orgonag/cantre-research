/**
 * Test-only builder for tiny national snapshots (pipeline/schema/snapshot.md), so the decoder's
 * hardening can be tested with one thing broken at a time. Independent of the decoder: it writes
 * zigzag LEB128 varints with BigInt, so values beyond 2^53 can be produced on purpose.
 */

/** Zigzag LEB128 of `v` (snapshot.md section 7), any size. */
export function varint(v: bigint | number): number[] {
  const x = BigInt(v);
  let z = x >= 0n ? 2n * x : -2n * x - 1n;
  const out: number[] = [];
  while (z >= 0x80n) {
    out.push(Number(z & 0x7fn) | 0x80);
    z >>= 7n;
  }
  out.push(Number(z));
  return out;
}

/** The varint stream of one chain: `n`, then lat/lon/s triples as deltas from the previous. */
export function chainGeometry(vertices: readonly (readonly [number, number, number])[]): number[] {
  const out = varint(vertices.length);
  let la = 0;
  let lo = 0;
  let s = 0;
  for (const [a, b, c] of vertices) {
    out.push(...varint(a - la), ...varint(b - lo), ...varint(c - s));
    [la, lo, s] = [a, b, c];
  }
  return out;
}

/** `u32` little-endian. */
function u32(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
}

const utf8 = (x: unknown): number[] => [...new TextEncoder().encode(JSON.stringify(x))];

/** The default meta object. */
export const META = {
  datasetVersion: 'test-1',
  snapshotDate: '2026-10-25',
  attribution: 'Test attribution.',
  packageVersions: { sk: '2.0' },
  coverage: [[52000000, -106500000, 52250000, -106000000]],
};

/** One chain `c1` of 3 vertices about 68.6 m apart, with two anchors and one interval. */
export const RECORDS = {
  chains: [['c1', 'S1', 'Sub One', ['CN'], false, ['Main']]],
  segments: [] as unknown[],
  anchors: [
    ['c1', 'a0', 0, 10, 'markerpost', 'posted'],
    ['c1', 'a1', 137200, 11, 'markerpost', 'posted'],
  ],
  intervals: [['c1.i0', 'c1', ['a0', 'a1']]],
  assets: [] as unknown[],
};

/** The default geometry stream that matches {@link RECORDS}. */
export const GEOMETRY: readonly number[] = chainGeometry([
  [52100000, -105900000, 0],
  [52100000, -105899000, 68600],
  [52100000, -105898000, 137200],
]);

export type SnapshotParts = {
  readonly magic?: string;
  readonly version?: number;
  readonly meta?: unknown;
  readonly records?: unknown;
  readonly geometry?: readonly number[];
  readonly tail?: readonly number[];
};

/** Frames meta, records and geometry as the bytes after gunzip. */
export function buildSnapshot(parts: SnapshotParts = {}): Uint8Array {
  const meta = utf8(parts.meta ?? META);
  const rec = utf8(parts.records ?? RECORDS);
  return Uint8Array.from([
    ...Array.from(parts.magic ?? 'CNTS', (c) => c.charCodeAt(0)),
    parts.version ?? 1,
    ...u32(meta.length),
    ...meta,
    ...u32(rec.length),
    ...rec,
    ...(parts.geometry ?? GEOMETRY),
    ...(parts.tail ?? []),
  ]);
}

/** A copy of {@link RECORDS} with some keys replaced. */
export function records(over: Partial<Record<keyof typeof RECORDS, unknown>>): unknown {
  return { ...RECORDS, ...over };
}
