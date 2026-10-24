"""Qualify tiered mileage anchors and merge duplicate crossings (spec sections 3 and 5.4).

An *anchor* ties a position on a chain (``s_m``, metres from the chain start) to a published
mileage (``mp``, miles). Every NRWN point record (CROSSING, STATION, MARKERPOST, STRUCTURE_0) and
every STRUCTURE_1 line gets exactly one outcome: it becomes part of an anchor, or it gets one
``rejected`` audit line carrying the first rule it failed. Merged crossings additionally get
``ANCHOR_MERGED`` info lines. Nothing is dropped silently.

Step A, the value and its tier (spec section 3, owner decision 2026-10-24, Decision 7):

* A record is *posted* when ``SUB1DISTY == "Posted"`` and its mileage parsed to a value.
* Posted crossing with a TC row that joins (Decision 7): the value must agree with the TC
  ``Mile`` within ``tc_max_disagreement_mi``, else ``SOURCE_DISAGREEMENT``. Tier ``posted``.
  A TC row that does not join is simply not comparable and raises no line (the crossing is
  kept on its own value).
* Crossing that is not usable as posted (Unknown qualifier, ``-1`` sentinel): a TC row that joins
  gives tier ``tc`` with ``mp = TC Mile``. If the TC row exists but fails the join, the TC reason
  (``TC_SPUR_CROSSING`` ...) is the rejection. With no TC row at all the reason is
  ``POSTED_SENTINEL`` (Posted with ``-1``) or ``NOT_POSTED``.
* MARKERPOST / STATION with qualifier ``Unknown`` and a value: tier ``unverified``.
* STRUCTURE_0 / STRUCTURE_1 are anchors only when Posted; otherwise ``NOT_POSTED``.
* Anything else: ``MILEAGE_SENTINEL`` (the stored value is negative) or ``NOT_POSTED``.

Step B, the rules, applied in this order (the first failure is the record's single reason):
unit is miles (``UNIT_NOT_MILE``; not applied to a TC value, which is miles by the inventory's
data dictionary), the track exists (``TRACK_NOT_FOUND``), is chained (``TRACK_NOT_CHAINED``),
has the record's subdivision (``SUBDIVISION_MISMATCH``), projects unambiguously onto the span
of the named segment only (``AMBIGUOUS_TRACK`` when candidates on different chains are within
1 m) and within ``anchor_max_residual_m`` (``RESIDUAL_TOO_LARGE``).

Merge, per chain: records sharing a ``CROSSINGID`` other than ``"None"`` merge into one anchor
when their values agree within ``mp_equal_tol_mi``, else each member gets ``ANCHOR_CONFLICT``.
A merged anchor takes the best tier of its members (Decision 8; ``posted`` > ``tc`` >
``unverified``) and the mean mileage of the members of that tier. Records on other chains stay
separate (double track).

Units: ``mp`` miles, ``s_m`` and ``residual_m`` metres.
"""

import math
from collections import defaultdict
from dataclasses import dataclass
from typing import Literal

from cantre_pipeline.audit import AuditReason, AuditRecord
from cantre_pipeline.chains import Chain, ChainSet
from cantre_pipeline.config import PipelineConfig
from cantre_pipeline.geodesy import project_onto_range
from cantre_pipeline.model import LineFeature, Network, PointFeature, Segment
from cantre_pipeline.reader import TcCrossing
from cantre_pipeline.schema_nrwn import norm_subdivision

__all__ = ["TIER_RANK", "AnchorSource", "AnchorTier", "QualifiedAnchor", "qualify_anchors"]

AnchorSource = Literal["crossing", "station", "structure", "markerpost"]
AnchorTier = Literal["posted", "tc", "unverified"]

TIER_RANK: dict[str, int] = {"posted": 0, "tc": 1, "unverified": 2}
"""Lower is better (Decision 8)."""

_AMBIGUITY_M = 1.0
"""Candidates on different chains this close (residual difference) are ambiguous, metres."""

_EPS_MI = 1e-9
"""Float slack for mileage tolerance comparisons (0.05 - 0.00 is 0.05000000000000071)."""

_SOURCE: dict[str, AnchorSource] = {
    "CROSSING": "crossing",
    "STATION": "station",
    "MARKERPOST": "markerpost",
    "STRUCTURE_0": "structure",
    "STRUCTURE_1": "structure",
}


