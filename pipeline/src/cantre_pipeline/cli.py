"""Command-line entry point: ``python -m cantre_pipeline <command>``.

Commands:

* ``acquire --source ID [--record]``: fetch a source (a province code or ``tc-gci``) and verify
  its hash against ``pipeline/sources/<id>.json``, or measure and rewrite that file.
* ``build --province PR --out DIR [--raw DIR] [--check-budget]``: acquire (verify mode) the
  province package and ``tc-gci``, run every stage and write the output tree described in
  :mod:`cantre_pipeline.build`. A cached copy that differs from the committed hash fails with
  ``HASH_MISMATCH`` before anything is built.
* ``national --out DIR [--raw DIR] [--snapshot-date YYYY-MM-DD] [--check-budget]``: do the same
  for every registered province, merge them into one network with one dataset version and write
  ``snapshot.bin.gz``, ``asset-details.json.gz`` and ``manifest.json`` directly in ``DIR``
  (layout: ``pipeline/schema/snapshot.md``). Each province's own build tree goes under
  ``DIR/build/<province>/``; its tiles are size-checked but are not part of the deployment. A
  file over 100 MB stops the build with ``SIZE_GATE``.

Exit codes: 0 success, 2 a :class:`~cantre_pipeline.errors.PipelineError` (or a bad option),
3 ``--check-budget`` found a tile over ``tile_budget_gzip_bytes`` (the output is still written).
"""

import argparse
import os
import sys
import time
from collections.abc import Sequence
from pathlib import Path

from cantre_pipeline.acquire import acquire
from cantre_pipeline.build import build_province
from cantre_pipeline.config import PipelineConfig
from cantre_pipeline.errors import PipelineError
from cantre_pipeline.national import ProvinceInput, build_national, check_snapshot_date
from cantre_pipeline.provinces import PROVINCES

REPO_ROOT = Path(__file__).resolve().parents[3]
SOURCES_DIR = REPO_ROOT / "pipeline" / "sources"
"""Committed provenance files, one ``<id>.json`` per source."""

CONFIG = PipelineConfig()
"""The configuration every ``build`` uses (read at call time, so tests can substitute it)."""

TC_SOURCE = "tc-gci"
"""Source id of the Transport Canada Grade Crossings Inventory, used by every ``build``."""


def raw_dir() -> Path:
    """Return the raw-byte cache: ``$CANTRE_RAW_DIR`` or ``<repo>/.cache/raw`` (git-ignored)."""
    override = os.environ.get("CANTRE_RAW_DIR")
    return Path(override) if override else REPO_ROOT / ".cache" / "raw"


def _tc_csv(directory: Path) -> Path:
    """Return the single CSV in the acquired ``tc-gci`` directory."""
    found = sorted(directory.glob("*.csv"))
    if len(found) != 1:
        raise PipelineError(
            "INCOMPLETE_EXTRACTION", f"expected one CSV in {directory}, found {len(found)}"
        )
    return found[0]


def _build(args: argparse.Namespace, sources_dir: Path) -> int:
    """Run the ``build`` command; see the module docstring for the exit codes."""
    started = time.perf_counter()
    province = str(args.province).lower()
    cache: Path = args.raw if args.raw is not None else raw_dir()
    cache.mkdir(parents=True, exist_ok=True)
    nrwn_rec, nrwn_dir = acquire(province, cache_dir=cache, sources_dir=sources_dir)
    tc_rec, tc_dir = acquire(TC_SOURCE, cache_dir=cache, sources_dir=sources_dir)
    result = build_province(
        province, nrwn_dir, _tc_csv(tc_dir), [nrwn_rec, tc_rec], args.out, CONFIG
    )
    total = result.totals
    print(
        f"built {province}: {len(result.gzip_bytes)} tiles, "
        f"max gzip {max(result.gzip_bytes.values(), default=0)} bytes, "
        f"chain {total.chain_km} km, calibrated {total.calibrated_km} km "
        f"({total.calibrated_pct} %), {result.audit_lines} audit lines, "
        f"{time.perf_counter() - started:.1f} s -> {args.out}"
    )
    if args.check_budget and result.over_budget:
        for key, size in result.over_budget:
            print(
                f"OVER_BUDGET: tile {key} is {size} bytes gzip, "
                f"budget {CONFIG.tile_budget_gzip_bytes}",
                file=sys.stderr,
            )
        return 3
    return 0


