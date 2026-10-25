/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion -- raw tile JSON is deliberately untyped */
import { readdirSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { networkFromSnapshot, networkFromTiles } from '../src/index.js';
import {
  GEOMETRY,
  META,
  RECORDS,
  buildSnapshot,
  chainGeometry,
  records,
  varint,
} from './helpers/snapshot.js';

/**
 * Tests for the snapshot decoder (`networkFromSnapshot`, pipeline/schema/snapshot.md). The
 * committed golden snapshot was written from the committed golden tiles, so the two decoders must
 * give deep-equal views. Hardening cases are built with a tiny independent encoder.
 */
type Json = Record<string, any>;

const GOLDEN = new URL('../../../pipeline/tests/golden/synthetic/', import.meta.url);
const goldenTiles = (): Json[] =>
  readdirSync(new URL('tiles/', GOLDEN))
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(new URL(`tiles/${f}`, GOLDEN), 'utf8')) as Json);
const gunzipFile = (url: URL): Uint8Array => new Uint8Array(gunzipSync(readFileSync(url)));
const goldenSnapshot = (): Uint8Array => gunzipFile(new URL('snapshot.bin.gz', GOLDEN));

const failure = (fn: () => unknown): { code: string; message: string } => {
  try {
    fn();
  } catch (e) {
    const err = e as { code: string; message: string };
    return { code: err.code, message: err.message };
  }
  throw new Error('expected a throw');
};

/** Asserts INVALID_SNAPSHOT; returns the byte offset the message names. */
const offsetOf = (bytes: Uint8Array): number => {
  const f = failure(() => networkFromSnapshot(bytes));
  expect(f.code).toBe('INVALID_SNAPSHOT');
  const m = /byte (\d+)/.exec(f.message);
  expect(m, f.message).not.toBeNull();
  return Number(m![1]);
};

/** Offset of the first geometry byte of a snapshot built by the helper. */
const geometryStart = (bytes: Uint8Array): number => {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const m = dv.getUint32(5, true);
  const r = dv.getUint32(9 + m, true);
  return 9 + m + 4 + r;
};

/** Offset of the records section (its `u32` length is four bytes earlier). */
const recordsStart = (bytes: Uint8Array): number => {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return 9 + dv.getUint32(5, true) + 4;
};

describe('networkFromSnapshot on the golden snapshot', () => {
  it('deep-equals networkFromTiles of the tiles it was written from, coverage included', () => {
    const fromSnapshot = networkFromSnapshot(goldenSnapshot());
    const fromTiles = networkFromTiles(goldenTiles());
    expect(fromSnapshot).toStrictEqual(fromTiles);
    expect(fromSnapshot.coverage.length).toBeGreaterThan(0);
    expect(fromSnapshot.assets.length).toBeGreaterThan(0);
    expect(fromSnapshot.diamonds.length).toBeGreaterThan(0);
  });

  it('lists assets sorted by id, each placed on a chain the view holds', () => {
    const net = networkFromSnapshot(goldenSnapshot());
    const ids = net.assets.map((a) => a.id);
    expect(ids).toEqual([...ids].sort());
    const chainIds = new Set(net.chains.map((c) => c.chainBaseId));
    for (const a of net.assets) {
      for (const p of a.positions) {
        expect(chainIds.has(p.chainId)).toBe(true);
      }
    }
  });

  it('decodes the two-province national snapshot, which has more chains', () => {
    const national = networkFromSnapshot(gunzipFile(new URL('national/snapshot.bin.gz', GOLDEN)));
    expect(national.datasetVersion).toMatch(/^nrwn-national-/);
    expect(national.chains.length).toBeGreaterThan(
      networkFromSnapshot(goldenSnapshot()).chains.length,
    );
  });
});

