"""Cut chains, segments, anchors, intervals and assets into regional tiles (spec section 5.7).

The grid is fixed: ``tile_lat_deg`` x ``tile_lon_deg`` (0.25 x 0.5 deg), key
``f"{floor(lat/tile_lat_deg)}_{floor(lon/tile_lon_deg)}"`` (floor, so negative longitudes are
stable). Each tile also holds everything within ``tile_buffer_m`` (2 km) of its edge, so a client
that loads one tile can still draw and measure up to its border.

Membership (Decision 5: bounding boxes, never a miss, a few extras):

* a chain **piece** is each maximal run of consecutive chain edges whose own bounding box
  overlaps the tile's buffered bounds. ``vertexStart`` is the index of the piece's first vertex in
  the full chain and ``sMm`` holds the full-chain along-track values, so pieces from different
  tiles reassemble exactly (their overlapping vertices are identical integers);
* a segment goes into every tile its bounding box overlaps;
* an interval, with **all** its anchors, goes into every tile that has a piece of its chain whose
  ``s`` range overlaps the interval's ``s`` range (closed ranges);
* an isolated anchor (in no interval) goes into every tile whose piece of its chain contains its
  ``s``;
* an asset goes into every tile whose buffered bounds contain any of its points.

Only tiles that receive something are emitted. Every list is sorted (see :func:`build_tiles`), so
the output depends only on the input *sets*. Coordinates and ``s`` are the quantised values the
earlier stages computed from, converted to integers with :func:`~cantre_pipeline.encode.to_e6`
and delta-encoded (first value absolute, then differences) in ``latE6``, ``lonE6`` and ``sMm``.
"""

import math
from collections import defaultdict
from collections.abc import Iterator, Sequence
from typing import Any, NamedTuple

from cantre_pipeline import __version__
from cantre_pipeline.anchors import QualifiedAnchor
from cantre_pipeline.assets import Asset
from cantre_pipeline.chains import Chain, ChainSet
from cantre_pipeline.config import PipelineConfig
from cantre_pipeline.encode import delta_encode, to_e6
from cantre_pipeline.geodesy import LatLon, metres_per_degree
from cantre_pipeline.intervals import Interval, isolated_anchors
from cantre_pipeline.model import Segment

__all__ = [
    "ATTRIBUTION",
    "DATASET_VERSION",
    "TILE_SCHEMA",
    "Bounds",
    "buffered_bounds",
    "build_tiles",
    "tile_bounds",
    "tile_key",
]

DATASET_VERSION = f"nrwn-2.0+cantre.{__version__}"
"""Dataset version written into every tile and the manifest (spec section 5.8)."""

TILE_SCHEMA = "cantre.tile/1"
ATTRIBUTION = "Contains information licensed under the Open Government Licence \u2013 Canada."
"""OGL-Canada attribution string carried by every NRWN-derived output."""

TileObj = dict[str, Any]

_MIN_LAT_M = 110_000.0
"""Below the smallest metres per degree of latitude (110,574 m); for search margins only."""


class Bounds(NamedTuple):
    """A latitude/longitude rectangle in degrees."""

    south: float
    west: float
    north: float
    east: float


def tile_key(lat: float, lon: float, cfg: PipelineConfig) -> str:
    """Return the key of the tile containing ``(lat, lon)`` degrees: ``"<floor>_<floor>"``.

    ``floor(lat / tile_lat_deg)`` and ``floor(lon / tile_lon_deg)``; a point on an edge belongs
    to the tile to its north / east. Source: Global Constraints, stable IDs.
    """
    return f"{math.floor(lat / cfg.tile_lat_deg)}_{math.floor(lon / cfg.tile_lon_deg)}"


def tile_bounds(key: str, cfg: PipelineConfig) -> Bounds:
    """Return the unbuffered bounds of tile ``key`` in degrees.

    Raises:
        ValueError: if ``key`` is not ``"<int>_<int>"``.
    """
    parts = key.split("_")
    try:
        if len(parts) != 2:
            raise ValueError
        i, j = int(parts[0]), int(parts[1])
    except ValueError:
        raise ValueError(f"malformed tile key {key!r}") from None
    return Bounds(
        i * cfg.tile_lat_deg,
        j * cfg.tile_lon_deg,
        (i + 1) * cfg.tile_lat_deg,
        (j + 1) * cfg.tile_lon_deg,
    )


