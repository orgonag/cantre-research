"""Tests for cantre_pipeline.validate, model and audit: records to dataclasses, audit lines."""

import json
import os
from collections import Counter
from dataclasses import FrozenInstanceError
from pathlib import Path
from typing import get_args

import pytest

from cantre_pipeline.audit import AuditReason, AuditRecord, write_audit_jsonl
from cantre_pipeline.config import PipelineConfig
from cantre_pipeline.geodesy import LatLon
from cantre_pipeline.model import Network
from cantre_pipeline.validate import load_network
from fixtures.builder import NrwnFixture

CFG = PipelineConfig()
A = LatLon(52.0, -106.0)
B = LatLon(52.0, -105.99)
C = LatLon(52.0, -105.98)


def _load(fx: NrwnFixture) -> Network:
    return load_network(fx.write(), "sk", CFG)


def _reasons(net: Network) -> Counter[str]:
    return Counter(a.reason for a in net.audit)


def test_reason_set_is_the_closed_set_of_33() -> None:
    reasons = set(get_args(AuditReason))
    assert len(reasons) == 33
    assert {"NULL_GEOMETRY", "TC_DUPLICATE_NUMBER", "CHAIN_CYCLE", "ANCHOR_OUTLIER"} <= reasons


def test_valid_package_maps_to_dataclasses(tmp_path: Path) -> None:
    fx = NrwnFixture(tmp_path)
    fx.track("SEG1", [A, B, C], nid="T1", op="CP", geoaccura=10, track_name="Line")
    fx.crossing("X1", B, "T1", mp=3.5, tcid=77, crossing_id="G1")
    fx.station("S1", A, "T1", mp=1.0)
    fx.markerpost("M1", C, "T1", mp=9.0)
    fx.culvert("U1", A, "T1")
    fx.bridge("BR1", [A, B], "T1")
    fx.junction("J1", A, "Diamond")
    net = _load(fx)
    assert net.province == "sk"
    assert net.audit == ()
    (seg,) = net.segments
    assert (seg.key, seg.nid, seg.segid) == ("SEG1", "T1", "SEG1")
    assert (seg.track_class, seg.status, seg.use_type) == ("Main", "Operational", "Freight")
    assert (seg.sub_nid, seg.sub_name) == ("S1", "Alpha")
    assert (seg.operator_mk, seg.operator_name, seg.owner) == ("CP", "CP", "Owner")
    assert seg.track_name == "Line"
    assert seg.geo_accuracy_m == 10
    assert seg.pts == (A, B, C)
    assert seg.start_node == (round(-106.0 / 1e-7), round(52.0 / 1e-7))
    assert seg.end_node == (round(-105.98 / 1e-7), round(52.0 / 1e-7))
    (x,) = net.crossings
    assert (x.layer, x.nid, x.track_nid, x.sub_nid) == ("CROSSING", "X1", "T1", "S1")
    assert (x.mp_value, x.mp_qualifier, x.mp_unit) == (3.5, "Posted", "Mile")
    assert x.pt == B
    assert x.node == (round(-105.99 / 1e-7), round(52.0 / 1e-7))
    assert x.attrs["TCID"] == "77"
    assert x.attrs["CROSSINGID"] == "G1"
    assert x.attrs["SUBDI1NAME"] == "Alpha"
    assert net.stations[0].mp_value == 1.0 and net.stations[0].mp_qualifier == "Unknown"
    assert net.markerposts[0].mp_value == 9.0
    assert net.structures_pt[0].attrs["STRUCTYPE"] == "Culvert"
    assert net.structures_pt[0].mp_value is None  # -1 sentinel
    assert net.structures_ln[0].pts == (A, B)
    assert net.junctions[0].attrs["TRAJUNCTYP"] == "Diamond"
    with pytest.raises(FrozenInstanceError):
        seg.key = "other"  # type: ignore[misc]


