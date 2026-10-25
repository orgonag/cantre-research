"""Build the national snapshot: every province, merged, with one dataset version (M4 Task 2).

The stages, in order:

1. **One dataset version** for the whole build, from the SHA-256 of every province package and of
   the Transport Canada file (:func:`~cantre_pipeline.manifest.national_dataset_version`). The
   matcher refuses tiles whose versions differ, so every tile and the snapshot carry this one
   string; each province's own NRWN version stays in ``provinces[].packageVersion``.
2. **Each province** goes through :func:`~cantre_pipeline.build.build_province` unchanged, with
   that version. Its tree (tiles, audit, coverage report) is written under
   ``<out>/build/<province>/``. The tiles are built and size-checked there but not published.
3. **Merge**: the province's tiles are folded into one network by
   :class:`~cantre_pipeline.snapshot.NetworkMerger`, province by province. NRWN clips every
   province at its border, so chains from two provinces are never joined: a train crossing a
   border changes chain, and nothing here bridges the cut (Review Focus 1).
4. **Write** ``snapshot.bin.gz``, ``asset-details.json.gz`` and ``manifest.json`` into ``<out>``.
   Both data files must be at most :data:`MAX_FILE_BYTES` (the GitHub Pages per-file limit), else
   the build stops with ``SIZE_GATE`` and writes none of the three.

``snapshotDate`` (``YYYY-MM-DD``) names the vintage of the data. It is the UTC date of the latest
``retrievedUtc`` among the source records the build used, or the date given to the caller. It is
never the wall clock, so the same inputs always give the same bytes and the date changes only when
a source is deliberately re-acquired (decision D8).
"""

import re
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date
from hashlib import sha256
from pathlib import Path
from typing import Any

from cantre_pipeline import __version__
from cantre_pipeline.acquire import SourceRecord
from cantre_pipeline.build import build_province
from cantre_pipeline.config import PipelineConfig
from cantre_pipeline.encode import canonical_json
from cantre_pipeline.errors import PipelineError
from cantre_pipeline.manifest import FileRef, build_national_manifest, national_dataset_version
from cantre_pipeline.snapshot import (
    NetworkMerger,
    ProvinceCounts,
    encode_asset_details,
    encode_snapshot,
    gzip_bytes,
)
from cantre_pipeline.tiles import ATTRIBUTION

__all__ = [
    "MAX_FILE_BYTES",
    "NationalResult",
    "ProvinceInput",
    "build_national",
    "check_snapshot_date",
]

MAX_FILE_BYTES = 100_000_000
"""Largest allowed size of a published national file, bytes. GitHub Pages refuses single files
over 100 MB; the check is on the gzip file, the one that is served."""

SNAPSHOT_FILE = "snapshot.bin.gz"
DETAILS_FILE = "asset-details.json.gz"
MANIFEST_FILE = "manifest.json"
"""The three files of a national build, written directly under the output directory."""


@dataclass(frozen=True)
class ProvinceInput:
    """One province's inputs: its code, the extracted NRWN package and its provenance record.

    Attributes:
        code: Lower-case province code; must equal ``record.sourceId``.
        nrwn_dir: Directory holding the extracted ``NRWN_<PR>_*`` files.
        record: The NRWN source record (hash, retrieval time, package version).
    """

    code: str
    nrwn_dir: Path
    record: SourceRecord


@dataclass(frozen=True)
class NationalResult:
    """What :func:`build_national` produced.

    Attributes:
        manifest: The national manifest that was written.
        dataset_version: The one version stamped on every tile and the snapshot.
        snapshot_date: ``YYYY-MM-DD``.
        counts: Per province, what its own tiles hold (see
            :class:`~cantre_pipeline.snapshot.ProvinceCounts`).
        totals: National counts after shared ids are de-duplicated.
        snapshot_bytes: Decompressed snapshot size, bytes.
        snapshot_gzip_bytes: Size of ``snapshot.bin.gz``, bytes.
        details_bytes: Decompressed asset-details size, bytes.
        details_gzip_bytes: Size of ``asset-details.json.gz``, bytes.
        over_budget: ``(province, tile key, gzip bytes)`` of tiles above the per-tile budget.
    """

    manifest: dict[str, Any]
    dataset_version: str
    snapshot_date: str
    counts: dict[str, ProvinceCounts]
    totals: ProvinceCounts
    snapshot_bytes: int
    snapshot_gzip_bytes: int
    details_bytes: int
    details_gzip_bytes: int
    over_budget: list[tuple[str, str, int]]


def check_snapshot_date(text: str) -> str:
    """Return ``text`` if it is a real calendar date written ``YYYY-MM-DD``.

    Raises:
        ValueError: otherwise.
    """
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        raise ValueError(f"snapshot date {text!r} is not YYYY-MM-DD")
    try:
        date.fromisoformat(text)
    except ValueError as exc:
        raise ValueError(f"snapshot date {text!r} is not a real date") from exc
    return text