describe('networkFromSnapshot framing', () => {
  it('decodes a minimal snapshot exactly', () => {
    const net = networkFromSnapshot(buildSnapshot());
    expect(net.datasetVersion).toBe('test-1');
    expect(net.coverage).toEqual([{ south: 52, west: -106.5, north: 52.25, east: -106 }]);
    const c = net.chains[0]!;
    expect(c.id).toBe('c1');
    expect(c.chainBaseId).toBe('c1');
    expect(c.pts).toEqual([
      { lat: 52.1, lon: -105.9 },
      { lat: 52.1, lon: -105.899 },
      { lat: 52.1, lon: -105.898 },
    ]);
    expect([...c.sM]).toEqual([0, 68.6, 137.2]);
    expect([...c.cumulativeM]).toEqual([0, 68.6, 137.2]);
    expect(net.intervals).toEqual([
      {
        id: 'c1.i0',
        chainId: 'c1',
        anchors: [
          { id: 'a0', s: 0, mp: 10, source: 'markerpost', tier: 'posted' },
          { id: 'a1', s: 137.2, mp: 11, source: 'markerpost', tier: 'posted' },
        ],
      },
    ]);
    expect(net.assets).toEqual([]);
    expect(net.diamonds).toEqual([]);
  });

  it('decodes the worked example of snapshot.md byte for byte', () => {
    const geometry = [
      0x04, 0xc0, 0xee, 0xd7, 0x31, 0xbf, 0x9f, 0xff, 0x64, 0x00, 0x14, 0xd0, 0x0f, 0xf8, 0x0a,
    ];
    const net = networkFromSnapshot(
      buildSnapshot({ records: records({ anchors: [], intervals: [] }), geometry }),
    );
    const c = net.chains[0]!;
    expect(c.pts).toEqual([
      { lat: 52.1, lon: -105.9 },
      { lat: 52.10001, lon: -105.899 },
    ]);
    expect([...c.sM]).toEqual([0, 0.7]);
  });

  it('rejects truncation at every cut point, naming a byte offset', () => {
    const bytes = buildSnapshot();
    for (const cut of [0, 1, 3, 4, 5, 8, 9, 20, bytes.length - 20]) {
      offsetOf(bytes.subarray(0, cut));
    }
    for (let cut = geometryStart(bytes); cut < bytes.length; cut += 1) {
      offsetOf(bytes.subarray(0, cut));
    }
  });

  it('rejects a wrong magic at byte 0 and a version other than 1 at byte 4', () => {
    expect(offsetOf(buildSnapshot({ magic: 'XNTS' }))).toBe(0);
    expect(offsetOf(buildSnapshot({ version: 2 }))).toBe(4);
    expect(offsetOf(buildSnapshot({ version: 0 }))).toBe(4);
  });

  it('rejects bytes left after the geometry, at the first leftover byte', () => {
    const bytes = buildSnapshot({ tail: [0] });
    expect(offsetOf(bytes)).toBe(bytes.length - 1);
  });

  it('rejects a section length that runs past the data', () => {
    const broken = Uint8Array.from(buildSnapshot());
    new DataView(broken.buffer).setUint32(5, 0xffffffff, true);
    expect(offsetOf(broken)).toBe(5);
  });

  it('rejects meta or records that are not JSON objects', () => {
    const broken = Uint8Array.from(buildSnapshot());
    broken[9] = 0x20; // meta no longer starts with "{"
    expect(offsetOf(broken)).toBe(9);
    expect(offsetOf(buildSnapshot({ meta: [] }))).toBe(9);
  });
});

