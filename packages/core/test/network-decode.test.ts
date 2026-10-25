/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/restrict-plus-operands, @typescript-eslint/no-non-null-assertion -- raw tile JSON is deliberately untyped: the decoder must cope with anything */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cumulativeLengthsM, networkFromTiles } from '../src/index.js';

/**
 * Tests for the tile decoder (`networkFromTiles`). The committed golden tiles
 * (pipeline/tests/golden/synthetic/tiles/) are the happy-path input; malformed and edge cases
 * are built by cloning a golden tile and breaking one thing.
 */
// Raw tile JSON is deliberately untyped here: the decoder must cope with anything.
type Json = Record<string, any>;

const GOLDEN = new URL('../../../pipeline/tests/golden/synthetic/tiles/', import.meta.url);

const goldenTiles = (): Json[] =>
  readdirSync(GOLDEN)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(new URL(f, GOLDEN), 'utf8')) as Json);

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** The chain id present in more than one tile with overlapping vertices (found, not hard-coded). */
const edgeChainId = (tiles: Json[]): string => {
  const seen = new Map<string, number>();
  for (const t of tiles) for (const c of t.chains) seen.set(c.id, (seen.get(c.id) ?? 0) + 1);
  const hit = [...seen.entries()].find(([, n]) => n > 1);
  if (hit === undefined) throw new Error('golden has no chain split across tiles');
  return hit[0];
};

/** The tiles that hold a piece of the given chain. */
const tilesWithChain = (tiles: Json[], id: string): Json[] =>
  tiles.filter((t) => t.chains.some((c: Json) => c.id === id));

const codeOf = (fn: () => unknown): { code: string; message: string } => {
  try {
    fn();
  } catch (e) {
    const err = e as { code: string; message: string };
    return { code: err.code, message: err.message };
  }
  throw new Error('expected a throw');
};

describe('networkFromTiles on the golden tiles', () => {
  it('reassembles a chain split across two golden tiles into one continuous chain', () => {
    const tiles = goldenTiles();
    const id = edgeChainId(tiles);
    const net = networkFromTiles(tiles);
    const matching = net.chains.filter((x) => x.chainBaseId === id);
    expect(matching).toHaveLength(1);
    const c = matching[0]!;
    expect(c.id).toBe(id);
    for (let i = 1; i < c.sM.length; i++) expect(c.sM[i]!).toBeGreaterThan(c.sM[i - 1]!);
    expect(c.pts.length).toBe(c.sM.length); // no duplicated overlap vertices
    const pieces = tilesWithChain(tiles, id).map((t) => t.chains.find((x: Json) => x.id === id));
    const total = pieces.reduce(
      (m: number, p: Json) => Math.max(m, p.vertexStart + p.latE6.length),
      0,
    );
    expect(c.pts.length).toBe(total);
  });

  it('recomputed lengths match stored s within 1 mm', () => {
    const net = networkFromTiles(goldenTiles());
    expect(net.chains.length).toBeGreaterThan(5);
    for (const c of net.chains) {
      const recomputed = cumulativeLengthsM(c.pts);
      expect(c.cumulativeM[0]).toBe(0);
      for (let i = 0; i < c.pts.length; i++) {
        expect(Math.abs(recomputed[i]! - c.cumulativeM[i]!)).toBeLessThan(1e-3);
        expect(c.cumulativeM[i]!).toBeCloseTo(c.sM[i]! - c.sM[0]!, 9);
      }
    }
  });

  it('carries anchor tier, segment geoAccuracyM, trackClasses and diamond positions', () => {
    const tiles = goldenTiles();
    const net = networkFromTiles(tiles);
    expect(net.datasetVersion).toBe(tiles[0]!.datasetVersion);

    const tiers = new Set(net.intervals.flatMap((iv) => iv.anchors.map((a) => a.tier)));
    expect(tiers.size).toBeGreaterThan(0);
    for (const iv of net.intervals) {
      expect(iv.anchors.length).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < iv.anchors.length; i++) {
        expect(iv.anchors[i]!.s).toBeGreaterThan(iv.anchors[i - 1]!.s);
      }
    }

    const rawSegments = tiles.flatMap((t) => t.segments as Json[]);
    const accuracy = rawSegments.find((s) => s.chainId === null && s.geoAccuracyM !== null);
    const unchained = new Set(rawSegments.filter((s) => s.chainId === null).map((s) => s.key));
    expect(net.segments.map((s) => s.key).sort()).toEqual([...unchained].sort());
    if (accuracy !== undefined) {
      expect(net.segments.find((s) => s.key === accuracy.key)?.geoAccuracyM).toBe(
        accuracy.geoAccuracyM,
      );
    }
    const chained = rawSegments.filter((s) => s.chainId !== null);
    expect(chained.length).toBeGreaterThan(0);
    for (const c of net.chains) {
      const expected = [
        ...new Set(chained.filter((s) => s.chainId === c.chainBaseId).map((s) => s.trackClass)),
      ].sort();
      expect(c.trackClasses).toEqual(expected);
    }

    const diamond = tiles.flatMap((t) => t.assets as Json[]).find((a) => a.kind === 'diamond');
    expect(diamond).toBeDefined();
    const expected = (diamond!.positions as Json[]).map((p) => ({
      assetId: diamond!.id,
      chainId: p.chainId,
      sM: (p.sStartMm + p.sEndMm) / 2 / 1000,
    }));
    expect(net.diamonds).toEqual(expected);
  });

  it('keeps tile bounds unbuffered as sorted coverage and is deterministic', () => {
    const tiles = goldenTiles();
    const net = networkFromTiles(tiles);
    expect(net.coverage).toHaveLength(tiles.length);
    expect(net.coverage).toContainEqual(tiles[0]!.bounds);
    const reversed = networkFromTiles([...tiles].reverse());
    expect(reversed).toEqual(net);
    const ids = net.chains.map((c) => c.id);
    expect(ids).toEqual([...ids].sort());
  });

  it('accepts an empty tile list', () => {
    const net = networkFromTiles([]);
    expect(net.chains).toEqual([]);
    expect(net.datasetVersion).toBe('');
    expect(net.coverage).toEqual([]);
  });
});

