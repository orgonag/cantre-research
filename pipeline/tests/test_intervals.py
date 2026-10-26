"""Tests for calibrated intervals and discontinuities (spec section 5.5, Task 6)."""

from itertools import pairwise, permutations

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from cantre_pipeline.anchors import AnchorTier, QualifiedAnchor
from cantre_pipeline.audit import AuditRecord
from cantre_pipeline.chains import Chain
from cantre_pipeline.config import PipelineConfig
from cantre_pipeline.intervals import (
    Interval,
    build_intervals,
    interpolate_mp,
    isolated_anchors,
)
from real_data import needs_real_sk, real_sk_paths

CFG = PipelineConfig()
MILE = 1609.344
CHAIN = Chain("ch_t", "S1", "Alpha", (), (), (), (), {}, False)


def anchor(
    aid: str, s: float, mp: float, tier: AnchorTier = "posted", residual: float = 0.0
) -> QualifiedAnchor:
    return QualifiedAnchor(aid, CHAIN.id, s, mp, "crossing", tier, (aid,), residual)


def run_mps(
    mps: list[float], step_m: float = MILE, tiers: dict[int, AnchorTier] | None = None
) -> list[QualifiedAnchor]:
    """Anchors a00.. at s = i * step_m with the given mileposts (tier overrides by index)."""
    t = tiers or {}
    return [anchor(f"a{i:02d}", i * step_m, mp, t.get(i, "posted")) for i, mp in enumerate(mps)]


def build(
    anchors: list[QualifiedAnchor],
) -> tuple[list[Interval], list[QualifiedAnchor], list[AuditRecord]]:
    return build_intervals(CHAIN, anchors, CFG)


def members(iv: Interval, kept: list[QualifiedAnchor]) -> list[QualifiedAnchor]:
    by_id = {a.id: a for a in kept}
    return [by_id[i] for i in iv.anchor_ids]


def reasons(audit: list[AuditRecord]) -> list[str]:
    return [a.reason for a in audit]


def test_increasing_mileage_gives_one_interval() -> None:
    ivs, kept, audit = build(run_mps([10.0, 11.0, 12.0, 13.0]))
    assert [i.id for i in ivs] == ["ch_t.i0"]
    assert ivs[0].chain_id == "ch_t"
    assert ivs[0].anchor_ids == ("a00", "a01", "a02", "a03")
    assert len(kept) == 4
    assert audit == []


def test_decreasing_mileage_gives_one_interval_with_decreasing_mp() -> None:
    ivs, kept, _ = build(run_mps([14.0, 13.0, 12.0, 11.0]))
    assert len(ivs) == 1
    ms = members(ivs[0], kept)
    assert [a.mp for a in ms] == [14.0, 13.0, 12.0, 11.0]
    assert interpolate_mp(ms, 0.5 * MILE) == pytest.approx(13.5)


def test_reset_to_zero_splits_and_never_interpolates_across() -> None:
    ivs, kept, _ = build(run_mps([10.0, 11.0, 12.0, 0.0, 1.0]))
    assert [len(i.anchor_ids) for i in ivs] == [3, 2]
    assert [i.id for i in ivs] == ["ch_t.i0", "ch_t.i1"]
    assert interpolate_mp(members(ivs[0], kept), 2.5 * MILE) is None
    assert interpolate_mp(members(ivs[1], kept), 2.5 * MILE) is None
    assert interpolate_mp(members(ivs[1], kept), 3.5 * MILE) == pytest.approx(0.5)


def test_single_outlier_is_dropped_not_split() -> None:
    ivs, kept, audit = build(run_mps([10.0, 11.0, 47.0, 13.0, 14.0]))
    assert [len(i.anchor_ids) for i in ivs] == [4]
    assert [a.id for a in kept] == ["a00", "a01", "a03", "a04"]
    out = [a for a in audit if a.reason == "ANCHOR_OUTLIER"]
    assert [(a.nid, a.severity) for a in out] == [("a02", "rejected")]
    assert "slope" in out[0].detail


def test_slope_test_skipped_below_800m_span() -> None:
    ivs, _, audit = build([anchor("a", 0.0, 5.00), anchor("b", 30.1, 5.01)])
    assert [i.anchor_ids for i in ivs] == [("a", "b")]
    assert audit == []


