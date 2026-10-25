"""Per-subdivision coverage report (spec section 5.9).

The report answers one question: how much of each subdivision's chain length lies inside a
calibrated interval, and why were records turned away? It is **internal coverage, not surveyed
accuracy**: a calibrated interval means that published mileposts bracket the position, not that
the interpolated value has been compared with a surveyed one.

Figures, per subdivision (rows) and for the whole province (totals row):

* ``chain_km``: sum of chain lengths, ``s_m[-1] / 1000``.
* ``calibrated_km``: ``sum(s_last - s_first)`` over the calibrated intervals, km.
* ``calibrated_pct``: ``100 * calibrated_km / chain_km`` (0 when there is no chain).
* ``calibrated_km_posted_only``: the same sum over intervals rebuilt from the qualified ``posted``
  anchors alone (rulings R3 and R17: :func:`~cantre_pipeline.intervals.build_intervals` is run
  again on each chain from the output of ``qualify_anchors``, not from the anchors the all-tier
  pass kept). The gap is what the ``tc`` and ``unverified`` tiers change. It is
  a difference of two independently built interval sets, so it is not guaranteed to be positive.
* anchor counts by source and by tier, and rejected audit lines by reason.

Kilometres are rounded to 6 decimals (1 mm) and percentages to 3, so the files do not carry
floating-point noise. Audit lines carry no subdivision, so the caller passes ``sub_of``, a map
from ``(layer, nid)`` to subdivision NID; rejected lines it cannot place (geometry rejects,
Transport Canada rows, ...) count toward the totals row only.
"""

from collections import Counter, defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from cantre_pipeline.acquire import SourceRecord
from cantre_pipeline.anchors import AnchorSource, AnchorTier, QualifiedAnchor
from cantre_pipeline.audit import AuditRecord
from cantre_pipeline.chains import Chain, ChainSet
from cantre_pipeline.config import PipelineConfig
from cantre_pipeline.encode import canonical_json
from cantre_pipeline.intervals import Interval, build_intervals

__all__ = [
    "COVERAGE_SCHEMA",
    "DISCLAIMER",
    "CoverageRow",
    "build_report",
    "coverage_rows",
    "render_markdown",
    "totals_row",
    "write_reports",
]

COVERAGE_SCHEMA = "cantre.coverage/1"
DISCLAIMER = "Internal coverage, not surveyed accuracy."

SOURCES: tuple[AnchorSource, ...] = ("crossing", "markerpost", "station", "structure")
TIERS: tuple[AnchorTier, ...] = ("posted", "tc", "unverified")
TOTAL_NID = "*"
"""``subdivision_nid`` of the totals row."""


@dataclass(frozen=True)
class CoverageRow:
    """Coverage of one subdivision (or, with ``subdivision_nid == "*"``, of the whole province).

    Attributes:
        subdivision_nid: ``SUBDI1NID``.
        subdivision_name: ``SUBDI1NAME`` as published.
        operators: Sorted operators of the subdivision's chains.
        chain_km: Chain length, km.
        calibrated_km: Chain length inside calibrated intervals, km.
        calibrated_pct: ``100 * calibrated_km / chain_km``.
        calibrated_km_posted_only: Calibrated length rebuilt from ``posted`` anchors only, km.
        anchors_by_source: Kept anchors per source (every source listed, zeros included).
        anchors_by_tier: Kept anchors per tier (every tier listed, zeros included).
        rejected_by_reason: ``rejected`` audit lines per reason (only reasons that occur).
    """

    subdivision_nid: str
    subdivision_name: str
    operators: tuple[str, ...]
    chain_km: float
    calibrated_km: float
    calibrated_pct: float
    calibrated_km_posted_only: float
    anchors_by_source: Mapping[AnchorSource, int] = field(default_factory=dict)
    anchors_by_tier: Mapping[AnchorTier, int] = field(default_factory=dict)
    rejected_by_reason: Mapping[str, int] = field(default_factory=dict)


def _km(metres: float) -> float:
    """Metres to kilometres, rounded to 6 decimals (1 mm)."""
    return round(metres / 1000.0, 6)


def _pct(part: float, whole: float) -> float:
    """``100 * part / whole`` rounded to 3 decimals; 0.0 when ``whole`` is not positive."""
    return round(100.0 * part / whole, 3) if whole > 0 else 0.0


def _interval_m(
    intervals: Iterable[Interval], by_key: Mapping[tuple[str, str], QualifiedAnchor]
) -> float:
    """Sum of ``s_last - s_first`` over ``intervals``, metres (anchors are in ``s`` order)."""
    return sum(
        by_key[(iv.chain_id, iv.anchor_ids[-1])].s_m - by_key[(iv.chain_id, iv.anchor_ids[0])].s_m
        for iv in intervals
    )


