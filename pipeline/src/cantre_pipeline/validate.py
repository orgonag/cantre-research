"""Validate raw NRWN records and map them to the typed model, auditing every rejection.

Rules (spec section 5; Decisions 1 and the quantisation constraint in the plan):

1. A record with no geometry, more than one part, or any vertex outside the Canada envelope
   (``geodesy.assert_lat_lon``) is rejected, never repaired or clamped.
2. Coordinates are quantised, ``round(v * coord_scale) / coord_scale`` (microdegrees, about
   0.11 m in latitude). Consecutive identical quantised vertices are collapsed
   (``VERTEX_DEDUPED``, info); a line left with fewer than two vertices is ``DEGENERATE_SEGMENT``.
3. Node keys are taken from the **unquantised** end points, ``round(v / snap_deg)``, so topology
   is decided on the data as published (1e-7 degree is about 1 cm).
4. Out-of-domain values for ``TRACKCLASS``, ``STATUS``, ``STRUCTYPE`` and ``TRAJUNCTYP`` pass
   through and are audited ``UNKNOWN_DOMAIN_VALUE`` (info).
5. Repeated ``NID`` values are kept and audited ``DUPLICATE_NID`` (info, one line per record
   that shares the NID). A repeated ``TRACKSEGID`` gets the key suffix ``~1``, ``~2`` ... in
   file order among the kept segments (``DUPLICATE_SEGID``, info, on the suffixed ones).
6. Decision 2: ``SUBDI2*`` is ignored in v1. Each kept record whose ``SUBDI2NID`` is not
   ``"None"``/blank gets a ``SECOND_SUBDIVISION_IGNORED`` info line carrying that NID.

Exactly one ``"rejected"`` audit line is written per rejected record, so for every layer
``kept + rejected == records read``.
"""

from collections import Counter
from collections.abc import Mapping
from pathlib import Path
from types import MappingProxyType

from cantre_pipeline.audit import AuditReason, AuditRecord
from cantre_pipeline.config import PipelineConfig
from cantre_pipeline.geodesy import LatLon, assert_lat_lon
from cantre_pipeline.model import LineFeature, Network, NodeKey, PointFeature, Segment
from cantre_pipeline.reader import RawFeature, read_layer
from cantre_pipeline.schema_nrwn import DOMAINS, REQUIRED_FIELDS, parse_mileage

__all__ = ["load_network", "parse_mileage"]


def _nid(f: RawFeature) -> str:
    """The record's ``NID``, or ``#<index>`` when it is blank, for audit lines."""
    return f.attrs.get("NID") or f"#{f.index}"


def _reject(layer: str, f: RawFeature, reason: AuditReason, detail: str) -> AuditRecord:
    return AuditRecord(layer, _nid(f), reason, "rejected", detail)


def _info(layer: str, f: RawFeature, reason: AuditReason, detail: str) -> AuditRecord:
    return AuditRecord(layer, _nid(f), reason, "info", detail)


def _node(lon: float, lat: float, cfg: PipelineConfig) -> NodeKey:
    """Topology node key of an unquantised position: ``(round(lon/snap), round(lat/snap))``."""
    return (round(lon / cfg.snap_deg), round(lat / cfg.snap_deg))


def _quantise(lon: float, lat: float, cfg: PipelineConfig) -> LatLon:
    """Round to the stored precision: ``round(v * coord_scale) / coord_scale`` degrees."""
    s = cfg.coord_scale
    return LatLon(round(lat * s) / s, round(lon * s) / s)


def _check_geometry(
    f: RawFeature, layer: str, *, line: bool
) -> tuple[list[tuple[float, float]], None] | tuple[None, AuditRecord]:
    """Return the single part's raw ``(lon, lat)`` vertices, or the rejection for ``f``."""
    if not f.parts or not f.parts[0]:
        return None, _reject(layer, f, "NULL_GEOMETRY", "shape has no vertices")
    if len(f.parts) > 1 or (not line and len(f.parts[0]) > 1):
        return None, _reject(layer, f, "MULTIPART_GEOMETRY", f"{len(f.parts)} parts (v1: one)")
    for lon, lat in f.parts[0]:
        try:
            assert_lat_lon(LatLon(lat, lon))
        except ValueError as exc:
            return None, _reject(layer, f, "COORD_OUT_OF_RANGE", str(exc))
    return f.parts[0], None


