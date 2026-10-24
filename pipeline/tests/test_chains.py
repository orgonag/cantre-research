"""Tests for cantre_pipeline.chains: per-subdivision main-track chains (spec 5.3, Decision 2)."""

import hashlib
import os
import tempfile
from collections import Counter
from pathlib import Path
from typing import Any

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from cantre_pipeline.chains import Chain, ChainSet, build_chains
from cantre_pipeline.config import PipelineConfig
from cantre_pipeline.geodesy import LatLon, cumulative_lengths_m
from cantre_pipeline.model import Network
from cantre_pipeline.validate import load_network
from fixtures.builder import NrwnFixture

CFG = PipelineConfig()


def P(i: int, j: int = 0) -> LatLon:  # noqa: N802 - short grid-point helper
    """Grid point: 0.01 deg steps (about 0.7 km east, 1.1 km north) from (52, -106)."""
    return LatLon(round(52.0 + 0.01 * j, 6), round(-106.0 + 0.01 * i, 6))


def seg(fx: NrwnFixture, segid: str, a: LatLon, b: LatLon, **kw: Any) -> None:
    """Add a bent three-vertex segment from ``a`` to ``b``."""
    mid = LatLon((a.lat + b.lat) / 2 + 0.0001, (a.lon + b.lon) / 2)
    fx.track(segid, [a, mid, b], **kw)


def load(fx: NrwnFixture) -> Network:
    return load_network(fx.write(), "sk", CFG)


def chains_of(net: Network) -> list[tuple[tuple[str, ...], float]]:
    cs = build_chains(net, CFG)
    return sorted((c.segment_keys, round(c.s_m[-1], 3)) for c in cs.chains)


def keysets(cs: ChainSet) -> set[frozenset[str]]:
    return {frozenset(c.segment_keys) for c in cs.chains}


def line3(tmp_path: Path) -> NrwnFixture:
    fx = NrwnFixture(tmp_path)
    seg(fx, "a", P(0), P(1))
    seg(fx, "b", P(1), P(2))
    seg(fx, "c", P(2), P(3))
    return fx


def loop_fixture(tmp_path: Path) -> NrwnFixture:
    """A balloon loop: four Main segments around a square, closing on themselves."""
    fx = NrwnFixture(tmp_path)
    seg(fx, "l1", P(0, 0), P(1, 0))
    seg(fx, "l2", P(1, 0), P(1, 1))
    seg(fx, "l3", P(1, 1), P(0, 1))
    seg(fx, "l4", P(0, 1), P(0, 0))
    return fx


def test_three_segments_make_one_chain_with_continuous_s(tmp_path: Path) -> None:
    net = load(line3(tmp_path))
    cs = build_chains(net, CFG)
    assert len(cs.chains) == 1
    c = cs.chains[0]
    assert c.segment_keys == ("a", "b", "c")  # walked west to east (smaller end node first)
    assert len(c.pts) == 7 and len(c.s_m) == 7  # 3 + 3 + 3 vertices, 2 joins dropped
    assert c.s_m[0] == 0.0
    assert all(b > a for a, b in zip(c.s_m, c.s_m[1:], strict=False))  # strictly increasing
    assert c.segment_ranges == {"a": (0, 2), "b": (2, 4), "c": (4, 6)}  # joins are shared
    assert c.pts[0] == P(0) and c.pts[-1] == P(3)
    assert not c.cycle and c.operators == ("CN",) and c.sub_nid == "S1" and c.sub_name == "Alpha"
    assert c.id == "ch_" + hashlib.sha256(b"a\nb\nc").hexdigest()[:16]
    assert cs.unchained == () and cs.audit == ()


def test_segment_ranges_slice_back_to_each_segments_vertices(tmp_path: Path) -> None:
    net = load(line3(tmp_path))
    c = build_chains(net, CFG).chains[0]
    by_key = {s.key: s for s in net.segments}
    for key, (i0, i1) in c.segment_ranges.items():
        assert c.pts[i0 : i1 + 1] == by_key[key].pts