def _file_ref(name: str, raw: bytes, packed: bytes) -> FileRef:
    return FileRef(name, sha256(packed).hexdigest(), len(raw), len(packed))


def build_national(
    inputs: Sequence[ProvinceInput],
    tc_csv: Path,
    tc_record: SourceRecord,
    out_dir: Path,
    cfg: PipelineConfig,
    *,
    snapshot_date: str | None = None,
    max_file_bytes: int | None = None,
) -> NationalResult:
    """Build every province in ``inputs``, merge them and write the national files.

    Args:
        inputs: The provinces to merge (codes unique).
        tc_csv: The Transport Canada inventory CSV, shared by every province.
        tc_record: Its source record.
        out_dir: Output directory (created). The three national files go directly in it and each
            province's build tree under ``build/<province>/``.
        cfg: Pipeline configuration.
        snapshot_date: ``YYYY-MM-DD`` override; by default the latest ``retrievedUtc`` date.
        max_file_bytes: Size limit per published file; defaults to :data:`MAX_FILE_BYTES`
            (read at call time).

    Raises:
        ValueError: on empty or duplicate ``inputs``, a record that does not match its code, or a
            bad date.
        PipelineError: from any province build, ``MERGE_CONFLICT`` from the merge, or
            ``SIZE_GATE`` when a file is too large (nothing is written then).
    """
    limit = MAX_FILE_BYTES if max_file_bytes is None else max_file_bytes
    if not inputs:
        raise ValueError("a national build needs at least one province")
    codes = [p.code for p in inputs]
    if len(set(codes)) != len(codes):
        raise ValueError("a province code was given twice")
    for p in inputs:
        if p.record.sourceId != p.code:
            raise ValueError(
                f"province {p.code} was given the source record of {p.record.sourceId}"
            )
    records = [*(p.record for p in inputs), tc_record]
    date_text = (
        check_snapshot_date(snapshot_date)
        if snapshot_date is not None
        else check_snapshot_date(max(r.retrievedUtc for r in records)[:10])
    )
    version = national_dataset_version(
        {**{p.code: p.record.sha256 for p in inputs}, tc_record.sourceId: tc_record.sha256},
        __version__,
    )

    out_dir.mkdir(parents=True, exist_ok=True)
    for stale in (SNAPSHOT_FILE, DETAILS_FILE, MANIFEST_FILE):
        (out_dir / stale).unlink(missing_ok=True)  # a failed rebuild must not leave old files
    net = NetworkMerger()
    counts: dict[str, ProvinceCounts] = {}
    manifests: dict[str, dict[str, Any]] = {}
    over: list[tuple[str, str, int]] = []
    for p in sorted(inputs, key=lambda p: p.code):
        built = build_province(
            p.code,
            p.nrwn_dir,
            tc_csv,
            [p.record, tc_record],
            out_dir / "build" / p.code,
            cfg,
            version,
        )
        counts[p.code] = net.add_tiles(p.code, built.tiles)
        manifests[p.code] = built.manifest
        over += [(p.code, key, size) for key, size in built.over_budget]
        del built  # the tiles are merged; free them before the next province
    if net.dataset_version != version:
        raise PipelineError(
            "MERGE_CONFLICT", f"merged tiles carry {net.dataset_version!r}, expected {version!r}"
        )

    snapshot_raw = encode_snapshot(
        net,
        snapshot_date=date_text,
        attribution=ATTRIBUTION,
        package_versions={p.code: p.record.packageVersion for p in inputs},
    )
    snapshot_gz = gzip_bytes(snapshot_raw)
    details_raw = encode_asset_details(net)
    details_gz = gzip_bytes(details_raw)
    for name, packed in ((SNAPSHOT_FILE, snapshot_gz), (DETAILS_FILE, details_gz)):
        if len(packed) > limit:
            raise PipelineError(
                "SIZE_GATE", f"{name} is {len(packed):,} bytes, which exceeds {limit:,} bytes"
            )

    manifest = build_national_manifest(
        manifests,
        records,
        cfg,
        version,
        _file_ref(SNAPSHOT_FILE, snapshot_raw, snapshot_gz),
        _file_ref(DETAILS_FILE, details_raw, details_gz),
        date_text,
    )
    (out_dir / SNAPSHOT_FILE).write_bytes(snapshot_gz)
    (out_dir / DETAILS_FILE).write_bytes(details_gz)
    (out_dir / MANIFEST_FILE).write_bytes(canonical_json(manifest))
    return NationalResult(
        manifest,
        version,
        date_text,
        counts,
        net.totals(),
        len(snapshot_raw),
        len(snapshot_gz),
        len(details_raw),
        len(details_gz),
        over,
    )