def buffered_bounds(b: Bounds, buffer_m: float) -> Bounds:
    """Return ``b`` grown by at least ``buffer_m`` metres on every edge (Decision 5).

    Degrees are ``buffer_m / metres_per_degree`` from core's ellipsoid formula. East-west, the
    scale is taken at ``max(|south|, |north|)``, the poleward edge, where a degree of longitude
    is shortest, so the margin is at least ``buffer_m`` along every parallel of the tile.
    North-south, a degree is shortest toward the equator, so the scale is taken at the far end of
    the equatorward margin; the poleward edge's scale would leave the equatorward margin about
    0.6 m short of ``buffer_m`` (and the edge's own scale about 1 mm short).
    """
    poleward = max(abs(b.south), abs(b.north))
    equatorward = 0.0 if b.south <= 0.0 <= b.north else min(abs(b.south), abs(b.north))
    d_lon = buffer_m / metres_per_degree(poleward)[1]
    # A degree of latitude shrinks toward the equator, so evaluate it at the far end of the
    # equatorward margin (just over buffer_m away), not at the edge itself.
    far = max(0.0, equatorward - 1.1 * buffer_m / metres_per_degree(equatorward)[0])
    d_lat = buffer_m / metres_per_degree(far)[0]
    return Bounds(b.south - d_lat, b.west - d_lon, b.north + d_lat, b.east + d_lon)


def _overlap(a: Bounds, b: Bounds) -> bool:
    """True when two closed rectangles share at least one point."""
    return a.south <= b.north and b.south <= a.north and a.west <= b.east and b.west <= a.east


def _bbox(pts: Sequence[LatLon]) -> Bounds:
    lats = [p.lat for p in pts]
    lons = [p.lon for p in pts]
    return Bounds(min(lats), min(lons), max(lats), max(lons))


class _Grid:
    """Finds the tiles whose buffered bounds overlap a rectangle (with a cache of the bounds)."""

    def __init__(self, cfg: PipelineConfig) -> None:
        self.cfg = cfg
        self._cache: dict[tuple[int, int], Bounds] = {}

    def buffered(self, i: int, j: int) -> Bounds:
        got = self._cache.get((i, j))
        if got is None:
            got = buffered_bounds(tile_bounds(f"{i}_{j}", self.cfg), self.cfg.tile_buffer_m)
            self._cache[(i, j)] = got
        return got

    def overlapping(self, box: Bounds) -> Iterator[str]:
        """Yield the key of every tile whose buffered bounds overlap ``box``."""
        cfg = self.cfg
        # Search margins are deliberately generous; the exact test below decides membership.
        lat_ref = min(85.0, max(abs(box.south), abs(box.north)) + cfg.tile_lat_deg + 0.05)
        m_lat = cfg.tile_buffer_m / _MIN_LAT_M
        m_lon = cfg.tile_buffer_m / metres_per_degree(lat_ref)[1]
        i0 = math.floor((box.south - m_lat) / cfg.tile_lat_deg)
        i1 = math.floor((box.north + m_lat) / cfg.tile_lat_deg)
        j0 = math.floor((box.west - m_lon) / cfg.tile_lon_deg)
        j1 = math.floor((box.east + m_lon) / cfg.tile_lon_deg)
        for i in range(i0, i1 + 1):
            for j in range(j0, j1 + 1):
                if _overlap(self.buffered(i, j), box):
                    yield f"{i}_{j}"


class _Piece(NamedTuple):
    chain: Chain
    v0: int  # first vertex index in the full chain
    v1: int  # last vertex index, inclusive


def _runs(edges: Sequence[int]) -> Iterator[tuple[int, int]]:
    """Yield ``(first, last)`` of each maximal run of consecutive ascending edge indices."""
    start = prev = edges[0]
    for e in edges[1:]:
        if e != prev + 1:
            yield start, prev
            start = e
        prev = e
    yield start, prev


