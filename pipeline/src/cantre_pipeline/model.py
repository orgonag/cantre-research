"""Typed, immutable records produced by :mod:`cantre_pipeline.validate`.

All coordinates here are the **quantised** ones (``round(v * coord_scale) / coord_scale``,
microdegrees), the only coordinates any later distance or ``s`` is computed from. ``NodeKey``
alone comes from the **unquantised** endpoint so topology is decided before quantisation.
"""

from collections.abc import Mapping
from dataclasses import dataclass

from cantre_pipeline.audit import AuditRecord
from cantre_pipeline.geodesy import LatLon

NodeKey = tuple[int, int]
"""``(round(lon / snap), round(lat / snap))`` with ``snap = PipelineConfig.snap_deg`` (1e-7 deg)."""


@dataclass(frozen=True)
class Segment:
    """One TRACK record. ``key`` is the unique segment key (Decision 1), ``pts`` run as stored.

    ``geo_accuracy_m`` is ``GEOACCURA`` in metres (the ``-1`` "unknown" code becomes ``None``).
    """

    key: str
    nid: str
    segid: str
    track_class: str
    status: str
    sub_nid: str
    sub_name: str
    operator_mk: str
    operator_name: str
    owner: str
    use_type: str
    track_name: str
    geo_accuracy_m: int | None
    pts: tuple[LatLon, ...]
    start_node: NodeKey
    end_node: NodeKey


@dataclass(frozen=True)
class PointFeature:
    """A point layer record (CROSSING, STATION, MARKERPOST, STRUCTURE_0, JUNCTION).

    ``mp_value`` is the published mileage in miles (``None`` for the ``-1`` sentinel or any
    unusable value), ``mp_qualifier`` is ``SUB1DISTY`` and ``mp_unit`` is ``SUB1UNITDI``. For
    JUNCTION, which has no mileage, these are ``None`` / ``""``. ``attrs`` holds every required
    field of the layer as a stripped string.
    """

    layer: str
    nid: str
    track_nid: str
    sub_nid: str
    mp_value: float | None
    mp_qualifier: str
    mp_unit: str
    pt: LatLon
    node: NodeKey
    attrs: Mapping[str, str]


@dataclass(frozen=True)
class LineFeature:
    """A STRUCTURE_1 record: like :class:`PointFeature` but with a polyline ``pts``."""

    layer: str
    nid: str
    track_nid: str
    sub_nid: str
    mp_value: float | None
    mp_qualifier: str
    mp_unit: str
    pts: tuple[LatLon, ...]
    attrs: Mapping[str, str]


@dataclass(frozen=True)
class Network:
    """All validated features of one province plus the audit lines raised while validating."""

    province: str
    segments: tuple[Segment, ...]
    crossings: tuple[PointFeature, ...]
    stations: tuple[PointFeature, ...]
    markerposts: tuple[PointFeature, ...]
    structures_pt: tuple[PointFeature, ...]
    structures_ln: tuple[LineFeature, ...]
    junctions: tuple[PointFeature, ...]
    audit: tuple[AuditRecord, ...]