def test_slope_outside_15_percent_splits_on_long_span() -> None:
    # 1.3 miles of mileage over 1 mile of track: 30 % off, so the pair is not ok.
    ivs, kept, _ = build([anchor("x", 0.0, 1.0), anchor("y", MILE, 2.3)])
    assert ivs == []
    assert [a.id for a in isolated_anchors(kept, ivs)] == ["x", "y"]
    # 14 % off is inside the tolerance.
    ivs2, _, _ = build([anchor("x", 0.0, 1.0), anchor("y", MILE, 2.14)])
    assert len(ivs2) == 1
    # Long stretch with a break in the middle: two intervals.
    chain = [
        anchor("a0", 0.0, 1.0),
        anchor("a1", MILE, 2.0),
        anchor("a2", 2 * MILE, 3.0),
        anchor("a3", 3 * MILE, 6.0),
        anchor("a4", 4 * MILE, 7.0),
        anchor("a5", 5 * MILE, 8.0),
    ]
    ivs3, _, _ = build(chain)
    assert [i.anchor_ids for i in ivs3] == [("a0", "a1", "a2"), ("a3", "a4", "a5")]


def test_close_equal_postings_collapse_to_mean_s() -> None:
    anchors = [
        anchor("a0", 0.0, 1.0),
        anchor("a1", MILE, 2.0),
        anchor("a2", MILE + 20.0, 2.003),
        anchor("a3", 2 * MILE, 3.0),
    ]
    ivs, kept, audit = build(anchors)
    assert [a.s_m for a in kept] == [0.0, MILE + 10.0, 2 * MILE]
    assert [len(i.anchor_ids) for i in ivs] == [3]
    col = [a for a in audit if a.reason == "ANCHOR_COLLAPSED"]
    assert {a.nid for a in col} == {"a1", "a2"}
    assert all(a.severity == "info" for a in col)
    merged = kept[1]
    assert merged.id == "a1" and merged.mp == 2.0
    assert merged.member_nids == ("a1", "a2")


def test_equal_mp_far_apart_is_a_split() -> None:
    ivs, _, _ = build(run_mps([1.0, 2.0, 3.0, 3.0, 4.0, 5.0]))
    assert [len(i.anchor_ids) for i in ivs] == [3, 3]


def test_interpolate_mp_reproduces_anchors_and_never_extrapolates() -> None:
    a = [anchor("a", 100.0, 5.0), anchor("b", 1709.344, 6.0), anchor("c", 3318.688, 7.0)]
    assert [interpolate_mp(a, x.s_m) for x in a] == [5.0, 6.0, 7.0]
    assert interpolate_mp(a, 99.999) is None
    assert interpolate_mp(a, 3318.7) is None
    assert interpolate_mp(a, 904.672) == pytest.approx(5.5, abs=1e-9)
    # core's operation order: lower.mp + ((s - lower.s) / (upper.s - lower.s)) * (dmp)
    s = 2000.0
    frac = (s - 1709.344) / (3318.688 - 1709.344)
    assert interpolate_mp(a, s) == 6.0 + frac * (7.0 - 6.0)
    assert interpolate_mp(a[:1], 100.0) is None
    assert interpolate_mp([], 0.0) is None


def test_unverified_within_005mi_of_posted_bracket_is_kept() -> None:
    anchors = [
        anchor("p0", 0.0, 10.0),
        anchor("u1", 0.5 * MILE, 10.54, "unverified"),
        anchor("p2", MILE, 11.0),
    ]
    ivs, kept, audit = build(anchors)
    assert [a.id for a in kept] == ["p0", "u1", "p2"]
    assert len(ivs) == 1
    assert "UNVERIFIED_DEVIATION" not in reasons(audit)


def test_unverified_off_by_02mi_between_posted_is_dropped() -> None:
    # 0.2 mi off: both of its pairs fail the slope test, so the outlier pass (step 3) gets it first.
    anchors = [
        anchor("p0", 0.0, 10.0),
        anchor("u1", 0.5 * MILE, 10.7, "unverified"),
        anchor("p2", MILE, 11.0),
    ]
    ivs, kept, audit = build(anchors)
    assert [a.id for a in kept] == ["p0", "p2"] and len(ivs) == 1
    assert reasons(audit) == ["ANCHOR_OUTLIER"]