def test_second_subdivision_is_ignored_and_counted(tmp_path: Path) -> None:
    fx = NrwnFixture(tmp_path)
    fx.track("S1", [A, B], nid="T1", sub2="SUB-B")
    fx.track("S2", [B, C], nid="T2")
    fx.track("S3", None, nid="T3", sub2="SUB-C")  # rejected record: no second-subdivision line
    fx.crossing("X1", A, "T1", mp=1.0, sub2="SUB-B")
    fx.station("ST1", A, "T1", sub2="SUB-B")
    fx.markerpost("M1", A, "T1", sub2="")
    fx.culvert("U1", A, "T1", sub2="SUB-B")
    fx.bridge("BR1", [A, B], "T1", sub2="SUB-B")
    fx.junction("J1", A, "End")
    net = _load(fx)
    got = {
        (a.layer, a.nid, a.detail) for a in net.audit if a.reason == "SECOND_SUBDIVISION_IGNORED"
    }
    assert got == {
        ("TRACK", "T1", "SUBDI2NID=SUB-B"),
        ("CROSSING", "X1", "SUBDI2NID=SUB-B"),
        ("STATION", "ST1", "SUBDI2NID=SUB-B"),
        ("STRUCTURE_0", "U1", "SUBDI2NID=SUB-B"),
        ("STRUCTURE_1", "BR1", "SUBDI2NID=SUB-B"),
    }
    assert {a.severity for a in net.audit if a.reason == "SECOND_SUBDIVISION_IGNORED"} == {"info"}
    assert len(net.segments) == 2  # kept either way


def test_geo_accuracy_sentinel_is_none(tmp_path: Path) -> None:
    fx = NrwnFixture(tmp_path)
    fx.track("S", [A, B], geoaccura=-1)
    assert _load(fx).segments[0].geo_accuracy_m is None


def test_duplicate_segid_is_suffixed_and_audited(tmp_path: Path) -> None:
    fx = NrwnFixture(tmp_path)
    fx.track("SEG1", [A, B], nid="N1")
    fx.track("SEG1", [B, C], nid="N2")
    fx.track("SEG1", [C, LatLon(52.0, -105.97)], nid="N3")
    net = _load(fx)
    assert [s.key for s in net.segments] == ["SEG1", "SEG1~1", "SEG1~2"]
    assert [s.segid for s in net.segments] == ["SEG1"] * 3
    dups = [a for a in net.audit if a.reason == "DUPLICATE_SEGID"]
    assert [(a.nid, a.severity) for a in dups] == [("N2", "info"), ("N3", "info")]


def test_duplicate_nid_kept_with_info_audit(tmp_path: Path) -> None:
    fx = NrwnFixture(tmp_path)
    fx.track("SEG1", [A, B], nid="SAME")
    fx.track("SEG2", [B, C], nid="SAME")
    fx.track("SEG3", [C, LatLon(52.0, -105.97)], nid="OTHER")
    net = _load(fx)
    assert len(net.segments) == 3  # all kept
    dups = [a for a in net.audit if a.reason == "DUPLICATE_NID"]
    assert len(dups) == 2 and {a.nid for a in dups} == {"SAME"}
    assert {a.severity for a in dups} == {"info"}
    assert {a.layer for a in dups} == {"TRACK"}


def test_quantisation_dedupes_vertices_and_rejects_degenerate(tmp_path: Path) -> None:
    # 52.0000001 and 52.0000003 are 0.02 m apart and both round to 52.000000 at 1e-6 deg.
    fx = NrwnFixture(tmp_path)
    fx.track("KEEP", [A, LatLon(52.0000001, -106.0), LatLon(52.0000003, -106.0), B], nid="K")
    fx.track("DEG", [A, LatLon(52.0000004, -106.0)], nid="D")
    net = _load(fx)
    (seg,) = net.segments
    assert seg.pts == (A, B)
    # Node keys come from the UNQUANTISED endpoints: 52.0000001 does not appear, A and B do.
    assert seg.start_node == (round(-106.0 / 1e-7), round(52.0 / 1e-7))
    got = {(a.nid, a.reason, a.severity) for a in net.audit}
    assert ("K", "VERTEX_DEDUPED", "info") in got
    assert ("D", "VERTEX_DEDUPED", "info") in got
    assert ("D", "DEGENERATE_SEGMENT", "rejected") in got


def test_node_key_uses_unquantised_endpoint(tmp_path: Path) -> None:
    fx = NrwnFixture(tmp_path)
    fx.track("S", [LatLon(52.00000046, -106.00000046), B])
    seg = _load(fx).segments[0]
    assert seg.pts[0] == LatLon(52.0, -106.0)  # quantised to 1e-6
    assert seg.start_node == (round(-106.00000046 / 1e-7), round(52.00000046 / 1e-7))
    assert seg.start_node != (round(-106.0 / 1e-7), round(52.0 / 1e-7))