def coverage_rows(
    chains: ChainSet,
    intervals: Sequence[Interval],
    anchors: Sequence[QualifiedAnchor],
    audit: Sequence[AuditRecord],
    cfg: PipelineConfig,
    *,
    sub_of: Mapping[tuple[str, str], str] | None = None,
    qualified_posted: Sequence[QualifiedAnchor] | None = None,
) -> list[CoverageRow]:
    """Return one :class:`CoverageRow` per subdivision that has a chain, sorted by (name, nid).

    ``anchors`` are the anchors kept by ``build_intervals`` (they are counted, and the interval
    ends are looked up in them), ``intervals`` all intervals, ``audit`` every audit line of the
    build and ``sub_of`` the attribution of audit lines to subdivisions (see the module doc;
    ``None`` attributes nothing).

    ``qualified_posted`` (ruling R17, refines R3) are the ``posted``-tier anchors exactly as
    ``qualify_anchors`` returned them, before any interval step. ``calibrated_km_posted_only``
    re-runs ``build_intervals`` on each chain with these alone, so it does not inherit a lower
    tier's decision (for example a posted anchor dropped as an outlier because an unverified
    anchor bridged it). ``None`` falls back to the posted subset of ``anchors``, which does
    inherit those decisions. Units: km; percentages 0 to 100.
    """
    by_key = {(a.chain_id, a.id): a for a in anchors}
    sub_of_chain = {c.id: c.sub_nid for c in chains.chains}
    posted: dict[str, list[QualifiedAnchor]] = defaultdict(list)
    for a in anchors if qualified_posted is None else qualified_posted:
        if a.tier == "posted":
            posted[a.chain_id].append(a)

    by_sub: dict[str, list[Chain]] = defaultdict(list)
    for c in chains.chains:
        by_sub[c.sub_nid].append(c)
    rejected: dict[str, Counter[str]] = defaultdict(Counter)
    for rec in audit:
        sub = (sub_of or {}).get((rec.layer, rec.nid))
        if rec.severity == "rejected" and sub in by_sub:
            rejected[sub][rec.reason] += 1

    rows: list[CoverageRow] = []
    for sub_nid, group in by_sub.items():
        ids = {c.id for c in group}
        chain_m = sum(c.s_m[-1] for c in group)
        calibrated_m = _interval_m((iv for iv in intervals if iv.chain_id in ids), by_key)
        posted_m = 0.0
        for c in group:
            ivs, kept, _ = build_intervals(c, posted[c.id], cfg)
            posted_m += _interval_m(ivs, {(a.chain_id, a.id): a for a in kept})
        own = [a for a in anchors if sub_of_chain.get(a.chain_id) == sub_nid]
        chain_km, calibrated_km = _km(chain_m), _km(calibrated_m)
        rows.append(
            CoverageRow(
                subdivision_nid=sub_nid,
                subdivision_name=group[0].sub_name,
                operators=tuple(sorted({op for c in group for op in c.operators})),
                chain_km=chain_km,
                calibrated_km=calibrated_km,
                calibrated_pct=_pct(calibrated_km, chain_km),
                calibrated_km_posted_only=_km(posted_m),
                anchors_by_source={s: sum(1 for a in own if a.source == s) for s in SOURCES},
                anchors_by_tier={t: sum(1 for a in own if a.tier == t) for t in TIERS},
                rejected_by_reason=dict(sorted(rejected[sub_nid].items())),
            )
        )
    rows.sort(key=lambda r: (r.subdivision_name, r.subdivision_nid))
    return rows


def totals_row(rows: Sequence[CoverageRow], audit: Sequence[AuditRecord]) -> CoverageRow:
    """Sum ``rows`` into the province row; its rejections are **all** ``rejected`` audit lines.

    That includes lines no row could claim, so the totals row matches the audit file exactly
    (``chain_km`` etc. are re-rounded sums of the rows' rounded values).
    """
    chain_km = round(sum(r.chain_km for r in rows), 6)
    calibrated_km = round(sum(r.calibrated_km for r in rows), 6)
    rejected = Counter(a.reason for a in audit if a.severity == "rejected")
    return CoverageRow(
        subdivision_nid=TOTAL_NID,
        subdivision_name="All subdivisions",
        operators=tuple(sorted({op for r in rows for op in r.operators})),
        chain_km=chain_km,
        calibrated_km=calibrated_km,
        calibrated_pct=_pct(calibrated_km, chain_km),
        calibrated_km_posted_only=round(sum(r.calibrated_km_posted_only for r in rows), 6),
        anchors_by_source={s: sum(r.anchors_by_source.get(s, 0) for r in rows) for s in SOURCES},
        anchors_by_tier={t: sum(r.anchors_by_tier.get(t, 0) for r in rows) for t in TIERS},
        rejected_by_reason=dict(sorted(rejected.items())),
    )


