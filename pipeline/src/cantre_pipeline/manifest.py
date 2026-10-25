"""Build and write the build manifest (spec section 5.8).

The manifest ties a build together: dataset and pipeline versions, the configuration and its
SHA-256, the full source records, per-province totals and, for every tile, its SHA-256, size,
gzip size and bounds. It contains no wall-clock time of its own (``retrievedUtc`` is copied from
the committed source records), so the same inputs give the same bytes.
"""

import hashlib
import re
import shutil
from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from cantre_pipeline import __version__
from cantre_pipeline.acquire import SourceRecord
from cantre_pipeline.config import PipelineConfig, config_sha256
from cantre_pipeline.encode import canonical_json, gzip_size
from cantre_pipeline.snapshot import FORMAT_VERSION as SNAPSHOT_FORMAT_VERSION
from cantre_pipeline.tiles import ATTRIBUTION, DATASET_VERSION, tile_bounds

__all__ = [
    "MANIFEST_SCHEMA",
    "FileRef",
    "ProvinceTotals",
    "build_manifest",
    "build_national_manifest",
    "national_dataset_version",
    "write_build",
]

MANIFEST_SCHEMA = "cantre.manifest/1"


@dataclass(frozen=True)
class ProvinceTotals:
    """Per-province totals, precomputed by the report stage (Task 9) and copied into the manifest.

    Attributes:
        chain_km: Length of all chains, km.
        calibrated_km: Length of chain inside calibrated intervals (any tier), km.
        calibrated_km_posted_only: Calibrated length with the intervals rebuilt from the
            qualified ``posted`` anchors alone (ruling R17: the output of ``qualify_anchors``
            before any interval step, then the same interval steps), km. It is not the all-tier
            intervals filtered to posted anchors, and it can exceed ``calibrated_km`` when a
            lower-tier anchor breaks an all-tier interval.
        anchors_by_tier: Kept anchors per tier (``posted``, ``tc``, ``unverified``).
        isolated_anchors: Kept anchors that belong to no interval.
        assets_by_kind: Asset count per asset kind.
        tiles: Keys of the tiles that hold this province's data.
    """

    chain_km: float
    calibrated_km: float
    calibrated_km_posted_only: float
    anchors_by_tier: Mapping[str, int]
    isolated_anchors: int
    assets_by_kind: Mapping[str, int]
    tiles: tuple[str, ...]


def national_dataset_version(
    packages: Mapping[str, str], pipeline_version: str, config_sha256_hex: str
) -> str:
    """Return the one dataset version of a national build.

    NRWN provinces carry different package versions, but the matcher rejects tiles whose
    ``datasetVersion`` differs (``MIXED_DATASET_VERSION``), so a national build stamps one string
    on every tile. It names the exact inputs: ``sha8`` is the first 8 hex characters of the
    SHA-256 of a UTF-8 text made of the ``"<province>=<packageSha256>"`` lines, sorted by
    province code, followed by one ``"configSha256=<config_sha256_hex>"`` line, all joined by line
    feeds (no trailing newline). The result is ``nrwn-national-<sha8>+cantre.<pipeline_version>``.

    Args:
        packages: Province code to the SHA-256 (64 hex characters) of its NRWN package.
        pipeline_version: The pipeline's own version. Release rule (pipeline/README.md): any
            change to pipeline code that changes output bytes must bump it, because code changes
            are not hashed here; only the inputs, the configuration and this version are.
        config_sha256_hex: :func:`~cantre_pipeline.config.config_sha256` of the build's
            configuration, so a changed threshold is a new dataset version even when the inputs
            and the pipeline version are unchanged.

    Include the Transport Canada file's hash under the key ``"tc-gci"`` (a national build does):
    it changes the anchors, so a new inventory must be a new dataset version.

    Limits: 8 hex characters (32 bits) identify a build, not authenticate it; the full hashes are
    in the manifest ``sources`` and ``configSha256``. Each province's NRWN version is listed in
    ``provinces[].packageVersion``.

    Raises:
        ValueError: if ``packages`` is empty or a hash is not 64 lower-case hex characters.
    """
    if not packages:
        raise ValueError("national_dataset_version needs at least one package hash")
    for code, digest in [*packages.items(), ("configSha256", config_sha256_hex)]:
        if not re.fullmatch(r"[0-9a-f]{64}", digest):
            raise ValueError(f"hash for {code!r} is not 64 lower-case hex characters")
    lines = [f"{code}={packages[code]}" for code in sorted(packages)]
    lines.append(f"configSha256={config_sha256_hex}")
    sha8 = hashlib.sha256("\n".join(lines).encode("utf-8")).hexdigest()[:8]
    return f"nrwn-national-{sha8}+cantre.{pipeline_version}"


@dataclass(frozen=True)
class FileRef:
    """A published national file as the manifest lists it.

    Attributes:
        path: File name, relative to the manifest.
        sha256: SHA-256 of the file at ``path`` exactly as served (the gzip bytes), so a client
            can reject a damaged or half-downloaded file before decoding it.
        bytes: Size of the decompressed content, bytes.
        gzip_bytes: Size of the file at ``path``, bytes.
    """

    path: str
    sha256: str
    bytes: int
    gzip_bytes: int

    def to_json(self) -> dict[str, Any]:
        """The manifest form: ``{path, sha256, bytes, gzipBytes}``."""
        return {
            "path": self.path,
            "sha256": self.sha256,
            "bytes": self.bytes,
            "gzipBytes": self.gzip_bytes,
        }