describe('networkFromSnapshot varints', () => {
  const noAnchors = records({ anchors: [], intervals: [] });
  /** A one-chain, two-vertex geometry whose last distance delta is `ds`. */
  const withLastDs = (ds: bigint): number[] => [
    ...varint(2),
    ...varint(52100000),
    ...varint(-105900000),
    ...varint(0),
    ...varint(0),
    ...varint(0),
    ...varint(ds),
  ];

  it('accepts the largest legal value, 2^52 - 1, in a distance delta', () => {
    const net = networkFromSnapshot(
      buildSnapshot({ records: noAnchors, geometry: withLastDs(2n ** 52n - 1n) }),
    );
    expect(net.chains[0]!.sM[1]).toBe((2 ** 52 - 1) / 1000);
  });

  it('rejects 2^52 (zigzag 2^53), naming where that varint starts', () => {
    const geometry = withLastDs(2n ** 52n);
    const bytes = buildSnapshot({ records: noAnchors, geometry });
    const lastLength = varint(2n ** 52n).length;
    expect(offsetOf(bytes)).toBe(bytes.length - lastLength);
  });

  it('rejects a value below -2^52', () => {
    const geometry = [...varint(1), ...varint(-(2n ** 52n) - 1n), ...varint(0), ...varint(0)];
    offsetOf(buildSnapshot({ records: noAnchors, geometry }));
  });

  it('rejects a varint longer than 8 bytes and one cut off by the end', () => {
    const nine = [0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x01];
    const bytes = buildSnapshot({ geometry: nine });
    expect(offsetOf(bytes)).toBe(geometryStart(bytes));
    offsetOf(buildSnapshot({ geometry: [0x80] }));
  });

  it('rejects a padded (non-minimal) varint', () => {
    // 0x82 0x00 is 1 written with a redundant last group; the only legal form is 0x02.
    const bytes = buildSnapshot({ geometry: [0x82, 0x00] });
    expect(offsetOf(bytes)).toBe(geometryStart(bytes));
  });
});

describe('networkFromSnapshot geometry invariants', () => {
  const noAnchors = records({ anchors: [], intervals: [] });
  const withGeometry = (geometry: readonly number[], rec: unknown = noAnchors): Uint8Array =>
    buildSnapshot({ records: rec, geometry });

  it('rejects a chain with no vertex', () => {
    offsetOf(withGeometry(varint(0)));
  });

  it('rejects a vertex count that runs past the data', () => {
    offsetOf(withGeometry(varint(1_000_000_000)));
  });

  it('rejects a chain whose first position is not 0', () => {
    offsetOf(withGeometry(chainGeometry([[52100000, -105900000, 5]])));
  });

  it('rejects a distance that goes backwards', () => {
    const geometry = [
      ...varint(2),
      ...varint(52100000),
      ...varint(-105900000),
      ...varint(0),
      ...varint(0),
      ...varint(1000),
      ...varint(-1),
    ];
    offsetOf(withGeometry(geometry));
  });

  it('keeps a repeated vertex (equal position)', () => {
    const net = networkFromSnapshot(
      withGeometry(
        chainGeometry([
          [52100000, -105900000, 0],
          [52100000, -105900000, 0],
        ]),
      ),
    );
    expect(net.chains[0]!.pts).toHaveLength(2);
  });

  it('rejects vertices outside +-90 / +-180 degrees and outside the Canada envelope', () => {
    offsetOf(withGeometry(chainGeometry([[91_000_000, -105900000, 0]])));
    offsetOf(withGeometry(chainGeometry([[52100000, -181_000_000, 0]])));
    offsetOf(withGeometry(chainGeometry([[10_000_000, -105900000, 0]]))); // south of the envelope
    offsetOf(withGeometry(chainGeometry([[52100000, 105_900_000, 0]]))); // east longitude
  });

  it('rejects a cycle chain whose last vertex is not its first', () => {
    const rec = records({
      chains: [['c1', 'S1', 'Sub One', ['CN'], true, ['Main']]],
      anchors: [],
      intervals: [],
    });
    offsetOf(withGeometry(GEOMETRY, rec));
    const closed = chainGeometry([
      [52100000, -105900000, 0],
      [52100000, -105899000, 68600],
      [52100000, -105900000, 137200],
    ]);
    expect(networkFromSnapshot(withGeometry(closed, rec)).chains[0]!.cycle).toBe(true);
  });

  it('decodes an unchained segment (geometry pairs, no distance)', () => {
    const rec = records({
      anchors: [],
      intervals: [],
      segments: [['seg1', 'Siding', 'Operational', 'S1', 'Sub One', 'CN', 5]],
    });
    const geometry = [
      ...GEOMETRY,
      ...varint(2),
      ...varint(52100500),
      ...varint(-105900000),
      ...varint(10),
      ...varint(20),
    ];
    const net = networkFromSnapshot(buildSnapshot({ records: rec, geometry }));
    expect(net.segments).toEqual([
      {
        key: 'seg1',
        chainId: null,
        trackClass: 'Siding',
        status: 'Operational',
        subdivisionNid: 'S1',
        subdivisionName: 'Sub One',
        operator: 'CN',
        geoAccuracyM: 5,
        pts: [
          { lat: 52.1005, lon: -105.9 },
          { lat: 52.10051, lon: -105.89998 },
        ],
      },
    ]);
  });

  it('rejects an empty segment, a bad geoAccuracyM and a duplicate key', () => {
    const seg = (acc: unknown): unknown =>
      records({
        anchors: [],
        intervals: [],
        segments: [['seg1', 'Siding', 'Operational', 'S1', 'Sub One', 'CN', acc]],
      });
    const oneVertex = [...varint(1), ...varint(52100500), ...varint(-105900000)];
    offsetOf(buildSnapshot({ records: seg(null), geometry: [...GEOMETRY, ...varint(0)] }));
    offsetOf(buildSnapshot({ records: seg(-1), geometry: [...GEOMETRY, ...oneVertex] }));
    offsetOf(buildSnapshot({ records: seg(1.5), geometry: [...GEOMETRY, ...oneVertex] }));
    const row = ['seg1', 'Siding', 'Operational', 'S1', 'Sub One', 'CN', null];
    offsetOf(
      buildSnapshot({
        records: records({ anchors: [], intervals: [], segments: [row, row] }),
        geometry: [...GEOMETRY, ...oneVertex, ...oneVertex],
      }),
    );
  });
});

