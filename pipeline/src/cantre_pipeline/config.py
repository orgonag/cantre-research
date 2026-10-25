"""Pipeline configuration: every threshold in one frozen dataclass.

Every threshold is EXPERIMENTAL (spec section 5): chosen from inspection of Saskatchewan data,
not validated against ground truth. The manifest records the configuration and its SHA-256 so a
build is reproducible from the raw bytes and this object alone.
"""

import hashlib
import json
from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class PipelineConfig:
    """All pipeline parameters, with units in the field names.

    Attributes:
        snap_deg: Topology snap tolerance for segment endpoints, degrees (1e-7 is about 1 cm).
        coord_scale: Quantisation of stored coordinates, integer units per degree (microdegrees).
        s_scale: Quantisation of along-chain distance, integer units per metre (millimetres).
        anchor_max_residual_m: Largest distance from a point to its chain for it to anchor, m.
        slope_tolerance: Allowed relative deviation of an interval's miles-per-metre slope.
        slope_min_span_m: Slope is tested only when the anchor spacing is at least this, m.
        anchor_collapse_span_m: Equal-mileage anchors this close along s are merged, m.
        mp_equal_tol_mi: Mileposts within this are equal, miles (NRWN resolution is 0.01 mi).
        posting_step_mi: NRWN mileage posting resolution, miles. Two anchors within the collapse
            span conflict only when their spacing leaves a mileage difference larger than this
            (ruling R19).
        tc_max_disagreement_mi: Largest NRWN vs Transport Canada mileage disagreement, miles.
        unverified_max_deviation_mi: Largest deviation of an unverified anchor from its
            interval's interpolation, miles.
        tile_lat_deg: Tile height, degrees of latitude.
        tile_lon_deg: Tile width, degrees of longitude.
        tile_buffer_m: Margin around a tile within which edges and assets are included, metres.
        tile_budget_gzip_bytes: Per-tile size budget after gzip, bytes.
    """

    snap_deg: float = 1e-7
    coord_scale: int = 1_000_000
    s_scale: int = 1000
    anchor_max_residual_m: float = 25.0
    slope_tolerance: float = 0.15
    slope_min_span_m: float = 800.0
    anchor_collapse_span_m: float = 30.0
    mp_equal_tol_mi: float = 0.005
    posting_step_mi: float = 0.01
    tc_max_disagreement_mi: float = 0.05
    unverified_max_deviation_mi: float = 0.05
    tile_lat_deg: float = 0.25
    tile_lon_deg: float = 0.5
    tile_buffer_m: float = 2000.0
    tile_budget_gzip_bytes: int = 500_000


FORMAT_CONSTANTS: frozenset[str] = frozenset({"coord_scale", "s_scale"})
"""Output number-format fields; changing them changes the schema, not a judgement."""

EXPERIMENTAL: frozenset[str] = frozenset(
    name for name in PipelineConfig.__dataclass_fields__ if name not in FORMAT_CONSTANTS
)
"""Names of the threshold fields, all labelled experimental in the manifest."""


def config_json(cfg: PipelineConfig) -> str:
    """Return the canonical JSON of ``cfg``: sorted keys, compact, UTF-8, one trailing newline."""
    return json.dumps(asdict(cfg), sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n"


def config_sha256(cfg: PipelineConfig) -> str:
    """Return the hex SHA-256 of :func:`config_json` encoded as UTF-8."""
    return hashlib.sha256(config_json(cfg).encode("utf-8")).hexdigest()
