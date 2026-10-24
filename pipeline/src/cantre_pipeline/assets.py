"""Extract map assets with chain positions and mileage (spec section 5.6).

An *asset* is something worth drawing or announcing along the track: a grade crossing, a bridge,
a moveable bridge, a tunnel, a culvert, a station or a diamond (rail-over-rail crossing).
Each carries its geometry, its published ("posted") mileage when it has one, and zero or more
*positions*, one per chain it sits on.

Kinds (spec 5.6; Decision 6 puts derived mileposts in the pipeline):

* every CROSSING is a ``crossing``; every STATION is a ``station``;
* STRUCTURE_0 / STRUCTURE_1 by ``STRUCTYPE``: ``Bridge`` is ``bridge``, ``Tunnel`` is ``tunnel``,
  ``Culvert`` is ``culvert`` (stored, never drawn as a bridge) and any value containing
  ``Moveable`` or ``Movable`` (case-insensitive) is ``moveableBridge``. Other values
  (``Unknown``) make no asset;
* a JUNCTION with ``TRAJUNCTYP == "Diamond"`` is a ``diamond``; other junction types are not assets.

Positions. A point or line asset with a usable ``TRACKNID`` is projected onto that track's chain
span with the anchor rule (:func:`~cantre_pipeline.anchors.locate_on_chain`: same subdivision,
unambiguous, residual at most ``anchor_max_residual_m``). A line is projected at its first and
last vertex; both must land on one chain, and ``s_start_m <= s_end_m`` is enforced by ordering the
two (a line drawn against the chain direction is not a different place). A diamond's node is
shared by the crossing chains, so it gets one position (residual 0) at every chain vertex that is
an endpoint of a chain segment with that ``NodeKey``. An asset on no chained track (a siding, say)
keeps an empty ``positions``.

Posted mileage is exactly Task 5's Step A (:func:`~cantre_pipeline.anchors.anchor_value`): tier
``posted`` (NRWN), ``tc`` (Transport Canada, also kept in ``attrs["tcMile"]``) or ``unverified``.
A value in a unit other than miles is not reported. Derived mileposts are
:func:`~cantre_pipeline.intervals.interpolate_mp` over the interval of the same chain that
contains ``s`` (inclusive), else ``None``; they never extrapolate. Posted and derived values are
never merged: they are separate labelled fields.

Attributes keep a fixed list of descriptive fields; the sentinels ``"None"``, ``"-1"`` and the
empty string are left out rather than stored. Units: metres for ``s`` and residuals, miles for
mileage.
"""

from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from types import MappingProxyType
from typing import Literal

from cantre_pipeline.anchors import (
    AnchorFeature,
    AnchorTier,
    ChainFix,
    QualifiedAnchor,
    anchor_value,
    index_tracks,
    locate_on_chain,
)
from cantre_pipeline.chains import Chain, ChainSet
from cantre_pipeline.config import PipelineConfig
from cantre_pipeline.geodesy import LatLon
from cantre_pipeline.intervals import Interval, interpolate_mp
from cantre_pipeline.model import Network, NodeKey, PointFeature, Segment
from cantre_pipeline.reader import TcCrossing

__all__ = ["Asset", "AssetKind", "ChainPosition", "PostedMileage", "extract_assets"]

AssetKind = Literal[
    "crossing", "bridge", "moveableBridge", "tunnel", "culvert", "station", "diamond"
]

_SENTINELS = frozenset({"", "None", "-1"})
"""Attribute values that mean "absent" in NRWN and are not stored."""

_CROSSING_ATTRS = (
    "LEVELCROSS",
    "CROSSINTYP",
    "WARNINGSYS",
    "ROADCLASS",
    "CROSSTYPNM",
    "ROUTENUMBE",
    "CROSACCES",
    "TCID",
)
_STATION_ATTRS = ("STNENNAME", "STNTYPE", "STNUSR1ENA")
_STRUCTURE_ATTRS = ("STRUCTYPE", "STRUENNAME")


@dataclass(frozen=True)
class PostedMileage:
    """A published mileage: ``mp`` miles along subdivision ``sub_nid``, from source ``tier``."""

    mp: float
    sub_nid: str
    tier: AnchorTier = "posted"