describe('networkFromSnapshot records and meta', () => {
  const bad = (rec: unknown): number => offsetOf(buildSnapshot({ records: rec }));
  const at = recordsStart(buildSnapshot());

  it('names the records section for a bad record', () => {
    expect(bad(records({ chains: [['c1', 'S1']] }))).toBe(at);
    expect(bad(records({ anchors: [['nope', 'a0', 0, 10, 'markerpost', 'posted']] }))).toBe(at);
    expect(bad(records({ anchors: [['c1', 'a0', 0, 10, 'wall', 'posted']] }))).toBe(at);
    expect(bad(records({ anchors: [['c1', 'a0', 0, 10, 'markerpost', 'gold']] }))).toBe(at);
    expect(bad(records({ anchors: [['c1', 'a0', 0.5, 10, 'markerpost', 'posted']] }))).toBe(at);
    expect(bad({ ...RECORDS, chains: 'x' })).toBe(at);
    expect(bad([])).toBe(at);
  });

  it('rejects duplicate ids', () => {
    const c = RECORDS.chains[0];
    bad(records({ chains: [c, c] }));
    bad(records({ anchors: [RECORDS.anchors[0], RECORDS.anchors[0]] }));
    bad(records({ intervals: [RECORDS.intervals[0], RECORDS.intervals[0]] }));
  });

  it('rejects an interval that is too short, unresolved or not monotonic', () => {
    bad(records({ intervals: [['c1.i0', 'c1', ['a0']]] }));
    bad(records({ intervals: [['c1.i0', 'c1', ['a0', 'zz']]] }));
    bad(records({ intervals: [['c1.i0', 'nochain', ['a0', 'a1']]] }));
    bad(
      records({
        anchors: [
          ['c1', 'a0', 0, 10, 'markerpost', 'posted'],
          ['c1', 'a1', 137200, 10, 'markerpost', 'posted'],
        ],
      }),
    );
  });

  it('orders an interval by s even when the records list its anchors the other way', () => {
    const net = networkFromSnapshot(
      buildSnapshot({ records: records({ intervals: [['c1.i0', 'c1', ['a1', 'a0']]] }) }),
    );
    expect(net.intervals[0]!.anchors.map((a) => a.id)).toEqual(['a0', 'a1']);
  });

  it('rejects bad meta', () => {
    const m = (over: Record<string, unknown>): number =>
      offsetOf(buildSnapshot({ meta: { ...META, ...over } }));
    m({ datasetVersion: 3 });
    m({ datasetVersion: '' });
    m({ snapshotDate: '25 Oct' });
    m({ attribution: null });
    m({ packageVersions: [] });
    m({ packageVersions: { sk: 2 } });
    m({ coverage: [[1, 2, 3]] });
    m({ coverage: [[52000000, -106500000, 52250000, 0.5]] });
    m({ coverage: [[5, 5, 4, 5]] }); // north below south
    m({ coverage: 'x' });
  });

  it('sorts chains by id whatever order the records give', () => {
    const rec = records({
      chains: [
        ['c2', 'S1', 'Sub One', ['CN'], false, ['Main']],
        ['c1', 'S1', 'Sub One', ['CN'], false, ['Main']],
      ],
      anchors: [],
      intervals: [],
    });
    const geometry = [
      ...chainGeometry([[52200000, -105900000, 0]]),
      ...chainGeometry([[52100000, -105900000, 0]]),
    ];
    const net = networkFromSnapshot(buildSnapshot({ records: rec, geometry }));
    expect(net.chains.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(net.chains[1]!.pts[0]).toEqual({ lat: 52.2, lon: -105.9 });
  });
});

describe('networkFromSnapshot assets', () => {
  const asset = (over: Record<number, unknown> = {}): unknown[] => {
    const base: unknown[] = [
      'X1',
      'bridge',
      'Big Bridge',
      [10.5, 'S1', 'tc'],
      [['c1', 20000, 40000, 1500, 10.2, 10.4]],
      [52100200, 100, 100],
      [-105899000, 50, 50],
    ];
    for (const [i, v] of Object.entries(over)) {
      base[Number(i)] = v;
    }
    return base;
  };
  const decode = (a: unknown[]): ReturnType<typeof networkFromSnapshot> =>
    networkFromSnapshot(buildSnapshot({ records: records({ assets: [a] }) }));

  it('decodes a line asset: delta vertices, midpoint position, mean derived milepost', () => {
    const [a] = decode(asset()).assets;
    expect(a).toEqual({
      id: 'X1',
      kind: 'bridge',
      name: 'Big Bridge',
      posted: { mp: 10.5, subdivisionNid: 'S1', tier: 'tc' },
      positions: [{ chainId: 'c1', sM: 30, residualM: 1.5, derivedMp: (10.2 + 10.4) / 2 }],
      at: { lat: 52.1003, lon: -105.89895 }, // the middle vertex (index 1 of 3)
    });
  });

  it('decodes a point asset with no posted value and no name', () => {
    const [a] = decode(
      asset({
        2: null,
        3: null,
        4: [['c1', 5000, 5000, 0, 10.1, 10.1]],
        5: [52100000],
        6: [-105900000],
      }),
    ).assets;
    expect(a).toEqual({
      id: 'X1',
      kind: 'bridge',
      name: null,
      posted: null,
      positions: [{ chainId: 'c1', sM: 5, residualM: 0, derivedMp: 10.1 }],
      at: { lat: 52.1, lon: -105.9 },
    });
  });

  it('leaves the derived milepost null unless both ends have one', () => {
    const noMp = [['c1', 20000, 40000, 0, null, 10.4]];
    expect(decode(asset({ 4: noMp })).assets[0]!.positions[0]!.derivedMp).toBeNull();
  });

  it('turns a diamond into a diamond position at the midpoint of start and end', () => {
    const net = decode(asset({ 1: 'diamond' }));
    expect(net.diamonds).toEqual([{ assetId: 'X1', chainId: 'c1', sM: 30 }]);
  });

  it('rejects malformed assets', () => {
    const dup = asset();
    offsetOf(buildSnapshot({ records: records({ assets: [dup, dup] }) }));
    for (const a of [
      asset({ 1: 'tower' }),
      asset({ 2: 5 }),
      asset({ 3: [10, 'S1', 'gold'] }),
      asset({ 3: [10, 'S1'] }),
      asset({ 4: [['c1', 40000, 20000, 0, null, null]] }),
      asset({ 4: [['c1', 20000, 40000, -1, null, null]] }),
      asset({ 4: [['nochain', 20000, 40000, 0, null, null]] }),
      asset({ 4: [['c1', 20000, 40000, 0, 'x', null]] }),
      asset({ 5: [], 6: [] }),
      asset({ 6: [-105899000] }),
      asset({ 5: [95_000_000, 0, 0] }),
      asset({ 6: [1.5, 0, 0] }),
      asset({ 6: [-105899000, 0, 0, 0] }),
    ]) {
      offsetOf(buildSnapshot({ records: records({ assets: [a] }) }));
    }
  });
});

describe('networkFromSnapshot remaining invariants', () => {
  const noAnchors = records({ anchors: [], intervals: [] });

  it('rejects a cycle flag that is not a boolean', () => {
    const rec = records({
      chains: [['c1', 'S1', 'Sub One', ['CN'], 'yes', ['Main']]],
      anchors: [],
      intervals: [],
    });
    offsetOf(buildSnapshot({ records: rec }));
  });

  it('rejects coverage cells out of order or repeated', () => {
    const a = [52000000, -106500000, 52250000, -106000000];
    const b = [52250000, -106500000, 52500000, -106000000];
    offsetOf(buildSnapshot({ meta: { ...META, coverage: [b, a] } }));
    offsetOf(buildSnapshot({ meta: { ...META, coverage: [a, a] } }));
    const net = networkFromSnapshot(buildSnapshot({ meta: { ...META, coverage: [a, b] } }));
    expect(net.coverage).toHaveLength(2);
  });

  it('rejects an anchor beyond the end of its chain', () => {
    const rec = records({
      anchors: [
        ['c1', 'a0', 0, 10, 'markerpost', 'posted'],
        ['c1', 'a1', 137201, 11, 'markerpost', 'posted'],
      ],
    });
    offsetOf(buildSnapshot({ records: rec }));
    const onTheEnd = records({
      anchors: [
        ['c1', 'a0', 0, 10, 'markerpost', 'posted'],
        ['c1', 'a1', 137200, 11, 'markerpost', 'posted'],
      ],
    });
    expect(networkFromSnapshot(buildSnapshot({ records: onTheEnd })).intervals).toHaveLength(1);
  });

  it('rejects an interval whose anchors share a position', () => {
    const rec = records({
      anchors: [
        ['c1', 'a0', 0, 10, 'markerpost', 'posted'],
        ['c1', 'a1', 0, 11, 'markerpost', 'posted'],
      ],
    });
    offsetOf(buildSnapshot({ records: rec }));
  });

  it('rejects a running position past 2^53 - 1 millimetres', () => {
    const big = varint(2n ** 52n - 1n);
    const geometry = [
      ...varint(4),
      ...varint(52100000),
      ...varint(-105900000),
      ...varint(0),
      ...[0, 0].flatMap((v) => varint(v)),
      ...big,
      ...[0, 0].flatMap((v) => varint(v)),
      ...big,
      ...[0, 0].flatMap((v) => varint(v)),
      ...big,
    ];
    offsetOf(buildSnapshot({ records: noAnchors, geometry }));
  });

  it('rejects a segment vertex count that cannot fit, and sorts segments by key', () => {
    const row = (key: string): unknown[] => [
      key,
      'Siding',
      'Operational',
      'S1',
      'Sub One',
      'CN',
      null,
    ];
    const seg = (la: number): number[] => [...varint(1), ...varint(la), ...varint(-105900000)];
    offsetOf(
      buildSnapshot({
        records: records({ anchors: [], intervals: [], segments: [row('s')] }),
        geometry: [...GEOMETRY, ...varint(1_000_000)],
      }),
    );
    const net = networkFromSnapshot(
      buildSnapshot({
        records: records({ anchors: [], intervals: [], segments: [row('s2'), row('s1')] }),
        geometry: [...GEOMETRY, ...seg(52100500), ...seg(52100600)],
      }),
    );
    expect(net.segments.map((s) => s.key)).toEqual(['s1', 's2']);
    expect(net.segments[0]?.pts[0]).toEqual({ lat: 52.1006, lon: -105.9 });
  });

  it('rejects an asset longitude beyond 180 degrees', () => {
    const a = ['X1', 'bridge', null, null, [], [52100200], [200_000_000]];
    offsetOf(buildSnapshot({ records: records({ assets: [a] }) }));
  });
});