def test_gap_of_one_metre_is_never_bridged(tmp_path: Path) -> None:
    fx = NrwnFixture(tmp_path)
    seg(fx, "a", P(0), P(1))
    gap = LatLon(P(1).lat, P(1).lon + 1.5e-5)  # about 1 m east at 52 N
    seg(fx, "b", gap, P(2))
    assert len(chains_of(load(fx))) == 2


def test_branch_node_splits_into_three_chains(tmp_path: Path) -> None:
    fx = NrwnFixture(tmp_path)
    seg(fx, "stem", P(0), P(1))
    seg(fx, "left", P(1), P(2, 0))
    seg(fx, "right", P(1), P(2, 1))
    cs = build_chains(load(fx), CFG)
    assert keysets(cs) == {frozenset({"stem"}), frozenset({"left"}), frozenset({"right"})}


def test_parallel_double_track_with_crossovers_gives_separate_chains(tmp_path: Path) -> None:
    fx = NrwnFixture(tmp_path)
    seg(fx, "t1a", P(0, 0), P(1, 0))
    seg(fx, "t1b", P(1, 0), P(2, 0))
    seg(fx, "t2a", P(0, 1), P(1, 1))
    seg(fx, "t2b", P(1, 1), P(2, 1))
    seg(fx, "x", P(1, 0), P(1, 1))  # crossover joining both tracks mid-way
    cs = build_chains(load(fx), CFG)
    assert keysets(cs) == {frozenset({k}) for k in ("t1a", "t1b", "t2a", "t2b", "x")}


def test_subdivision_change_ends_the_chain(tmp_path: Path) -> None:
    fx = NrwnFixture(tmp_path)
    fx.track("a", [P(0), P(1)], sub=("S1", "Alpha"))
    fx.track("b", [P(1), P(2)], sub=("S2", "Beta"))
    cs = build_chains(load(fx), CFG)
    assert {(c.sub_nid, c.segment_keys) for c in cs.chains} == {("S1", ("a",)), ("S2", ("b",))}


def test_siding_attached_mid_chain_does_not_break_it(tmp_path: Path) -> None:
    fx = line3(tmp_path)
    seg(fx, "sid", P(1), P(1, 1), cls="Siding")
    cs = build_chains(load(fx), CFG)
    assert keysets(cs) == {frozenset({"a", "b", "c"})}
    assert [s.key for s in cs.unchained] == ["sid"]
    assert [(a.reason, a.severity, a.layer) for a in cs.audit] == [
        ("NOT_CHAINED_CLASS", "info", "TRACK")
    ]


def test_discontinued_main_is_unchained_and_audited(tmp_path: Path) -> None:
    fx = line3(tmp_path)
    fx.track("dead", [P(3), P(4)], status="Discontinued")
    fx.track("deadsid", [P(4), P(5)], status="Discontinued", cls="Spur")
    cs = build_chains(load(fx), CFG)
    assert keysets(cs) == {frozenset({"a", "b", "c"})}
    assert [s.key for s in cs.unchained] == ["dead", "deadsid"]  # sorted by key
    assert Counter(a.reason for a in cs.audit) == {"NOT_OPERATIONAL": 1, "NOT_CHAINED_CLASS": 1}
    assert {a.nid for a in cs.audit} == {"dead", "deadsid"}


def test_discontinued_middle_segment_splits_the_chain(tmp_path: Path) -> None:
    fx = NrwnFixture(tmp_path)
    seg(fx, "a", P(0), P(1))
    seg(fx, "b", P(1), P(2), status="Discontinued")
    seg(fx, "c", P(2), P(3))
    assert keysets(build_chains(load(fx), CFG)) == {frozenset({"a"}), frozenset({"c"})}