@dataclass(frozen=True)
class ChainPosition:
    """Where an asset sits on one chain.

    ``s_start_m <= s_end_m`` are metres from the chain start, ``residual_m`` the largest distance
    from the asset's geometry to the chain (0 for a diamond) and ``derived_mp_*`` the interpolated
    mileposts in miles, or ``None`` when no interval of the chain contains that ``s``.
    """

    chain_id: str
    s_start_m: float
    s_end_m: float
    residual_m: float
    derived_mp_start: float | None
    derived_mp_end: float | None


@dataclass(frozen=True)
class Asset:
    """One asset. ``id`` is ``"<LAYER>.<NID>"`` (``~n`` appended to repeated NIDs).

    ``layer`` is the NRWN layer, ``pts`` the (quantised) geometry: one point, or a line's
    vertices. ``posted`` and ``positions[*].derived_mp_*`` are separate, labelled mileages.
    """

    id: str
    kind: AssetKind
    layer: str
    name: str | None
    pts: tuple[LatLon, ...]
    posted: PostedMileage | None
    positions: tuple[ChainPosition, ...]
    attrs: Mapping[str, str]


def _structure_kind(structype: str) -> AssetKind | None:
    """Kind of a STRUCTURE record from its ``STRUCTYPE`` (module docstring), None if none."""
    low = structype.lower()
    if "moveable" in low or "movable" in low:
        return "moveableBridge"
    kinds: dict[str, AssetKind] = {"bridge": "bridge", "tunnel": "tunnel", "culvert": "culvert"}
    return kinds.get(low)


def _attrs(f: Mapping[str, str], keys: Sequence[str]) -> dict[str, str]:
    """The listed attributes of ``f`` that carry a real value."""
    return {k: f[k] for k in keys if f.get(k, "") not in _SENTINELS}


class _Deriver:
    """Derived milepost lookup: the interval of a chain that contains ``s``."""

    def __init__(self, intervals: Sequence[Interval], anchors: Sequence[QualifiedAnchor]) -> None:
        by_id = {(a.chain_id, a.id): a for a in anchors}
        self._by_chain: dict[str, list[tuple[QualifiedAnchor, ...]]] = defaultdict(list)
        for iv in intervals:
            self._by_chain[iv.chain_id].append(
                tuple(by_id[(iv.chain_id, i)] for i in iv.anchor_ids)
            )

    def mp(self, chain_id: str, s_m: float) -> float | None:
        """Interpolated milepost (miles) at ``s_m`` on ``chain_id``, None outside every interval."""
        for anchors in self._by_chain.get(chain_id, []):
            if anchors[0].s_m <= s_m <= anchors[-1].s_m:
                return interpolate_mp(anchors, s_m)
        return None

    def position(self, chain_id: str, s0: float, s1: float, residual: float) -> ChainPosition:
        """A :class:`ChainPosition` with both derived mileposts filled in."""
        return ChainPosition(
            chain_id, s0, s1, residual, self.mp(chain_id, s0), self.mp(chain_id, s1)
        )


def _feature_positions(
    f: AnchorFeature,
    by_nid: Mapping[str, list[Segment]],
    chain_of: Mapping[str, Chain],
    cfg: PipelineConfig,
    deriver: _Deriver,
) -> tuple[ChainPosition, ...]:
    """Position of a point or line asset on its track's chain (module docstring), or ()."""
    first = locate_on_chain(f, by_nid, chain_of, cfg)
    if not isinstance(first, ChainFix):
        return ()
    if isinstance(f, PointFeature):
        return (deriver.position(first.chain.id, first.s_m, first.s_m, first.residual_m),)
    last = locate_on_chain(f, by_nid, chain_of, cfg, pt=f.pts[-1])
    if not isinstance(last, ChainFix) or last.chain.id != first.chain.id:
        return ()
    s0, s1 = sorted((first.s_m, last.s_m))
    return (deriver.position(first.chain.id, s0, s1, max(first.residual_m, last.residual_m)),)


def _diamond_positions(
    node: NodeKey, chains: ChainSet, seg_by_key: Mapping[str, Segment], deriver: _Deriver
) -> tuple[ChainPosition, ...]:
    """A residual-0 position at every chain vertex that is an end of a segment at ``node``."""
    out: list[ChainPosition] = []
    for chain in chains.chains:
        idx: set[int] = set()
        for key in chain.segment_keys:
            seg = seg_by_key[key]
            i0, i1 = chain.segment_ranges[key]
            forward = chain.pts[i0] == seg.pts[0]  # segment runs along the chain, or against it
            start_i, end_i = (i0, i1) if forward else (i1, i0)
            if seg.start_node == node:
                idx.add(start_i)
            if seg.end_node == node:
                idx.add(end_i)
        out += [deriver.position(chain.id, chain.s_m[i], chain.s_m[i], 0.0) for i in sorted(idx)]
    return tuple(out)


