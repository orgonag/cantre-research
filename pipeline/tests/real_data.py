"""Shared gate for the tests that need the real Saskatchewan source files.

``CANTRE_RAW_DIR`` names the raw-byte cache filled by ``python -m cantre_pipeline acquire``;
each source is extracted into a ``<sha256>/`` subfolder of it. A test marked with
:data:`needs_real_sk` is skipped, with the reason spelled out, unless the directory exists and
holds both the NRWN Saskatchewan shapefiles and the Transport Canada inventory CSV. (Setting the
variable alone is not enough: CI sets it for the whole job, before the data has been acquired.)
"""

import os
from pathlib import Path

import pytest

__all__ = ["needs_real_sk", "raw_dir", "real_sk_paths"]

_TRACK_GLOB = "NRWN_SK_*_TRACK.shp"
_TC_CSV = "en-grade-crossing-inventory-2023-update.csv"


def raw_dir() -> Path | None:
    """The raw cache directory from ``CANTRE_RAW_DIR``, or ``None`` when unset or empty."""
    value = os.environ.get("CANTRE_RAW_DIR")
    return Path(value) if value else None


def _find(raw: Path) -> tuple[Path | None, Path | None]:
    shp = next((p.parent for p in sorted(raw.glob(f"*/{_TRACK_GLOB}"))), None)
    csv = next(iter(sorted(raw.glob(f"*/{_TC_CSV}"))), None)
    return shp, csv


def _skip_reason() -> str | None:
    raw = raw_dir()
    if raw is None:
        return "CANTRE_RAW_DIR not set (no raw NRWN data)"
    if not raw.is_dir():
        return f"CANTRE_RAW_DIR={raw} does not exist (run `acquire` first)"
    shp, csv = _find(raw)
    if shp is None:
        return f"no <sha256>/{_TRACK_GLOB} under {raw} (run `acquire --source sk`)"
    if csv is None:
        return f"no <sha256>/{_TC_CSV} under {raw} (run `acquire --source tc-gci`)"
    return None


needs_real_sk = pytest.mark.skipif(_skip_reason() is not None, reason=_skip_reason() or "")
"""Skip marker for the tests that read the real SK shapefiles and TC CSV."""


def real_sk_paths() -> tuple[Path, Path]:
    """``(shapefile directory, TC CSV)`` of the acquired data; call only from a gated test."""
    raw = raw_dir()
    assert raw is not None, "gate with needs_real_sk"
    shp, csv = _find(raw)
    assert shp is not None and csv is not None, "gate with needs_real_sk"
    return shp, csv
