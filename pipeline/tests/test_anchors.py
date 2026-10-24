"""Tests for cantre_pipeline.anchors: tiered anchor qualification (spec 3, 5.4, Decisions 7-8)."""

import os
from pathlib import Path

import pytest

from cantre_pipeline.anchors import TIER_RANK, QualifiedAnchor, qualify_anchors
from cantre_pipeline.audit import AuditRecord
from cantre_pipeline.chains import build_chains
from cantre_pipeline.config import PipelineConfig
from cantre_pipeline.geodesy import LatLon, metres_per_degree
from cantre_pipeline.reader import read_tc_inventory
from cantre_pipeline.validate import load_network
from fixtures.builder import NrwnFixture

CFG = PipelineConfig()
LAT_M = metres_per_degree(52.0)[0]  # metres per degree of latitude at the fixture latitude
LON_M = metres_per_degree(52.0)[1]  # metres per degree of longitude at the fixture latitude


def P(i: float, off_m: float = 0.0, lat: float = 52.0) -> LatLon:  # noqa: N802
    """Point ``i`` * 0.01 deg east of (lat, -106), ``off_m`` metres north of the line."""
    return LatLon(round(lat + off_m / LAT_M, 6), round(-106.0 + 0.01 * i, 6))


def base(tmp_path: Path) -> NrwnFixture:
    """One Main track ``T1`` of two edges (P0-P1-P2) in subdivision S1 / Alpha, plus a siding."""
    fx = NrwnFixture(tmp_path)
    fx.track("T1", [P(0), P(1), P(2)])
    fx.track("SD", [P(0, 30), P(2, 30)], cls="Siding")
    return fx


def qualify(fx: NrwnFixture) -> tuple[list[QualifiedAnchor], list[AuditRecord]]:
    net = load_network(fx.write(), "sk", CFG)
    chains = build_chains(net, CFG)
    return qualify_anchors(net, chains, read_tc_inventory(fx.tc_path, "SK"), CFG)


def reasons(audit: list[AuditRecord]) -> list[str]:
    return [a.reason for a in audit]


def rejected(audit: list[AuditRecord]) -> list[str]:
    return [a.reason for a in audit if a.severity == "rejected"]


def test_tier_rank_orders_posted_tc_unverified() -> None:
    assert TIER_RANK == {"posted": 0, "tc": 1, "unverified": 2}


def test_posted_crossing_on_main_becomes_anchor_at_projected_s(tmp_path: Path) -> None:
    fx = base(tmp_path)
    fx.crossing("X1", P(0.5, 10), "T1", mp=3.5)
    anchors, audit = qualify(fx)
    assert audit == []
    (a,) = anchors
    assert (a.id, a.source, a.tier, a.mp) == ("X1", "crossing", "posted", 3.5)
    assert a.member_nids == ("X1",)
    assert a.residual_m == pytest.approx(10.0, abs=0.05)
    # 0.005 deg of longitude at 52 N, measured against the chain's own cumulative distance.
    assert a.s_m == pytest.approx(0.005 * LON_M, rel=1e-3)
    assert a.chain_id.startswith("ch_")


def test_posted_minus_one_is_rejected_as_posted_sentinel(tmp_path: Path) -> None:
    fx = base(tmp_path)
    fx.crossing("X1", P(0.5), "T1", mp=-1.0, qualifier="Posted")
    anchors, audit = qualify(fx)
    assert anchors == [] and reasons(audit) == ["POSTED_SENTINEL"]
    assert (audit[0].layer, audit[0].nid, audit[0].severity) == ("CROSSING", "X1", "rejected")


def test_unknown_marker_post_and_station_become_unverified_tier(tmp_path: Path) -> None:
    fx = base(tmp_path)
    fx.markerpost("M1", P(0.5), "T1", mp=7.25)
    fx.station("S1", P(1.5), "T1", mp=8.0)
    anchors, audit = qualify(fx)
    assert audit == []
    assert [(a.id, a.source, a.tier, a.mp) for a in anchors] == [
        ("M1", "markerpost", "unverified", 7.25),
        ("S1", "station", "unverified", 8.0),
    ]


