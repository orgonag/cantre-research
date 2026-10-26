"""Calibrated intervals and discontinuities (spec section 5.5, Decisions 3, 4 and 8).

An *interval* is a run of consecutive anchors on one chain that core's ``validateInterval``
accepts: sorted by ``s``, at least two anchors, and a milepost that strictly increases or
strictly decreases. Between two anchors of an interval the milepost is the linear interpolation
of core's ``interpolateMilepost``; across an interval boundary nothing is ever interpolated.

``build_intervals`` applies these steps in this order to the anchors of one chain, sorted by
``(s_m, TIER_RANK[tier], mp, id)``. Distances are metres, mileposts miles, ``1 mi = 1609.344 m``.

1. **Coincident conflicts** (spec section 5.5, rulings R12 and R19). Two anchors *conflict* when
   ``|Δs| <= anchor_collapse_span_m``, ``|Δmp| > mp_equal_tol_mi`` and the spacing cannot explain
   the mileage difference within one posting step:
   ``| |Δmp| * 1609.344 - |Δs| | > posting_step_mi * 1609.344`` (metres). NRWN posts mileage in
   0.01 mi (16.09 m) steps, so neighbouring crossings 0.01 mi apart and 20 m apart are genuine
   neighbours, not a conflict; 10.0 and 10.9 at the same spot are. The connected components
   of the conflict graph are *clusters*; anchors with no conflict are untouched. In a cluster,
   look at the members holding the cluster's best tier. If no conflict edge joins two of them,
   they agree with each other: all of them are kept and every other member is dropped
   (``ANCHOR_CONFLICT`` ``rejected``, detail names the kept ids and their mp). If a conflict edge
   joins two best-tier members there is no basis to choose and the whole cluster is dropped
   (detail lists the cluster ids). Clusters depend only on ``s``, ``mp`` and tier, so the result
   is independent of id strings and input order. The sort key is ``(s_m, TIER_RANK[tier], mp, id)``;
   ids only break ties between equal ``s``, tier and ``mp``, which can matter to the order of
   audit lines but never to which anchors survive. This runs before the collapse so that a
   conflicting lower-tier anchor sitting between two agreeing postings cannot keep them apart.
2. **Collapse** (Decision 4). Consecutive anchors with ``|Δs| <= anchor_collapse_span_m`` and
   ``|Δmp| <= mp_equal_tol_mi`` form a run (each member is compared with the previous member).
   A run becomes one anchor at the mean ``s``; it keeps the ``mp``, id, tier and source of the
   best-tier member (Decision 8; ties: smallest mp, then s, then id), the union of the
   ``member_nids`` and the largest residual. Every member gets an ``ANCHOR_COLLAPSED`` info line.
3. **pair_ok(a, b)**, for ``a`` before ``b``: ``Δs = s_b - s_a > 0``; ``|Δmp| > mp_equal_tol_mi``;
   and either ``Δs < slope_min_span_m`` (too short for the slope to mean anything) or
   ``| |Δmp| * 1609.344 / Δs - 1 | <= slope_tolerance``. A true track mile is 1609.344 m, so the
   implied slope of an honest pair is 1.
4. **Outliers** (ruling R18: a lower tier never evicts a higher one). Repeat until stable: an
   interior anchor ``k`` is an outlier when neither
   ``pair_ok(k-1, k)`` nor ``pair_ok(k, k+1)`` holds, ``pair_ok(k-1, k+1)`` holds, and the sign
   of that bridge agrees with every neighbouring pair ``(k-2, k-1)`` and ``(k+1, k+2)`` that is
   itself ok, and neither bridge end ``k-1`` or ``k+1`` has a worse tier (higher ``TIER_RANK``)
   than ``k`` (so unverified anchors can never bridge a posted one away). Several candidates in
   one pass: drop one only, the worst first (highest
   ``TIER_RANK``, then the largest slope error of its two bad pairs, then s, mp and id),
   then re-test.
   Each drop is an ``ANCHOR_OUTLIER`` ``rejected`` line carrying both slopes.
5. **Unverified check** (Decision 3, ruling R4). ``H`` is the anchors left after step 2 whose
   tier is not ``unverified``, run through steps 3 and 4 on their own. For an unverified anchor
   ``u`` of the main set that lies strictly between consecutive ``h1, h2`` in ``H`` with
   ``pair_ok(h1, h2)``, the anchor is dropped when
   ``|u.mp - interpolate(h1, h2, u.s)| > unverified_max_deviation_mi`` (``UNVERIFIED_DEVIATION``
   ``rejected``, detail has predicted and actual MP). ``H`` is only the reference set: anchors
   the sub-pass removed from ``H`` stay in the main set unless the main step 4 removed them.
   Unverified anchors outside such a pair are kept. Step 4 is not re-run after step 5 drops
   anchors (simple and documented; the split in step 6 handles any pair that this leaves bad).
6. **Split.** Walk consecutive pairs. The current interval's direction is the sign of its
   first pair. The interval is closed before pair ``(i, i+1)`` when ``pair_ok`` fails or the
   sign differs; the pair is not interpolated and the next interval starts at anchor ``i+1``.
   Intervals with fewer than two anchors are not emitted; their anchor stays in the kept set
   as an isolated anchor (see :func:`isolated_anchors`).

Audit lines of this module use layer ``"ANCHOR"`` and the anchor's id as ``nid`` (one line per
anchor, not per member NID). ``ANCHOR_COLLAPSED`` is ``info`` (the position is kept inside the
merged anchor); ``ANCHOR_OUTLIER`` and ``UNVERIFIED_DEVIATION`` are ``rejected`` (anchor unused).
All thresholds are EXPERIMENTAL (see :class:`~cantre_pipeline.config.PipelineConfig`).
"""

