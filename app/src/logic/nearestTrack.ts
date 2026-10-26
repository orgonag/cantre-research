import { findCandidates, MATCH_CONFIG, milepostFor } from '@cantre/core';
import type { Fix, Lock, NetworkView } from '@cantre/core';

/** Nearest mapped track, not a claim that the device is on it. Search expands without
 * the matcher's proximity cutoff. 40,000 km covers the entire supported Canada envelope;
 * far-away projections retain the core's local-plane approximation, not survey accuracy.
 * A route lock restricts the search; missing calibration stays missing (no extrapolation).
 */
export function nearestTrack(
  net: NetworkView,
  point: Pick<Fix, 'lat' | 'lon' | 'accuracyM'>,
  lock: Lock | null,
) {
  const scoped =
    lock === null
      ? net
      : {
          ...net,
          chains: net.chains.filter((c) =>
            lock.kind === 'chain'
              ? c.id === lock.chainId || c.chainBaseId === lock.chainId
              : c.subdivisionNid === lock.subdivisionNid,
          ),
          segments:
            lock.kind === 'chain'
              ? []
              : net.segments.filter((s) => s.subdivisionNid === lock.subdivisionNid),
        };
  if (!scoped.chains.length && !scoped.segments.length) return null;
  const fix: Fix = { ...point, timestampMs: 0 };
  for (let radius = 50; ; radius = Math.min(radius * 4, 40_000_000)) {
    const candidates = findCandidates(scoped, fix, { ...MATCH_CONFIG, searchRadiusMinM: radius });
    const candidate = candidates[0];
    if (candidate)
      return { candidate, candidates, ...milepostFor(net, candidate, point.accuracyM) };
    if (radius === 40_000_000) return null;
  }
}
