import { cumulativeLengthsM, fromLocalM } from '@cantre/core';
import type { LatLon, NetworkChain, NetworkInterval, NetworkView } from '@cantre/core';

/** Test-only: a small hand-built network, placed by metre offsets from a point in southern MB. */
export const ORIGIN: LatLon = { lat: 50, lon: -100 };

/** A straight east-west chain from `fromM` to `toM` metres, `lateralM` metres north of ORIGIN. */
export function chain(
  id: string,
  sub: string,
  subName: string,
  fromM: number,
  toM: number,
  lateralM = 0,
): NetworkChain {
  const pts = [fromM, (fromM + toM) / 2, toM].map((x) =>
    fromLocalM(ORIGIN, { x, y: lateralM }, ORIGIN.lat),
  );
  const cumulativeM = cumulativeLengthsM(pts);
  return {
    id,
    chainBaseId: id,
    subdivisionNid: sub,
    subdivisionName: subName,
    operators: ['CN'],
    cycle: false,
    trackClasses: ['Main'],
    pts,
    sM: Float64Array.from(cumulativeM, (c) => fromM + c),
    cumulativeM,
  };
}

export function interval(
  id: string,
  chainId: string,
  anchors: readonly (readonly [number, number])[],
): NetworkInterval {
  return {
    id,
    chainId,
    anchors: anchors.map(([s, mp], i) => ({
      id: `${id}-a${String(i)}`,
      s,
      mp,
      source: 'markerpost',
      tier: 'posted',
    })),
  };
}

export function net(parts: Partial<NetworkView> = {}): NetworkView {
  return {
    datasetVersion: 'v1',
    coverage: [],
    chains: [],
    segments: [],
    intervals: [],
    diamonds: [],
    assets: [],
    ...parts,
  };
}
