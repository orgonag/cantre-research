"""Run every pipeline stage for one province and write the output tree (spec section 5).

The stages run in this order, each a pure function over the previous one's result:
``load_network`` -> ``build_chains`` -> ``qualify_anchors`` -> ``build_intervals`` (per chain) ->
``extract_assets`` -> ``build_tiles`` -> coverage report -> manifest. Only this module and the
writers touch the disk.

Output tree under ``out_dir`` (ruling: nothing outside it is written)::

    manifest.json
    tiles/<key>.json
    audit/<pr>.jsonl            every stage's audit lines, one canonical JSON object per line
    reports/coverage-<pr>.json  and  coverage-<pr>.md

Transport Canada rows that occur twice are audited (``TC_DUPLICATE_NUMBER``, ruling R8) and the
de-duplicated rows go to anchor qualification and asset extraction.
"""

from collections import Counter, defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from cantre_pipeline.acquire import SourceRecord
from cantre_pipeline.anchors import QualifiedAnchor, qualify_anchors
from cantre_pipeline.assets import extract_assets
from cantre_pipeline.audit import AuditRecord, write_audit_jsonl
from cantre_pipeline.chains import build_chains
from cantre_pipeline.config import PipelineConfig
from cantre_pipeline.encode import canonical_json, gzip_size
from cantre_pipeline.intervals import Interval, build_intervals, isolated_anchors
from cantre_pipeline.manifest import ProvinceTotals, build_manifest, write_build
from cantre_pipeline.model import LineFeature, Network, PointFeature
from cantre_pipeline.reader import read_tc_inventory_full, tc_duplicate_audit
from cantre_pipeline.report import (
    CoverageRow,
    build_report,
    coverage_rows,
    totals_row,
    write_reports,
)
from cantre_pipeline.tiles import DATASET_VERSION, build_tiles
from cantre_pipeline.validate import load_network

__all__ = ["BuildResult", "build_province"]


@dataclass(frozen=True)
class BuildResult:
    """What :func:`build_province` produced.

    Attributes:
        manifest: The manifest object that was written.
        rows: Per-subdivision coverage rows (without the totals row).
        totals: The province totals row.
        over_budget: ``(tile key, gzip bytes)`` of every tile above ``tile_budget_gzip_bytes``.
        gzip_bytes: Gzip size of every tile by key.
        audit_lines: Number of audit lines written.
        tiles: The tile objects by key, as written (a national build merges them).
    """

    manifest: dict[str, Any]
    rows: list[CoverageRow]
    totals: CoverageRow
    over_budget: list[tuple[str, int]]
    gzip_bytes: dict[str, int]
    audit_lines: int
    tiles: dict[str, dict[str, Any]]


def _attribution(
    net: Network, chains_sub: dict[str, str], anchors: Sequence[QualifiedAnchor]
) -> dict[tuple[str, str], str]:
    """Map ``(audit layer, nid)`` to a subdivision NID where the record has exactly one.

    Network features carry ``SUBDI1NID``; ``CHAIN`` lines are keyed by chain id and ``ANCHOR``
    lines by anchor id (through the anchor's chain). Keys that map to two subdivisions are left
    out, so their lines count toward the totals row only.
    """
    seen: dict[tuple[str, str], set[str]] = defaultdict(set)
    features: list[PointFeature | LineFeature] = [
        *net.crossings,
        *net.stations,
        *net.markerposts,
        *net.structures_pt,
        *net.structures_ln,
    ]
    for f in features:
        seen[(f.layer, f.nid)].add(f.sub_nid)
    for s in net.segments:
        seen[("TRACK", s.nid)].add(s.sub_nid)
    for chain_id, sub in chains_sub.items():
        seen[("CHAIN", chain_id)].add(sub)
    for a in anchors:
        seen[("ANCHOR", a.id)].add(chains_sub[a.chain_id])
    return {k: next(iter(v)) for k, v in seen.items() if len(v) == 1 and "" not in v}


def build_province(
    province: str,
    nrwn_dir: Path,
    tc_csv: Path,
    sources: Sequence[SourceRecord],
    out_dir: Path,
    cfg: PipelineConfig,
    dataset_version: str = DATASET_VERSION,
) -> BuildResult:
    """Build ``province`` from the NRWN files in ``nrwn_dir`` and the TC inventory ``tc_csv``.

    ``province`` is the lower-case code. ``sources`` are the provenance records copied into the
    manifest and report. Writes the tree in the module doc into ``out_dir`` (the ``tiles``
    directory is replaced). ``dataset_version`` is stamped on every tile, the manifest and the
    report; it defaults to the per-province version and a national build overrides it. The same
    inputs give byte-identical output: no wall-clock time is written and every collection is
    sorted before it is serialised.

    Raises:
        PipelineError: from the reader on schema drift or a CRS mismatch.
    """
    net = load_network(nrwn_dir, province, cfg)
    chains = build_chains(net, cfg)
    inventory = read_tc_inventory_full(tc_csv, province.upper())
    tc_rows = inventory.rows  # repeated TC numbers are already excluded (ruling R8)

    qualified, anchor_audit = qualify_anchors(net, chains, tc_rows, cfg)
    by_chain: dict[str, list[QualifiedAnchor]] = defaultdict(list)
    for a in qualified:
        by_chain[a.chain_id].append(a)
    intervals: list[Interval] = []
    kept: list[QualifiedAnchor] = []
    interval_audit: list[AuditRecord] = []
    for chain in chains.chains:
        ivs, chain_kept, chain_audit = build_intervals(chain, by_chain[chain.id], cfg)
        intervals += ivs
        kept += chain_kept
        interval_audit += chain_audit
    assets, asset_audit = extract_assets(net, chains, intervals, kept, tc_rows, cfg)
    tiles = build_tiles(
        province, chains, net.segments, kept, intervals, assets, cfg, dataset_version
    )

    audit = [
        *net.audit,
        *chains.audit,
        *anchor_audit,
        *interval_audit,
        *asset_audit,
        *tc_duplicate_audit(inventory),
    ]
    sub_of = _attribution(net, {c.id: c.sub_nid for c in chains.chains}, qualified)
    rows = coverage_rows(
        chains,
        intervals,
        kept,
        audit,
        cfg,
        sub_of=sub_of,
        qualified_posted=[a for a in qualified if a.tier == "posted"],
    )
    total = totals_row(rows, audit)
    report = build_report(province, rows, audit, chains, sources, dataset_version)

    tiles_bytes = {key: canonical_json(tile) for key, tile in tiles.items()}
    totals = {
        province: ProvinceTotals(
            chain_km=total.chain_km,
            calibrated_km=total.calibrated_km,
            calibrated_km_posted_only=total.calibrated_km_posted_only,
            anchors_by_tier={str(k): v for k, v in total.anchors_by_tier.items()},
            isolated_anchors=len(isolated_anchors(kept, intervals)),
            assets_by_kind=dict(Counter(a.kind for a in assets)),
            tiles=tuple(sorted(tiles_bytes)),
        )
    }
    manifest = build_manifest(sources, tiles_bytes, totals, cfg, dataset_version)
    write_build(out_dir, tiles_bytes, manifest)
    write_audit_jsonl(out_dir / "audit" / f"{province}.jsonl", audit)
    write_reports(out_dir, province, report)

    sizes = {key: gzip_size(data) for key, data in tiles_bytes.items()}
    over = sorted((k, n) for k, n in sizes.items() if n > cfg.tile_budget_gzip_bytes)
    return BuildResult(manifest, rows, total, over, sizes, len(audit), tiles)
