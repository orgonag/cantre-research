"""Tests for cantre_pipeline.tiles: keys, buffers, membership and exact reassembly (Task 8)."""

from pathlib import Path
from typing import Any

import pytest
from geographiclib.geodesic import Geodesic  # type: ignore[import-untyped]

from cantre_pipeline.config import PipelineConfig
from cantre_pipeline.encode import delta_decode
from cantre_pipeline.intervals import Interval
from cantre_pipeline.tiles import (
    ATTRIBUTION,
    DATASET_VERSION,
    Bounds,
    buffered_bounds,
    build_tiles,
    tile_bounds,
    tile_key,
)
from fixtures.builder import NrwnFixture
from pipeline_run import CFG, Run, decode_piece, pt, run, straddling_fixture

WEST, EAST = "208_-213", "208_-212"


def test_tile_key_is_floor_based_for_negative_longitudes() -> None:
    assert tile_key(52.30, -106.70, PipelineConfig()) == "209_-214"
    assert tile_key(52.0, -106.0, PipelineConfig()) == "208_-212"


def test_tile_bounds_round_trip() -> None:
    b = tile_bounds("209_-214", PipelineConfig())
    assert b == Bounds(52.25, -107.0, 52.5, -106.5)
    assert tile_key(b.south, b.west, PipelineConfig()) == "209_-214"


@pytest.mark.parametrize("key", ["nope", "1_", "1_2_3", "a_b"])
def test_tile_bounds_rejects_malformed_key(key: str) -> None:
    with pytest.raises(ValueError):
        tile_bounds(key, PipelineConfig())