def _posted(
    f: AnchorFeature, tc_rows: Mapping[str, TcCrossing], cfg: PipelineConfig, province: str
) -> tuple[PostedMileage | None, dict[str, str]]:
    """Step A value as a :class:`PostedMileage` plus the ``tcMile`` attribute when TC is used."""
    v = anchor_value(f, tc_rows, cfg, province)
    if v.mp is None or v.tier is None or (v.tier != "tc" and f.mp_unit != "Mile"):
        return None, {}
    extra = {"tcMile": repr(v.mp)} if v.tier == "tc" else {}
    return PostedMileage(v.mp, f.sub_nid, v.tier), extra


def extract_assets(
    net: Network,
    chains: ChainSet,
    intervals: Sequence[Interval],
    anchors: Sequence[QualifiedAnchor],
    tc_rows: Mapping[str, TcCrossing],
    cfg: PipelineConfig,
) -> list[Asset]:
    """Extract every asset of ``net`` with its positions and mileage (spec section 5.6).

    ``intervals`` are all intervals of all chains and ``anchors`` the anchors kept by
    :func:`~cantre_pipeline.intervals.build_intervals` (every interval's anchor ids are looked
    up there by chain). ``tc_rows`` maps TC number to row, as for ``qualify_anchors``. The result
    is sorted by id and does not depend on record order; a repeated NID gets ``~1``, ``~2``... in
    geometry order. See the module docstring for the rules; units are metres and miles.
    """
    by_nid, chain_of = index_tracks(net, chains)
    seg_by_key = {s.key: s for s in net.segments}
    deriver = _Deriver(intervals, anchors)
    raw: list[Asset] = []

    def add(f: AnchorFeature, kind: AssetKind, keys: Sequence[str], name_key: str | None) -> None:
        pts = (f.pt,) if isinstance(f, PointFeature) else f.pts
        posted, extra = _posted(f, tc_rows, cfg, net.province)
        attrs = _attrs(f.attrs, keys) | extra
        name = f.attrs.get(name_key, "") if name_key else ""
        raw.append(
            Asset(
                id=f"{f.layer}.{f.nid}",
                kind=kind,
                layer=f.layer,
                name=None if name in _SENTINELS else name,
                pts=pts,
                posted=posted,
                positions=_feature_positions(f, by_nid, chain_of, cfg, deriver),
                attrs=MappingProxyType(dict(sorted(attrs.items()))),
            )
        )

    for c in net.crossings:
        add(c, "crossing", _CROSSING_ATTRS, None)
    for st in net.stations:
        add(st, "station", _STATION_ATTRS, "STNENNAME")
    structures: list[AnchorFeature] = [*net.structures_pt, *net.structures_ln]
    for sf in structures:
        kind = _structure_kind(sf.attrs["STRUCTYPE"])
        if kind is not None:
            add(sf, kind, _STRUCTURE_ATTRS, "STRUENNAME")
    for j in net.junctions:
        if j.attrs.get("TRAJUNCTYP") == "Diamond":
            raw.append(
                Asset(
                    id=f"{j.layer}.{j.nid}",
                    kind="diamond",
                    layer=j.layer,
                    name=None,
                    pts=(j.pt,),
                    posted=None,
                    positions=_diamond_positions(j.node, chains, seg_by_key, deriver),
                    attrs=MappingProxyType({}),
                )
            )
    return _unique_ids(raw)


def _unique_ids(assets: list[Asset]) -> list[Asset]:
    """Sort by ``(id, geometry)`` and suffix repeated ids with ``~1``, ``~2``... (NID repeats)."""
    out: list[Asset] = []
    seen: dict[str, int] = defaultdict(int)
    for a in sorted(assets, key=lambda a: (a.id, a.pts)):
        n = seen[a.id]
        seen[a.id] += 1
        out.append(
            a
            if n == 0
            else Asset(
                f"{a.id}~{n}", a.kind, a.layer, a.name, a.pts, a.posted, a.positions, a.attrs
            )
        )
    return sorted(out, key=lambda a: a.id)
