import type { AssetKind, LatLon, NetworkAsset } from '@cantre/core';

export const ASSET_KINDS: readonly AssetKind[] = [
  'crossing',
  'bridge',
  'moveableBridge',
  'tunnel',
  'culvert',
  'station',
  'diamond',
];
export const DEFAULT_ASSET_KINDS: readonly AssetKind[] = ['crossing', 'bridge', 'moveableBridge'];
export type ViewBounds = { west: number; east: number; south: number; north: number };
/** Bound both map markers and their accessible list to the same nearest 100 items.
 * Haversine's dimensionless half-chord is monotonic with great-circle distance. It
 * ranks points without converting to metres; no mileage or rail match uses it. */
export function visibleAssets(
  assets: readonly NetworkAsset[],
  kinds: readonly AssetKind[],
  center: LatLon,
  bounds: ViewBounds,
): readonly NetworkAsset[] {
  const rad = Math.PI / 180;
  const rank = (p: LatLon) =>
    Math.sin(((p.lat - center.lat) * rad) / 2) ** 2 +
    Math.cos(p.lat * rad) *
      Math.cos(center.lat * rad) *
      Math.sin(((p.lon - center.lon) * rad) / 2) ** 2;
  return assets
    .filter(
      (a) =>
        kinds.includes(a.kind) &&
        a.at.lat >= bounds.south &&
        a.at.lat <= bounds.north &&
        (bounds.west <= bounds.east
          ? a.at.lon >= bounds.west && a.at.lon <= bounds.east
          : a.at.lon >= bounds.west || a.at.lon <= bounds.east),
    )
    .map((a) => ({ a, rank: rank(a.at) }))
    .sort((a, b) => a.rank - b.rank || a.a.id.localeCompare(b.a.id))
    .slice(0, 100)
    .map((x) => x.a);
}