def test_unverified_off_by_006mi_with_good_slopes_is_a_deviation_drop() -> None:
    # 10.56 vs predicted 10.5: pairs have slope 1.12 / 0.88 (ok), so step 4 is what drops it.
    anchors = [
        anchor("p0", 0.0, 10.0),
        anchor("u1", 0.5 * MILE, 10.56, "unverified"),
        anchor("p2", MILE, 11.0),
    ]
    ivs, kept, audit = build(anchors)
    assert [a.id for a in kept] == ["p0", "p2"]
    assert len(ivs) == 1
    dev = [a for a in audit if a.reason == "UNVERIFIED_DEVIATION"]
    assert [(a.nid, a.severity) for a in dev] == [("u1", "rejected")]
    assert "10.500" in dev[0].detail and "10.560" in dev[0].detail


def test_unverified_only_stretch_still_forms_an_interval() -> None:
    ivs, kept, audit = build(run_mps([3.0, 4.0, 5.0], tiers=dict.fromkeys(range(3), "unverified")))
    assert [len(i.anchor_ids) for i in ivs] == [3]
    assert len(kept) == 3 and audit == []


def test_unverified_outside_posted_pairs_is_kept() -> None:
    anchors = [
        anchor("u0", 0.0, 9.0, "unverified"),
        anchor("p1", MILE, 10.0),
        anchor("p2", 2 * MILE, 11.0),
    ]
    _, kept, audit = build(anchors)
    assert [a.id for a in kept] == ["u0", "p1", "p2"] and audit == []


def test_unverified_between_posted_pair_that_is_not_ok_is_kept() -> None:
    # Posted pair 10 -> 30 over a mile is not pair_ok, so there is no reference to test against.
    anchors = [
        anchor("p0", 0.0, 10.0),
        anchor("u1", 0.5 * MILE, 11.0, "unverified"),
        anchor("p2", MILE, 30.0),
    ]
    _, kept, audit = build(anchors)
    assert "UNVERIFIED_DEVIATION" not in reasons(audit)
    assert "u1" in [a.id for a in kept]


@pytest.mark.parametrize("uid", ["u1", "a1", "zz", "p1"])
def test_coincident_lower_tier_is_dropped_whatever_its_id(uid: str) -> None:
    anchors = [
        anchor("p0", 0.0, 10.0),
        anchor(uid, MILE, 10.9, "unverified"),
        anchor("p2", MILE, 11.0),
        anchor("p3", 2 * MILE, 12.0),
    ]
    ivs, kept, audit = build(anchors)
    assert [a.id for a in kept] == ["p0", "p2", "p3"]
    assert [i.anchor_ids for i in ivs] == [("p0", "p2", "p3")]
    c = [a for a in audit if a.reason == "ANCHOR_CONFLICT"]
    assert [(a.nid, a.severity) for a in c] == [(uid, "rejected")]
    assert "p2" in c[0].detail and "10.900" in c[0].detail and "11.000" in c[0].detail


def test_coincident_same_tier_conflict_drops_both() -> None:
    anchors = [
        anchor("p0", 0.0, 10.0),
        anchor("b1", MILE, 10.9),
        anchor("b2", MILE + 5.0, 11.0),
        anchor("p3", 2 * MILE, 12.0),
    ]
    ivs, kept, audit = build(anchors)
    assert [a.id for a in kept] == ["p0", "p3"]
    assert sorted(a.nid for a in audit if a.reason == "ANCHOR_CONFLICT") == ["b1", "b2"]
    assert len(ivs) == 1


def test_agreeing_posted_pair_survives_a_conflicting_unverified_between_them() -> None:
    anchors = [
        anchor("p", MILE, 11.0),
        anchor("u", MILE, 11.4, "unverified"),
        anchor("q", MILE + 1.0, 11.0),
    ]
    _, kept, audit = build(anchors)
    assert [(a.id, a.member_nids) for a in kept] == [("p", ("p", "q"))]
    assert [a.nid for a in audit if a.reason == "ANCHOR_CONFLICT"] == ["u"]
    assert sorted(a.nid for a in audit if a.reason == "ANCHOR_COLLAPSED") == ["p", "q"]