describe('networkFromTiles merging and duplicates', () => {
  it('throws MIXED_DATASET_VERSION when versions differ', () => {
    const tiles = goldenTiles();
    tiles[1]!.datasetVersion = 'other';
    expect(codeOf(() => networkFromTiles(tiles)).code).toBe('MIXED_DATASET_VERSION');
  });

  it('throws TILE_MISMATCH when overlapping vertices disagree', () => {
    for (const field of ['latE6', 'lonE6', 'sMm'] as const) {
      const tiles = goldenTiles();
      const id = edgeChainId(tiles);
      const holder = tilesWithChain(tiles, id).at(-1)!;
      const piece = holder.chains.find((c: Json) => c.id === id);
      // A change to the second delta shifts every later vertex of that piece.
      piece[field][1] += 5;
      expect(codeOf(() => networkFromTiles(tiles)).code).toBe('TILE_MISMATCH');
    }
  });

  it('throws TILE_MISMATCH when pieces of one chain disagree on subdivision', () => {
    for (const [field, value] of [
      ['subdivisionName', 'X'],
      ['subdivisionNid', 'X'],
      ['operators', ['X']],
      ['cycle', true],
    ] as const) {
      const tiles = goldenTiles();
      const id = edgeChainId(tiles);
      const piece = tilesWithChain(tiles, id)[1]!.chains.find((c: Json) => c.id === id);
      piece[field] = value;
      expect(codeOf(() => networkFromTiles(tiles)).code).toBe('TILE_MISMATCH');
    }
  });

  it('keeps non-contiguous pieces of one chain as separate entries', () => {
    const tiles = goldenTiles();
    const id = edgeChainId(tiles);
    const [a, b] = tilesWithChain(tiles, id);
    // Move the second piece so that it starts beyond the end of the first: a missing middle tile.
    const pa = a!.chains.find((c: Json) => c.id === id);
    const pb = clone(b!.chains.find((c: Json) => c.id === id));
    const net1 = networkFromTiles([a!]);
    pb.vertexStart = pa.vertexStart + pa.latE6.length + 3;
    const synthetic = clone(b!);
    synthetic.chains = [pb];
    synthetic.key = '999_999';
    synthetic.segments = [];
    synthetic.anchors = [];
    synthetic.intervals = [];
    synthetic.assets = [];
    const net = networkFromTiles([a!, synthetic]);
    const pieces = net.chains.filter((c) => c.chainBaseId === id);
    expect(pieces.map((c) => c.id)).toEqual([id, `${id}#2`]);
    expect(pieces[0]!.pts.length).toBe(net1.chains.find((c) => c.id === id)!.pts.length);
    expect(pieces[1]!.pts.length).toBe(pb.latE6.length);
    expect(pieces[1]!.cumulativeM[0]).toBe(0);
  });

  it('accepts identical duplicate intervals, anchors, segments and assets across tiles', () => {
    const tiles = goldenTiles();
    const a = networkFromTiles(tiles);
    const dup = clone(tiles[0]!);
    dup.key = '777_777';
    const b = networkFromTiles([...tiles, dup]);
    expect(b.intervals).toEqual(a.intervals);
    expect(b.segments).toEqual(a.segments);
    expect(b.diamonds).toEqual(a.diamonds);
    expect(b.chains).toEqual(a.chains);
  });

  it('throws TILE_MISMATCH for a conflicting duplicate of each kind', () => {
    const base = goldenTiles()[0]!;
    const mutate = (fn: (t: Json) => void): (() => unknown) => {
      return () => {
        const dup = clone(base);
        dup.key = '777_777';
        fn(dup);
        return networkFromTiles([base, dup]);
      };
    };
    const mismatch = (fn: (t: Json) => void): void => {
      expect(codeOf(mutate(fn)).code).toBe('TILE_MISMATCH');
    };
    mismatch((t) => {
      t.segments[0].trackClass = 'Z';
    });
    mismatch((t) => {
      t.anchors[0].mp += 1;
    });
    mismatch((t) => {
      t.intervals[0].anchorIds.reverse();
    });
    mismatch((t) => {
      t.assets[0].name = 'changed';
    });
    mismatch((t) => {
      t.assets[0].positions = [];
    });
    mismatch((t) => {
      t.assets[0].attrs = { a: 'b' };
    });
    mismatch((t) => {
      t.assets[0].posted = { mp: 1, subdivisionNid: 'S', tier: 'posted' };
    });
    mismatch((t) => {
      t.assets[0].latE6 = [1];
    });
  });

  it('de-duplicates anchors by (chainId, id): the same id on two chains is legal', () => {
    const t = goldenTiles()[0]!;
    const chainA = t.chains[0].id as string;
    const tile = clone(t);
    tile.chains = [t.chains[0], { ...clone(t.chains[0]), id: 'other' }];
    const anchor = (id: string, chainId: string, sMm: number, mp: number, tier: string): Json => ({
      id,
      chainId,
      sMm,
      mp,
      source: 'crossing',
      tier,
      memberNids: [],
    });
    tile.anchors = [
      anchor('A1', chainA, 0, 1, 'posted'),
      anchor('A2', chainA, 1000, 2, 'tc'),
      anchor('A1', 'other', 0, 5, 'unverified'),
      anchor('A2', 'other', 1000, 6, 'unverified'),
    ];
    tile.intervals = [
      { id: 'I1', chainId: chainA, anchorIds: ['A2', 'A1'] },
      { id: 'I2', chainId: 'other', anchorIds: ['A1', 'A2'] },
    ];
    const net = networkFromTiles([tile]);
    const i1 = net.intervals.find((i) => i.id === 'I1')!;
    const i2 = net.intervals.find((i) => i.id === 'I2')!;
    expect(i1.anchors.map((a) => [a.id, a.s, a.mp, a.tier])).toEqual([
      ['A1', 0, 1, 'posted'],
      ['A2', 1, 2, 'tc'],
    ]); // sorted into s order even though anchorIds were listed reversed
    expect(i2.anchors.map((a) => a.mp)).toEqual([5, 6]);
  });

  it('drops an interval whose anchors do not all resolve', () => {
    const t = clone(goldenTiles()[0]!);
    t.intervals = [{ id: 'I1', chainId: t.chains[0].id, anchorIds: [t.anchors[0].id, 'missing'] }];
    const net = networkFromTiles([t]);
    expect(net.intervals).toEqual([]);
  });

  it('emits every diamond position, sorted by asset, chain and s', () => {
    const t = clone(goldenTiles()[0]!);
    const chain = t.chains[0].id as string;
    const mk = (id: string, c: string, a: number, b: number): Json => ({
      id,
      kind: 'diamond',
      layer: 'X',
      name: null,
      latE6: [1],
      lonE6: [1],
      posted: null,
      attrs: {},
      positions: [
        {
          chainId: c,
          sStartMm: a,
          sEndMm: b,
          residualMm: 0,
          derivedMpStart: null,
          derivedMpEnd: null,
        },
        {
          chainId: chain,
          sStartMm: 100,
          sEndMm: 100,
          residualMm: 0,
          derivedMpStart: null,
          derivedMpEnd: null,
        },
      ],
    });
    t.assets = [mk('D2', 'zz', 1000, 3000), mk('D1', chain, 500, 500)];
    const net = networkFromTiles([t]);
    expect(net.diamonds).toEqual([
      { assetId: 'D1', chainId: chain, sM: 0.1 },
      { assetId: 'D1', chainId: chain, sM: 0.5 },
      { assetId: 'D2', chainId: chain, sM: 0.1 },
      { assetId: 'D2', chainId: 'zz', sM: 2 }, // midpoint of 1000 and 3000 mm
    ]);
  });

  it('lists unchained segments sorted by key and excludes chained ones', () => {
    const t = clone(goldenTiles()[0]!);
    const seg = (key: string, chainId: string | null): Json => ({
      ...clone(t.segments[0]),
      key,
      chainId,
    });
    t.segments = [seg('b', null), seg('c', t.chains[0].id), seg('a', null)];
    const net = networkFromTiles([t]);
    expect(net.segments.map((x) => x.key)).toEqual(['a', 'b']);
    expect(net.chains.find((c) => c.id === t.chains[0].id)?.trackClasses).toEqual([
      t.segments[0].trackClass,
    ]);
  });

  it('treats an array and an object with the same keys as different duplicates', () => {
    const base = goldenTiles()[0]!;
    const dup = clone(base);
    dup.assets[0].attrs = ['TCID'];
    expect(codeOf(() => networkFromTiles([base, dup])).code).toBe('TILE_MISMATCH');
  });

  it('keeps the base chain id on intervals and diamonds', () => {
    const tiles = goldenTiles();
    const id = edgeChainId(tiles);
    const net = networkFromTiles(tiles);
    expect(net.intervals.some((i) => i.chainId === id)).toBe(true);
    expect(net.diamonds.every((d) => !d.chainId.includes('#'))).toBe(true);
  });
});

