"""Tests for cantre_pipeline.config and cantre_pipeline.errors."""

import dataclasses
import importlib
import json

import pytest

import cantre_pipeline.config as config_module
from cantre_pipeline import __version__
from cantre_pipeline.config import (
    EXPERIMENTAL,
    FORMAT_CONSTANTS,
    PipelineConfig,
    config_json,
    config_sha256,
)
from cantre_pipeline.errors import PipelineError


def test_version() -> None:
    assert __version__ == "0.1.0"


def test_config_sha256_is_stable_and_sensitive() -> None:
    before = config_sha256(PipelineConfig())
    assert len(before) == 64
    reloaded = importlib.reload(config_module)
    assert reloaded.config_sha256(reloaded.PipelineConfig()) == before
    assert config_sha256(PipelineConfig(slope_tolerance=0.16)) != before


def test_experimental_covers_every_threshold_field() -> None:
    fields = {f.name for f in dataclasses.fields(PipelineConfig)}
    assert fields == EXPERIMENTAL | FORMAT_CONSTANTS
    assert not EXPERIMENTAL & FORMAT_CONSTANTS
    assert {"anchor_max_residual_m", "slope_tolerance", "mp_equal_tol_mi"} <= EXPERIMENTAL


def test_config_json_is_canonical() -> None:
    text = config_json(PipelineConfig())
    assert text.endswith("\n") and " " not in text
    keys = list(json.loads(text).keys())
    assert keys == sorted(keys)
    canonical = json.dumps(json.loads(text), sort_keys=True, separators=(",", ":"))
    assert text == canonical + "\n"


def test_config_defaults_and_frozen() -> None:
    cfg = PipelineConfig()
    assert (cfg.snap_deg, cfg.coord_scale, cfg.s_scale) == (1e-7, 1_000_000, 1000)
    assert cfg.tile_budget_gzip_bytes == 500_000
    with pytest.raises(dataclasses.FrozenInstanceError):
        cfg.snap_deg = 1.0  # type: ignore[misc]


def test_pipeline_error_carries_code() -> None:
    err = PipelineError("HASH_MISMATCH", "bad hash")
    assert err.code == "HASH_MISMATCH" and str(err) == "bad hash"
