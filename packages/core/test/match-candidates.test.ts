import { describe, expect, it } from 'vitest';
import { CoreInputError, MATCH_CONFIG, fromLocalM } from '../src/index.js';
import {
  coverageOf,
  diamondsNear,
  findCandidates,
  searchRadiusM,
} from '../src/match/candidates.js';
import type { Fix } from '../src/match/candidates.js';
import {
  ORIGIN,
  coverageAround,
  network,
  siding,
  straightChain,
  withDiamond,
} from './helpers/network.js';

/** A fix `eastM`/`northM` metres from the origin. */
function fixAt(eastM: number, northM: number, accuracyM = 5, extra: Partial<Fix> = {}): Fix {
  const p = fromLocalM(ORIGIN, { x: eastM, y: northM }, ORIGIN.lat);
  return { lat: p.lat, lon: p.lon, timestampMs: 1000, accuracyM, ...extra };
}

describe('searchRadiusM', () => {
  it('is max(50 m, 3 x accuracy)', () => {
    expect(searchRadiusM(5, MATCH_CONFIG)).toBe(50);
    expect(searchRadiusM(40, MATCH_CONFIG)).toBe(120);
  });
});

describe('findCandidates', () => {
  it('a chain 30 m away is a candidate with s and bearing; one 60 m away is not', () => {
    // East-running chains; positive lateralM is right of travel (south), so -30 is 30 m north.
    const near = straightChain('near', ORIGIN, 0, 2000, { bearingDeg: 90, lateralM: -30 });
    const far = straightChain('far', ORIGIN, 0, 2000, { bearingDeg: 90, lateralM: -60 });
    const net = network({ chains: [near, far] });
    const cands = findCandidates(net, fixAt(500, 0), MATCH_CONFIG);
    expect(cands).toHaveLength(1);
    const c = cands[0];
    expect(c?.chainId).toBe('near');
    expect(c?.chainBaseId).toBe('near');
    expect(c?.segmentKey).toBeNull();
    expect(c?.residualM).toBeCloseTo(30, 3);
    expect(c?.s).toBeCloseTo(500, 1); // fix placed on the origin-latitude plane, projected on the mid-latitude one
    expect(c?.bearingDeg).toBeCloseTo(90, 3);
    expect(c?.subdivisionNid).toBe('sub-1');
    expect(c?.operator).toBe('CN');
    expect(c?.trackClass).toBe('Main');
  });

  it('s is absolute along the chain: sM[0] plus the along distance', () => {
    const chain = straightChain('c', ORIGIN, 1000, 3000, { bearingDeg: 90 });
    const cands = findCandidates(network({ chains: [chain] }), fixAt(1500, 10), MATCH_CONFIG);
    expect(cands[0]?.s).toBeCloseTo(1500, 3);
  });

  it('joins operators and track classes with + and keeps the base id of a split piece', () => {
    const chain = straightChain('c#2', ORIGIN, 0, 1000, {
      chainBaseId: 'c',
      operators: ['CPKC', 'CN'],
      trackClasses: ['Main', 'Siding'],
    });
    const cands = findCandidates(network({ chains: [chain] }), fixAt(500, 0), MATCH_CONFIG);
    expect(cands[0]).toMatchObject({
      chainId: 'c#2',
      chainBaseId: 'c',
      operator: 'CN+CPKC',
      trackClass: 'Main+Siding',
    });
  });

  it('reads the bearing of the segment the projection lies on', () => {
    const chain = straightChain('c', ORIGIN, 0, 1000, { bearingDeg: 0 });
    const cands = findCandidates(network({ chains: [chain] }), fixAt(5, 500), MATCH_CONFIG);
    expect(cands[0]?.bearingDeg).toBeCloseTo(0, 3);
  });

  it('a siding within the radius is a segment candidate with s null', () => {
    const sid = siding('seg-1', ORIGIN, 0, 500, { lateralM: -20, op: 'CPKC', sub: 'sub-9' });
    const cands = findCandidates(network({ segments: [sid] }), fixAt(250, 0), MATCH_CONFIG);
    expect(cands).toHaveLength(1);
    expect(cands[0]).toMatchObject({
      chainId: null,
      chainBaseId: null,
      segmentKey: 'seg-1',
      s: null,
      operator: 'CPKC',
      trackClass: 'Siding',
      subdivisionNid: 'sub-9',
    });
    expect(cands[0]?.residualM).toBeCloseTo(20, 3);
  });

  it('a siding beyond the radius is not a candidate', () => {
    const sid = siding('seg-1', ORIGIN, 0, 500, { lateralM: -80 });
    expect(findCandidates(network({ segments: [sid] }), fixAt(250, 0), MATCH_CONFIG)).toEqual([]);
  });

  it('skips degenerate geometry (one vertex or zero length) instead of throwing', () => {
    const chain = straightChain('c', ORIGIN, 0, 1000);
    const p0 = chain.pts[0];
    if (p0 === undefined) {
      throw new Error('helper built no points');
    }
    const dup = { ...chain, id: 'dup', pts: [p0, p0], cumulativeM: Float64Array.of(0, 0) };
    const single = { ...siding('one', ORIGIN, 0, 100), pts: [p0] };
    const net = network({ chains: [dup], segments: [single] });
    expect(findCandidates(net, fixAt(0, 0), MATCH_CONFIG)).toEqual([]);
  });

  it('sorts by residual then ids, deterministically under shuffled network order', () => {
    const a = straightChain('a', ORIGIN, 0, 1000, { lateralM: -10 }); // 10 m
    const b = straightChain('b', ORIGIN, 0, 1000, { lateralM: -10 }); // identical geometry: exact tie with a
    const c = straightChain('c', ORIGIN, 0, 1000, { lateralM: -5 }); // 5 m
    const s1 = siding('s1', ORIGIN, 0, 1000, { lateralM: -10 }); // exact tie again; segment key sorts first (null chainId is '')
    const fix = fixAt(500, 0);
    const first = findCandidates(network({ chains: [a, b, c], segments: [s1] }), fix, MATCH_CONFIG);
    const second = findCandidates(
      network({ chains: [c, b, a], segments: [s1] }),
      fix,
      MATCH_CONFIG,
    );
    expect(second).toEqual(first);
    expect(first.map((x) => x.chainId ?? x.segmentKey)).toEqual(['c', 's1', 'a', 'b']);
  });

  it('300 m accuracy searches 900 m and never fewer candidates than 5 m accuracy', () => {
    const chains = [0, 1, 2].map((i) =>
      straightChain(`c${String(i)}`, ORIGIN, 0, 2000, { lateralM: -(i * 400 + 10) }),
    );
    const net = network({ chains });
    const tight = findCandidates(net, fixAt(500, 0, 5), MATCH_CONFIG);
    const wide = findCandidates(net, fixAt(500, 0, 300), MATCH_CONFIG);
    expect(searchRadiusM(300, MATCH_CONFIG)).toBe(900);
    expect(tight.map((x) => x.chainId)).toEqual(['c0']);
    expect(wide.map((x) => x.chainId)).toEqual(['c0', 'c1', 'c2']); // 10, 410, 810 m
    for (const t of tight) {
      expect(wide.some((w) => w.chainId === t.chainId)).toBe(true);
    }
  });

  it('keeps a diagonal chain whose bounding box only just reaches the radius', () => {
    // A north-east chain; the fix sits 45 m perpendicular off it, inside the 50 m radius.
    const chain = straightChain('d', ORIGIN, 0, 1000, { bearingDeg: 45, lateralM: 45 });
    const cands = findCandidates(network({ chains: [chain] }), fixAt(500, 500, 5), MATCH_CONFIG);
    expect(cands).toHaveLength(1);
    expect(cands[0]?.residualM).toBeCloseTo(45, 2);
  });

  it('rejects a non-finite or negative fix', () => {
    const net = network();
    expect(() => findCandidates(net, { ...fixAt(0, 0), lat: Number.NaN }, MATCH_CONFIG)).toThrow(
      CoreInputError,
    );
    expect(() =>
      findCandidates(net, { ...fixAt(0, 0), accuracyM: Number.NaN }, MATCH_CONFIG),
    ).toThrow(CoreInputError);
    expect(() => findCandidates(net, { ...fixAt(0, 0), accuracyM: -1 }, MATCH_CONFIG)).toThrow(
      CoreInputError,
    );
  });
});