def test_posted_marker_post_station_and_bridge_are_posted_tier(tmp_path: Path) -> None:
    fx = base(tmp_path)
    fx.markerpost("M1", P(0.5), "T1", mp=1.0, qualifier="Posted")
    fx.station("S1", P(1.0), "T1", mp=2.0, qualifier="Posted")
    fx.bridge("B1", [P(1.5), P(1.6)], "T1", mp=3.0, qualifier="Posted")
    fx.culvert("C1", P(1.7), "T1", mp=3.5, qualifier="Posted")
    anchors, audit = qualify(fx)
    assert audit == []
    assert [(a.source, a.tier) for a in anchors] == [
        ("markerpost", "posted"),
        ("station", "posted"),
        ("structure", "posted"),
        ("structure", "posted"),
    ]


def test_unknown_structure_is_not_an_anchor(tmp_path: Path) -> None:
    fx = base(tmp_path)
    fx.culvert("C1", P(0.5), "T1", mp=4.0)
    fx.bridge("B1", [P(1.0), P(1.1)], "T1", mp=5.0)
    anchors, audit = qualify(fx)
    assert anchors == [] and reasons(audit) == ["NOT_POSTED", "NOT_POSTED"]
    assert {a.layer for a in audit} == {"STRUCTURE_0", "STRUCTURE_1"}


def test_station_without_value_is_mileage_sentinel_and_other_qualifier_is_not_posted(
    tmp_path: Path,
) -> None:
    fx = base(tmp_path)
    fx.station("S1", P(0.5), "T1", mp=None)  # -1 sentinel
    fx.markerpost("M1", P(0.6), "T1", mp=2.0, qualifier="Estimated")  # neither Posted nor Unknown
    anchors, audit = qualify(fx)
    assert anchors == []
    assert sorted(reasons(audit)) == ["MILEAGE_SENTINEL", "NOT_POSTED"]


def test_unposted_crossing_with_joined_tc_row_becomes_tc_tier(tmp_path: Path) -> None:
    fx = base(tmp_path)
    fx.crossing("X1", P(0.5), "T1", qualifier="Unknown", tcid=501)
    fx.tc_row(501, mile=12.34, subdivision="Alpha")
    anchors, audit = qualify(fx)
    assert [(a.tier, a.mp) for a in anchors] == [("tc", 12.34)]
    assert audit == []


def test_tc_tier_ignores_the_nrwn_unit_field(tmp_path: Path) -> None:
    fx = base(tmp_path)
    fx.crossing("X1", P(0.5), "T1", qualifier="Unknown", tcid=501, unit="Unknown")
    fx.tc_row(501, mile=1.5, subdivision="Alpha - CN")
    anchors, _ = qualify(fx)
    assert [(a.tier, a.mp) for a in anchors] == [("tc", 1.5)]


def test_tc_spur_crossing_is_never_used(tmp_path: Path) -> None:
    fx = base(tmp_path)
    fx.crossing("X1", P(0.5), "T1", qualifier="Unknown", tcid=502)
    fx.tc_row(502, mile=103.04, subdivision="Alpha", spur_mile_point="2.04")
    anchors, audit = qualify(fx)
    assert anchors == [] and "TC_SPUR_CROSSING" in reasons(audit)
    assert rejected(audit) == ["TC_SPUR_CROSSING"]


def test_tc_subdivision_name_mismatch_is_not_joined(tmp_path: Path) -> None:
    fx = base(tmp_path)
    fx.crossing("X1", P(0.5), "T1", qualifier="Unknown", tcid=503)
    fx.tc_row(503, mile=5.0, subdivision="Gamma")
    anchors, audit = qualify(fx)
    assert anchors == [] and rejected(audit) == ["TC_SUBDIVISION_MISMATCH"]


def test_tc_bad_mile_is_not_joined(tmp_path: Path) -> None:
    fx = base(tmp_path)
    fx.crossing("X1", P(0.5), "T1", qualifier="Unknown", tcid=504)
    fx.tc_row(504, mile="-1", subdivision="Alpha")
    anchors, audit = qualify(fx)
    assert anchors == [] and rejected(audit) == ["TC_BAD_MILE"]


