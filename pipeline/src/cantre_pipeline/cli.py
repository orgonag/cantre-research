"""Command-line entry point: ``python -m cantre_pipeline <command>``.

Only ``acquire`` exists so far; the ``build`` command is added with the full pipeline.
"""

import argparse
import os
import sys
from collections.abc import Sequence
from pathlib import Path

from cantre_pipeline.acquire import acquire
from cantre_pipeline.errors import PipelineError

REPO_ROOT = Path(__file__).resolve().parents[3]
SOURCES_DIR = REPO_ROOT / "pipeline" / "sources"
"""Committed provenance files, one ``<id>.json`` per source."""


def raw_dir() -> Path:
    """Return the raw-byte cache: ``$CANTRE_RAW_DIR`` or ``<repo>/.cache/raw`` (git-ignored)."""
    override = os.environ.get("CANTRE_RAW_DIR")
    return Path(override) if override else REPO_ROOT / ".cache" / "raw"


def main(argv: Sequence[str] | None = None) -> int:
    """Run the CLI and return the process exit code (0 ok, 2 on a ``PipelineError``)."""
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
    args = parser.parse_args(argv)
    try:
        rec, directory = acquire(
            args.source_id, cache_dir=raw_dir(), sources_dir=SOURCES_DIR, record=args.record
        )
    except PipelineError as exc:
        print(f"{exc.code}: {exc}", file=sys.stderr)
        return 2
    print(f"{rec.sourceId} sha256={rec.sha256} bytes={rec.contentLength} dir={directory}")
    return 0