describe('coverageOf', () => {
  const tile = coverageAround(ORIGIN, 1000);

  it('is outside when the fix lies in no loaded tile (including no tiles)', () => {
    expect(coverageOf(network({ coverage: [tile] }), fixAt(2000, 0), 50)).toBe('outside');
    expect(coverageOf(network(), fixAt(0, 0), 50)).toBe('outside');
  });

  it('is covered in the middle and partial near a tile edge', () => {
    const net = network({ coverage: [tile] });
    expect(coverageOf(net, fixAt(0, 0), 50)).toBe('covered');
    expect(coverageOf(net, fixAt(980, 0), 50)).toBe('partial'); // square reaches 1030 m
    expect(coverageOf(net, fixAt(1000 - 60, 0), 50)).toBe('covered');
  });

  it('is correct for the union of adjacent tiles', () => {
    const east = {
      ...coverageAround(fromLocalM(ORIGIN, { x: 2000, y: 0 }, ORIGIN.lat), 1000),
      west: tile.east,
    }; // shares the exact seam
    const net = network({ coverage: [tile, east] });
    expect(coverageOf(net, fixAt(1000, 0), 50)).toBe('covered'); // straddles the shared edge
  });

  it('is partial when a corner of the square falls in a gap of the union', () => {
    // Tile A covers y in [-1000, 1000]; tile B is only the south half to its east.
    const b = {
      ...coverageAround(fromLocalM(ORIGIN, { x: 1500, y: -500 }, ORIGIN.lat), 500),
      west: tile.east,
    };
    const net = network({ coverage: [tile, b] });
    expect(coverageOf(net, fixAt(1000, -500), 50)).toBe('covered');
    expect(coverageOf(net, fixAt(1000, 500), 50)).toBe('partial'); // NE of the seam is unloaded
  });

  it('rejects a negative or non-finite radius', () => {
    const net = network({ coverage: [tile] });
    expect(() => coverageOf(net, fixAt(0, 0), -1)).toThrow(CoreInputError);
    expect(() => coverageOf(net, fixAt(0, 0), Number.NaN)).toThrow(CoreInputError);
  });
});