import math
from bisect import bisect_left, bisect_right
from collections.abc import Sequence
from dataclasses import dataclass, replace

from cantre_pipeline.anchors import TIER_RANK, QualifiedAnchor
from cantre_pipeline.audit import AuditReason, AuditRecord, Severity
from cantre_pipeline.chains import Chain
from cantre_pipeline.config import PipelineConfig
from cantre_pipeline.geodesy import METRES_PER_MILE

__all__ = ["Interval", "build_intervals", "interpolate_mp", "isolated_anchors"]

_EPS_MI = 1e-9
"""Float slack for mileage tolerance comparisons (same value as anchors.py), miles."""

_LAYER = "ANCHOR"
"""Audit layer of the lines written here."""


@dataclass(frozen=True)
class Interval:
    """One calibrated interval: ``anchor_ids`` in ``s`` order, at least two, strict monotonic mp.

    ``id`` is ``f"{chain_id}.i{n}"`` with ``n`` the 0-based index of the interval along ``s``
    among the intervals emitted for the chain.
    """

    id: str
    chain_id: str
    anchor_ids: tuple[str, ...]


def interpolate_mp(anchors: Sequence[QualifiedAnchor], s_m: float) -> float | None:
    """Milepost at along-chain position ``s_m`` (metres) from one interval's anchors, in miles.

    Formula (core ``interpolateMilepost``, spec section 6): for ``s`` strictly between
    consecutive anchors ``lower`` and ``upper`` (found by bisection),
    ``mp = lower.mp + (s - lower.s) / (upper.s - lower.s) * (upper.mp - lower.mp)``, with the
    same operation order as core so both agree to 1e-9 mi. An exact hit on an anchor returns its
    ``mp`` unchanged. Anchors must be sorted by ``s`` with strictly increasing ``s``.
    Limits: returns ``None`` outside ``[first.s, last.s]`` and for fewer than two anchors;
    it never extrapolates and does not validate the interval.
    """
    if len(anchors) < 2:
        return None
    ss = [a.s_m for a in anchors]
    if s_m < ss[0] or s_m > ss[-1]:
        return None
    k = bisect_left(ss, s_m)
    if k < len(ss) and ss[k] == s_m:
        return anchors[k].mp
    return _lerp(anchors[k - 1], anchors[k], s_m)  # ss[k-1] < s < ss[k]


def _lerp(lower: QualifiedAnchor, upper: QualifiedAnchor, s_m: float) -> float:
    """Core's interpolation between two anchors (same operation order as interpolate.ts)."""
    fraction = (s_m - lower.s_m) / (upper.s_m - lower.s_m)  # dimensionless
    return lower.mp + fraction * (upper.mp - lower.mp)  # miles


