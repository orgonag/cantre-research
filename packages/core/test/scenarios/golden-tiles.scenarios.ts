/**
 * Scenarios on the committed golden tiles (pipeline/tests/golden/synthetic/tiles/, one
 * datasetVersion). These tiles are SYNTHETIC output of the M2 pipeline's golden fixture, not
 * field data. Every coordinate below is derived from the decoded network (chain geometry, anchors
 * and the diamond position); nothing is hard-coded.
 *
 * What is exercised: a chain decoded from pieces in two tiles stays one chain with continuous `s`
 * and mileposts; the diamond blocks automatic selection; two parallel chains of one subdivision
 * give a subdivision match. Accuracy is 5 m throughout (search radius 50 m, margin d_min + 10 m).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { metresToMiles, networkFromTiles } from '../../src/index.js';
import type {
  LatLon,
  NetworkChain,
  NetworkInterval,
  NetworkView,
  Result,
} from '../../src/index.js';
import { expect } from 'vitest';
import { fixPointStep } from './harness.js';
import type { Expectation, Scenario, Step } from './harness.js';

const GOLDEN = new URL('../../../../pipeline/tests/golden/synthetic/tiles/', import.meta.url);

/** The shape of a raw tile that these helpers read (the decoder validates the rest). */
type RawTile = { chains: { id: string }[] };

/** Reads every committed golden tile, sorted by file name. */
export function goldenTiles(): RawTile[] {
  return readdirSync(GOLDEN)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(new URL(f, GOLDEN), 'utf8')) as RawTile);
}

export const goldenNet: NetworkView = networkFromTiles(goldenTiles());

/** Chain ids that appear in more than one tile (split across a tile edge), sorted. */
export function tileEdgeChainIds(tiles: readonly RawTile[]): string[] {
  const seen = new Map<string, number>();
  for (const t of tiles) {
    for (const c of t.chains) {
      seen.set(c.id, (seen.get(c.id) ?? 0) + 1);
    }
  }
  return [...seen.entries()]
    .filter(([, n]) => n > 1)
    .map(([id]) => id)
    .sort();
}

/** The point `s` metres along the chain (linear in latitude and longitude between vertices). */
export function pointAtS(chain: NetworkChain, s: number): LatLon {
  for (let i = 0; i + 1 < chain.pts.length; i += 1) {
    const s0 = chain.sM[i] ?? 0;
    const s1 = chain.sM[i + 1] ?? 0;
    if (s >= s0 && s <= s1) {
      const a = chain.pts[i] as LatLon;
      const b = chain.pts[i + 1] as LatLon;
      const f = (s - s0) / (s1 - s0); // fraction of the vertex-to-vertex span, dimensionless
      return { lat: a.lat + f * (b.lat - a.lat), lon: a.lon + f * (b.lon - a.lon) };
    }
  }
  throw new Error(`s = ${String(s)} is outside chain ${chain.id}`);
}

/** The chain with this id (throws if absent: the scenarios must fail loudly, not skip). */
export function chainById(net: NetworkView, id: string): NetworkChain {
  const chain = net.chains.find((c) => c.id === id);
  if (chain === undefined) {
    throw new Error(`golden network has no chain ${id}`);
  }
  return chain;
}

/** Milepost (miles) at `s` on one interval, by plain linear interpolation of its anchors. */
export function mpOnInterval(iv: NetworkInterval, s: number): number {
  for (let i = 0; i + 1 < iv.anchors.length; i += 1) {
    const a = iv.anchors[i];
    const b = iv.anchors[i + 1];
    if (a !== undefined && b !== undefined && s >= a.s && s <= b.s) {
      return a.mp + ((s - a.s) / (b.s - a.s)) * (b.mp - a.mp);
    }
  }
  throw new Error(`s = ${String(s)} is outside interval ${iv.id}`);
}

/** The interval of a chain (golden walk chains have exactly one). */
function onlyInterval(net: NetworkView, chainId: string): NetworkInterval {
  const ivs = net.intervals.filter((iv) => iv.chainId === chainId);
  if (ivs.length !== 1 || ivs[0] === undefined) {
    throw new Error(`expected one interval on ${chainId}, found ${String(ivs.length)}`);
  }
  return ivs[0];
}

/** Metres between two points that are close together (flat approximation, fine below 1 km). */
function nearM(a: LatLon, b: LatLon): number {
  const mPerDegLat = 111_000; // rough: only used to pick candidate chains, never for a result
  const dLat = (a.lat - b.lat) * mPerDegLat;
  const dLon = (a.lon - b.lon) * mPerDegLat * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
}