def _chain_pieces(chain: Chain, grid: _Grid) -> dict[str, list[_Piece]]:
    """Split ``chain`` into pieces by tile: edge ``i`` is vertices ``i`` and ``i + 1``."""
    edges: dict[str, list[int]] = defaultdict(list)
    for i in range(len(chain.pts) - 1):
        for key in grid.overlapping(_bbox(chain.pts[i : i + 2])):
            edges[key].append(i)
    return {
        key: [_Piece(chain, first, last + 1) for first, last in _runs(es)]
        for key, es in edges.items()
    }


def _e6(pts: Sequence[LatLon], cfg: PipelineConfig) -> tuple[list[int], list[int]]:
    """Delta-encoded integer ``(latE6, lonE6)`` arrays of ``pts``."""
    return (
        delta_encode([to_e6(p.lat, cfg.coord_scale) for p in pts]),
        delta_encode([to_e6(p.lon, cfg.coord_scale) for p in pts]),
    )


def _piece_json(piece: _Piece, cfg: PipelineConfig) -> TileObj:
    c = piece.chain
    sl = slice(piece.v0, piece.v1 + 1)
    lat, lon = _e6(c.pts[sl], cfg)
    return {
        "id": c.id,
        "subdivisionNid": c.sub_nid,
        "subdivisionName": c.sub_name,
        "operators": list(c.operators),
        "cycle": c.cycle,
        "vertexStart": piece.v0,
        "latE6": lat,
        "lonE6": lon,
        "sMm": delta_encode([to_e6(s, cfg.s_scale) for s in c.s_m[sl]]),
    }


def _segment_json(seg: Segment, chain_id: str | None, cfg: PipelineConfig) -> TileObj:
    lat, lon = _e6(seg.pts, cfg)
    return {
        "key": seg.key,
        "nid": seg.nid,
        "trackClass": seg.track_class,
        "status": seg.status,
        "subdivisionNid": seg.sub_nid,
        "subdivisionName": seg.sub_name,
        "operator": seg.operator_name,
        "owner": seg.owner,
        "useType": seg.use_type,
        "trackName": seg.track_name,
        "chainId": chain_id,
        "latE6": lat,
        "lonE6": lon,
    }


def _anchor_json(a: QualifiedAnchor, cfg: PipelineConfig) -> TileObj:
    return {
        "id": a.id,
        "chainId": a.chain_id,
        "sMm": to_e6(a.s_m, cfg.s_scale),
        "mp": a.mp,
        "source": a.source,
        "tier": a.tier,
        "memberNids": sorted(a.member_nids),
    }


def _asset_json(a: Asset, cfg: PipelineConfig) -> TileObj:
    lat, lon = _e6(a.pts, cfg)
    sc = cfg.s_scale
    return {
        "id": a.id,
        "kind": a.kind,
        "layer": a.layer,
        "name": a.name,
        "latE6": lat,
        "lonE6": lon,
        "posted": None
        if a.posted is None
        else {"mp": a.posted.mp, "subdivisionNid": a.posted.sub_nid, "tier": a.posted.tier},
        "positions": [
            {
                "chainId": p.chain_id,
                "sStartMm": to_e6(p.s_start_m, sc),
                "sEndMm": to_e6(p.s_end_m, sc),
                "residualMm": to_e6(p.residual_m, sc),
                "derivedMpStart": p.derived_mp_start,
                "derivedMpEnd": p.derived_mp_end,
            }
            for p in a.positions
        ],
        "attrs": dict(sorted(a.attrs.items())),
    }


