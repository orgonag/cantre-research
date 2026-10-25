import type { NetworkAsset, NetworkView } from '../network/types.js';
import { byString } from '../network/decode.js';
import { assertFinite } from '../units.js';

/** An asset found by {@link assetsAlong}, with its signed distance from the query position. */
export type AssetAlong = {
  readonly asset: NetworkAsset;
  /** Asset position minus the query position, metres along the chain. Positive is toward higher `s`. */
  readonly deltaM: number;
};

/**
 * Assets within `rangeM` metres of position `s` along one chain, nearest first.
 *
 * Formula: deltaM = s_asset - s, in metres along the chain (the same axis as `Candidate.s`, which
 * is absolute along the BASE chain, so a chain split by an unloaded gap needs no special case:
 * pass the candidate's `chainBaseId` and `s`). An asset is listed when |deltaM| <= rangeM.
 * Sign: positive means the asset lies toward higher `s` (the stored vertex order), negative
 * toward lower `s`. This is not "ahead" or "behind": that needs a direction of travel, which one
 * fix does not give.
 *
 * Rules: an asset with several positions on this chain is listed once, at the position nearest
 * to `s` (the lower `s` wins an exact tie). Positions on other chains are ignored. The result is
 * sorted by |deltaM|, then by asset id (code-point order), so it does not depend on input order.
 * A negative `rangeM` lists nothing.
 *
 * Units: `s`, `rangeM` and `deltaM` in metres. Limits: distance is along the track, not straight
 * line, and only on one chain; an asset on a parallel or crossing chain is not found here. It is
 * as good as the pipeline's placement of the asset (see `residualM`), not a survey. Cost: one pass
 * over `net.assets`. Throws `CoreInputError` (`NON_FINITE`) for a non-finite `s` or `rangeM`.
 */
export function assetsAlong(
  net: NetworkView,
  chainBaseId: string,
  s: number,
  rangeM: number,
): readonly AssetAlong[] {
  assertFinite(s, 's');
  assertFinite(rangeM, 'rangeM');
  const found: AssetAlong[] = [];
  for (const asset of net.assets) {
    let best: number | null = null;
    for (const p of asset.positions) {
      if (p.chainId !== chainBaseId) {
        continue;
      }
      const deltaM = p.sM - s; // metres, signed
      if (
        best === null ||
        Math.abs(deltaM) < Math.abs(best) ||
        (Math.abs(deltaM) === Math.abs(best) && deltaM < best)
      ) {
        best = deltaM;
      }
    }
    if (best !== null && Math.abs(best) <= rangeM) {
      found.push({ asset, deltaM: best });
    }
  }
  return found.sort(
    (a, b) => Math.abs(a.deltaM) - Math.abs(b.deltaM) || byString(a.asset.id, b.asset.id),
  );
}