/**
 * The walk chain: the first tile-edge chain, by id, that is straight along one parallel, carries
 * no diamond, has no other chain within 300 m of any of its vertices, and has one interval at
 * least 5 km long. Chosen by this predicate, from the decoded data, so the scenario does not
 * depend on a hard-coded id. Where another chain is genuinely close (the parallel S6 pair, the
 * S5 end-to-end pieces) the rules would correctly give MATCHED_SUBDIVISION or AMBIGUOUS_ROUTE, so
 * those chains are not used for a plain MATCHED walk; the S6 pair has its own scenario below.
 */
export function pickWalkChain(net: NetworkView, edgeIds: readonly string[]): NetworkChain {
  for (const id of edgeIds) {
    const chain = chainById(net, id);
    const lat0 = chain.pts[0]?.lat;
    const straight = chain.pts.every((p) => p.lat === lat0);
    const hasDiamond = net.diamonds.some((d) => d.chainId === chain.chainBaseId);
    const crowded = net.chains.some(
      (o) => o.id !== chain.id && o.pts.some((p) => chain.pts.some((q) => nearM(p, q) < 300)),
    );
    const ivs = net.intervals.filter((iv) => iv.chainId === chain.chainBaseId);
    const iv = ivs[0];
    const long =
      ivs.length === 1 &&
      iv !== undefined &&
      (iv.anchors[iv.anchors.length - 1]?.s ?? 0) - (iv.anchors[0]?.s ?? 0) >= 5000;
    if (straight && !hasDiamond && !crowded && long) {
      return chain;
    }
  }
  throw new Error('no golden chain satisfies the walk predicate');
}

const EDGE_IDS = tileEdgeChainIds(goldenTiles());

/** The walk chain, found from the data. */
export const walkChain: NetworkChain = pickWalkChain(goldenNet, EDGE_IDS);

/** Along-track positions (metres) walked, every 500 m inside the single calibrated interval. */
export const WALK_S: readonly number[] = (() => {
  const iv = onlyInterval(goldenNet, walkChain.chainBaseId);
  const first = Math.ceil((iv.anchors[0]?.s ?? 0) / 500) * 500; // first multiple of 500 m inside
  const last = iv.anchors[iv.anchors.length - 1]?.s ?? 0;
  const out: number[] = [];
  for (let s = first; s <= last - 1; s += 500) {
    out.push(s);
  }
  return out;
})();

/**
 * Walk the tile-edge chain end to end: every fix is MATCHED on the one chain id, `s` rises with the
 * walk (checked in `after`), and the milepost follows the decoded anchors piecewise-linearly with
 * no jump at the interior anchor or at the overlap between the two tiles' pieces.
 */
export const goldenWalk: Scenario = {
  name: 'golden tiles: walking a tile-edge chain keeps one chain id, rising s, continuous milepost',
  net: goldenNet,
  steps: WALK_S.map((s, i): Step => {
    const iv = onlyInterval(goldenNet, walkChain.chainBaseId);
    const e: Expectation = {
      status: 'MATCHED',
      chainId: walkChain.id,
      reasons: [],
      mpApprox: mpOnInterval(iv, s),
      mpTolMi: 0.001,
      selectionOrigin: 'auto',
    };
    return fixPointStep((i + 1) * 1000, pointAtS(walkChain, s), e);
  }),
  after: (results: readonly Result[]) => {
    expect(results.length).toBe(WALK_S.length);
    expect(results.length).toBeGreaterThan(5);
    const mps: number[] = [];
    results.forEach((r, i) => {
      const walked = WALK_S[i] ?? 0;
      expect(r.s, `s at step ${String(i)}`).not.toBeNull();
      // The projected s is the walked s to within 0.5 m (linear lat/lon placement, 5 m accuracy).
      expect(Math.abs((r.s ?? 0) - walked), `s error at step ${String(i)}`).toBeLessThan(0.5);
      if (i > 0) {
        expect(r.s ?? 0, `s rises at step ${String(i)}`).toBeGreaterThan(results[i - 1]?.s ?? 0);
      }
      if (r.milepost?.kind === 'calibrated') {
        mps.push(r.milepost.mp);
      }
    });
    expect(mps.length).toBe(results.length);
    // Continuity: between fixes 500 m apart the milepost moves by no more than 500 m of the
    // steepest anchor spacing (miles per metre) plus 0.001 mi, and never reverses direction.
    const iv = onlyInterval(goldenNet, walkChain.chainBaseId);
    const slopes = iv.anchors.slice(1).map((a, k) => {
      const p = iv.anchors[k];
      return Math.abs(a.mp - (p?.mp ?? 0)) / (a.s - (p?.s ?? 0));
    });
    const maxStepMi = 500 * Math.max(...slopes) + 0.001;
    const sign = Math.sign((mps[mps.length - 1] ?? 0) - (mps[0] ?? 0));
    for (let i = 1; i < mps.length; i += 1) {
      const d = (mps[i] ?? 0) - (mps[i - 1] ?? 0);
      expect(Math.abs(d), `mp step ${String(i)}`).toBeLessThanOrEqual(maxStepMi);
      expect(Math.sign(d) * sign, `mp direction ${String(i)}`).toBeGreaterThanOrEqual(0);
    }
    // The chain the walk matched on really was assembled from two tiles.
    expect(EDGE_IDS).toContain(walkChain.id);
    // A sanity bound on the units: the whole walk spans the interval, in miles.
    expect(metresToMiles((WALK_S.at(-1) ?? 0) - (WALK_S[0] ?? 0))).toBeGreaterThan(2);
  },
};