def test_tc_row_for_another_province_is_no_row(tmp_path: Path) -> None:
    fx = base(tmp_path)
    fx.crossing("X1", P(0.5), "T1", qualifier="Unknown", tcid=505)
    fx.tc_row(505, mile=5.0, subdivision="Alpha", province="MB")
    net = load_network(fx.write(), "sk", CFG)
    tc = read_tc_inventory(fx.tc_path, "MB")  # wrong-province rows handed in directly
    anchors, audit = qualify_anchors(net, build_chains(net, CFG), tc, CFG)
    assert anchors == [] and rejected(audit) == ["NOT_POSTED"]


def test_unposted_crossing_without_tc_row_falls_back_to_not_posted(tmp_path: Path) -> None:
    fx = base(tmp_path)
    fx.crossing("X1", P(0.5), "T1", qualifier="Unknown", tcid=-1)
    fx.crossing("X2", P(0.6), "T1", qualifier="Unknown", tcid=999)  # TCID with no TC row
    anchors, audit = qualify(fx)
    assert anchors == [] and reasons(audit) == ["NOT_POSTED", "NOT_POSTED"]


def test_posted_and_tc_disagreeing_over_005mi_excluded(tmp_path: Path) -> None:
    fx = base(tmp_path)
    fx.crossing("X1", P(0.5), "T1", mp=10.00, tcid=601)
    fx.tc_row(601, mile=10.06, subdivision="Alpha")
    anchors, audit = qualify(fx)
    assert anchors == [] and reasons(audit) == ["SOURCE_DISAGREEMENT"]
    assert "10.0" in audit[0].detail and "10.06" in audit[0].detail


def test_posted_and_tc_agreeing_keeps_posted_tier(tmp_path: Path) -> None:
    fx = base(tmp_path)
    fx.crossing("X1", P(0.5), "T1", mp=10.00, tcid=602)
    fx.tc_row(602, mile=10.05, subdivision="Alpha")  # exactly at the tolerance: agrees
    anchors, audit = qualify(fx)
    assert [(a.tier, a.mp) for a in anchors] == [("posted", 10.0)] and audit == []


def test_posted_crossing_with_unjoinable_tc_row_stays_posted_without_noise(
    tmp_path: Path,
) -> None:
    fx = base(tmp_path)
    fx.crossing("X1", P(0.5), "T1", mp=10.00, tcid=603)
    fx.tc_row(603, mile=99.0, subdivision="Alpha", spur_mile_point="1.0")  # spur: not comparable
    anchors, audit = qualify(fx)
    assert [(a.tier, a.mp) for a in anchors] == [("posted", 10.0)] and audit == []


def test_posted_minus_one_with_tc_value_becomes_tc_tier(tmp_path: Path) -> None:
    fx = base(tmp_path)
    fx.crossing("X1", P(0.5), "T1", mp=-1.0, qualifier="Posted", tcid=604)
    fx.tc_row(604, mile=20.5, subdivision="Alpha")
    anchors, audit = qualify(fx)
    assert [(a.tier, a.mp) for a in anchors] == [("tc", 20.5)] and audit == []


def test_posted_minus_one_with_spur_tc_row_is_rejected_with_the_tc_reason(
    tmp_path: Path,
) -> None:
    fx = base(tmp_path)
    fx.crossing("X1", P(0.5), "T1", mp=-1.0, qualifier="Posted", tcid=605)
    fx.tc_row(605, mile=3.0, subdivision="Alpha", spur_mile_point="0.5")
    anchors, audit = qualify(fx)
    assert anchors == [] and rejected(audit) == ["TC_SPUR_CROSSING"]


def test_non_mile_unit_is_rejected(tmp_path: Path) -> None:
    fx = base(tmp_path)
    fx.crossing("X1", P(0.5), "T1", mp=3.0, unit="Kilometre")
    anchors, audit = qualify(fx)
    assert anchors == [] and reasons(audit) == ["UNIT_NOT_MILE"]