def test_balloon_loop_terminates_and_is_flagged_cycle(tmp_path: Path) -> None:
    cs = build_chains(load(loop_fixture(tmp_path)), CFG)
    assert len(cs.chains) == 1
    c = cs.chains[0]
    assert c.cycle and c.pts[0] == c.pts[-1]
    assert [(a.reason, a.severity, a.layer, a.nid) for a in cs.audit] == [
        ("CHAIN_CYCLE", "info", "CHAIN", c.id)
    ]
    assert c.segment_ranges["l4"][0] == 0
    assert c.segment_ranges[c.segment_keys[-1]][1] == len(c.pts) - 1


def test_cycle_start_and_direction_follow_the_node_keys(tmp_path: Path) -> None:
    c = build_chains(load(loop_fixture(tmp_path)), CFG).chains[0]
    # The smallest node key (lon, lat) is the south-west corner P(0, 0). Its neighbours are
    # P(1, 0) = (-105.99, 52.00) and P(0, 1) = (-106.00, 52.01); tuple order puts the smaller
    # longitude first, so the walk leaves toward P(0, 1) along l4.
    assert c.pts[0] == P(0, 0)
    assert c.segment_keys == ("l4", "l3", "l2", "l1")
    assert c.pts[2] == P(0, 1)


def test_lollipop_loop_back_to_a_branch_node_is_an_open_chain(tmp_path: Path) -> None:
    fx = NrwnFixture(tmp_path)
    seg(fx, "stem", P(0), P(1))
    seg(fx, "o1", P(1), P(2, 1))
    seg(fx, "o2", P(2, 1), P(1))
    cs = build_chains(load(fx), CFG)
    assert keysets(cs) == {frozenset({"stem"}), frozenset({"o1", "o2"})}
    loop = next(c for c in cs.chains if len(c.segment_keys) == 2)
    assert not loop.cycle and loop.pts[0] == loop.pts[-1] == P(1)
    assert cs.audit == ()


def test_two_parallel_segments_between_the_same_nodes_form_a_cycle(tmp_path: Path) -> None:
    fx = NrwnFixture(tmp_path)
    fx.track("p", [P(0), LatLon(52.001, -105.995), P(1)])
    fx.track("q", [P(0), LatLon(51.999, -105.995), P(1)])
    cs = build_chains(load(fx), CFG)
    assert len(cs.chains) == 1 and cs.chains[0].cycle
    assert cs.chains[0].segment_keys == ("p", "q")  # tie on neighbour node: smaller key first


def test_self_loop_segment_is_a_one_segment_cycle(tmp_path: Path) -> None:
    fx = NrwnFixture(tmp_path)
    fx.track("ring", [P(0), P(1), P(1, 1), P(0)])
    cs = build_chains(load(fx), CFG)
    assert len(cs.chains) == 1 and cs.chains[0].cycle and cs.chains[0].segment_keys == ("ring",)
    assert cs.chains[0].pts[0] == cs.chains[0].pts[-1]


def test_diamond_node_keeps_both_lines_continuous_and_is_labelled(tmp_path: Path) -> None:
    fx = NrwnFixture(tmp_path)
    x = P(1, 1)
    seg(fx, "w", P(0, 1), x, sub=("S1", "Alpha"))
    seg(fx, "e", x, P(2, 1), sub=("S1", "Alpha"))
    seg(fx, "s", P(1, 0), x, sub=("S2", "Beta"))
    seg(fx, "n", x, P(1, 2), sub=("S2", "Beta"))
    fx.junction("j1", x, "Diamond")
    net = load(fx)
    cs = build_chains(net, CFG)
    assert keysets(cs) == {frozenset({"w", "e"}), frozenset({"s", "n"})}
    assert cs.node_junctions[net.junctions[0].node] == "Diamond"