def _row_json(r: CoverageRow) -> dict[str, Any]:
    """The JSON-ready (camelCase, key-sorted maps) form of one coverage row."""
    return {
        "subdivisionNid": r.subdivision_nid,
        "subdivisionName": r.subdivision_name,
        "operators": list(r.operators),
        "chainKm": r.chain_km,
        "calibratedKm": r.calibrated_km,
        "calibratedPct": r.calibrated_pct,
        "calibratedKmPostedOnly": r.calibrated_km_posted_only,
        "anchorsBySource": dict(sorted(r.anchors_by_source.items())),
        "anchorsByTier": dict(sorted(r.anchors_by_tier.items())),
        "rejectedByReason": dict(sorted(r.rejected_by_reason.items())),
    }


def build_report(
    province: str,
    rows: Sequence[CoverageRow],
    audit: Sequence[AuditRecord],
    chains: ChainSet,
    sources: Sequence[SourceRecord],
    dataset_version: str,
) -> dict[str, Any]:
    """Return the JSON-ready report (schema ``cantre.coverage/1``).

    Besides the rows it holds ``auditByReason`` (every audit line, counted per reason and
    severity: the figures the audit file must reproduce), ``chainCycles`` (chains flagged
    ``cycle``) and ``zeroCalibrationSubdivisions`` (subdivisions with chain but 0 % calibrated).
    """
    by_reason: dict[str, dict[str, int]] = defaultdict(lambda: {"info": 0, "rejected": 0})
    for rec in audit:
        by_reason[rec.reason][rec.severity] += 1
    return {
        "schema": COVERAGE_SCHEMA,
        "province": province,
        "datasetVersion": dataset_version,
        "disclaimer": DISCLAIMER,
        "sources": [
            {"sourceId": s.sourceId, "sha256": s.sha256}
            for s in sorted(sources, key=lambda s: s.sourceId)
        ],
        "totals": _row_json(totals_row(rows, audit)),
        "subdivisions": [_row_json(r) for r in rows],
        "auditByReason": dict(sorted(by_reason.items())),
        "chainCycles": sum(1 for c in chains.chains if c.cycle),
        "zeroCalibrationSubdivisions": sorted(
            r.subdivision_nid for r in rows if r.chain_km > 0 and r.calibrated_km == 0
        ),
    }


def _table_row(r: dict[str, Any], label: str) -> str:
    """One Markdown table line for a JSON row, under ``label``."""
    tiers = r["anchorsByTier"]
    return (
        f"| {label} | {', '.join(r['operators'])} | {r['chainKm']:.3f} | {r['calibratedKm']:.3f} "
        f"| {r['calibratedPct']:.3f} | {r['calibratedKmPostedOnly']:.3f} "
        f"| {tiers['posted']} / {tiers['tc']} / {tiers['unverified']} "
        f"| {sum(r['rejectedByReason'].values())} |"
    )


def render_markdown(report: Mapping[str, Any]) -> str:
    """Render ``report`` (from :func:`build_report`) as Markdown with LF line endings.

    The header names the dataset version and each source SHA-256 and states that this is
    internal coverage, not surveyed accuracy. The table has one row per subdivision and a totals
    row; below it are the rejected-line and info-line counts per audit reason.
    """
    lines = [
        f"# Coverage report: {str(report['province']).upper()}",
        "",
        f"Dataset version: `{report['datasetVersion']}`",
        "",
        *[f"Source `{s['sourceId']}` SHA-256: `{s['sha256']}`" for s in report["sources"]],
        "",
        f"**{report['disclaimer']}** A calibrated interval means published mileposts bracket the "
        "position; it does not mean the interpolated value was compared with a survey.",
        "",
        "| Subdivision | Operators | Chain km | Calibrated km | Calibrated % "
        "| Posted-only km | Anchors posted / tc / unverified | Rejected |",
        "|---|---|---:|---:|---:|---:|---|---:|",
        *[_table_row(r, r["subdivisionName"]) for r in report["subdivisions"]],
        _table_row(report["totals"], "**Total**"),
        "",
        f"Chain cycles: {report['chainCycles']}. "
        f"Subdivisions with 0 % calibration: {len(report['zeroCalibrationSubdivisions'])}.",
        "",
        "## Audit lines by reason",
        "",
        "| Reason | Rejected | Info |",
        "|---|---:|---:|",
        *[
            f"| {reason} | {n['rejected']} | {n['info']} |"
            for reason, n in report["auditByReason"].items()
        ],
        "",
    ]
    return "\n".join(lines)


def write_reports(out_dir: Path, province: str, report: Mapping[str, Any]) -> None:
    """Write ``out_dir/reports/coverage-<province>.json`` (canonical) and ``.md`` (LF)."""
    directory = out_dir / "reports"
    directory.mkdir(parents=True, exist_ok=True)
    (directory / f"coverage-{province}.json").write_bytes(canonical_json(report))
    (directory / f"coverage-{province}.md").write_bytes(render_markdown(report).encode("utf-8"))
