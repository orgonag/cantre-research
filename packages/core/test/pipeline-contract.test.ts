import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CANADA_ENVELOPE,
  cumulativeLengthsM,
  interpolateMilepost,
  validateInterval,
} from '../src/index.js';
import type { Anchor, AnchorSource, AnchorTier } from '../src/index.js';

/**
 * Contract test: `@cantre/core` run on the pipeline's committed synthetic build
 * (pipeline/tests/golden/synthetic/, written by pipeline/scripts/make_golden.py).
 *
 * The tiles are the pipeline's output format (JSON Schema cantre.tile/1). `latE6`, `lonE6` and a
 * chain piece's `sMm` are delta-encoded, so every array is decoded before use. Anchor `sMm` and
 * asset `sStartMm`/`sEndMm` are absolute. The test proves that what the pipeline computed in
 * Python (cumulative `s`, interval validity, derived mileposts) is what core recomputes.
 */
type ChainPiece = {
  readonly id: string;
  readonly vertexStart: number;
  readonly latE6: readonly number[];
  readonly lonE6: readonly number[];
  readonly sMm: readonly number[];
};
type TileAnchor = {
  readonly id: string;
  readonly chainId: string;
  readonly sMm: number;
  readonly mp: number;
  readonly source: AnchorSource;
  readonly tier: AnchorTier;
};
type TileInterval = {
  readonly id: string;
  readonly chainId: string;
  readonly anchorIds: readonly string[];
};
type Position = {
  readonly chainId: string;
  readonly sStartMm: number;
  readonly sEndMm: number;
  readonly derivedMpStart: number | null;
  readonly derivedMpEnd: number | null;
};
type TileAsset = {
  readonly id: string;
  readonly latE6: readonly number[];
  readonly lonE6: readonly number[];
  readonly positions: readonly Position[];
};
type TileSegment = { readonly latE6: readonly number[]; readonly lonE6: readonly number[] };
type Tile = {
  readonly key: string;
  readonly chains: readonly ChainPiece[];
  readonly segments: readonly TileSegment[];
  readonly anchors: readonly TileAnchor[];
  readonly intervals: readonly TileInterval[];
  readonly assets: readonly TileAsset[];
};

const GOLDEN = new URL('../../../pipeline/tests/golden/synthetic/tiles/', import.meta.url);

const tiles: readonly Tile[] = readdirSync(GOLDEN)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => JSON.parse(readFileSync(new URL(f, GOLDEN), 'utf8')) as Tile);

/** Undoes the pipeline's delta encoding: the first value is absolute, the rest are differences. */
const decode = (deltas: readonly number[]): number[] => {
  let total = 0;
  return deltas.map((d) => (total += d));
};

const toLatLon = (latE6: readonly number[], lonE6: readonly number[]) => {
  const lat = decode(latE6);
  const lon = decode(lonE6);
  return lat.map((la, i) => ({ lat: la / 1e6, lon: (lon[i] as number) / 1e6 }));
};

const anchorOf = (a: TileAnchor): Anchor => ({
  id: a.id,
  s: a.sMm / 1000,
  mp: a.mp,
  source: a.source,
  tier: a.tier,
});

/** The tile's intervals as core anchors, each paired with its chain id. */
const intervalsOf = (tile: Tile): { chainId: string; anchors: Anchor[] }[] => {
  const byKey = new Map(tile.anchors.map((a) => [`${a.chainId}/${a.id}`, a]));
  return tile.intervals.map((iv) => ({
    chainId: iv.chainId,
    anchors: iv.anchorIds.map((id) => {
      const found = byKey.get(`${iv.chainId}/${id}`);
      if (found === undefined) {
        throw new Error(`interval ${iv.id} names anchor ${id} that its tile does not hold`);
      }
      return anchorOf(found);
    }),
  }));
};

describe('pipeline tiles read by @cantre/core', () => {
  it('has the synthetic build to read', () => {
    expect(tiles.length).toBeGreaterThanOrEqual(2);
    expect(tiles.some((t) => t.intervals.length > 0)).toBe(true);
  });

  it('chain s values equal the cumulative lengths core recomputes (within 1 mm)', () => {
    let vertices = 0;
    for (const tile of tiles) {
      for (const piece of tile.chains) {
        const line = toLatLon(piece.latE6, piece.lonE6);
        const cumulative = cumulativeLengthsM(line);
        const sMm = decode(piece.sMm);
        const offsetM = (sMm[0] as number) / 1000; // s of the piece's first vertex in the chain
        expect(sMm).toHaveLength(line.length);
        for (const [i, s] of sMm.entries()) {
          const recomputed = (cumulative[i] as number) + offsetM;
          expect(Math.abs(recomputed - s / 1000)).toBeLessThan(1e-3);
          vertices += 1;
        }
      }
    }
    expect(vertices).toBeGreaterThan(100);
  });

  it('every interval is accepted by validateInterval', () => {
    let count = 0;
    for (const tile of tiles) {
      for (const { anchors } of intervalsOf(tile)) {
        expect(validateInterval(anchors)).toEqual([]);
        count += 1;
      }
    }
    expect(count).toBeGreaterThan(5);
  });

  it('includes an interval whose milepost decreases along the chain', () => {
    const decreasing = tiles
      .flatMap(intervalsOf)
      .filter(({ anchors }) => (anchors.at(-1) as Anchor).mp < (anchors[0] as Anchor).mp);
    expect(decreasing.length).toBeGreaterThan(0);
  });

  it('every non-null derived milepost equals interpolateMilepost on its interval (1e-9 mi)', () => {
    let checked = 0;
    for (const tile of tiles) {
      const intervals = intervalsOf(tile);
      for (const asset of tile.assets) {
        for (const pos of asset.positions) {
          const ends = [
            { sMm: pos.sStartMm, derived: pos.derivedMpStart },
            { sMm: pos.sEndMm, derived: pos.derivedMpEnd },
          ];
          for (const { sMm, derived } of ends) {
            if (derived === null) {
              continue;
            }
            const s = sMm / 1000;
            const candidates = intervals
              .filter(({ chainId }) => chainId === pos.chainId)
              .map(({ anchors }) => interpolateMilepost(s, anchors))
              .filter((r) => r.kind === 'calibrated');
            expect(candidates.length, `${asset.id} at s=${String(s)} has no interval`).toBe(1);
            const result = candidates[0];
            expect(result?.kind === 'calibrated' && Math.abs(result.mp - derived)).toBeLessThan(
              1e-9,
            );
            checked += 1;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('has no negative anchor milepost and no coordinate outside the Canada envelope', () => {
    const inside = (p: { lat: number; lon: number }): boolean =>
      p.lat >= CANADA_ENVELOPE.minLat &&
      p.lat <= CANADA_ENVELOPE.maxLat &&
      p.lon >= CANADA_ENVELOPE.minLon &&
      p.lon <= CANADA_ENVELOPE.maxLon;
    for (const tile of tiles) {
      for (const a of tile.anchors) {
        expect(a.mp).toBeGreaterThanOrEqual(0);
      }
      const lines = [...tile.chains, ...tile.segments, ...tile.assets];
      for (const item of lines) {
        for (const p of toLatLon(item.latE6, item.lonE6)) {
          expect(inside(p), `${tile.key}: ${JSON.stringify(p)}`).toBe(true);
        }
      }
    }
  });
});