def test_track_missing_is_track_not_found(tmp_path: Path) -> None:
    fx = base(tmp_path)
    fx.crossing("X1", P(0.5), "NOPE", mp=3.0)
    anchors, audit = qualify(fx)
    assert anchors == [] and reasons(audit) == ["TRACK_NOT_FOUND"]


def test_crossing_on_siding_is_track_not_chained(tmp_path: Path) -> None:
    fx = base(tmp_path)
    fx.crossing("X1", P(0.5, 30), "SD", mp=3.0)
    anchors, audit = qualify(fx)
    assert anchors == [] and reasons(audit) == ["TRACK_NOT_CHAINED"]


def test_crossing_with_other_subdivision_is_mismatch(tmp_path: Path) -> None:
    fx = base(tmp_path)
    fx.crossing("X1", P(0.5), "T1", mp=3.0, sub=("S2", "Beta"))
    anchors, audit = qualify(fx)
    assert anchors == [] and reasons(audit) == ["SUBDIVISION_MISMATCH"]


def test_residual_over_25m_rejected_and_25m_accepted(tmp_path: Path) -> None:
    fx = base(tmp_path)
    fx.crossing("OK", P(0.5, 24.9), "T1", mp=1.0)
    fx.crossing("FAR", P(1.5, 25.1), "T1", mp=2.0)
    anchors, audit = qualify(fx)
    assert [a.id for a in anchors] == ["OK"]
    assert [(a.nid, a.reason) for a in audit] == [("FAR", "RESIDUAL_TOO_LARGE")]
    assert max(a.residual_m for a in anchors) <= CFG.anchor_max_residual_m


def test_parallel_tracks_with_one_nid_on_two_chains_are_ambiguous(tmp_path: Path) -> None:
    fx = NrwnFixture(tmp_path)
    fx.track("D1", [P(0), P(2)], nid="D")
    fx.track("D2", [P(0, 1.1), P(2, 1.1)], nid="D")  # 1.1 m apart, never joined: two chains
    fx.crossing("X1", P(1, 0.55), "D", mp=1.0)
    anchors, audit = qualify(fx)
    assert anchors == [] and reasons(audit) == ["AMBIGUOUS_TRACK"]


def test_repeated_nid_on_one_chain_is_not_ambiguous(tmp_path: Path) -> None:
    fx = NrwnFixture(tmp_path)
    fx.track("D1", [P(0), P(1)], nid="D")
    fx.track("D2", [P(1), P(2)], nid="D")  # same NID, same chain
    fx.crossing("X1", P(1.5, 2), "D", mp=1.0)
    anchors, audit = qualify(fx)
    assert [a.id for a in anchors] == ["X1"] and audit == []


def test_same_crossingid_same_chain_agreeing_values_merge(tmp_path: Path) -> None:
    fx = base(tmp_path)
    fx.crossing("Xb", P(0.50, 5), "T1", mp=3.00, crossing_id="G1")
    fx.crossing("Xa", P(0.52, 5), "T1", mp=3.00, crossing_id="G1")
    fx.crossing("Xc", P(0.51, 5), "T1", qualifier="Unknown", tcid=701, crossing_id="G1")
    fx.tc_row(701, mile=3.00, subdivision="Alpha")
    anchors, audit = qualify(fx)
    (a,) = anchors
    assert (a.id, a.tier, a.mp, a.member_nids) == ("Xa", "posted", 3.0, ("Xa", "Xb", "Xc"))
    assert a.s_m == pytest.approx(0.0051 * LON_M, rel=1e-3)
    assert sorted((r.nid, r.reason, r.severity) for r in audit) == [
        ("Xa", "ANCHOR_MERGED", "info"),
        ("Xb", "ANCHOR_MERGED", "info"),
        ("Xc", "ANCHOR_MERGED", "info"),
    ]


def test_merged_anchor_takes_best_tier_and_its_mp(tmp_path: Path) -> None:
    fx = base(tmp_path)
    fx.crossing("Xa", P(0.5), "T1", qualifier="Unknown", tcid=702, crossing_id="G1")
    fx.tc_row(702, mile=4.00, subdivision="Alpha")
    fx.crossing("Xb", P(0.6), "T1", mp=4.00, crossing_id="G1")
    anchors, _ = qualify(fx)
    (a,) = anchors
    assert (a.id, a.tier, a.mp, a.member_nids) == ("Xa", "posted", 4.0, ("Xa", "Xb"))


