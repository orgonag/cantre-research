"""Tests for cantre_pipeline.assets: crossings, structures, stations, diamonds (spec 5.6)."""

import os
from pathlib import Path

import pytest

from cantre_pipeline.anchors import QualifiedAnchor, qualify_anchors
from cantre_pipeline.assets import Asset, ChainPosition, PostedMileage, extract_assets
from cantre_pipeline.chains import build_chains
from cantre_pipeline.config import PipelineConfig
from cantre_pipeline.geodesy import LatLon, metres_per_degree
from cantre_pipeline.intervals import Interval, build_intervals
from cantre_pipeline.reader import read_tc_inventory
from cantre_pipeline.validate import load_network
from fixtures.builder import NrwnFixture

CFG = PipelineConfig()
LAT_M = metres_per_degree(52.0)[0]
STEP_M = metres_per_degree(52.0)[1] * 0.01  # one P() step east, metres (about 685)
STEP_MI = STEP_M / 1609.344  # the same in miles (about 0.4257)


def P(i: float, off_m: float = 0.0, lat: float = 52.0) -> LatLon:  # noqa: N802
    """Point ``i`` * 0.01 deg east of (lat, -106), ``off_m`` metres north of the line."""
    return LatLon(round(lat + off_m / LAT_M, 6), round(-106.0 + 0.01 * i, 6))


def base(tmp_path: Path, *, calibrated: bool = True) -> NrwnFixture:
    """Main ``T1`` P0-P4 with two posted crossings (MP 1.0 at P0.5, MP 1.0 + 3 steps at P3.5)."""
    fx = NrwnFixture(tmp_path)
    fx.track("T1", [P(0), P(1), P(2), P(3), P(4)])
    fx.track("SD", [P(0, 30), P(4, 30)], cls="Siding")
    if calibrated:
        fx.crossing("A", P(0.5), "T1", mp=1.0)
        fx.crossing("B", P(3.5), "T1", mp=round(1.0 + 3 * STEP_MI, 2))
    return fx


def run_full(
    fx: NrwnFixture,
) -> tuple[list[Asset], list[Interval], list[QualifiedAnchor]]:
    net = load_network(fx.write(), "sk", CFG)
    chains = build_chains(net, CFG)
    tc = read_tc_inventory(fx.tc_path, "SK")
    anchors, _ = qualify_anchors(net, chains, tc, CFG)
    intervals: list[Interval] = []
    kept: list[QualifiedAnchor] = []
    for ch in chains.chains:
        ivs, k, _ = build_intervals(ch, anchors, CFG)
        intervals += ivs
        kept += k
    out = extract_assets(net, chains, intervals, kept, tc, CFG)
    assert len({a.id for a in out}) == len(out)
    return out, intervals, kept


def run(fx: NrwnFixture) -> dict[str, Asset]:
    return {a.id: a for a in run_full(fx)[0]}


def one(assets: dict[str, Asset], suffix: str) -> Asset:
    (a,) = [a for a in assets.values() if a.id.endswith("." + suffix)]
    return a


def test_crossing_keeps_posted_and_derived_mileage_separately(tmp_path: Path) -> None:
    fx = base(tmp_path)
    fx.crossing("X", P(2.0, 5), "T1", mp=1.80)  # posted, but an outlier: not an anchor
    a = one(run(fx), "X")
    assert a.kind == "crossing" and a.layer == "CROSSING"
    assert a.posted == PostedMileage(1.80, "S1", "posted")
    (pos,) = a.positions
    assert pos.derived_mp_start is not None and pos.derived_mp_start != 1.80
    assert pos.derived_mp_start == pytest.approx(1.0 + 1.5 * STEP_MI, abs=0.01)
    assert pos.derived_mp_end == pos.derived_mp_start
    assert pos.residual_m == pytest.approx(5.0, abs=0.05)


def test_unposted_crossing_has_derived_only(tmp_path: Path) -> None:
    fx = base(tmp_path)
    fx.crossing("X", P(2.0), "T1", mp=None, qualifier="Unknown")
    a = one(run(fx), "X")
    assert a.posted is None
    assert a.positions[0].derived_mp_start == pytest.approx(1.0 + 1.5 * STEP_MI, abs=0.01)


def test_tc_value_is_labelled_and_kept_as_tcmile(tmp_path: Path) -> None:
    fx = base(tmp_path)
    fx.crossing("X", P(2.0), "T1", mp=None, qualifier="Unknown", tcid=777)
    fx.tc_row(777, mile=1.63, subdivision="Alpha")
    a = one(run(fx), "X")
    assert a.posted == PostedMileage(1.63, "S1", "tc")
    assert a.attrs["tcMile"] == "1.63" and a.attrs["TCID"] == "777"