describe('diamondsNear', () => {
  const chain = straightChain('c', ORIGIN, 0, 2000, { bearingDeg: 90 });
  const other = straightChain('o', ORIGIN, 0, 2000, { bearingDeg: 0 });

  it('a diamond 40 m along-track from the projection is near; 400 m is not', () => {
    const near = withDiamond(network({ chains: [chain] }), 'd1', 'c', 540);
    const far = withDiamond(network({ chains: [chain] }), 'd1', 'c', 900);
    const cands = findCandidates(near, fixAt(500, 0), MATCH_CONFIG);
    expect(diamondsNear(near, cands, 50).map((d) => d.assetId)).toEqual(['d1']);
    expect(diamondsNear(far, cands, 50)).toEqual([]);
  });

  it('matches the base chain id of a split piece and ignores other chains', () => {
    const piece = straightChain('c#2', ORIGIN, 0, 2000, { chainBaseId: 'c' });
    let net = withDiamond(network({ chains: [piece, other] }), 'd1', 'c', 520);
    net = withDiamond(net, 'd2', 'zzz', 520);
    const cands = findCandidates(net, fixAt(500, 0), MATCH_CONFIG);
    expect(diamondsNear(net, cands, 50).map((d) => d.assetId)).toEqual(['d1']);
  });

  it('finds a diamond registered on only one of several candidate chains', () => {
    // Crossing at the origin: the diamond is registered on chain c only. The fix is on o, 3 m
    // from c, so both chains are candidates and c's diamond blocks.
    let net = network({ chains: [chain, other] });
    net = withDiamond(net, 'dia', 'c', 0);
    const cands = findCandidates(net, fixAt(3, 20), MATCH_CONFIG);
    expect(cands.map((c) => c.chainId).sort()).toEqual(['c', 'o']);
    expect(diamondsNear(net, cands, 50)).toHaveLength(1);
  });

  it('includes the boundary, returns sorted and without duplicates', () => {
    let net = network({ chains: [chain] });
    net = withDiamond(net, 'b', 'c', 550); // 50 m from s = 500
    net = withDiamond(net, 'a', 'c', 480);
    const cands = findCandidates(net, fixAt(500, 0), MATCH_CONFIG);
    // The same chain twice (two candidates sharing a base id) must not duplicate diamonds.
    const out = diamondsNear(net, [...cands, ...cands], 50 + 1e-6);
    expect(out.map((d) => d.assetId)).toEqual(['a', 'b']);
  });

  it('ignores segment candidates and rejects a bad radius', () => {
    const sid = siding('s', ORIGIN, 0, 500);
    let net = network({ segments: [sid] });
    net = withDiamond(net, 'd', 'c', 0);
    const cands = findCandidates(net, fixAt(250, 0), MATCH_CONFIG);
    expect(cands).toHaveLength(1);
    expect(diamondsNear(net, cands, 50)).toEqual([]);
    expect(() => diamondsNear(net, cands, -1)).toThrow(CoreInputError);
  });
});