def test_same_crossingid_disagreeing_values_all_conflict(tmp_path: Path) -> None:
    fx = base(tmp_path)
    fx.crossing("Xa", P(0.5), "T1", mp=3.00, crossing_id="G1")
    fx.crossing("Xb", P(0.6), "T1", mp=3.02, crossing_id="G1")
    fx.crossing("Xc", P(1.5), "T1", mp=9.00)  # unrelated, survives
    anchors, audit = qualify(fx)
    assert [a.id for a in anchors] == ["Xc"]
    assert [(r.nid, r.reason, r.severity) for r in audit] == [
        ("Xa", "ANCHOR_CONFLICT", "rejected"),
        ("Xb", "ANCHOR_CONFLICT", "rejected"),
    ]


def test_same_crossingid_on_two_chains_stays_two_anchors(tmp_path: Path) -> None:
    fx = NrwnFixture(tmp_path)
    fx.track("T1", [P(0), P(2)])
    fx.track("T2", [P(0, 40), P(2, 40)])  # double track, never joined
    fx.crossing("Xa", P(1, 2), "T1", mp=3.00, crossing_id="G1")
    fx.crossing("Xb", P(1, 38), "T2", mp=3.00, crossing_id="G1")
    anchors, audit = qualify(fx)
    assert len(anchors) == 2 and audit == []
    assert anchors[0].chain_id != anchors[1].chain_id
    assert {a.member_nids for a in anchors} == {("Xa",), ("Xb",)}


def test_projection_uses_the_referenced_segment_span_only(tmp_path: Path) -> None:
    # A runs east, B turns north, C returns west 22 m north of A: the chain doubles back.
    fx = NrwnFixture(tmp_path)
    fx.track("A", [P(0), P(2)])
    fx.track("B", [P(2), P(2, 22.2)])
    fx.track("C", [P(2, 22.2), P(0, 22.2)])
    # 10 m from A but 12.2 m from C; the record names C, so only C's span may be used.
    fx.crossing("X1", P(1, 10.0), "C", mp=5.0)
    anchors, audit = qualify(fx)
    (a,) = anchors
    assert audit == []
    assert a.residual_m == pytest.approx(12.2, abs=0.2)
    assert a.s_m > 2000  # on C, after A (1.5 km) and B; on A it would be about 750 m


def test_anchors_are_sorted_and_independent_of_record_order(tmp_path: Path) -> None:
    def run(order: list[int], sub: str) -> list[QualifiedAnchor]:
        fx = base(tmp_path / sub)
        pts = [(0.2, 1.0), (1.2, 2.0), (0.7, 3.0)]
        for n in order:
            fx.crossing(f"X{n}", P(pts[n][0], 3), "T1", mp=pts[n][1])
        return qualify(fx)[0]

    one, two = run([0, 1, 2], "a"), run([2, 1, 0], "b")
    assert one == two
    assert [a.s_m for a in one] == sorted(a.s_m for a in one)


@pytest.mark.skipif(not os.environ.get("CANTRE_RAW_DIR"), reason="needs real SK data")
def test_real_sk_anchor_invariants() -> None:  # pragma: no cover - env-gated
    raw = Path(os.environ["CANTRE_RAW_DIR"])
    shp = next(p for p in raw.iterdir() if p.is_dir() and any(p.glob("NRWN_SK_*_TRACK.shp")))
    csv_path = next(raw.rglob("*.csv"))
    net = load_network(shp, "sk", CFG)
    anchors, _ = qualify_anchors(
        net, build_chains(net, CFG), read_tc_inventory(csv_path, "SK"), CFG
    )
    assert anchors
    assert all(a.residual_m <= CFG.anchor_max_residual_m for a in anchors)
    assert all(a.tier in TIER_RANK and a.mp >= 0 for a in anchors)