def test_posted_crossing_with_tc_row_does_not_get_tcmile(tmp_path: Path) -> None:
    fx = base(tmp_path)
    fx.crossing("X", P(2.0), "T1", mp=1.65, tcid=778)
    fx.tc_row(778, mile=1.66, subdivision="Alpha")
    a = one(run(fx), "X")
    assert a.posted == PostedMileage(1.65, "S1", "posted") and "tcMile" not in a.attrs


def test_unverified_station_and_attributes(tmp_path: Path) -> None:
    fx = base(tmp_path)
    fx.station(
        "S", P(2.0), "T1", mp=1.6, name="Town", attrs={"STNTYPE": "Passenger", "STNUSR1ENA": "VIA"}
    )
    a = one(run(fx), "S")
    assert (a.kind, a.name) == ("station", "Town")
    assert a.posted == PostedMileage(1.6, "S1", "unverified")
    assert dict(a.attrs) == {"STNENNAME": "Town", "STNTYPE": "Passenger", "STNUSR1ENA": "VIA"}


def test_bridge_line_gets_start_and_end_positions(tmp_path: Path) -> None:
    fx = base(tmp_path)
    fx.bridge("BR", [P(1.5, 4), P(1.7, 4), P(2.0, 4)], "T1", attrs={"STRUENNAME": "Big Bridge"})
    a = one(run(fx), "BR")
    assert (a.kind, a.name, a.posted) == ("bridge", "Big Bridge", None)
    assert len(a.pts) == 3
    (pos,) = a.positions
    assert 0 < pos.s_start_m < pos.s_end_m
    assert pos.s_end_m - pos.s_start_m == pytest.approx(0.5 * STEP_M, rel=0.02)
    assert pos.derived_mp_start is not None and pos.derived_mp_end is not None
    assert pos.derived_mp_end > pos.derived_mp_start
    assert a.attrs["STRUCTYPE"] == "Bridge"


def test_line_drawn_against_the_chain_is_ordered_by_s(tmp_path: Path) -> None:
    fx = base(tmp_path)
    fx.bridge("BR", [P(2.0, 4), P(1.5, 4)], "T1")
    (pos,) = one(run(fx), "BR").positions
    assert pos.s_start_m < pos.s_end_m


def test_line_whose_end_is_off_the_track_has_no_position(tmp_path: Path) -> None:
    fx = base(tmp_path)
    fx.bridge("BR", [P(1.5, 4), P(2.0, 400)], "T1")
    assert one(run(fx), "BR").positions == ()


def test_diamond_gets_a_position_on_each_crossing_chain(tmp_path: Path) -> None:
    fx = NrwnFixture(tmp_path)
    fx.track("E1", [P(0), P(1)])
    fx.track("E2", [P(2), P(1)])  # stored against the chain
    fx.track("N1", [P(1, 500), P(1)], sub=("S2", "Beta"))
    fx.track("N2", [P(1), P(1, -500)], sub=("S2", "Beta"))
    fx.junction("D", P(1), "Diamond")
    fx.junction("W", P(0), "Switch")
    assets = run(fx)
    assert list(assets) == ["JUNCTION.D"]
    d = assets["JUNCTION.D"]
    assert d.kind == "diamond" and d.pts == (P(1),) and d.posted is None
    assert len(d.positions) == 2 and len({p.chain_id for p in d.positions}) == 2
    assert all(p.residual_m == 0 and p.s_start_m == p.s_end_m for p in d.positions)
    assert all(p.derived_mp_start is None for p in d.positions)  # no anchors on these chains
    assert min(p.s_start_m for p in d.positions) > 0  # the node is interior to both chains


def test_diamond_at_a_chain_end_is_found_on_that_end(tmp_path: Path) -> None:
    fx = NrwnFixture(tmp_path)
    fx.track("E1", [P(0), P(1)])
    fx.junction("D", P(0), "Diamond")
    fx.junction("D2", P(1), "Diamond")
    fx.junction("OFF", P(5), "Diamond")
    a = run(fx)
    assert [p.s_start_m for p in a["JUNCTION.D"].positions] == [0.0]
    assert a["JUNCTION.D2"].positions[0].s_start_m > 0
    assert a["JUNCTION.OFF"].positions == ()


def test_culvert_is_not_a_bridge(tmp_path: Path) -> None:
    fx = base(tmp_path)
    fx.culvert("C", P(2.0, 3), "T1")
    fx.bridge("TN", [P(1.0, 3), P(1.2, 3)], "T1", kind="Tunnel")
    fx.bridge("MB", [P(1.3, 3), P(1.4, 3)], "T1", kind="Moveable Bridge")
    fx.bridge("MV", [P(1.5, 3), P(1.6, 3)], "T1", kind="Movable")
    fx.bridge("UN", [P(1.7, 3), P(1.8, 3)], "T1", kind="Unknown")
    assets = run(fx)
    assert one(assets, "C").kind == "culvert"
    assert one(assets, "TN").kind == "tunnel"
    assert one(assets, "MB").kind == "moveableBridge"
    assert one(assets, "MV").kind == "moveableBridge"
    assert not [a for a in assets if a.endswith(".UN")]  # unknown type: no asset
    assert not [a for a in assets.values() if a.kind == "bridge"]