def _line(
    f: RawFeature, layer: str, cfg: PipelineConfig, audit: list[AuditRecord]
) -> tuple[list[tuple[float, float]], tuple[LatLon, ...]] | None:
    """Validate a polyline: return (raw vertices, quantised de-duplicated vertices) or ``None``.

    Appends the rejection or the ``VERTEX_DEDUPED`` note to ``audit``.
    """
    raw, rej = _check_geometry(f, layer, line=True)
    if raw is None:
        assert rej is not None  # noqa: S101 - narrows the union for mypy
        audit.append(rej)
        return None
    pts: list[LatLon] = []
    for lon, lat in raw:
        q = _quantise(lon, lat, cfg)
        if not pts or q != pts[-1]:
            pts.append(q)
    removed = len(raw) - len(pts)
    if removed:
        audit.append(
            _info(
                layer,
                f,
                "VERTEX_DEDUPED",
                f"{removed} consecutive vertices identical at {cfg.coord_scale}/deg removed",
            )
        )
    if len(pts) < 2:
        audit.append(_reject(layer, f, "DEGENERATE_SEGMENT", f"{len(pts)} vertex after dedupe"))
        return None
    return raw, tuple(pts)


def _point(
    f: RawFeature, layer: str, cfg: PipelineConfig, audit: list[AuditRecord]
) -> tuple[LatLon, NodeKey] | None:
    """Validate a point: return (quantised position, node key) or ``None`` after auditing."""
    raw, rej = _check_geometry(f, layer, line=False)
    if raw is None:
        assert rej is not None  # noqa: S101 - narrows the union for mypy
        audit.append(rej)
        return None
    lon, lat = raw[0]
    return _quantise(lon, lat, cfg), _node(lon, lat, cfg)


def _identity_audit(layer: str, feats: list[RawFeature], audit: list[AuditRecord]) -> None:
    """Add ``DUPLICATE_NID`` and ``UNKNOWN_DOMAIN_VALUE`` notes for every record of a layer."""
    counts = Counter(f.attrs["NID"] for f in feats if f.attrs["NID"])
    for f in feats:
        n = counts[f.attrs["NID"]] if f.attrs["NID"] else 0
        if n > 1:
            audit.append(_info(layer, f, "DUPLICATE_NID", f"{n} records share this NID"))
        for field, domain in DOMAINS.items():
            value = f.attrs.get(field)
            if value is not None and value not in domain:
                audit.append(_info(layer, f, "UNKNOWN_DOMAIN_VALUE", f"{field}={value!r}"))


def _second_subdivision(layer: str, f: RawFeature, audit: list[AuditRecord]) -> None:
    """Note a kept record that names a second subdivision (``SUBDI2*`` is ignored in v1).

    Decision 2: only subdivision 1 is used; one info line per such record lets the build report
    how many records that leaves out. Blank and ``"None"`` mean no second subdivision.
    """
    nid2 = f.attrs.get("SUBDI2NID", "")
    if nid2 not in ("", "None"):
        audit.append(_info(layer, f, "SECOND_SUBDIVISION_IGNORED", f"SUBDI2NID={nid2}"))


def _attrs(layer: str, f: RawFeature) -> Mapping[str, str]:
    """Read-only view of the layer's required fields."""
    return MappingProxyType({k: f.attrs[k] for k in sorted(REQUIRED_FIELDS[layer])})


def _mileage(f: RawFeature) -> tuple[float | None, str, str]:
    """``(mileage in miles or None, qualifier, unit)`` from SUBD1DIST / SUB1DISTY / SUB1UNITDI."""
    return parse_mileage(f.attrs["SUBD1DIST"]), f.attrs["SUB1DISTY"], f.attrs["SUB1UNITDI"]


def _accuracy(value: str) -> int | None:
    """``GEOACCURA`` metres; the ``-1`` code (or anything unparsable) means unknown."""
    try:
        v = int(float(value))
    except ValueError:
        return None
    return v if v >= 0 else None


