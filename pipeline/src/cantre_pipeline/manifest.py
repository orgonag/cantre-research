"""Build and write the build manifest (spec section 5.8).

The manifest ties a build together: dataset and pipeline versions, the configuration and its
SHA-256, the full source records, per-province totals and, for every tile, its SHA-256, size,
gzip size and bounds. It contains no wall-clock time of its own (``retrievedUtc`` is copied from
the committed source records), so the same inputs give the same bytes.
"""

import hashlib
import shutil
from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from cantre_pipeline import __version__
from cantre_pipeline.acquire import SourceRecord
from cantre_pipeline.config import PipelineConfig, config_sha256
from cantre_pipeline.encode import canonical_json, gzip_size
from cantre_pipeline.tiles import ATTRIBUTION, DATASET_VERSION, tile_bounds

__all__ = ["MANIFEST_SCHEMA", "ProvinceTotals", "build_manifest", "write_build"]

MANIFEST_SCHEMA = "cantre.manifest/1"


@dataclass(frozen=True)
class ProvinceTotals:
    """Per-province totals, precomputed by the report stage (Task 9) and copied into the manifest.

    Attributes:
        chain_km: Length of all chains, km.
        calibrated_km: Length of chain inside calibrated intervals (any tier), km.
        calibrated_km_posted_only: The same counting intervals whose anchors are all ``posted``
            tier, km.
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


def _province_json(t: ProvinceTotals) -> dict[str, Any]:
    return {
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
) -> dict[str, Any]:
    """Return the manifest object (``schema: "cantre.manifest/1"``, spec section 5.8).

    ``tiles_bytes`` maps tile key to the exact bytes that will be written
    (:func:`~cantre_pipeline.encode.canonical_json` of the tile), so the recorded SHA-256, size
    and gzip size are those of the files on disk. ``totals`` maps province code to its
    :class:`ProvinceTotals`; a tile's ``provinces`` are the provinces whose ``tiles`` list it.
    Sources are sorted by ``sourceId``, tiles by key.

    Raises:
        ValueError: if a tile in ``tiles_bytes`` is listed by no province in ``totals``.
    """
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
        "datasetVersion": DATASET_VERSION,
        "pipelineVersion": __version__,
        "attribution": ATTRIBUTION,
        "config": asdict(cfg),
        "configSha256": config_sha256(cfg),
        "sources": [_source_json(s) for s in sorted(sources, key=lambda s: s.sourceId)],
        "provinces": {p: _province_json(t) for p, t in sorted(totals.items())},
        "tiles": entries,
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