def isolated_anchors(
    kept: Sequence[QualifiedAnchor], intervals: Sequence[Interval]
) -> list[QualifiedAnchor]:
    """Anchors of ``kept`` that belong to no interval (step 6), in the order given."""
    used = {i for iv in intervals for i in iv.anchor_ids}
    return [a for a in kept if a.id not in used]


def _slope(a: QualifiedAnchor, b: QualifiedAnchor) -> float:
    """Miles of mileage per mile of track, ``|Δmp| * 1609.344 / Δs``; ``inf`` if ``Δs <= 0``."""
    ds = b.s_m - a.s_m
    if ds <= 0:
        return math.inf
    return abs(b.mp - a.mp) * METRES_PER_MILE / ds


def _pair_ok(a: QualifiedAnchor, b: QualifiedAnchor, cfg: PipelineConfig) -> bool:
    """Step 3 rule for ``a`` before ``b`` (module docstring)."""
    ds = b.s_m - a.s_m
    if not ds > 0:
        return False
    if not abs(b.mp - a.mp) > cfg.mp_equal_tol_mi + _EPS_MI:
        return False
    if ds < cfg.slope_min_span_m:
        return True
    return abs(_slope(a, b) - 1.0) <= cfg.slope_tolerance


def _slope_error(a: QualifiedAnchor, b: QualifiedAnchor) -> float:
    """``|slope - 1|`` of a pair; ``inf`` for an equal-mileage or non-advancing pair."""
    if b.mp == a.mp:
        return math.inf
    return abs(_slope(a, b) - 1.0)


def _sign(a: QualifiedAnchor, b: QualifiedAnchor) -> int:
    """Direction of mileage from ``a`` to ``b``: +1, -1 or 0."""
    d = b.mp - a.mp
    return (d > 0) - (d < 0)


def _fmt(x: float) -> str:
    return "inf" if math.isinf(x) else f"{x:.3f}"


def _audit(a: QualifiedAnchor, reason: AuditReason, severity: Severity, detail: str) -> AuditRecord:
    return AuditRecord(_LAYER, a.id, reason, severity, detail)


def _collapse(
    anchors: list[QualifiedAnchor], cfg: PipelineConfig, audit: list[AuditRecord]
) -> list[QualifiedAnchor]:
    """Step 2 (Decision 4): merge runs of near-identical postings; see the module docstring."""
    runs: list[list[QualifiedAnchor]] = []
    for a in anchors:
        prev = runs[-1][-1] if runs else None
        if (
            prev is not None
            and a.s_m - prev.s_m <= cfg.anchor_collapse_span_m
            and abs(a.mp - prev.mp) <= cfg.mp_equal_tol_mi + _EPS_MI
        ):
            runs[-1].append(a)
        else:
            runs.append([a])
    out: list[QualifiedAnchor] = []
    for run in runs:
        if len(run) == 1:
            out.append(run[0])
            continue
        best = min(run, key=lambda m: (TIER_RANK[m.tier], m.mp, m.s_m, m.id))
        # Numeric tie-breaks are canonical ordering, not evidence of greater accuracy.
        # IDs may select provenance only after the retained numerical value is fixed.
        merged = replace(
            best,
            s_m=math.fsum(m.s_m for m in run) / len(run),
            member_nids=tuple(sorted({n for m in run for n in m.member_nids})),
            residual_m=max(m.residual_m for m in run),
        )
        out.append(merged)
        for m in run:
            audit.append(
                _audit(
                    m,
                    "ANCHOR_COLLAPSED",
                    "info",
                    f"collapsed into anchor {merged.id} at s={merged.s_m:.3f} m "
                    f"({len(run)} postings within {cfg.anchor_collapse_span_m} m)",
                )
            )
    return out