def test_cluster_with_one_posted_and_two_unverified_keeps_the_posted() -> None:
    anchors = [
        anchor("p0", 0.0, 10.0),
        anchor("u1", MILE, 10.9, "unverified"),
        anchor("u2", MILE + 3.0, 11.2, "unverified"),
        anchor("b", MILE + 5.0, 11.0),
        anchor("p3", 2 * MILE, 12.0),
    ]
    ivs, kept, audit = build(anchors)
    assert [a.id for a in kept] == ["p0", "b", "p3"]
    conf = [a for a in audit if a.reason == "ANCHOR_CONFLICT"]
    assert sorted(a.nid for a in conf) == ["u1", "u2"]
    assert all("kept b (MP 11.000)" in a.detail for a in conf)
    assert len(ivs) == 1


def test_lower_tier_cannot_survive_after_higher_tier_conflict_drops_both() -> None:
    anchors = [
        anchor("p0", 0.0, 10.0),
        anchor("b1", MILE, 10.8),
        anchor("b2", MILE, 11.2),
        anchor("u", MILE, 11.0, "unverified"),
        anchor("p9", 2 * MILE, 12.0),
    ]
    _, kept, _ = build(anchors)
    assert [a.id for a in kept] == ["p0", "p9"]


def test_three_way_same_tier_cluster_is_id_independent() -> None:
    from itertools import permutations

    results = set()
    for names in permutations(["x1", "x2", "x3"]):
        anchors = [anchor("p0", 0.0, 10.0), anchor("p9", 2 * MILE, 12.0)] + [
            anchor(n, MILE, mp) for n, mp in zip(names, (10.8, 10.9, 11.1), strict=True)
        ]
        _, kept, audit = build(anchors)
        results.add(tuple(a.id for a in kept))
        assert sorted(a.nid for a in audit if a.reason == "ANCHOR_CONFLICT") == ["x1", "x2", "x3"]
    assert results == {("p0", "p9")}


def test_h_subpass_outlier_stays_in_main_set_and_h_is_the_reference() -> None:
    # x is an outlier among the higher tiers alone (ref = p0, p2) but not in the main set,
    # where the unverified u sits 161 m before it. u is tested against the filtered H.
    anchors = [
        anchor("p0", 0.0, 10.0),
        anchor("u", 1.9 * MILE, 12.3, "unverified"),
        anchor("x", 2.0 * MILE, 12.4),
        anchor("p2", 4.0 * MILE, 14.0),
    ]
    _, kept, audit = build(anchors)
    assert "x" in [a.id for a in kept]
    assert [a.nid for a in audit if a.reason == "UNVERIFIED_DEVIATION"] == ["u"]
    assert "ANCHOR_OUTLIER" not in reasons(audit)


@settings(max_examples=150, deadline=None)
@given(
    data=st.lists(
        st.tuples(
            st.integers(0, 12).map(lambda v: v * 20.0 if v % 3 else 1609.0),
            st.integers(0, 600).map(lambda v: v / 100),
            st.sampled_from(["posted", "tc", "unverified"]),
        ),
        max_size=20,
    ),
    flip=st.booleans(),
)
def test_property_renaming_ids_does_not_change_membership(
    data: list[tuple[float, float, AnchorTier]], flip: bool
) -> None:
    def shape(names: list[str]) -> list[tuple[tuple[float, float, str], ...]]:
        anchors = [anchor(n, s, mp, tier) for n, (s, mp, tier) in zip(names, data, strict=True)]
        ivs, kept, _ = build(anchors)
        by_id = {a.id: a for a in kept}
        return [tuple((a.s_m, a.mp, a.tier) for a in members_of(iv, by_id)) for iv in ivs]

    def members_of(iv: Interval, by_id: dict[str, QualifiedAnchor]) -> list[QualifiedAnchor]:
        return [by_id[i] for i in iv.anchor_ids]

    n = len(data)
    plain = [f"a{i:03d}" for i in range(n)]
    renamed = [f"a{(n - i) if flip else i + n:03d}" for i in range(n)]
    assert shape(plain) == shape(renamed)