@dataclass(frozen=True)
class QualifiedAnchor:
    """A mileage anchor on a chain.

    ``id`` is the smallest member NID, ``s_m`` the position along the chain in metres (mean of
    the members when merged), ``mp`` the mileage in miles, ``residual_m`` the largest
    point-to-chain distance among the members and ``member_nids`` every NID in the anchor.
    """

    id: str
    chain_id: str
    s_m: float
    mp: float
    source: AnchorSource
    tier: AnchorTier
    member_nids: tuple[str, ...]
    residual_m: float


_Feature = PointFeature | LineFeature


@dataclass(frozen=True)
class _Value:
    """Step A result: a mileage and its tier (``tier`` None means rejected with ``reason``)."""

    mp: float | None
    tier: AnchorTier | None
    reason: AuditReason | None = None
    detail: str = ""


def _tc_join(
    f: PointFeature, tc_rows: dict[str, TcCrossing], province: str
) -> tuple[float | None, AuditReason, str]:
    """Apply the Decision 7 join rule to crossing ``f``.

    Returns ``(mile, reason, detail)``: ``mile`` is the joined TC ``Mile`` in miles, or None with
    the first rule that failed (``TC_NO_ROW`` when there is no usable ``TCID`` or no row of that
    number and province, ``TC_SPUR_CROSSING``, ``TC_SUBDIVISION_MISMATCH``, ``TC_BAD_MILE``).
    """
    tcid = f.attrs["TCID"].strip()
    row = tc_rows.get(tcid) if tcid not in ("", "-1") else None
    if row is None or row.province.upper() != province.upper():
        return None, "TC_NO_ROW", f"TCID {tcid!r} has no TC row"
    if row.spur_mile_point not in ("", "-"):
        return (
            None,
            "TC_SPUR_CROSSING",
            f"TC {tcid} is a spur crossing (Spur Mile Point {row.spur_mile_point!r}); "
            f"its Mile {row.mile} is the turnout on the main line",
        )
    nrwn_name = f.attrs.get("SUBDI1NAME", "")
    if norm_subdivision(row.subdivision) != norm_subdivision(nrwn_name):
        return (
            None,
            "TC_SUBDIVISION_MISMATCH",
            f"TC {tcid} subdivision {row.subdivision!r} differs from NRWN {nrwn_name!r}",
        )
    if row.mile is None or not (math.isfinite(row.mile) and row.mile >= 0):
        return None, "TC_BAD_MILE", f"TC {tcid} Mile is unusable"
    return row.mile, "TC_NO_ROW", ""


def _raw_negative(f: _Feature) -> bool:
    """True when the stored ``SUBD1DIST`` is a negative number (the ``-1`` sentinel)."""
    try:
        return float(f.attrs["SUBD1DIST"]) < 0
    except ValueError:  # pragma: no cover - the DBF field is numeric
        return False


def _step_a(
    f: _Feature, tc_rows: dict[str, TcCrossing], cfg: PipelineConfig, province: str
) -> _Value:
    """Step A: choose the value and tier of ``f`` or the reason it has none (module docstring)."""
    mp = f.mp_value
    posted = f.mp_qualifier == "Posted"
    if isinstance(f, PointFeature) and f.layer == "CROSSING":
        tc_mile, reason, detail = _tc_join(f, tc_rows, province)
        if posted and mp is not None:
            # Decision 7: NRWN and TC values must agree; a larger gap excludes the record.
            if tc_mile is not None and abs(mp - tc_mile) > cfg.tc_max_disagreement_mi + _EPS_MI:
                return _Value(
                    None,
                    None,
                    "SOURCE_DISAGREEMENT",
                    f"NRWN posted {mp} mi vs TC {tc_mile} mi (limit {cfg.tc_max_disagreement_mi})",
                )
            return _Value(mp, "posted")
        if tc_mile is not None:
            return _Value(tc_mile, "tc")  # not usable as posted: use the TC value
        if reason != "TC_NO_ROW":
            return _Value(None, None, reason, detail)
        if posted:
            return _Value(None, None, "POSTED_SENTINEL", "Posted crossing with mileage -1")
        return _Value(None, None, "NOT_POSTED", f"qualifier {f.mp_qualifier!r}, no TC value")
    if mp is not None and posted:
        return _Value(mp, "posted")
    if mp is not None and f.layer in ("MARKERPOST", "STATION") and f.mp_qualifier == "Unknown":
        return _Value(mp, "unverified")
    if mp is None and _raw_negative(f):
        return _Value(None, None, "MILEAGE_SENTINEL", "mileage is the -1 sentinel")
    return _Value(None, None, "NOT_POSTED", f"qualifier {f.mp_qualifier!r}, not a posted value")