def _resolve_conflicts(
    anchors: list[QualifiedAnchor], cfg: PipelineConfig, audit: list[AuditRecord]
) -> list[QualifiedAnchor]:
    """Step 1 (ruling R12): resolve each conflict cluster by tier; see the module docstring."""
    n = len(anchors)
    parent = list(range(n))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    edges: list[tuple[int, int]] = []
    step_m = cfg.posting_step_mi * METRES_PER_MILE  # one posting step, metres
    for i, a in enumerate(anchors):
        for j in range(i + 1, n):
            b = anchors[j]
            ds = b.s_m - a.s_m
            if ds > cfg.anchor_collapse_span_m:
                break  # sorted by s: nothing further can be within the span
            dmp = abs(b.mp - a.mp)
            # Ruling R19: the mileage difference must exceed what the spacing explains by more
            # than one posting step (the 1e-6 m slack keeps an exact step off float noise).
            if (
                dmp > cfg.mp_equal_tol_mi + _EPS_MI
                and abs(dmp * METRES_PER_MILE - ds) > step_m + 1e-6
            ):
                edges.append((i, j))
                parent[find(i)] = find(j)
    clusters: dict[int, list[int]] = {}
    for i in sorted({k for e in edges for k in e}):
        clusters.setdefault(find(i), []).append(i)
    dropped: set[int] = set()
    for members in clusters.values():  # members are in sort order
        best = min(TIER_RANK[anchors[i].tier] for i in members)
        top = {i for i in members if TIER_RANK[anchors[i].tier] == best}
        clash = any(i in top and j in top for i, j in edges)  # conflict between best-tier members
        keep = [] if clash else sorted(top)
        ids = ", ".join(anchors[i].id for i in members)
        for i in members:
            if i in keep:
                continue
            dropped.add(i)
            lose = anchors[i]
            if clash:
                detail = (
                    f"MP {lose.mp:.3f} in conflict cluster [{ids}] with conflicting anchors of "
                    f"the best tier; whole cluster dropped"
                )
            else:
                kept_txt = ", ".join(f"{anchors[k].id} (MP {anchors[k].mp:.3f})" for k in keep)
                detail = f"MP {lose.mp:.3f} conflicts with higher-tier anchors; kept {kept_txt}"
            audit.append(_audit(lose, "ANCHOR_CONFLICT", "rejected", detail))
    return [a for i, a in enumerate(anchors) if i not in dropped]


def _outliers(
    anchors: list[QualifiedAnchor], cfg: PipelineConfig, audit: list[AuditRecord] | None
) -> list[QualifiedAnchor]:
    """Step 4: drop interior outliers, one per round, worst first, until stable."""
    cur = list(anchors)
    while True:
        best: tuple[tuple[int, float, float, float, str], int] | None = None
        for k in range(1, len(cur) - 1):
            p, a, n = cur[k - 1], cur[k], cur[k + 1]
            if _pair_ok(p, a, cfg) or _pair_ok(a, n, cfg) or not _pair_ok(p, n, cfg):
                continue
            if TIER_RANK[p.tier] > TIER_RANK[a.tier] or TIER_RANK[n.tier] > TIER_RANK[a.tier]:
                continue  # ruling R18: a worse-tier bridge end never evicts anchor k
            bridge = _sign(p, n)
            if k >= 2 and _pair_ok(cur[k - 2], p, cfg) and _sign(cur[k - 2], p) != bridge:
                continue
            if k + 2 < len(cur) and _pair_ok(n, cur[k + 2], cfg) and _sign(n, cur[k + 2]) != bridge:
                continue
            err = max(_slope_error(p, a), _slope_error(a, n))
            key = (-TIER_RANK[a.tier], -err, a.s_m, a.mp, a.id)
            if best is None or key < best[0]:
                best = (key, k)
        if best is None:
            return cur
        k = best[1]
        if audit is not None:
            a = cur[k]
            audit.append(
                _audit(
                    a,
                    "ANCHOR_OUTLIER",
                    "rejected",
                    f"slope to previous {_fmt(_slope(cur[k - 1], a))}, "
                    f"slope to next {_fmt(_slope(a, cur[k + 1]))}; "
                    f"bridge {cur[k - 1].id}-{cur[k + 1].id} is consistent",
                )
            )
        del cur[k]