def test_outlier_pass_drops_lower_tier_first() -> None:
    mps = [10.0, 11.0, 47.0, 13.0, 14.0, 15.0, 52.0, 17.0, 18.0]
    ivs, kept, audit = build(run_mps(mps, tiers={6: "unverified"}))
    out = [a.nid for a in audit if a.reason == "ANCHOR_OUTLIER"]
    assert out == ["a06", "a02"]  # unverified first, then the posted one
    assert len(ivs) == 1 and len(kept) == 7


def test_outlier_pass_breaks_tier_tie_by_slope_error() -> None:
    # Same tier; a02 is 34 miles off, a06 about 2.5 miles off: the larger error goes first.
    mps = [10.0, 11.0, 47.0, 13.0, 14.0, 15.0, 19.5, 17.0, 18.0]
    _, _, audit = build(run_mps(mps))
    out = [a.nid for a in audit if a.reason == "ANCHOR_OUTLIER"]
    assert out == ["a02", "a06"]


def test_collapse_keeps_posted_value_over_unverified() -> None:
    anchors = [
        anchor("a0", 0.0, 1.0),
        anchor("z1", 1000.0, 2.0, "unverified"),
        anchor("b1", 1010.0, 2.004, "posted"),
        anchor("a3", 2000.0, 3.0),
    ]
    _, kept, _ = build(anchors)
    assert [a.id for a in kept] == ["a0", "b1", "a3"]
    assert kept[1].mp == 2.004 and kept[1].tier == "posted"
    assert kept[1].s_m == 1005.0
    assert kept[1].member_nids == ("b1", "z1")


def test_collapse_tie_on_tier_takes_smallest_mileage_and_max_residual() -> None:
    anchors = [anchor("m2", 100.0, 2.001, residual=3.0), anchor("m1", 110.0, 2.0, residual=1.0)]
    _, kept, _ = build(anchors)
    assert len(kept) == 1 and kept[0].id == "m1" and kept[0].mp == 2.0
    assert kept[0].residual_m == 3.0


def test_outlier_with_disagreeing_neighbour_direction_is_not_dropped() -> None:
    # 10, 11, 5, 3, 4, 5: pair (11,5) and (5,3) fail the slope test, (11,3) fails too.
    ivs, kept, audit = build(run_mps([10.0, 11.0, 5.0, 3.0, 4.0, 5.0]))
    assert "ANCHOR_OUTLIER" not in reasons(audit)
    assert len(kept) == 6
    assert [i.anchor_ids for i in ivs] == [("a00", "a01"), ("a03", "a04", "a05")]


def test_outlier_whose_bridge_runs_against_a_neighbour_pair_is_not_dropped() -> None:
    # Right neighbour: bridge 11 -> 13 rises, the ok pair (13 -> 12) falls.
    _, kept, audit = build(run_mps([10.0, 11.0, 40.0, 13.0, 12.0]))
    assert "ANCHOR_OUTLIER" not in reasons(audit) and len(kept) == 5
    # Left neighbour: bridge 13 -> 11 falls, the ok pair (12 -> 13) rises.
    _, kept, audit = build(run_mps([12.0, 13.0, 40.0, 11.0, 12.0]))
    assert "ANCHOR_OUTLIER" not in reasons(audit) and len(kept) == 5


def test_equal_mileage_pair_is_a_bad_pair_for_the_outlier_test() -> None:
    _, kept, audit = build(run_mps([9.0, 10.0, 10.0, 12.0, 13.0]))
    assert [a.id for a in kept] == ["a00", "a01", "a03", "a04"]
    out = [a for a in audit if a.reason == "ANCHOR_OUTLIER"]
    assert [a.nid for a in out] == ["a02"]
    assert "slope to previous 0.000, slope to next 2.000" in out[0].detail


def test_three_anchors_outlier_in_the_middle_is_dropped() -> None:
    # No neighbouring pairs exist to disagree, the bridge (0,2) is fine.
    ivs, kept, audit = build(run_mps([10.0, 40.0, 12.0]))
    assert [a.id for a in kept] == ["a00", "a02"]
    assert reasons(audit) == ["ANCHOR_OUTLIER"]
    assert len(ivs) == 1


def test_direction_reversal_with_valid_pair_splits() -> None:
    ivs, _, _ = build(run_mps([10.0, 11.0, 12.0, 11.0, 10.0, 9.0]))
    assert [i.anchor_ids for i in ivs] == [("a00", "a01", "a02"), ("a03", "a04", "a05")]