/** The diamond: its chain (base id) and position along it, metres, from the decoded network. */
const diamond = (() => {
  const d = goldenNet.diamonds[0];
  if (d === undefined) {
    throw new Error('golden network has no diamond');
  }
  return d;
})();
const diamondChain = chainById(goldenNet, diamond.chainId);
const diamondIv = onlyInterval(goldenNet, diamond.chainId);
const RADIUS_M = 50; // max(50 m, 3 x 5 m accuracy)

/**
 * The golden diamond sits on the tile edge (the chain's pieces overlap there). Fixes 100 m short
 * of it are MATCHED, fixes within 50 m of it on either side are AMBIGUOUS_ROUTE / DIAMOND_NEARBY
 * (the diamond is registered on one chain, and still blocks), and fixes 100 m past it are MATCHED
 * again on the same chain, with `s` and the milepost continuing across the tile edge.
 */
export const goldenDiamond: Scenario = {
  name: 'golden tiles: the golden diamond blocks automatic selection within its radius only',
  net: goldenNet,
  steps: [
    [-1200, -600, -(RADIUS_M + 50)],
    [-RADIUS_M + 10, -10, 0, 10, RADIUS_M - 10],
    [RADIUS_M + 50, 600, 1200],
  ].flatMap((offsets, group) =>
    offsets.map((off, k): Step => {
      const s = diamond.sM + off;
      const t = (group * 10 + k + 1) * 1000;
      const near = Math.abs(off) <= RADIUS_M;
      const e: Expectation = near
        ? {
            status: 'AMBIGUOUS_ROUTE',
            reasons: ['DIAMOND_NEARBY'],
            chainId: null,
            mpApprox: null,
            candidates: [diamondChain.id],
          }
        : {
            status: 'MATCHED',
            chainId: diamondChain.id,
            reasons: [],
            mpApprox: mpOnInterval(diamondIv, s),
            mpTolMi: 0.001,
          };
      return fixPointStep(t, pointAtS(diamondChain, s), e);
    }),
  ),
  after: (results) => {
    // s keeps rising across the tile edge for the matched fixes, and is continuous through it.
    const matched = results.filter((r) => r.status === 'MATCHED');
    expect(matched.length).toBe(6);
    for (let i = 1; i < matched.length; i += 1) {
      expect(matched[i]?.s ?? 0).toBeGreaterThan(matched[i - 1]?.s ?? 0);
    }
    // The diamond must be a genuine tile-edge feature of a chain split across two tiles.
    expect(EDGE_IDS).toContain(diamond.chainId);
  },
};

/**
 * Two parallel chains of one subdivision, about 33 m apart (the S6 pair): a fix on one is MATCHED
 * (the other is 33 m away, beyond 0 + 10 m); a fix midway is 16.7 m from each, so both are
 * indistinguishable and the result is MATCHED_SUBDIVISION with a milepost range (the two chains
 * carry the same anchors).
 */
