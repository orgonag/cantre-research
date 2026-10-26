import { findCandidates, MATCH_CONFIG, milepostFor } from '@cantre/core';
import type { Candidate, Fix, Lock, NetworkView } from '@cantre/core';

const MAX_RADIUS_M = 40_000_000;
const NEARBY_RADIUS_M = 10_000;
const keyOf = (c: Candidate) => c.chainBaseId ?? c.chainId ?? `segment:${c.segmentKey ?? ''}`;
const matches = (c: Candidate, lock: Lock) =>
  lock.kind === 'chain'
    ? c.chainBaseId === lock.chainId || c.chainId === lock.chainId
    : c.subdivisionNid === lock.subdivisionNid;

/** One nearest projection per base chain, never a farther calibrated pass of the same
 * chain substituted for the nearest uncalibrated pass. Miles come only from the core's
 * qualified intervals. The distance is a geometric residual in metres, not GPS accuracy. */
function projections(net: NetworkView, fix: Fix, radius: number) {
  const seen = new Set<string>();
  return findCandidates(net, fix, { ...MATCH_CONFIG, searchRadiusMinM: radius })
    .filter((candidate) => {
      const key = keyOf(candidate);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((candidate) => ({
      key: keyOf(candidate),
      candidate,
      ...milepostFor(net, candidate, fix.accuracyM),
    }));
}
export type MainlineOption = ReturnType<typeof projections>[number];

/** Nearby alternatives start at 10 km. Auto chooses the closest mainline with usable
 * calibration and expands if necessary; absent calibration stays absent. Explicit locks
 * choose that chain/subdivision's closest geometry even when its mileage is unavailable.
 * Search only Main-class geometry (no spur/siding/yard/rapid-transit substitution).
 * Like the core, far-away projections use a local-plane approximation, not survey accuracy. */
export function mainlines(
  net: NetworkView,
  point: Pick<Fix, 'lat' | 'lon' | 'accuracyM'>,
  lock: Lock | null,
) {
  const main = {
    ...net,
    chains: net.chains.filter((c) => c.trackClasses.includes('Main')),
    segments: net.segments.filter((s) => s.trackClass === 'Main'),
  };
  const fix: Fix = { ...point, timestampMs: 0 };
  const total = new Set([
    ...main.chains.filter((c) => c.pts.length).map((c) => c.chainBaseId),
    ...main.segments.filter((s) => s.pts.length).map((s) => `segment:${s.key}`),
  ]).size;
  if (!total) return { selected: null, choices: [] };
  let options: MainlineOption[];
  let auto: MainlineOption | undefined;
  for (let radius = NEARBY_RADIUS_M; ; radius = Math.min(radius * 4, MAX_RADIUS_M)) {
    options = projections(main, fix, radius);
    auto = options.find((o) => o.milepost?.kind === 'calibrated');
    if (auto || options.length >= total || radius === MAX_RADIUS_M) break;
  }
  let selected = auto ?? options[0] ?? null;
  if (lock) {
    const scoped = {
      ...main,
      chains: main.chains.filter((c) =>
        lock.kind === 'chain'
          ? c.id === lock.chainId || c.chainBaseId === lock.chainId
          : c.subdivisionNid === lock.subdivisionNid,
      ),
      segments:
        lock.kind === 'chain'
          ? []
          : main.segments.filter((s) => s.subdivisionNid === lock.subdivisionNid),
    };
    selected = null;
    if (scoped.chains.length || scoped.segments.length) {
      for (let radius = NEARBY_RADIUS_M; ; radius = Math.min(radius * 4, MAX_RADIUS_M)) {
        selected = projections(scoped, fix, radius)[0] ?? null;
        if (selected || radius === MAX_RADIUS_M) break;
      }
    }
  }
  // Keep nearby alternatives even while locked, and always include the current choice.
  const choices = options.slice(0, 8);
  if (selected && !choices.some((o) => o.key === selected.key)) choices.push(selected);
  return {
    selected,
    choices: choices.map((o) => ({
      ...o,
      selected: lock
        ? matches(o.candidate, lock) && o.key === selected?.key
        : o.key === selected?.key,
    })),
  };
}