def test_other_chain_anchors_are_ignored_and_unsorted_input_is_sorted() -> None:
    other = QualifiedAnchor("zz", "ch_other", 5.0, 99.0, "crossing", "posted", ("zz",), 0.0)
    anchors = [*reversed(run_mps([1.0, 2.0, 3.0])), other]
    ivs, kept, _ = build(anchors)
    assert [a.id for a in kept] == ["a00", "a01", "a02"]
    assert ivs[0].anchor_ids == ("a00", "a01", "a02")


def test_no_anchors_gives_nothing() -> None:
    assert build([]) == ([], [], [])


def test_isolated_anchors_are_those_in_no_interval() -> None:
    ivs, kept, _ = build(run_mps([10.0, 11.0, 12.0, 0.0]))
    assert [a.id for a in isolated_anchors(kept, ivs)] == ["a03"]


@settings(max_examples=200, deadline=None)
@given(
    data=st.lists(
        st.tuples(
            st.floats(0, 20000, allow_nan=False),
            st.floats(0, 500, allow_nan=False).map(lambda v: round(v, 2)),
            st.sampled_from(["posted", "tc", "unverified"]),
        ),
        max_size=25,
    )
)
def test_property_emitted_intervals_satisfy_core_contract(
    data: list[tuple[float, float, AnchorTier]],
) -> None:
    anchors = [anchor(f"a{i:03d}", s, mp, tier) for i, (s, mp, tier) in enumerate(data)]
    ivs, kept, _ = build(anchors)
    by_id = {a.id: a for a in kept}
    assert len(by_id) == len(kept)
    for iv in ivs:
        ms = [by_id[i] for i in iv.anchor_ids]
        assert len(ms) >= 2
        assert all(x.s_m < y.s_m for x, y in pairwise(ms))
        d = [y.mp - x.mp for x, y in pairwise(ms)]
        assert all(v > 0 for v in d) or all(v < 0 for v in d)


@needs_real_sk
def test_real_sk_interval_contract() -> None:  # pragma: no cover - env-gated
    from cantre_pipeline.anchors import qualify_anchors
    from cantre_pipeline.chains import build_chains
    from cantre_pipeline.reader import read_tc_inventory
    from cantre_pipeline.validate import load_network

    shp, csv_path = real_sk_paths()
    net = load_network(shp, "sk", CFG)
    chains = build_chains(net, CFG)
    anchors, _ = qualify_anchors(net, chains, read_tc_inventory(csv_path, "SK"), CFG)
    total = 0
    for chain in chains.chains:
        ivs, kept, _ = build_intervals(chain, anchors, CFG)
        by_id = {a.id: a for a in kept}
        for iv in ivs:
            ms = [by_id[i] for i in iv.anchor_ids]
            assert len(ms) >= 2
            assert all(x.s_m < y.s_m for x, y in pairwise(ms))
            d = [y.mp - x.mp for x, y in pairwise(ms)]
            assert all(v > 0 for v in d) or all(v < 0 for v in d)
            total += 1
    assert total > 0


def test_pair_rules_are_defensive_about_non_advancing_pairs() -> None:
    from cantre_pipeline.intervals import _pair_ok, _slope

    a, b = anchor("a", 100.0, 1.0), anchor("b", 100.0, 2.0)
    assert _slope(a, b) == float("inf")
    assert not _pair_ok(a, b, CFG)
    assert not _pair_ok(b, anchor("c", 50.0, 3.0), CFG)


def test_neighbouring_postings_one_step_apart_are_not_a_conflict() -> None:
    """Ruling R19: 0.19 and 0.20 posted 20.5 m apart are genuine neighbours (a 16 m step)."""
    anchors = [
        anchor("p0", 0.0, 0.0),
        anchor("n1", 0.19 * MILE, 0.19),
        anchor("n2", 0.19 * MILE + 20.5, 0.20),
        anchor("p3", 0.5 * MILE, 0.5),
    ]
    _, kept, audit = build(anchors)
    assert not [a for a in audit if a.reason == "ANCHOR_CONFLICT"]
    assert [a.id for a in kept] == ["p0", "n1", "n2", "p3"]