describe('networkFromTiles validation', () => {
  const invalid = (fn: (t: Json) => void, path: string, tileIndex = 0): void => {
    const tiles = goldenTiles();
    fn(tiles[tileIndex]!);
    const r = codeOf(() => networkFromTiles(tiles));
    expect(r.code).toBe('INVALID_TILE');
    expect(r.message).toContain(path);
  };

  it('rejects non-object tiles and a wrong schema', () => {
    for (const x of [null, 3, 'x', []]) {
      const r = codeOf(() => networkFromTiles([x]));
      expect(r.code).toBe('INVALID_TILE');
      expect(r.message).toContain('tiles[0]');
    }
    invalid((t) => {
      t.schema = 'cantre.tile/2';
    }, 'tiles[0].schema');
  });

  const cases: [string, string, (t: Json) => void][] = [
    ['datasetVersion', 'tiles[0].datasetVersion', (t) => (t.datasetVersion = 3)],
    ['key', 'tiles[0].key', (t) => (t.key = 3)],
    ['bounds', 'tiles[0].bounds', (t) => (t.bounds = null)],
    ['bounds.south', 'tiles[0].bounds.south', (t) => (t.bounds.south = 'x')],
    ['bounds.west', 'tiles[0].bounds.west', (t) => (t.bounds.west = Number.NaN)],
    ['chains', 'tiles[0].chains', (t) => (t.chains = {})],
    ['chains[0]', 'tiles[0].chains[0]', (t) => (t.chains[0] = 5)],
    ['chain id', 'tiles[0].chains[0].id', (t) => (t.chains[0].id = 5)],
    ['chain nid', 'tiles[0].chains[0].subdivisionNid', (t) => (t.chains[0].subdivisionNid = 5)],
    ['chain name', 'tiles[0].chains[0].subdivisionName', (t) => (t.chains[0].subdivisionName = 5)],
    ['operators', 'tiles[0].chains[0].operators', (t) => (t.chains[0].operators = 'CN')],
    ['operators[0]', 'tiles[0].chains[0].operators[0]', (t) => (t.chains[0].operators = [1])],
    ['cycle', 'tiles[0].chains[0].cycle', (t) => (t.chains[0].cycle = 1)],
    ['vertexStart<0', 'tiles[0].chains[0].vertexStart', (t) => (t.chains[0].vertexStart = -1)],
    ['vertexStart frac', 'tiles[0].chains[0].vertexStart', (t) => (t.chains[0].vertexStart = 1.5)],
    ['latE6 type', 'tiles[0].chains[0].latE6', (t) => (t.chains[0].latE6 = 'x')],
    ['latE6 frac', 'tiles[0].chains[0].latE6[2]', (t) => (t.chains[0].latE6[2] = 1.5)],
    ['latE6 NaN', 'tiles[0].chains[0].latE6[2]', (t) => (t.chains[0].latE6[2] = Number.NaN)],
    ['lonE6 str', 'tiles[0].chains[0].lonE6[1]', (t) => (t.chains[0].lonE6[1] = '1')],
    ['sMm null', 'tiles[0].chains[0].sMm[0]', (t) => (t.chains[0].sMm[0] = null)],
    ['segments', 'tiles[0].segments', (t) => (t.segments = null)],
    ['segments[0]', 'tiles[0].segments[0]', (t) => (t.segments[0] = null)],
    ['segment key', 'tiles[0].segments[0].key', (t) => (t.segments[0].key = 1)],
    ['segment chainId', 'tiles[0].segments[0].chainId', (t) => (t.segments[0].chainId = 1)],
    ['segment class', 'tiles[0].segments[0].trackClass', (t) => (t.segments[0].trackClass = 1)],
    ['segment status', 'tiles[0].segments[0].status', (t) => (t.segments[0].status = 1)],
    [
      'segment nid',
      'tiles[0].segments[0].subdivisionNid',
      (t) => (t.segments[0].subdivisionNid = 1),
    ],
    [
      'segment name',
      'tiles[0].segments[0].subdivisionName',
      (t) => (t.segments[0].subdivisionName = 1),
    ],
    ['segment operator', 'tiles[0].segments[0].operator', (t) => (t.segments[0].operator = 1)],
    [
      'segment acc<0',
      'tiles[0].segments[0].geoAccuracyM',
      (t) => (t.segments[0].geoAccuracyM = -1),
    ],
    [
      'segment acc str',
      'tiles[0].segments[0].geoAccuracyM',
      (t) => (t.segments[0].geoAccuracyM = 'x'),
    ],
    ['segment latE6', 'tiles[0].segments[0].latE6[0]', (t) => (t.segments[0].latE6 = [1.5])],
    ['anchors', 'tiles[0].anchors', (t) => (t.anchors = 1)],
    ['anchors[0]', 'tiles[0].anchors[0]', (t) => (t.anchors[0] = 1)],
    ['anchor id', 'tiles[0].anchors[0].id', (t) => (t.anchors[0].id = 1)],
    ['anchor chainId', 'tiles[0].anchors[0].chainId', (t) => (t.anchors[0].chainId = 1)],
    ['anchor sMm', 'tiles[0].anchors[0].sMm', (t) => (t.anchors[0].sMm = 0.5)],
    ['anchor mp str', 'tiles[0].anchors[0].mp', (t) => (t.anchors[0].mp = 'x')],
    [
      'anchor mp inf',
      'tiles[0].anchors[0].mp',
      (t) => (t.anchors[0].mp = Number.POSITIVE_INFINITY),
    ],
    ['anchor source', 'tiles[0].anchors[0].source', (t) => (t.anchors[0].source = 'gps')],
    ['anchor tier', 'tiles[0].anchors[0].tier', (t) => (t.anchors[0].tier = 'gold')],
    ['intervals', 'tiles[0].intervals', (t) => (t.intervals = 1)],
    ['intervals[0]', 'tiles[0].intervals[0]', (t) => (t.intervals[0] = 1)],
    ['interval id', 'tiles[0].intervals[0].id', (t) => (t.intervals[0].id = 1)],
    ['interval chainId', 'tiles[0].intervals[0].chainId', (t) => (t.intervals[0].chainId = 1)],
    [
      'interval anchorIds',
      'tiles[0].intervals[0].anchorIds',
      (t) => (t.intervals[0].anchorIds = 1),
    ],
    [
      'interval one anchor',
      'tiles[0].intervals[0].anchorIds',
      (t) => (t.intervals[0].anchorIds = ['a']),
    ],
    [
      'interval anchorIds[1]',
      'tiles[0].intervals[0].anchorIds[1]',
      (t) => (t.intervals[0].anchorIds[1] = 1),
    ],
    ['assets', 'tiles[0].assets', (t) => (t.assets = 1)],
    ['assets[0]', 'tiles[0].assets[0]', (t) => (t.assets[0] = 1)],
    ['asset id', 'tiles[0].assets[0].id', (t) => (t.assets[0].id = 1)],
    ['asset kind', 'tiles[0].assets[0].kind', (t) => (t.assets[0].kind = 1)],
    ['positions', 'tiles[0].assets[0].positions', (t) => (t.assets[0].positions = 1)],
    ['positions[0]', 'tiles[0].assets[0].positions[0]', (t) => (t.assets[0].positions[0] = 1)],
    [
      'position chainId',
      'tiles[0].assets[0].positions[0].chainId',
      (t) => (t.assets[0].positions[0].chainId = 1),
    ],
    [
      'position sStartMm',
      'tiles[0].assets[0].positions[0].sStartMm',
      (t) => (t.assets[0].positions[0].sStartMm = 0.5),
    ],
    [
      'position sEndMm',
      'tiles[0].assets[0].positions[0].sEndMm',
      (t) => (t.assets[0].positions[0].sEndMm = 'x'),
    ],
  ];
  it.each(cases)('rejects a bad %s naming %s', (_name, path, fn) => {
    invalid(fn, path);
  });

  it('reports the index of the offending tile', () => {
    invalid(
      (t) => {
        t.chains[0].latE6 = [0.5];
      },
      'tiles[3].chains[0].latE6[0]',
      3,
    );
  });

  it('rejects delta arrays of unequal length', () => {
    invalid((t) => t.chains[0].lonE6.pop(), 'tiles[0].chains[0].lonE6');
    invalid((t) => t.chains[0].sMm.pop(), 'tiles[0].chains[0].sMm');
    invalid((t) => t.segments[0].lonE6.pop(), 'tiles[0].segments[0].lonE6');
  });

  it('rejects decoded coordinates outside the valid degree range', () => {
    invalid((t) => {
      t.chains[0].latE6 = [91_000_000];
      t.chains[0].lonE6 = [0];
      t.chains[0].sMm = [0];
    }, 'tiles[0].chains[0].latE6');
    invalid((t) => {
      t.chains[0].latE6 = [0];
      t.chains[0].lonE6 = [181_000_000];
      t.chains[0].sMm = [0];
    }, 'tiles[0].chains[0].lonE6');
  });

  /** Like invalid(), but decodes the broken first tile alone (neighbours would TILE_MISMATCH). */
  const invalidAlone = (fn: (t: Json) => void, path: string): void => {
    const t = clone(goldenTiles()[0]!);
    fn(t);
    const r = codeOf(() => networkFromTiles([t]));
    expect(r.code).toBe('INVALID_TILE');
    expect(r.message).toContain(path);
  };

  it('R28: rejects an interval that fails validateInterval (flat or reversing milepost)', () => {
    // Flat: every anchor of the first interval at one milepost (NON_MONOTONIC_MILEPOST).
    invalidAlone((t) => {
      for (const a of t.anchors) a.mp = 7;
    }, 'tiles[0].intervals[0]');
    // Two anchors at the same position (DUPLICATE_POSITION).
    invalidAlone((t) => {
      const ids: string[] = t.intervals[0].anchorIds;
      const first = t.anchors.find((a: Json) => a.id === ids[0]);
      const second = t.anchors.find((a: Json) => a.id === ids[1]);
      second.sMm = first.sMm;
    }, 'tiles[0].intervals[0]');
    const r = codeOf(() => {
      const t = clone(goldenTiles()[0]!);
      for (const a of t.anchors) a.mp = 7;
      networkFromTiles([t]);
    });
    expect(r.message).toContain('NON_MONOTONIC_MILEPOST');
  });

  it('R28: rejects a chain piece whose sMm decreases', () => {
    invalidAlone((t) => {
      t.chains[0].sMm[1] = -1; // delta -1 mm: the decoded position goes backwards
    }, 'tiles[0].chains[0].sMm[1]');
  });

  it('R28: rejects vertices outside the Canada envelope (chains and segments)', () => {
    invalidAlone((t) => {
      t.chains[0].latE6 = [40_000_000];
      t.chains[0].lonE6 = [-100_000_000];
      t.chains[0].sMm = [0];
    }, 'tiles[0].chains[0].latE6[0]');
    invalidAlone((t) => {
      t.chains[0].latE6 = [50_000_000];
      t.chains[0].lonE6 = [100_000_000]; // positive-east longitude: outside the envelope
      t.chains[0].sMm = [0];
    }, 'tiles[0].chains[0].lonE6[0]');
    invalidAlone((t) => {
      t.segments[0].latE6 = [84_000_000];
      t.segments[0].lonE6 = [-100_000_000];
    }, 'tiles[0].segments[0].latE6[0]');
  });

  it('R28: a decoded golden network never makes the matcher throw', () => {
    // Every golden vertex lies in the envelope and every interval validates, so reduce-level
    // calls (findCandidates, milepost) cannot throw on it.
    expect(() => networkFromTiles(goldenTiles())).not.toThrow();
  });

  it('rejects an empty chain piece', () => {
    invalid((t) => {
      t.chains[0].latE6 = [];
      t.chains[0].lonE6 = [];
      t.chains[0].sMm = [];
    }, 'tiles[0].chains[0].latE6');
  });
});