def test_junction_types_are_mapped_and_off_network_junctions_audited(tmp_path: Path) -> None:
    fx = line3(tmp_path)
    seg(fx, "sid", P(1), P(1, 1), cls="Siding")
    fx.junction("jsw", P(1), "Switch")  # on a Main endpoint
    fx.junction("jsid", P(1, 1), "End")  # only on a siding endpoint: still on the network
    fx.junction("jfar", P(9, 9), "Switch")  # on nothing
    net = load(fx)
    cs = build_chains(net, CFG)
    assert {j.nid: cs.node_junctions[j.node] for j in net.junctions if j.nid != "jfar"} == {
        "jsw": "Switch",
        "jsid": "End",
    }
    off = [a for a in cs.audit if a.reason == "JUNCTION_OFF_NETWORK"]
    assert [(a.layer, a.nid, a.severity) for a in off] == [("JUNCTION", "jfar", "info")]
    far = next(j for j in net.junctions if j.nid == "jfar")
    assert far.node in cs.node_junctions  # still mapped, but audited


def test_several_junctions_on_one_node_pick_a_deterministic_label(tmp_path: Path) -> None:
    fx = line3(tmp_path)
    fx.junction("j1", P(1), "Switch")
    fx.junction("j2", P(1), "Diamond")
    fx.junction("j3", P(2), "Switch")
    fx.junction("j4", P(2), "End")
    net = load(fx)
    cs = build_chains(net, CFG)
    nodes = {j.nid: j.node for j in net.junctions}
    assert cs.node_junctions[nodes["j1"]] == "Diamond"  # Diamond wins over anything else
    assert cs.node_junctions[nodes["j3"]] == "End"  # otherwise the alphabetically first type


def test_join_vertices_that_differ_by_one_microdegree_are_still_one_chain(tmp_path: Path) -> None:
    fx = NrwnFixture(tmp_path)
    # Both within 1e-7 deg (same NodeKey) but on opposite sides of a microdegree rounding edge.
    fx.track("a", [P(0), P(1), LatLon(52.00000049, -105.0)])
    fx.track("b", [LatLon(52.00000051, -105.0), P(2, 1)])
    net = load(fx)
    qa = next(s for s in net.segments if s.key == "a").pts[-1]
    qb = next(s for s in net.segments if s.key == "b").pts[0]
    assert qa != qb  # the quantised join vertices genuinely differ
    c = build_chains(net, CFG).chains
    assert len(c) == 1 and len(c[0].pts) == 4  # earlier segment's vertex kept, later one dropped
    assert c[0].pts[2] == qa and c[0].segment_ranges == {"a": (0, 2), "b": (2, 3)}


def test_cycle_closing_vertices_that_differ_are_forced_equal(tmp_path: Path) -> None:
    fx = NrwnFixture(tmp_path)
    fx.track("a", [LatLon(52.00000049, -106.0), P(1), P(1, 1)])
    fx.track("b", [P(1, 1), LatLon(52.00000051, -106.0)])
    c = build_chains(load(fx), CFG).chains[0]
    assert c.cycle and c.pts[0] == c.pts[-1]


def test_chains_are_sorted_and_s_is_from_quantised_pts(tmp_path: Path) -> None:
    fx = NrwnFixture(tmp_path)
    seg(fx, "z", P(5), P(6))
    seg(fx, "a", P(0), P(1))
    cs = build_chains(load(fx), CFG)
    assert [c.id for c in cs.chains] == sorted(c.id for c in cs.chains)
    for c in cs.chains:
        assert list(c.s_m) == cumulative_lengths_m(c.pts)


def test_operators_are_the_sorted_distinct_markers(tmp_path: Path) -> None:
    fx = NrwnFixture(tmp_path)
    seg(fx, "a", P(0), P(1), op="CP")
    seg(fx, "b", P(1), P(2), op="CN")
    seg(fx, "c", P(2), P(3), op="CP")
    assert build_chains(load(fx), CFG).chains[0].operators == ("CN", "CP")


def test_empty_network_gives_no_chains(tmp_path: Path) -> None:
    cs = build_chains(load(NrwnFixture(tmp_path)), CFG)
    assert cs == ChainSet((), (), {}, ())