@dataclass(frozen=True)
class _Fail:
    """A Step B rule failure."""

    reason: AuditReason
    detail: str


@dataclass(frozen=True)
class _Pos:
    """Where a record sits: chain, ``s_m`` (metres) and residual (metres)."""

    chain: Chain
    s_m: float
    residual_m: float


@dataclass(frozen=True)
class _Located:
    """A record that passed every rule: its value, chain and position."""

    nid: str
    layer: str
    source: AnchorSource
    tier: AnchorTier
    mp: float
    chain: Chain
    s_m: float
    residual_m: float


_Hit = tuple[Segment, Chain]
"""A TRACK segment with the chain that contains it."""


def _locate(
    f: _Feature, by_nid: dict[str, list[Segment]], chain_of: dict[str, Chain], cfg: PipelineConfig
) -> _Pos | _Fail:
    """Step B rules 4-8: return ``(chain, s_m, residual_m)`` or ``(reason, detail)``.

    The record's ``TRACKNID`` may name several segments (a NID can repeat, Decision 1); each
    chained one in the record's own subdivision is a candidate, and the point is projected onto
    that segment's vertex span only, never the whole chain, so a chain that doubles back near
    itself cannot pull the anchor onto the wrong leg.
    """
    segs = by_nid.get(f.track_nid)
    if not segs:
        return _Fail("TRACK_NOT_FOUND", f"no TRACK with NID {f.track_nid!r}")
    chained: list[_Hit] = [(s, chain_of[s.key]) for s in segs if s.key in chain_of]
    if not chained:
        return _Fail("TRACK_NOT_CHAINED", f"track {f.track_nid!r} is in no chain")
    hits = [h for h in chained if h[1].sub_nid == f.sub_nid]
    if not hits:
        return _Fail(
            "SUBDIVISION_MISMATCH",
            f"record subdivision {f.sub_nid!r}, track chain subdivision {chained[0][1].sub_nid!r}",
        )
    pt = f.pt if isinstance(f, PointFeature) else f.pts[0]  # a line anchors at its first vertex
    found: list[tuple[float, str, Chain, float]] = []  # (residual m, chain id, chain, s m)
    for seg, chain in hits:
        i0, i1 = chain.segment_ranges[seg.key]
        r = project_onto_range(pt, chain.pts, chain.s_m, i0, i1)
        found.append((r.cross_track_m, chain.id, chain, r.s_m))
    found.sort(key=lambda x: (x[0], x[1], x[3]))
    best = found[0]
    for other in found[1:]:
        # Rule 7: a rival on a different chain within 1 m cannot be told apart.
        if other[2].id != best[2].id and other[0] - best[0] <= _AMBIGUITY_M:
            return _Fail(
                "AMBIGUOUS_TRACK",
                f"chains {best[2].id} and {other[2].id} within {_AMBIGUITY_M} m "
                f"({best[0]:.2f} m, {other[0]:.2f} m)",
            )
    if best[0] > cfg.anchor_max_residual_m:  # Rule 8
        return _Fail(
            "RESIDUAL_TOO_LARGE", f"residual {best[0]:.2f} m exceeds {cfg.anchor_max_residual_m} m"
        )
    return _Pos(best[2], best[3], best[0])


def _candidates(net: Network) -> list[_Feature]:
    """Every record that can anchor, in a fixed layer order."""
    return [*net.crossings, *net.stations, *net.markerposts, *net.structures_pt, *net.structures_ln]


def _agree(group: list[_Located], tol: float) -> bool:
    """True when the members' mileages differ by at most ``tol`` miles (``max - min``)."""
    return max(g.mp for g in group) - min(g.mp for g in group) <= tol + _EPS_MI


def _merge(group: list[_Located]) -> QualifiedAnchor:
    """Merge agreeing records of one chain into one anchor (a single record is its own anchor).

    The anchor takes the best tier present (Decision 8) and the mean mileage of the members of
    that tier; ``s_m`` is the mean over all members and ``id`` the smallest NID.
    """
    best_rank = min(TIER_RANK[g.tier] for g in group)
    top = sorted((g for g in group if TIER_RANK[g.tier] == best_rank), key=lambda g: g.nid)
    first = min(group, key=lambda g: g.nid)
    return QualifiedAnchor(
        id=first.nid,
        chain_id=first.chain.id,
        s_m=math.fsum(g.s_m for g in group) / len(group),
        mp=math.fsum(g.mp for g in top) / len(top),
        source=first.source,
        tier=top[0].tier,
        member_nids=tuple(sorted(g.nid for g in group)),
        residual_m=max(g.residual_m for g in group),
    )


