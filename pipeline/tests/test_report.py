"""Tests for cantre_pipeline.report: coverage rows, totals and the JSON and Markdown files."""

import json
from collections import Counter
from pathlib import Path
from typing import Any

import pytest

from cantre_pipeline.chains import ChainSet
from cantre_pipeline.config import PipelineConfig
from cantre_pipeline.report import (
    build_report,
    coverage_rows,
    render_markdown,
    totals_row,
)
from fixtures.synthetic import SYNTHETIC_SOURCES, build_synthetic


@pytest.fixture(scope="module")
def built(tmp_path_factory: pytest.TempPathFactory) -> Path:
    out = tmp_path_factory.mktemp("synthetic")
    build_synthetic(out)
    return out


def load(built: Path, name: str) -> Any:
    return json.loads((built / name).read_text(encoding="utf-8"))


def audit_lines(built: Path) -> list[dict[str, str]]:
    text = (built / "audit" / "sk.jsonl").read_text(encoding="utf-8")
    return [json.loads(line) for line in text.splitlines()]


def by_name(report: Any) -> dict[str, Any]:
    return {r["subdivisionName"]: r for r in report["subdivisions"]}


def test_every_audit_reason_in_report_matches_audit_file(built: Path) -> None:
    report = load(built, "reports/coverage-sk.json")
    lines = audit_lines(built)
    expected: dict[str, dict[str, int]] = {}
    for line in lines:
        expected.setdefault(line["reason"], {"info": 0, "rejected": 0})[line["severity"]] += 1
    assert report["auditByReason"] == expected
    rejected = Counter(line["reason"] for line in lines if line["severity"] == "rejected")
    assert report["totals"]["rejectedByReason"] == dict(rejected)
    # Rows claim only the lines they can place; none may claim more than the audit holds.
    claimed: Counter[str] = Counter()
    for row in report["subdivisions"]:
        claimed.update(row["rejectedByReason"])
    assert all(claimed[r] <= n for r, n in rejected.items())
    assert sum(claimed.values()) > 0


def test_calibrated_km_never_exceeds_chain_km(built: Path) -> None:
    report = load(built, "reports/coverage-sk.json")
    for row in [*report["subdivisions"], report["totals"]]:
        assert 0 <= row["calibratedKm"] <= row["chainKm"]
        assert 0 <= row["calibratedKmPostedOnly"] <= row["chainKm"]
        assert 0 <= row["calibratedPct"] <= 100


def test_posted_only_coverage_shows_what_the_extra_tiers_add(built: Path) -> None:
    rows = by_name(load(built, "reports/coverage-sk.json"))
    # Iota has one posted anchor and one TC anchor: no interval exists without the TC tier.
    assert rows["Iota"]["calibratedKmPostedOnly"] == 0
    assert rows["Iota"]["calibratedKm"] > 0
    assert rows["Iota"]["anchorsByTier"] == {"posted": 1, "tc": 1, "unverified": 0}
    # Gamma has only posted anchors, so both figures agree.
    assert rows["Gamma"]["calibratedKm"] == rows["Gamma"]["calibratedKmPostedOnly"] > 0


def test_scenario_coverage_figures(built: Path) -> None:
    report = load(built, "reports/coverage-sk.json")
    rows = by_name(report)
    assert rows["Eta"]["calibratedKm"] == 0  # the loop has a single anchor
    assert report["zeroCalibrationSubdivisions"] == ["S7"]
    assert report["chainCycles"] == 1
    assert rows["Beta"]["calibratedPct"] == 75.0  # the reset leaves 9 of 12 steps calibrated
    assert rows["Alpha"]["anchorsBySource"]["markerpost"] == 1
    assert rows["Alpha"]["rejectedByReason"]["ANCHOR_CONFLICT"] == 2
    totals = report["totals"]
    assert totals["chainKm"] == pytest.approx(sum(r["chainKm"] for r in rows.values()), abs=1e-5)
    manifest = load(built, "manifest.json")["provinces"]["sk"]
    assert manifest["chainKm"] == totals["chainKm"]
    assert manifest["calibratedKm"] == totals["calibratedKm"]
    assert manifest["calibratedKmPostedOnly"] == totals["calibratedKmPostedOnly"]
    assert manifest["anchorsByTier"] == totals["anchorsByTier"]


def test_markdown_states_version_source_hashes_and_the_coverage_disclaimer(built: Path) -> None:
    report = load(built, "reports/coverage-sk.json")
    text = (built / "reports" / "coverage-sk.md").read_text(encoding="utf-8")
    assert text == render_markdown(report)
    assert f"Dataset version: `{report['datasetVersion']}`" in text
    for source in SYNTHETIC_SOURCES:
        assert f"`{source.sourceId}` SHA-256: `{source.sha256}`" in text
    assert "not surveyed accuracy" in text
    assert "| **Total** |" in text
    assert "\r" not in text and text.endswith("\n")
    assert "| ANCHOR_CONFLICT | 2 | 0 |" in text


def test_empty_province_has_no_rows_and_a_zero_percent_total() -> None:
    chains = ChainSet(chains=(), unchained=(), node_junctions={}, audit=())
    assert coverage_rows(chains, [], [], [], PipelineConfig()) == []
    total = totals_row([], [])
    assert (total.chain_km, total.calibrated_pct, dict(total.rejected_by_reason)) == (0.0, 0.0, {})
    report = build_report("sk", [], [], chains, SYNTHETIC_SOURCES, "v")
    assert report["subdivisions"] == [] and report["zeroCalibrationSubdivisions"] == []


def test_unverified_bridge_does_not_evict_a_posted_anchor(built: Path) -> None:
    """Ruling R18: KX (posted) is kept although unverified KM1-KM2 would bridge it away."""
    report = load(built, "reports/coverage-sk.json")
    kappa = by_name(report)["Kappa"]
    lines = audit_lines(built)
    assert not [
        line for line in lines if line["reason"] == "ANCHOR_OUTLIER" and line["nid"] == "KX"
    ]
    assert any(line["nid"] == "KM1" and line["reason"] == "UNVERIFIED_DEVIATION" for line in lines)
    assert kappa["anchorsByTier"] == {"posted": 2, "tc": 0, "unverified": 1}  # K0, KX, KM2
    assert kappa["calibratedKm"] == pytest.approx(2.951, abs=0.002)  # K0 to KX
    assert kappa["calibratedKmPostedOnly"] == kappa["calibratedKm"]


def test_posted_only_exceeds_all_tier_when_a_lower_tier_anchor_breaks_the_interval(
    built: Path,
) -> None:
    """Ruling R17: the TC anchor LT is 0.5 mi off; posted-only rebuilds L0-LX in one piece."""
    lambda_ = by_name(load(built, "reports/coverage-sk.json"))["Lambda"]
    assert lambda_["anchorsByTier"] == {"posted": 2, "tc": 1, "unverified": 0}
    assert lambda_["calibratedKmPostedOnly"] == pytest.approx(5.221, abs=0.002)
    assert lambda_["calibratedKm"] == pytest.approx(0.653, abs=0.002)  # only L0-LT survives