def _national(args: argparse.Namespace, sources_dir: Path) -> int:
    """Run the ``national`` command; see the module docstring for the exit codes."""
    started = time.perf_counter()
    cache: Path = args.raw if args.raw is not None else raw_dir()
    cache.mkdir(parents=True, exist_ok=True)
    inputs: list[ProvinceInput] = []
    for code in sorted(PROVINCES):
        rec, directory = acquire(code, cache_dir=cache, sources_dir=sources_dir)
        inputs.append(ProvinceInput(code, directory, rec))
    tc_rec, tc_dir = acquire(TC_SOURCE, cache_dir=cache, sources_dir=sources_dir)
    result = build_national(
        inputs, _tc_csv(tc_dir), tc_rec, args.out, CONFIG, snapshot_date=args.snapshot_date
    )
    print(
        f"built national: {len(inputs)} provinces, dataset {result.dataset_version}, "
        f"snapshot date {result.snapshot_date}, {time.perf_counter() - started:.1f} s -> {args.out}"
    )
    for code, c in sorted(result.counts.items()):
        print(
            f"  {code}: {c.chains} chains, {c.vertices} vertices, {c.segments} segments, "
            f"{c.anchors} anchors, {c.intervals} intervals, {c.assets} assets"
        )
    t = result.totals
    print(
        f"  national: {t.chains} chains, {t.vertices} vertices, {t.segments} segments, "
        f"{t.anchors} anchors, {t.intervals} intervals, {t.assets} assets"
    )
    print(f"  snapshot.bin.gz: {result.snapshot_bytes} bytes, {result.snapshot_gzip_bytes} gzip")
    print(
        f"  asset-details.json.gz: {result.details_bytes} bytes, {result.details_gzip_bytes} gzip"
    )
    if args.check_budget and result.over_budget:
        for code, key, size in result.over_budget:
            print(
                f"OVER_BUDGET: {code} tile {key} is {size} bytes gzip, "
                f"budget {CONFIG.tile_budget_gzip_bytes}",
                file=sys.stderr,
            )
        return 3
    return 0


def _iso_date(text: str) -> str:
    """Argparse type: a real ``YYYY-MM-DD`` date."""
    try:
        return check_snapshot_date(text)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(str(exc)) from exc


def main(argv: Sequence[str] | None = None, *, sources_dir: Path | None = None) -> int:
    """Run the CLI and return the process exit code (0 ok, 2 on a ``PipelineError``, 3 budget)."""
    parser = argparse.ArgumentParser(prog="cantre_pipeline")
    commands = parser.add_subparsers(dest="command", required=True)
    acq = commands.add_parser("acquire", help="download a source and verify or record its hash")
    acq.add_argument(
        "--source",
        "--province",
        dest="source_id",
        required=True,
        help="source id: a province code such as 'sk', or 'tc-gci' (--province is an alias)",
    )
    acq.add_argument(
        "--record",
        action="store_true",
        help="measure provenance and rewrite sources/<id>.json instead of verifying it",
    )
    bld = commands.add_parser("build", help="build tiles, manifest, audit and coverage report")
    bld.add_argument("--province", required=True, help="province code, e.g. 'sk'")
    bld.add_argument("--out", required=True, type=Path, help="output directory")
    bld.add_argument("--raw", type=Path, default=None, help="raw cache (default: $CANTRE_RAW_DIR)")
    bld.add_argument(
        "--check-budget",
        action="store_true",
        help="exit 3 when a tile exceeds tile_budget_gzip_bytes",
    )
    nat = commands.add_parser(
        "national", help="build every province and merge them into one national snapshot"
    )
    nat.add_argument("--out", required=True, type=Path, help="output directory")
    nat.add_argument("--raw", type=Path, default=None, help="raw cache (default: $CANTRE_RAW_DIR)")
    nat.add_argument(
        "--snapshot-date",
        type=_iso_date,
        default=None,
        help="YYYY-MM-DD (default: the latest retrievedUtc among the source records)",
    )
    nat.add_argument(
        "--check-budget",
        action="store_true",
        help="exit 3 when a tile exceeds tile_budget_gzip_bytes",
    )
    args = parser.parse_args(argv)
    sources = SOURCES_DIR if sources_dir is None else sources_dir  # read at call time
    try:
        if args.command == "build":
            return _build(args, sources)
        if args.command == "national":
            return _national(args, sources)
        rec, directory = acquire(
            args.source_id, cache_dir=raw_dir(), sources_dir=sources, record=args.record
        )
    except PipelineError as exc:
        print(f"{exc.code}: {exc}", file=sys.stderr)
        return 2
    print(f"{rec.sourceId} sha256={rec.sha256} bytes={rec.contentLength} dir={directory}")
    return 0