def test_single_vertex_line_is_degenerate(tmp_path: Path) -> None:
    fx = NrwnFixture(tmp_path)
    fx.track("ONE", [A])
    net = _load(fx)
    assert net.segments == ()
    assert _reasons(net) == {"DEGENERATE_SEGMENT": 1}


def test_coordinates_outside_canada_are_rejected_not_clamped(tmp_path: Path) -> None:
    fx = NrwnFixture(tmp_path)
    fx.track("SWAP", [LatLon(-106.0, 52.0), LatLon(-105.0, 52.0)], nid="SW")  # lat/lon swapped
    fx.track("EAST", [A, LatLon(52.0, 106.0)], nid="EA")  # positive-west longitude
    fx.crossing("XO", LatLon(10.0, -100.0), "SW", mp=1.0)
    fx.junction("JO", LatLon(52.0, -200.0), "End")
    net = _load(fx)
    assert (net.segments, net.crossings, net.junctions) == ((), (), ())
    out = {(a.layer, a.nid) for a in net.audit if a.reason == "COORD_OUT_OF_RANGE"}
    assert out == {("TRACK", "SW"), ("TRACK", "EA"), ("CROSSING", "XO"), ("JUNCTION", "JO")}
    assert {a.severity for a in net.audit} == {"rejected"}


def test_null_and_multipart_geometry_are_audited(tmp_path: Path) -> None:
    fx = NrwnFixture(tmp_path)
    fx.track("NUL", None, nid="NU")
    fx.track("MUL", [A, B], nid="MU", extra_parts=[[B, C]])
    fx.crossing("XN", None, "NU", mp=1.0)
    fx.bridge("BN", None, "NU")
    fx.bridge("BM", [A, B], "NU", extra_parts=[[B, C]])
    net = _load(fx)
    got = {(a.layer, a.nid, a.reason, a.severity) for a in net.audit}
    assert got == {
        ("TRACK", "NU", "NULL_GEOMETRY", "rejected"),
        ("TRACK", "MU", "MULTIPART_GEOMETRY", "rejected"),
        ("CROSSING", "XN", "NULL_GEOMETRY", "rejected"),
        ("STRUCTURE_1", "BN", "NULL_GEOMETRY", "rejected"),
        ("STRUCTURE_1", "BM", "MULTIPART_GEOMETRY", "rejected"),
    }


def test_unknown_domain_values_pass_through_with_info_audit(tmp_path: Path) -> None:
    fx = NrwnFixture(tmp_path)
    fx.track("S", [A, B], nid="T", cls="Ghost", status="Mothballed")
    fx.culvert("U", A, "T", kind="Weir")
    fx.bridge("B", [A, B], "T", kind="Ferry")
    fx.junction("J", A, "Roundabout")
    fx.junction("J2", B, "")  # SK has 2 blank-typed junctions
    net = _load(fx)
    assert net.segments[0].track_class == "Ghost"
    assert net.segments[0].status == "Mothballed"
    assert len(net.junctions) == 2
    got = {(a.layer, a.nid, a.reason, a.severity) for a in net.audit}
    assert got == {
        ("TRACK", "T", "UNKNOWN_DOMAIN_VALUE", "info"),
        ("STRUCTURE_0", "U", "UNKNOWN_DOMAIN_VALUE", "info"),
        ("STRUCTURE_1", "B", "UNKNOWN_DOMAIN_VALUE", "info"),
        ("JUNCTION", "J", "UNKNOWN_DOMAIN_VALUE", "info"),
        ("JUNCTION", "J2", "UNKNOWN_DOMAIN_VALUE", "info"),
    }
    details = [a.detail for a in net.audit if a.layer == "TRACK"]
    assert any("TRACKCLASS" in d and "Ghost" in d for d in details)
    assert any("STATUS" in d and "Mothballed" in d for d in details)