function pickParallelPair(net: NetworkView): readonly [NetworkChain, NetworkChain] {
  for (const a of net.chains) {
    for (const b of net.chains) {
      const a0 = a.pts[0];
      const b0 = b.pts[0];
      if (
        a.id < b.id &&
        a.subdivisionNid === b.subdivisionNid &&
        a0 !== undefined &&
        b0 !== undefined &&
        nearM(a0, b0) < 100 &&
        nearM(a0, b0) > 20
      ) {
        return [a, b];
      }
    }
  }
  throw new Error('golden network has no parallel pair');
}
const [twinA, twinB] = pickParallelPair(goldenNet);
const twinIv = onlyInterval(goldenNet, twinA.chainBaseId);
const TWIN_S = 3000; // metres along the pair, inside their shared calibrated interval

export const goldenParallel: Scenario = {
  name: 'golden tiles: the parallel pair gives MATCHED on one chain and MATCHED_SUBDIVISION between',
  net: goldenNet,
  steps: [
    fixPointStep(1000, pointAtS(twinA, TWIN_S), {
      status: 'MATCHED',
      chainId: twinA.id,
      reasons: [],
      mpApprox: mpOnInterval(twinIv, TWIN_S),
    }),
    fixPointStep(
      2000,
      {
        lat: (pointAtS(twinA, TWIN_S).lat + pointAtS(twinB, TWIN_S).lat) / 2,
        lon: pointAtS(twinA, TWIN_S).lon,
      },
      {
        status: 'MATCHED_SUBDIVISION',
        reasons: ['MULTIPLE_TRACKS'],
        chainId: null,
        mpApprox: null,
        candidatesAnyOrder: [twinA.id, twinB.id],
        mpRange: { lowerMp: mpOnInterval(twinIv, TWIN_S), upperMp: mpOnInterval(twinIv, TWIN_S) },
        mpTolMi: 0.01,
      },
    ),
  ],
};

/**
 * Gaps and unchained track, from the data. A chain with two calibrated intervals has a gap between
 * them: a fix in the gap is MATCHED on the chain but carries no milepost (DISCONTINUITY_GAP);
 * nothing is bridged. The unchained siding SD (a segment with no chain) is MATCHED as a track
 * with no chain position and no milepost (UNCHAINED_TRACK). The siding fix is taken a quarter of
 * the way along it, kilometres from the diamond, so the diamond rule does not apply.
 */
function pickGapChain(net: NetworkView): { chain: NetworkChain; gapS: number } {
  for (const chain of net.chains) {
    const ivs = net.intervals
      .filter((iv) => iv.chainId === chain.chainBaseId)
      .sort((x, y) => (x.anchors[0]?.s ?? 0) - (y.anchors[0]?.s ?? 0));
    const lo = ivs[0]?.anchors[ivs[0].anchors.length - 1]?.s;
    const hi = ivs[1]?.anchors[0]?.s;
    if (ivs.length === 2 && lo !== undefined && hi !== undefined && hi > lo) {
      return { chain, gapS: (lo + hi) / 2 };
    }
  }
  throw new Error('golden network has no chain with a gap between two intervals');
}
const { chain: gapChain, gapS } = pickGapChain(goldenNet);
const siding = goldenNet.segments.find((s) => s.chainId === null);
if (siding === undefined) {
  throw new Error('golden network has no unchained segment');
}
const sidingFirst = siding.pts[0] as LatLon;
const sidingLast = siding.pts[siding.pts.length - 1] as LatLon;
const sidingQuarter: LatLon = {
  lat: sidingFirst.lat + 0.25 * (sidingLast.lat - sidingFirst.lat),
  lon: sidingFirst.lon + 0.25 * (sidingLast.lon - sidingFirst.lon),
};

export const goldenGapAndSiding: Scenario = {
  name: 'golden tiles: a fix in a milepost gap and a fix on an unchained siding carry no milepost',
  net: goldenNet,
  steps: [
    fixPointStep(1000, pointAtS(gapChain, gapS), {
      status: 'MATCHED',
      chainId: gapChain.id,
      reasons: ['DISCONTINUITY_GAP'],
      mpApprox: null,
    }),
    fixPointStep(2000, sidingQuarter, {
      status: 'MATCHED',
      chainId: null,
      reasons: ['UNCHAINED_TRACK'],
      mpApprox: null,
      candidates: [siding.key],
    }),
  ],
  after: (results) => {
    expect(results[0]?.s).not.toBeNull(); // the gap fix has a chain position, just no milepost
    expect(results[1]?.s).toBeNull(); // the siding has none
    expect(results[1]?.chosen?.segmentKey).toBe(siding.key);
  },
};

export const scenarios: readonly Scenario[] = [
  goldenWalk,
  goldenDiamond,
  goldenParallel,
  goldenGapAndSiding,
];