def build_tiles(
    province: str,
    chains: ChainSet,
    segments: Sequence[Segment],
    anchors: Sequence[QualifiedAnchor],
    intervals: Sequence[Interval],
    assets: Sequence[Asset],
    cfg: PipelineConfig,
    dataset_version: str,
) -> dict[str, TileObj]:
    """Return the tile JSON objects by tile key (spec section 5.7; membership in the module doc).

    ``segments`` are every segment of the network (chained and not; segments of ``chains`` get
    their ``chainId``, the rest ``null``). ``anchors`` are the anchors kept by
    ``build_intervals`` and ``intervals`` all intervals. ``province`` is the lower-case code; tiles
    are province-agnostic, so it is not written into them (a later multi-province merge keys on
    it). Sort orders: chains by ``(id, vertexStart)``, segments by key, anchors by
    ``(chainId, sMm, id)``, intervals by id, assets by id. Units: integer microdegrees and
    integer millimetres; mileposts are miles.

    Raises:
        ValueError: if an interval names an anchor that is not in ``anchors``.
    """
    del province  # tiles are province-agnostic; kept in the signature for the multi-province merge
    grid = _Grid(cfg)
    by_key: dict[str, list[_Piece]] = defaultdict(list)
    ranges: dict[tuple[str, str], list[tuple[float, float]]] = defaultdict(list)
    chain_tiles: dict[str, set[str]] = defaultdict(set)
    for chain in chains.chains:
        for key, pcs in _chain_pieces(chain, grid).items():
            by_key[key] += pcs
            chain_tiles[chain.id].add(key)
            ranges[(key, chain.id)] += [(chain.s_m[p.v0], chain.s_m[p.v1]) for p in pcs]

    chain_of = {k: c.id for c in chains.chains for k in c.segment_keys}
    seg_in: dict[str, list[Segment]] = defaultdict(list)
    for seg in segments:
        for key in grid.overlapping(_bbox(seg.pts)):
            seg_in[key].append(seg)

    asset_in: dict[str, list[Asset]] = defaultdict(list)
    for asset in assets:
        keys = {k for p in asset.pts for k in grid.overlapping(_bbox([p]))}
        for key in keys:
            asset_in[key].append(asset)

    by_id = {(a.chain_id, a.id): a for a in anchors}
    anchor_in: dict[str, dict[tuple[str, str], QualifiedAnchor]] = defaultdict(dict)
    interval_in: dict[str, list[Interval]] = defaultdict(list)
    for iv in intervals:
        try:
            members = [by_id[(iv.chain_id, i)] for i in iv.anchor_ids]
        except KeyError as exc:
            raise ValueError(f"interval {iv.id} names unknown anchor {exc.args[0][1]!r}") from None
        s_lo, s_hi = min(m.s_m for m in members), max(m.s_m for m in members)
        for key in chain_tiles[iv.chain_id]:
            if any(lo <= s_hi and s_lo <= hi for lo, hi in ranges[(key, iv.chain_id)]):
                interval_in[key].append(iv)
                for m in members:
                    anchor_in[key][(m.chain_id, m.id)] = m
    for a in isolated_anchors(anchors, intervals):
        for key in chain_tiles[a.chain_id]:
            if any(lo <= a.s_m <= hi for lo, hi in ranges[(key, a.chain_id)]):
                anchor_in[key][(a.chain_id, a.id)] = a

    tiles: dict[str, TileObj] = {}
    for key in sorted({*by_key, *seg_in, *asset_in}):
        b = tile_bounds(key, cfg)
        tiles[key] = {
            "schema": TILE_SCHEMA,
            "datasetVersion": dataset_version,
            "key": key,
            "bounds": {"south": b.south, "west": b.west, "north": b.north, "east": b.east},
            "bufferM": cfg.tile_buffer_m,
            "attribution": ATTRIBUTION,
            "chains": [
                _piece_json(p, cfg) for p in sorted(by_key[key], key=lambda p: (p.chain.id, p.v0))
            ],
            "segments": [
                _segment_json(s, chain_of.get(s.key), cfg)
                for s in sorted(seg_in[key], key=lambda s: s.key)
            ],
            "anchors": [
                _anchor_json(a, cfg)
                for a in sorted(
                    anchor_in[key].values(),
                    key=lambda a: (a.chain_id, to_e6(a.s_m, cfg.s_scale), a.id),
                )
            ],
            "intervals": [
                {"id": iv.id, "chainId": iv.chain_id, "anchorIds": list(iv.anchor_ids)}
                for iv in sorted(interval_in[key], key=lambda iv: iv.id)
            ],
            "assets": [_asset_json(a, cfg) for a in sorted(asset_in[key], key=lambda a: a.id)],
        }
    return tiles