describe('networkFromTiles asset validation', () => {
  const bad = (change: (a: Json) => void, where: string): void => {
    const tile = clone(goldenTiles().find((t) => t.assets.length > 0)!);
    change(tile.assets[0]);
    const r = codeOf(() => networkFromTiles([tile]));
    expect(r.code).toBe('INVALID_TILE');
    expect(r.message).toContain(where);
  };

  it('rejects an asset with a bad position, name, posted value or vertices', () => {
    bad((a) => (a.latE6 = []), 'assets[0].latE6');
    bad((a) => (a.lonE6 = [1, 2]), 'assets[0].lonE6');
    bad((a) => (a.latE6 = [91_000_000]), 'assets[0].latE6');
    bad((a) => (a.lonE6 = [181_000_000]), 'assets[0].lonE6');
    bad((a) => (a.positions[0].residualMm = -1), 'residualMm');
    bad((a) => (a.positions[0].derivedMpStart = 'x'), 'derivedMpStart');
    bad((a) => (a.name = 5), 'assets[0].name');
    bad((a) => (a.kind = 'tower'), 'assets[0].kind');
    bad((a) => (a.posted = { mp: 1, subdivisionNid: 'S', tier: 'gold' }), 'posted.tier');
    bad((a) => (a.posted = 4), 'assets[0].posted');
  });

  it('keeps asset vertices outside the Canada envelope (the matcher never projects onto one)', () => {
    const tile = clone(goldenTiles().find((t) => t.assets.length > 0)!);
    tile.assets[0].latE6 = [1];
    tile.assets[0].lonE6 = [1];
    const a = networkFromTiles([tile]).assets.find((x) => x.at.lat === 0.000001);
    expect(a?.at).toEqual({ lat: 0.000001, lon: 0.000001 });
  });
});