def qualify_anchors(
    net: Network,
    chains: ChainSet,
    tc_rows: dict[str, TcCrossing],
    cfg: PipelineConfig,
) -> tuple[list[QualifiedAnchor], list[AuditRecord]]:
    """Qualify every anchor candidate of ``net`` against ``chains`` (spec section 5.4).

    Applies Step A (value and tier) and Step B (rules) from the module docstring to each
    CROSSING, STATION, MARKERPOST, STRUCTURE_0 and STRUCTURE_1 record, then merges crossings that
    share a ``CROSSINGID`` on one chain. ``tc_rows`` must already be de-duplicated by TC number
    (duplicates are audited by the caller). Units: miles for mileage, metres for ``s_m``.

    Returns ``(anchors, audit)``. ``anchors`` are sorted by ``(chain_id, s_m, id)``. Each
    rejected record has exactly one ``rejected`` audit line; members of a merged anchor get an
    ``ANCHOR_MERGED`` info line. The result depends only on the set of records, not their order.
    """
    audit: list[AuditRecord] = []
    by_nid: dict[str, list[Segment]] = defaultdict(list)
    for s in net.segments:
        by_nid[s.nid].append(s)
    chain_of = {k: c for c in chains.chains for k in c.segment_keys}

    located: list[_Located] = []
    for f in _candidates(net):
        value = _step_a(f, tc_rows, cfg, net.province)
        if value.tier is None or value.mp is None:
            reason = value.reason or "NOT_POSTED"
            audit.append(AuditRecord(f.layer, f.nid, reason, "rejected", value.detail))
            continue
        # Rule 2. A TC value is miles by the inventory's data dictionary, whatever NRWN's unit says.
        if value.tier != "tc" and f.mp_unit != "Mile":
            audit.append(
                AuditRecord(f.layer, f.nid, "UNIT_NOT_MILE", "rejected", f"unit {f.mp_unit!r}")
            )
            continue
        # Rule 3 is guaranteed by parse_mileage / the TC join; fail loudly if that ever breaks.
        if not (math.isfinite(value.mp) and value.mp >= 0):  # pragma: no cover
            raise ValueError(f"{f.layer} {f.nid}: mileage {value.mp} is not finite and >= 0")
        loc = _locate(f, by_nid, chain_of, cfg)
        if isinstance(loc, _Fail):
            audit.append(AuditRecord(f.layer, f.nid, loc.reason, "rejected", loc.detail))
            continue
        located.append(
            _Located(
                f.nid,
                f.layer,
                _SOURCE[f.layer],
                value.tier,
                value.mp,
                loc.chain,
                loc.s_m,
                loc.residual_m,
            )
        )

    # Merge per chain (spec 5.4): a CROSSINGID other than "None" groups records of one chain.
    crossing_group = {f.nid: f.attrs["CROSSINGID"] for f in net.crossings}
    groups: dict[tuple[str, str], list[_Located]] = defaultdict(list)
    anchors: list[QualifiedAnchor] = []
    for loc_rec in located:
        cid = crossing_group.get(loc_rec.nid, "None") if loc_rec.layer == "CROSSING" else "None"
        if cid == "None":
            anchors.append(_merge([loc_rec]))
        else:
            groups[(loc_rec.chain.id, cid)].append(loc_rec)
    for (chain_id, cid), members in sorted(groups.items()):
        if not _agree(members, cfg.mp_equal_tol_mi):
            values = ", ".join(f"{m.nid}={m.mp}" for m in sorted(members, key=lambda m: m.nid))
            for m in members:
                audit.append(
                    AuditRecord(
                        m.layer,
                        m.nid,
                        "ANCHOR_CONFLICT",
                        "rejected",
                        f"CROSSINGID {cid} on {chain_id}: values disagree ({values})",
                    )
                )
            continue
        merged = _merge(members)
        anchors.append(merged)
        if len(members) > 1:
            for m in members:
                audit.append(
                    AuditRecord(
                        m.layer,
                        m.nid,
                        "ANCHOR_MERGED",
                        "info",
                        f"merged into anchor {merged.id} (CROSSINGID {cid})",
                    )
                )
    anchors.sort(key=lambda a: (a.chain_id, a.s_m, a.id))
    return anchors, audit