def _unverified_check(
    main: list[QualifiedAnchor],
    ref: list[QualifiedAnchor],
    cfg: PipelineConfig,
    audit: list[AuditRecord],
) -> list[QualifiedAnchor]:
    """Step 5 (Decision 3, ruling R4): drop unverified anchors far from the higher-tier line."""
    ref_s = [h.s_m for h in ref]
    kept: list[QualifiedAnchor] = []
    for u in main:
        if u.tier != "unverified":
            kept.append(u)
            continue
        j = bisect_right(ref_s, u.s_m)  # ref[j-1].s <= u.s < ref[j].s
        if j == 0 or j == len(ref) or ref_s[j - 1] == u.s_m:  # outside, or exactly on an h
            kept.append(u)
            continue
        h1, h2 = ref[j - 1], ref[j]
        if not _pair_ok(h1, h2, cfg):
            kept.append(u)
            continue
        predicted = _lerp(h1, h2, u.s_m)
        if abs(u.mp - predicted) > cfg.unverified_max_deviation_mi + _EPS_MI:
            audit.append(
                _audit(
                    u,
                    "UNVERIFIED_DEVIATION",
                    "rejected",
                    f"predicted MP {predicted:.3f} from {h1.id}-{h2.id}, actual MP {u.mp:.3f} "
                    f"(limit {cfg.unverified_max_deviation_mi} mi)",
                )
            )
        else:
            kept.append(u)
    return kept


def _split(chain_id: str, anchors: list[QualifiedAnchor], cfg: PipelineConfig) -> list[Interval]:
    """Step 6: cut at every failed pair and at every change of mileage direction."""
    runs: list[list[QualifiedAnchor]] = []
    cur: list[QualifiedAnchor] = []
    direction = 0
    for a in anchors:
        if not cur:
            cur = [a]
            continue
        prev = cur[-1]
        sign = _sign(prev, a)
        if not _pair_ok(prev, a, cfg) or (direction != 0 and sign != direction):
            runs.append(cur)  # the pair (prev, a) is not interpolated
            cur, direction = [a], 0
        else:
            cur.append(a)
            direction = sign
    if cur:
        runs.append(cur)
    emitted = [r for r in runs if len(r) >= 2]
    return [
        Interval(f"{chain_id}.i{n}", chain_id, tuple(a.id for a in r))
        for n, r in enumerate(emitted)
    ]


def build_intervals(
    chain: Chain, anchors: Sequence[QualifiedAnchor], cfg: PipelineConfig
) -> tuple[list[Interval], list[QualifiedAnchor], list[AuditRecord]]:
    """Split ``chain``'s anchors into calibrated intervals (spec section 5.5).

    Applies steps 1 to 6 of the module docstring to the anchors whose ``chain_id`` is the
    chain's (others are ignored), after sorting by ``(s_m, TIER_RANK[tier], mp, id)``.
    Units: metres, miles.
    Returns ``(intervals, kept, audit)``: the intervals (ids ``f"{chain.id}.i{n}"``, ``n`` from
    0 along ``s``), every anchor left after collapsing and after the ANCHOR_CONFLICT,
    ANCHOR_OUTLIER and UNVERIFIED_DEVIATION drops (in ``s`` order, a superset of the interval
    anchors) and the audit lines. The result depends only on the set of
    anchors. Every emitted interval has at least two anchors, strictly increasing ``s`` and a
    strictly monotonic ``mp``, so core's ``validateInterval`` accepts it.
    """
    audit: list[AuditRecord] = []
    own = sorted(
        (a for a in anchors if a.chain_id == chain.id),
        key=lambda a: (a.s_m, TIER_RANK[a.tier], a.mp, a.id),
    )
    resolved = _resolve_conflicts(own, cfg, audit)  # step 1 (ruling R12)
    collapsed = _collapse(resolved, cfg, audit)  # step 2
    main = _outliers(collapsed, cfg, audit)  # step 4 on the full set
    # Step 5 reference: the higher tiers alone, outlier pass on their own (ruling R4). Its drops
    # are not audited here; the main pass decides what leaves the set.
    ref = _outliers([a for a in collapsed if a.tier != "unverified"], cfg, None)
    kept = _unverified_check(main, ref, cfg, audit)
    return _split(chain.id, kept, cfg), kept, audit  # step 6