def test_asset_outside_any_interval_has_null_derived_mp(tmp_path: Path) -> None:
    fx = base(tmp_path)
    fx.crossing("OUT", P(3.9), "T1", mp=None, qualifier="Unknown")  # beyond anchor B
    fx.crossing("IN", P(2.0), "T1", mp=None, qualifier="Unknown")
    a = run(fx)
    assert one(a, "OUT").positions[0].derived_mp_start is None
    assert one(a, "IN").positions[0].derived_mp_start is not None


def test_uncalibrated_chain_has_positions_but_no_derived_mp(tmp_path: Path) -> None:
    fx = base(tmp_path, calibrated=False)
    fx.crossing("X", P(2.0), "T1", mp=None, qualifier="Unknown")
    a = one(run(fx), "X")
    assert len(a.positions) == 1 and a.positions[0].derived_mp_start is None


def test_siding_crossing_has_no_position_and_unit_mismatch_has_no_posted(tmp_path: Path) -> None:
    fx = base(tmp_path)
    fx.crossing("SC", P(2.0, 30), "SD", mp=1.5, track_class="Siding")
    fx.crossing("KM", P(2.0), "T1", mp=3.0, unit="Kilometre")
    a = run(fx)
    assert one(a, "SC").positions == ()
    assert one(a, "KM").posted is None and len(one(a, "KM").positions) == 1


def test_sentinel_attributes_are_omitted(tmp_path: Path) -> None:
    fx = base(tmp_path)
    fx.crossing(
        "X",
        P(2.0),
        "T1",
        mp=None,
        qualifier="Unknown",
        attrs={"LEVELCROSS": "At Grade", "ROADCLASS": "-1"},
    )
    a = one(run(fx), "X")
    assert dict(a.attrs) == {"LEVELCROSS": "At Grade"}
    assert a.name is None


def test_duplicate_nids_get_distinct_stable_ids(tmp_path: Path) -> None:
    fx = base(tmp_path)
    fx.crossing("D", P(1.0), "T1", mp=None, qualifier="Unknown")
    fx.crossing("D", P(2.0), "T1", mp=None, qualifier="Unknown")
    ids = sorted(a for a in run(fx) if a.startswith("CROSSING.D"))
    assert ids == ["CROSSING.D", "CROSSING.D~1"]


def test_extraction_is_independent_of_record_order(tmp_path: Path) -> None:
    def build(sub: str, order: list[int]) -> list[Asset]:
        fx = base(tmp_path / sub)
        for n in order:
            fx.crossing(f"X{n}", P(1 + n * 0.3), "T1", mp=None, qualifier="Unknown")
        return run_full(fx)[0]

    assert build("a", [0, 1, 2]) == build("b", [2, 0, 1])


def test_dataclass_defaults() -> None:
    assert PostedMileage(1.0, "S").tier == "posted"
    assert ChainPosition("c", 0.0, 1.0, 0.0, None, None).residual_m == 0.0


@pytest.mark.skipif(not os.environ.get("CANTRE_RAW_DIR"), reason="needs real SK data")
def test_real_sk_asset_invariants() -> None:  # pragma: no cover - env-gated
    raw = Path(os.environ["CANTRE_RAW_DIR"])
    shp = next(p for p in raw.iterdir() if p.is_dir() and any(p.glob("NRWN_SK_*_TRACK.shp")))
    csv_path = next(raw.rglob("*.csv"))
    net = load_network(shp, "sk", CFG)
    chains = build_chains(net, CFG)
    tc = read_tc_inventory(csv_path, "SK")
    anchors, _ = qualify_anchors(net, chains, tc, CFG)
    intervals: list[Interval] = []
    kept: list[QualifiedAnchor] = []
    for ch in chains.chains:
        ivs, k, _ = build_intervals(ch, anchors, CFG)
        intervals += ivs
        kept += k
    assets = extract_assets(net, chains, intervals, kept, tc, CFG)
    assert assets
    ak = {(a.chain_id, a.id): a for a in kept}
    spans: dict[str, list[tuple[float, float]]] = {}
    for iv in intervals:
        lo, hi = ak[(iv.chain_id, iv.anchor_ids[0])], ak[(iv.chain_id, iv.anchor_ids[-1])]
        spans.setdefault(iv.chain_id, []).append((lo.s_m, hi.s_m))
    for a in assets:
        assert a.kind != "bridge" or a.attrs.get("STRUCTYPE") == "Bridge"
        for p in a.positions:
            assert p.residual_m <= CFG.anchor_max_residual_m
            for s, mp in ((p.s_start_m, p.derived_mp_start), (p.s_end_m, p.derived_mp_end)):
                inside = any(lo <= s <= hi for lo, hi in spans.get(p.chain_id, []))
                assert (mp is not None) == inside