def test_every_input_record_is_accounted_for(tmp_path: Path) -> None:
    fx = NrwnFixture(tmp_path)
    fx.track("OK", [A, B], nid="T")
    fx.track("OK2", [B, C], nid="T2")
    fx.track("NUL", None, nid="N1")
    fx.track("OUT", [LatLon(1.0, 1.0), LatLon(2.0, 2.0)], nid="N2")
    fx.track("DEG", [A, A], nid="N3")
    fx.crossing("X1", A, "T", mp=1.0)
    fx.crossing("X2", None, "T", mp=1.0)
    fx.station("S1", A, "T")
    fx.station("S2", LatLon(0.0, 0.0), "T")
    fx.markerpost("M1", A, "T")
    fx.culvert("U1", A, "T")
    fx.bridge("B1", [A, B], "T")
    fx.bridge("B2", None, "T")
    fx.junction("J1", A, "Switch")
    fx.junction("J2", None, "Switch")
    net = _load(fx)
    kept = {
        "TRACK": len(net.segments),
        "CROSSING": len(net.crossings),
        "STATION": len(net.stations),
        "MARKERPOST": len(net.markerposts),
        "STRUCTURE_0": len(net.structures_pt),
        "STRUCTURE_1": len(net.structures_ln),
        "JUNCTION": len(net.junctions),
    }
    total = {
        "TRACK": 5,
        "CROSSING": 2,
        "STATION": 2,
        "MARKERPOST": 1,
        "STRUCTURE_0": 1,
        "STRUCTURE_1": 2,
        "JUNCTION": 2,
    }
    rejected = Counter(a.layer for a in net.audit if a.severity == "rejected")
    for layer, n in total.items():
        assert kept[layer] + rejected[layer] == n, layer
    assert sum(rejected.values()) == 7  # exactly one rejection line per rejected record


def test_audit_jsonl_is_sorted_and_canonical(tmp_path: Path) -> None:
    recs = [
        AuditRecord("TRACK", "b", "NULL_GEOMETRY", "rejected", "z"),
        AuditRecord("CROSSING", "a", "DUPLICATE_NID", "info", "d"),
        AuditRecord("TRACK", "a", "VERTEX_DEDUPED", "info", "é"),
        AuditRecord("TRACK", "a", "DEGENERATE_SEGMENT", "rejected", "q"),
    ]
    out = tmp_path / "sub" / "audit.jsonl"
    write_audit_jsonl(out, recs)
    raw = out.read_bytes()
    assert raw.endswith(b"\n") and b"\r" not in raw
    lines = raw.decode("utf-8").splitlines()
    parsed = [json.loads(line) for line in lines]
    assert [(p["layer"], p["nid"], p["reason"]) for p in parsed] == [
        ("CROSSING", "a", "DUPLICATE_NID"),
        ("TRACK", "a", "DEGENERATE_SEGMENT"),
        ("TRACK", "a", "VERTEX_DEDUPED"),
        ("TRACK", "b", "NULL_GEOMETRY"),
    ]
    assert lines[0] == (
        '{"detail":"d","layer":"CROSSING","nid":"a","reason":"DUPLICATE_NID","severity":"info"}'
    )
    assert "é" in lines[2]  # ensure_ascii=False
    # Input order must not matter.
    out2 = tmp_path / "audit2.jsonl"
    write_audit_jsonl(out2, list(reversed(recs)))
    assert out2.read_bytes() == raw


def test_empty_audit_writes_empty_file(tmp_path: Path) -> None:
    out = tmp_path / "a.jsonl"
    write_audit_jsonl(out, [])
    assert out.read_bytes() == b""


RAW = os.environ.get("CANTRE_RAW_DIR")


@pytest.mark.skipif(RAW is None, reason="CANTRE_RAW_DIR not set (no raw NRWN data)")
def test_loads_real_sk_network_and_accounts_for_every_record() -> None:
    assert RAW is not None
    shp_dir = next(p.parent for p in Path(RAW).rglob("NRWN_SK_2_0_TRACK.shp"))
    net = load_network(shp_dir, "sk", CFG)
    rejected = Counter(a.layer for a in net.audit if a.severity == "rejected")
    assert len(net.segments) + rejected["TRACK"] == 7084
    assert len(net.crossings) + rejected["CROSSING"] == 7660
    assert len(net.junctions) + rejected["JUNCTION"] == 5163
    assert len({s.key for s in net.segments}) == len(net.segments)  # keys are unique
    assert sum(1 for a in net.audit if a.reason == "DUPLICATE_SEGID") == 1