def _property_fixture(root: Path, order: list[int], flips: list[bool]) -> NrwnFixture:
    """Five Main segments: stem Z-A-B, a two-segment loop at B, and a tail B-E."""
    a, b, c, e, z = P(1), P(2), P(3, 1), P(4), P(0)
    defs = {
        "s0": [a, LatLon(52.0003, -105.985), b],
        "s1": [b, LatLon(52.004, -105.97), c],
        "s2": [c, LatLon(52.012, -105.975), b],
        "s3": [z, LatLon(52.0002, -105.995), a],
        "s4": [b, LatLon(52.0001, -105.975), e],
    }
    keys = sorted(defs)
    fx = NrwnFixture(root)
    for pos, idx in enumerate(order):
        pts = defs[keys[idx]]
        fx.track(keys[idx], pts[::-1] if flips[pos] else pts)
    return fx


def _chains(net: Network) -> list[Chain]:
    return list(build_chains(net, CFG).chains)


@settings(max_examples=200, deadline=None)
@given(order=st.permutations(range(5)), flips=st.lists(st.booleans(), min_size=5, max_size=5))
def test_property_order_and_direction_do_not_change_chains(
    order: list[int], flips: list[bool]
) -> None:
    with tempfile.TemporaryDirectory() as t1, tempfile.TemporaryDirectory() as t2:
        base = _chains(load(_property_fixture(Path(t1), list(range(5)), [False] * 5)))
        got = _chains(load(_property_fixture(Path(t2), order, flips)))
    assert got == base  # same ids, pts, s_m (exact equality), ranges and flags
    assert len(got) == 3
    assert any(len(c.segment_keys) == 2 and c.pts[0] == c.pts[-1] for c in got)  # loop kept


@settings(max_examples=100, deadline=None)
@given(order=st.permutations(range(4)), flips=st.lists(st.booleans(), min_size=4, max_size=4))
def test_property_cycle_start_and_direction_are_canonical(
    order: list[int], flips: list[bool]
) -> None:
    corners = [(P(0, 0), P(1, 0)), (P(1, 0), P(1, 1)), (P(1, 1), P(0, 1)), (P(0, 1), P(0, 0))]

    def build(root: Path, o: list[int], f: list[bool]) -> list[Chain]:
        fx = NrwnFixture(root)
        for pos, idx in enumerate(o):
            a, b = corners[idx]
            seg(fx, f"l{idx}", b if f[pos] else a, a if f[pos] else b)
        return _chains(load(fx))

    with tempfile.TemporaryDirectory() as t1, tempfile.TemporaryDirectory() as t2:
        got = build(Path(t2), order, flips)
        assert got == build(Path(t1), [0, 1, 2, 3], [False] * 4)
    assert len(got) == 1 and got[0].cycle


RAW = os.environ.get("CANTRE_RAW_DIR")


@pytest.mark.skipif(RAW is None, reason="CANTRE_RAW_DIR not set (no raw NRWN data)")
def test_real_sk_chains_satisfy_structural_invariants() -> None:
    assert RAW is not None
    shp_dir = next(p.parent for p in Path(RAW).rglob("NRWN_SK_2_0_TRACK.shp"))
    net = load_network(shp_dir, "sk", CFG)
    cs = build_chains(net, CFG)
    eligible = {
        s.key for s in net.segments if s.track_class == "Main" and s.status == "Operational"
    }
    seen: Counter[str] = Counter(k for c in cs.chains for k in c.segment_keys)
    assert set(seen) == eligible and set(seen.values()) == {1}  # each exactly once
    assert {s.key for s in cs.unchained} == {s.key for s in net.segments} - eligible
    for c in cs.chains:
        assert all(b > a for a, b in zip(c.s_m, c.s_m[1:], strict=False))
        assert len(c.pts) == len(c.s_m) and (not c.cycle or c.pts[0] == c.pts[-1])
    ids = [c.id for c in cs.chains]
    assert ids == sorted(ids) and len(set(ids)) == len(ids)