def _province_json(t: ProvinceTotals, package_version: str) -> dict[str, Any]:
    return {
        "packageVersion": package_version,
        "chainKm": t.chain_km,
        "calibratedKm": t.calibrated_km,
        "calibratedKmPostedOnly": t.calibrated_km_posted_only,
        "anchorsByTier": dict(sorted(t.anchors_by_tier.items())),
        "isolatedAnchors": t.isolated_anchors,
        "assetsByKind": dict(sorted(t.assets_by_kind.items())),
        "tiles": sorted(t.tiles),
    }


def _source_json(s: SourceRecord) -> dict[str, Any]:
    """The full source record as JSON-ready data (``members`` as a list, not a tuple)."""
    return {**asdict(s), "members": [asdict(m) for m in s.members]}


def build_manifest(
    sources: Sequence[SourceRecord],
    tiles_bytes: Mapping[str, bytes],
    totals: Mapping[str, ProvinceTotals],
    cfg: PipelineConfig,
    dataset_version: str = DATASET_VERSION,
) -> dict[str, Any]:
    """Return the manifest object (``schema: "cantre.manifest/1"``, spec section 5.8).

    ``tiles_bytes`` maps tile key to the exact bytes that will be written
    (:func:`~cantre_pipeline.encode.canonical_json` of the tile), so the recorded SHA-256, size
    and gzip size are those of the files on disk. ``totals`` maps province code to its
    :class:`ProvinceTotals`; a tile's ``provinces`` are the provinces whose ``tiles`` list it.
    Sources are sorted by ``sourceId``, tiles by key. ``dataset_version`` defaults to the
    per-province :data:`~cantre_pipeline.tiles.DATASET_VERSION`; a national build passes
    :func:`national_dataset_version`. Each province's ``packageVersion`` (the NRWN version, e.g.
    ``"2.0"``) is copied from the source record whose ``sourceId`` is the province code.

    Raises:
        ValueError: if a tile in ``tiles_bytes`` is listed by no province in ``totals``, or a
            province in ``totals`` has no source record.
    """
    package_versions = {s.sourceId: s.packageVersion for s in sources}
    for code in totals:
        if code not in package_versions:
            raise ValueError(f"province {code} has no source record")
    entries: list[dict[str, Any]] = []
    for key in sorted(tiles_bytes):
        data = tiles_bytes[key]
        provinces = sorted(p for p, t in totals.items() if key in t.tiles)
        if not provinces:
            raise ValueError(f"tile {key} is listed by no province in the totals")
        b = tile_bounds(key, cfg)
        entries.append(
            {
                "key": key,
                "path": f"tiles/{key}.json",
                "sha256": hashlib.sha256(data).hexdigest(),
                "bytes": len(data),
                "gzipBytes": gzip_size(data),
                "bounds": {"south": b.south, "west": b.west, "north": b.north, "east": b.east},
                "provinces": provinces,
            }
        )
    return {
        "schema": MANIFEST_SCHEMA,
        "datasetVersion": dataset_version,
        "pipelineVersion": __version__,
        "attribution": ATTRIBUTION,
        "config": asdict(cfg),
        "configSha256": config_sha256(cfg),
        "sources": [_source_json(s) for s in sorted(sources, key=lambda s: s.sourceId)],
        "provinces": {p: _province_json(t, package_versions[p]) for p, t in sorted(totals.items())},
        "tiles": entries,
    }


def build_national_manifest(
    province_manifests: Mapping[str, Mapping[str, Any]],
    sources: Sequence[SourceRecord],
    cfg: PipelineConfig,
    dataset_version: str,
    snapshot: FileRef,
    asset_details: FileRef,
    snapshot_date: str,
) -> dict[str, Any]:
    """Return the national manifest (``cantre.manifest/1`` with the national fields set).

    It describes the two files a deployment serves and lists **no tiles** (``"tiles": []``): the
    per-province builds make tiles and check their size, but only the snapshot and the asset
    details are published. ``province_manifests`` maps province code to the manifest its
    :func:`~cantre_pipeline.build.build_province` returned; each province's totals entry is copied
    from it. ``snapshot_date`` is ``YYYY-MM-DD`` (see :mod:`cantre_pipeline.national`).

    ``snapshotFormat`` is the snapshot's byte-layout version
    (:data:`~cantre_pipeline.snapshot.FORMAT_VERSION`, schema/snapshot.md), so a client can see
    that it cannot decode a build before it downloads anything.
    """
    return {
        "schema": MANIFEST_SCHEMA,
        "datasetVersion": dataset_version,
        "pipelineVersion": __version__,
        "attribution": ATTRIBUTION,
        "config": asdict(cfg),
        "configSha256": config_sha256(cfg),
        "sources": [_source_json(s) for s in sorted(sources, key=lambda s: s.sourceId)],
        "provinces": {p: m["provinces"][p] for p, m in sorted(province_manifests.items())},
        "tiles": [],
        "snapshot": snapshot.to_json(),
        "snapshotFormat": SNAPSHOT_FORMAT_VERSION,
        "assetDetails": asset_details.to_json(),
        "snapshotDate": snapshot_date,
    }


def write_build(
    out_dir: Path, tiles_bytes: Mapping[str, bytes], manifest: Mapping[str, Any]
) -> None:
    """Write ``out_dir/tiles/<key>.json`` and ``out_dir/manifest.json`` as given/canonical bytes.

    The ``tiles`` directory is replaced (not merged) so a smaller build leaves no stale
    tile behind. Files are written as bytes, so line endings are LF on every platform.
    """
    tiles_dir = out_dir / "tiles"
    if tiles_dir.exists():
        shutil.rmtree(tiles_dir)
    tiles_dir.mkdir(parents=True)
    for key, data in tiles_bytes.items():
        (tiles_dir / f"{key}.json").write_bytes(data)
    (out_dir / "manifest.json").write_bytes(canonical_json(manifest))