def test_same_spot_with_different_mileposts_is_still_a_conflict() -> None:
    """Ruling R19: 10.0 and 10.9 at one spot cannot both be right, whatever the spacing."""
    anchors = [anchor("p0", 0.0, 9.0), anchor("c1", MILE, 10.0), anchor("c2", MILE, 10.9)]
    _, kept, audit = build(anchors)
    assert sorted(a.nid for a in audit if a.reason == "ANCHOR_CONFLICT") == ["c1", "c2"]
    assert [a.id for a in kept] == ["p0"]


def test_spacing_that_explains_the_difference_is_not_a_conflict_but_a_wide_gap_is() -> None:
    # 0.2 mi (321.9 m) of mileage over 25 m: not explained by spacing, a conflict.
    a = [anchor("x1", 0.0, 5.0), anchor("x2", 25.0, 5.2)]
    assert [m.nid for m in build(a)[2] if m.reason == "ANCHOR_CONFLICT"] == ["x1", "x2"]
    # 0.02 mi (32.2 m) over 25 m: within one step (16.09 m) of the spacing, so no conflict.
    b = [anchor("y1", 0.0, 5.0), anchor("y2", 25.0, 5.02)]
    assert not [m for m in build(b)[2] if m.reason == "ANCHOR_CONFLICT"]


def test_unverified_bridge_never_evicts_a_posted_anchor() -> None:
    """Ruling R18: the outlier pass keeps a posted anchor that worse-tier ends bridge."""
    # a02 is far off both neighbours, which agree with each other (a bridge exists).
    mps = [10.0, 11.0, 47.0, 13.0, 14.0]
    tiers: dict[int, AnchorTier] = {1: "unverified", 3: "unverified"}
    _, _, audit = build(run_mps(mps, tiers=tiers))
    assert not [a for a in audit if a.reason == "ANCHOR_OUTLIER"]
    # The same shape with posted bridge ends still drops the posted outlier.
    _, _, audit = build(run_mps(mps))
    assert [a.nid for a in audit if a.reason == "ANCHOR_OUTLIER"] == ["a02"]
    # A worse-tier anchor is still dropped by better-tier ends.
    _, _, audit = build(run_mps(mps, tiers={2: "unverified"}))
    assert [a.nid for a in audit if a.reason == "ANCHOR_OUTLIER"] == ["a02"]


def test_coincident_different_postings_ignore_id_order() -> None:
    # Regression: ID ordering used to decide whether the 40 m anchor collapsed
    # with the MP 0 anchor at 20 m, changing an interval endpoint to 30 m.
    data: list[tuple[float, float, AnchorTier]] = [
        (20.0, 0.0, "tc"),
        (20.0, 0.01, "tc"),
        (40.0, 0.0, "posted"),
    ]
    shapes = set()
    for names in permutations(["a", "b", "c"]):
        values = [anchor(n, s, mp, tier) for n, (s, mp, tier) in zip(names, data, strict=True)]
        for order in permutations(values):
            ivs, kept, _ = build(list(order))
            by_id = {a.id: a for a in kept}
            shapes.add(
                tuple(tuple((by_id[n].s_m, by_id[n].mp) for n in iv.anchor_ids) for iv in ivs)
            )
    assert shapes == {(((20.0, 0.01), (40.0, 0.0)),)}


def test_collapse_representative_value_ignores_ids() -> None:
    for names in permutations(["a", "z"]):
        _, kept, _ = build([anchor(names[0], 100, 2.004), anchor(names[1], 110, 2.0)])
        assert [(a.s_m, a.mp, a.tier) for a in kept] == [(105.0, 2.0, "posted")]


def test_outlier_equal_errors_use_position_before_id() -> None:
    anchors = run_mps([10.0, 11.0, 47.0, 13.0, 14.0, 15.0, 51.0, 17.0, 18.0])
    # Reverse ID preference: the earlier equal-error outlier must still go first.
    anchors[2] = anchor("z", anchors[2].s_m, anchors[2].mp)
    anchors[6] = anchor("a", anchors[6].s_m, anchors[6].mp)
    _, _, audit = build(anchors)
    assert [a.nid for a in audit if a.reason == "ANCHOR_OUTLIER"] == ["z", "a"]