def _segments(
    feats: list[RawFeature], cfg: PipelineConfig, audit: list[AuditRecord]
) -> tuple[Segment, ...]:
    """Map TRACK records to :class:`Segment`, assigning unique keys (Decision 1)."""
    out: list[Segment] = []
    used: set[str] = set()
    repeats: Counter[str] = Counter()
    for f in feats:
        res = _line(f, "TRACK", cfg, audit)
        if res is None:
            continue
        raw, pts = res
        _second_subdivision("TRACK", f, audit)
        a = f.attrs
        segid = a["TRACKSEGID"]
        key = segid
        while key in used:  # repeated TRACKSEGID: suffix in file order
            repeats[segid] += 1
            key = f"{segid}~{repeats[segid]}"
        if key != segid:
            audit.append(_info("TRACK", f, "DUPLICATE_SEGID", f"TRACKSEGID repeated; key {key}"))
        used.add(key)
        out.append(
            Segment(
                key=key,
                nid=a["NID"],
                segid=segid,
                track_class=a["TRACKCLASS"],
                status=a["STATUS"],
                sub_nid=a["SUBDI1NID"],
                sub_name=a["SUBDI1NAME"],
                operator_mk=a["OPERATORMK"],
                operator_name=a["OPERATOENA"],
                owner=a["OWNERENA"],
                use_type=a["USETYPE"],
                track_name=a["TRACKNAME"],
                geo_accuracy_m=_accuracy(a["GEOACCURA"]),
                pts=pts,
                start_node=_node(raw[0][0], raw[0][1], cfg),
                end_node=_node(raw[-1][0], raw[-1][1], cfg),
            )
        )
    return tuple(out)


def _points(
    layer: str, feats: list[RawFeature], cfg: PipelineConfig, audit: list[AuditRecord]
) -> tuple[PointFeature, ...]:
    """Map a point layer to :class:`PointFeature` (JUNCTION has no mileage fields)."""
    out: list[PointFeature] = []
    for f in feats:
        res = _point(f, layer, cfg, audit)
        if res is None:
            continue
        pt, node = res
        _second_subdivision(layer, f, audit)
        if layer == "JUNCTION":
            mp, qualifier, unit, track_nid, sub_nid = None, "", "", "", ""
        else:
            mp, qualifier, unit = _mileage(f)
            track_nid, sub_nid = f.attrs["TRACKNID"], f.attrs["SUBDI1NID"]
        out.append(
            PointFeature(
                layer=layer,
                nid=f.attrs["NID"],
                track_nid=track_nid,
                sub_nid=sub_nid,
                mp_value=mp,
                mp_qualifier=qualifier,
                mp_unit=unit,
                pt=pt,
                node=node,
                attrs=_attrs(layer, f),
            )
        )
    return tuple(out)


def _structure_lines(
    feats: list[RawFeature], cfg: PipelineConfig, audit: list[AuditRecord]
) -> tuple[LineFeature, ...]:
    """Map STRUCTURE_1 records to :class:`LineFeature`."""
    out: list[LineFeature] = []
    for f in feats:
        res = _line(f, "STRUCTURE_1", cfg, audit)
        if res is None:
            continue
        _second_subdivision("STRUCTURE_1", f, audit)
        mp, qualifier, unit = _mileage(f)
        out.append(
            LineFeature(
                layer="STRUCTURE_1",
                nid=f.attrs["NID"],
                track_nid=f.attrs["TRACKNID"],
                sub_nid=f.attrs["SUBDI1NID"],
                mp_value=mp,
                mp_qualifier=qualifier,
                mp_unit=unit,
                pts=res[1],
                attrs=_attrs("STRUCTURE_1", f),
            )
        )
    return tuple(out)


def load_network(raw_dir: Path, province: str, cfg: PipelineConfig) -> Network:
    """Read and validate all seven NRWN layers of ``province`` from ``raw_dir``.

    ``raw_dir`` holds the ``NRWN_<PR>_*_<LAYER>`` files directly. Fatal problems (schema drift,
    wrong CRS) raise :class:`~cantre_pipeline.errors.PipelineError` from the reader; everything
    else becomes an audit line (see the module rules). Returns immutable features in file order
    and the audit lines in processing order (layer by layer); sort with
    :func:`~cantre_pipeline.audit.write_audit_jsonl` for output.
    """
    audit: list[AuditRecord] = []
    raw = {layer: read_layer(raw_dir, province, layer) for layer in REQUIRED_FIELDS}
    for layer, feats in raw.items():
        _identity_audit(layer, feats, audit)
    segments = _segments(raw["TRACK"], cfg, audit)
    crossings = _points("CROSSING", raw["CROSSING"], cfg, audit)
    stations = _points("STATION", raw["STATION"], cfg, audit)
    markerposts = _points("MARKERPOST", raw["MARKERPOST"], cfg, audit)
    structures_pt = _points("STRUCTURE_0", raw["STRUCTURE_0"], cfg, audit)
    structures_ln = _structure_lines(raw["STRUCTURE_1"], cfg, audit)
    junctions = _points("JUNCTION", raw["JUNCTION"], cfg, audit)
    return Network(
        province=province,
        segments=segments,
        crossings=crossings,
        stations=stations,
        markerposts=markerposts,
        structures_pt=structures_pt,
        structures_ln=structures_ln,
        junctions=junctions,
        audit=tuple(audit),
    )
