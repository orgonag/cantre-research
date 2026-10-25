import type { Anchor, AnchorTier } from '../anchors.js';
import type { LatLon } from '../coords.js';

/**
 * The in-memory rail network the matcher reads, decoded from `cantre.tile/1` tiles by
 * `networkFromTiles`. Source: CANTRE v1 spec §6 and the M3 plan (Task 2); the tile format is
 * pipeline/schema/tile.schema.json.
 *
 * Limits: the view holds only what the loaded tiles hold. Absence of a track, chain piece or
 * anchor means "not loaded", never "does not exist".
 */

/**
 * The rectangle a tile covers, in degrees (WGS84). Unbuffered: the tile's own `bounds`, not the
 * buffered geometry it also carries. Source: tile schema `bounds`.
 */
export type TileBounds = {
  readonly south: number;
  readonly west: number;
  readonly north: number;
  readonly east: number;
};

/**
 * One continuous track chain, as far as it is loaded: the pieces from every loaded tile merged
 * by vertex index.
 *
 * Units: `sM` and `cumulativeM` are metres along the chain. `sM` holds the pipeline's stored
 * `sMm / 1000`, the position of each vertex in the full chain. `cumulativeM` is `sM` rebased so
 * that `cumulativeM[0] = 0`, which is what `projectOntoPolyline(p, pts, cumulativeM)` expects;
 * the candidate's chain position is then `sM[0] + alongM`.
 * Limits: when a tile in the middle of a chain is not loaded, the loaded pieces cannot be
 * joined without bridging a gap. They are kept as separate entries (`id`, `id#2`, ...), all with
 * the same `chainBaseId`, and the decoder never interpolates across the gap.
 */
export type NetworkChain = {
  /** Unique within the view. The pipeline chain id, or `<id>#2`, `<id>#3`, ... for later pieces. */
  readonly id: string;
  /** The pipeline chain id. Intervals, anchors and diamond positions refer to this id. */
  readonly chainBaseId: string;
  readonly subdivisionNid: string;
  readonly subdivisionName: string;
  readonly operators: readonly string[];
  readonly cycle: boolean;
  /** Sorted unique `trackClass` of the loaded segments that belong to this chain. */
  readonly trackClasses: readonly string[];
  readonly pts: readonly LatLon[];
  /** Position of each vertex in the full chain, metres (`sMm / 1000`). */
  readonly sM: Float64Array;
  /** `sM` minus `sM[0]`, metres, for M1's polyline projection. */
  readonly cumulativeM: Float64Array;
};

/**
 * One NRWN track segment. Only segments that belong to no chain are in `NetworkView.segments`
 * (sidings, yards, spurs); segments that belong to a chain are reflected in the chain's
 * `trackClasses`. Units: `geoAccuracyM` is metres, as the source states it, or null when the
 * source gives none. It is reported, not verified (spec §6(e)).
 */
export type NetworkSegment = {
  readonly key: string;
  readonly chainId: string | null;
  readonly trackClass: string;
  readonly status: string;
  readonly subdivisionNid: string;
  readonly subdivisionName: string;
  readonly operator: string;
  readonly geoAccuracyM: number | null;
  readonly pts: readonly LatLon[];
};

/**
 * A run of milepost anchors on one chain that may be interpolated between. Anchors are in `s`
 * order with their quality tier carried. `chainId` is the BASE chain id.
 */
export type NetworkInterval = {
  readonly id: string;
  readonly chainId: string;
  readonly anchors: readonly Anchor[];
};

/**
 * Where a diamond (the crossing of two lines) lies along a chain. `sM` is metres along the chain
 * (the midpoint of the stored start and end position). `chainId` is the BASE chain id.
 */
export type DiamondPosition = {
  readonly assetId: string;
  readonly chainId: string;
  readonly sM: number;
};

/** The kinds of asset the pipeline places on the network (tile schema `assets[].kind`). */
export type AssetKind =
  'crossing' | 'bridge' | 'moveableBridge' | 'tunnel' | 'culvert' | 'station' | 'diamond';

/**
 * Where an asset lies along one chain it was placed on.
 *
 * Units: `sM` is metres along the BASE chain (the midpoint of the stored start and end, the same
 * rule as {@link DiamondPosition}); `residualM` is the distance from the asset to the chain in
 * metres (a residual, not an accuracy). `derivedMp` is the milepost in miles that the pipeline
 * derived at this position, or null when the position is not inside a calibrated interval or the
 * start or end had none. For a line asset it is the milepost at the midpoint `sM`, interpolated
 * inside the one calibrated interval that holds both ends; when no single interval holds both
 * (for example across a milepost equation) it is null, never an average across the gap.
 */
export type AssetPosition = {
  /** The pipeline (base) chain id. */
  readonly chainId: string;
  readonly sM: number;
  readonly residualM: number;
  readonly derivedMp: number | null;
};

/** An asset's own posted milepost, as published (miles) with its subdivision and tier. */
export type AssetPosted = {
  readonly mp: number;
  readonly subdivisionNid: string;
  readonly tier: AnchorTier;
};

/**
 * One asset (level crossing, bridge, tunnel, culvert, station or diamond) on the network.
 *
 * `at` is a representative point in degrees: the asset's only vertex, or for a line asset the
 * middle vertex (index floor((n - 1) / 2) of n), not an extent. `positions` is where the asset
 * lies along each chain it was placed on (empty when it was placed on none). The asset's layer
 * and source attributes are not here; they live in the separate asset-details file.
 * Limits: positions are as good as the pipeline's snapping (see `residualM`); no safety or
 * survey claim.
 */
export type NetworkAsset = {
  readonly id: string;
  readonly kind: AssetKind;
  readonly name: string | null;
  readonly posted: AssetPosted | null;
  readonly positions: readonly AssetPosition[];
  readonly at: LatLon;
};

/**
 * Everything the matcher needs, merged across the loaded tiles and sorted by id (code-point
 * order) so that the same tiles in any order give a deep-equal view.
 *
 * `coverage` is each loaded tile's unbuffered bounds. `datasetVersion` is the version every
 * tile agrees on (empty string when no tile is loaded).
 */
export type NetworkView = {
  readonly datasetVersion: string;
  readonly coverage: readonly TileBounds[];
  readonly chains: readonly NetworkChain[];
  /** Unchained segments only. */
  readonly segments: readonly NetworkSegment[];
  readonly intervals: readonly NetworkInterval[];
  readonly diamonds: readonly DiamondPosition[];
  /** Every asset, sorted by id. `diamonds` is the subset of kind `diamond`, in match form. */
  readonly assets: readonly NetworkAsset[];
};