@pytest.mark.parametrize("key", ["209_-214", "0_0", "320_-290", "-1_5"])
def test_buffer_is_at_least_2km_on_every_edge(key: str) -> None:
    b = tile_bounds(key, CFG)
    bb = buffered_bounds(b, CFG.tile_buffer_m)
    geod = Geodesic.WGS84  # GRS80 differs from WGS84 by about 0.1 mm over these distances

    def dist(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        return float(geod.Inverse(lat1, lon1, lat2, lon2)["s12"])

    tol = 1e-3  # metres
    for lon in (b.west, b.east):
        assert dist(b.south, lon, bb.south, lon) >= CFG.tile_buffer_m - tol
        assert dist(b.north, lon, bb.north, lon) >= CFG.tile_buffer_m - tol
    for lat in (b.south, b.north):
        assert dist(lat, b.west, lat, bb.west) >= CFG.tile_buffer_m - tol
        assert dist(lat, b.east, lat, bb.east) >= CFG.tile_buffer_m - tol
    # not wastefully wide: within 1 % of the requirement along the poleward edge
    assert dist(b.north, b.east, b.north, bb.east) <= CFG.tile_buffer_m * 1.01


@pytest.fixture
def r(tmp_path: Path) -> Run:
    return run(straddling_fixture(tmp_path))


def pieces(tile: dict[str, Any]) -> list[dict[str, Any]]:
    return [p for p in tile["chains"] if p["subdivisionNid"] == "S1"]


def test_tile_header_fields(r: Run) -> None:
    t = r.tiles[WEST]
    assert t["schema"] == "cantre.tile/1" and t["key"] == WEST
    assert t["datasetVersion"] == DATASET_VERSION and t["attribution"] == ATTRIBUTION
    assert t["bufferM"] == 2000.0
    assert t["bounds"] == {"south": 52.0, "west": -106.5, "north": 52.25, "east": -106.0}


def test_chain_crossing_tile_edge_reassembles_exactly(r: Run) -> None:
    (pw,) = pieces(r.tiles[WEST])
    (pe,) = pieces(r.tiles[EAST])
    assert pw["id"] == pe["id"]
    aw, ae = decode_piece(pw), decode_piece(pe)
    chain = next(c for c in r.chains.chains if c.sub_nid == "S1")
    full = len(chain.pts)
    # each piece is a strict sub-range of the chain, so the tiles really do split it
    assert pw["vertexStart"] == 0 and len(aw[0]) < full
    assert pe["vertexStart"] > 0 and pe["vertexStart"] + len(ae[0]) == full
    lo = pe["vertexStart"] - pw["vertexStart"]
    overlap = len(aw[0]) - lo
    assert overlap >= 2
    for k in range(3):
        assert aw[k][lo:] == ae[k][:overlap]
    # and both agree with the chain itself
    for p, a in ((pw, aw), (pe, ae)):
        v0, n = p["vertexStart"], len(a[0])
        assert a[0] == [round(q.lat * 1e6) for q in chain.pts[v0 : v0 + n]]
        assert a[1] == [round(q.lon * 1e6) for q in chain.pts[v0 : v0 + n]]
        assert a[2] == [round(s * 1000) for s in chain.s_m[v0 : v0 + n]]


def test_interval_with_all_anchors_in_each_overlapping_tile(r: Run) -> None:
    (iw,) = [i for i in r.tiles[WEST]["intervals"] if len(i["anchorIds"]) > 1]
    (ie,) = r.tiles[EAST]["intervals"]
    assert iw == ie and len(iw["anchorIds"]) == 3
    for key in (WEST, EAST):
        ids = sorted(a["id"] for a in r.tiles[key]["anchors"] if a["chainId"] == iw["chainId"])
        assert ids == ["A", "B", "E"]  # A is outside the east tile's pieces but travels along


def test_anchor_fields_and_order(r: Run) -> None:
    anchors = [a for a in r.tiles[WEST]["anchors"] if a["id"] in "ABE"]
    assert [a["sMm"] for a in anchors] == sorted(a["sMm"] for a in anchors)
    a = next(x for x in anchors if x["id"] == "A")
    assert set(a) == {"id", "chainId", "sMm", "mp", "source", "tier", "memberNids"}
    assert a["tier"] == "posted" and a["source"] == "crossing" and a["mp"] == 10.0


def test_isolated_anchor_only_where_it_falls_in_a_piece(r: Run) -> None:
    assert any(a["id"] == "Z" for a in r.tiles["210_-213"]["anchors"])
    assert not any(a["id"] == "Z" for a in r.tiles["210_-212"]["anchors"])
    assert not r.tiles["210_-213"]["intervals"]


def test_asset_within_buffer_appears_in_both_tiles(r: Run) -> None:
    ids = {k: {a["id"] for a in t["assets"]} for k, t in r.tiles.items()}
    assert "CROSSING.E" in ids[WEST] and "CROSSING.E" in ids[EAST]  # 380 m from the edge
    assert "CROSSING.A" in ids[WEST] and "CROSSING.A" not in ids[EAST]
    assert "CROSSING.B" in ids[EAST] and "CROSSING.B" not in ids[WEST]


def test_asset_json_fields(r: Run) -> None:
    a = next(x for x in r.tiles[WEST]["assets"] if x["id"] == "CROSSING.A")
    assert a["kind"] == "crossing" and a["layer"] == "CROSSING" and a["name"] is None
    assert a["posted"] == {"mp": 10.0, "subdivisionNid": "S1", "tier": "posted"}
    assert delta_decode(a["latE6"]) == [round(52.1 * 1e6)]
    (pos,) = a["positions"]
    assert set(pos) == {
        "chainId",
        "sStartMm",
        "sEndMm",
        "residualMm",
        "derivedMpStart",
        "derivedMpEnd",
    }
    assert pos["derivedMpStart"] == pytest.approx(10.0, abs=0.01)
    assert isinstance(pos["sStartMm"], int) and isinstance(pos["residualMm"], int)


def test_segments_listed_with_chain_id_or_null(r: Run) -> None:
    segs = {s["key"]: s for s in r.tiles[WEST]["segments"]}
    assert set(segs) == {"T1", "SD"}
    assert segs["T1"]["chainId"] == pieces(r.tiles[WEST])[0]["id"]
    assert segs["SD"]["chainId"] is None
    assert segs["SD"]["trackClass"] == "Siding" and segs["T1"]["subdivisionName"] == "Alpha"
    assert [s["key"] for s in r.tiles[WEST]["segments"]] == sorted(segs)
    assert delta_decode(segs["T1"]["latE6"])[0] == round(52.1 * 1e6)


def test_everything_is_sorted(r: Run) -> None:
    for t in r.tiles.values():
        assert [(c["id"], c["vertexStart"]) for c in t["chains"]] == sorted(
            (c["id"], c["vertexStart"]) for c in t["chains"]
        )
        assert [a["id"] for a in t["assets"]] == sorted(a["id"] for a in t["assets"])
        assert [i["id"] for i in t["intervals"]] == sorted(i["id"] for i in t["intervals"])
        keys = [(a["chainId"], a["sMm"], a["id"]) for a in t["anchors"]]
        assert keys == sorted(keys)


def test_only_non_empty_tiles_are_emitted(r: Run) -> None:
    assert set(r.tiles) == {WEST, EAST, "210_-213", "210_-212"}


def test_tiles_independent_of_input_order(r: Run) -> None:
    again = build_tiles(
        "sk",
        r.chains,
        tuple(reversed(r.net.segments)),
        list(reversed(r.anchors)),
        list(reversed(r.intervals)),
        list(reversed(r.assets)),
        CFG,
        DATASET_VERSION,
    )
    assert again == r.tiles


def test_buffered_bounds_is_symmetric_in_longitude() -> None:
    b = tile_bounds("208_-213", CFG)
    bb = buffered_bounds(b, 2000.0)
    assert bb.south < b.south and bb.north > b.north
    assert bb.west - b.west == pytest.approx(-(bb.east - b.east))


def test_chain_leaving_and_reentering_a_tile_gives_two_pieces(tmp_path: Path) -> None:
    fx = NrwnFixture(tmp_path)
    # a U that goes north out of tile 208_-213 (lat 52.0-52.25) and comes back
    fx.track("U", [pt(-20, 52.1), pt(-20, 52.6), pt(-19, 52.6), pt(-19, 52.1)])
    r = run(fx)
    got = sorted(r.tiles["208_-213"]["chains"], key=lambda p: p["vertexStart"])
    assert [p["vertexStart"] for p in got] == [0, 2]
    assert [len(delta_decode(p["latE6"])) for p in got] == [2, 2]
    assert len(r.chains.chains[0].pts) == 4  # the pieces together skip no vertex of the middle


def test_interval_naming_unknown_anchor_is_rejected(r: Run) -> None:
    bad = [Interval("x.i0", r.intervals[0].chain_id, ("nope", "nada"))]
    with pytest.raises(ValueError, match="unknown anchor"):
        build_tiles("sk", r.chains, r.net.segments, r.anchors, bad, r.assets, CFG, DATASET_VERSION)
