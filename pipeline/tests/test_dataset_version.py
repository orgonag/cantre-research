"""Tests for the one national dataset version (M4 Task 1, Review Focus 2; final fix wave 5)."""

import hashlib
import re

import pytest

from cantre_pipeline import __version__
from cantre_pipeline.config import PipelineConfig, config_sha256
from cantre_pipeline.manifest import national_dataset_version

HASHES = {"sk": "a" * 64, "ab": "b" * 64, "bc": "c" * 64}
CFG = "e" * 64


def test_format_and_value() -> None:
    lines = [f"{p}={h}" for p, h in sorted(HASHES.items())] + [f"configSha256={CFG}"]
    sha8 = hashlib.sha256("\n".join(lines).encode("utf-8")).hexdigest()[:8]
    v = national_dataset_version(HASHES, __version__, CFG)
    assert v == f"nrwn-national-{sha8}+cantre.{__version__}"
    assert re.fullmatch(r"nrwn-national-[0-9a-f]{8}\+cantre\..+", v)


def test_national_version_stable_and_order_free() -> None:
    forward = national_dataset_version(HASHES, "0.1.0", CFG)
    backward = national_dataset_version(dict(reversed(list(HASHES.items()))), "0.1.0", CFG)
    assert forward == backward
    changed = {**HASHES, "ab": "d" * 64}
    assert national_dataset_version(changed, "0.1.0", CFG) != forward


def test_pipeline_version_and_province_set_matter() -> None:
    base = national_dataset_version(HASHES, "0.1.0", CFG)
    assert national_dataset_version(HASHES, "0.2.0", CFG) != base
    assert national_dataset_version({"sk": HASHES["sk"]}, "0.1.0", CFG) != base


def test_configuration_matters() -> None:
    """A changed threshold with the same inputs and pipeline version is a new dataset version."""
    default = config_sha256(PipelineConfig())
    changed = config_sha256(PipelineConfig(slope_tolerance=0.16))
    assert default != changed
    assert national_dataset_version(HASHES, "0.1.0", default) != national_dataset_version(
        HASHES, "0.1.0", changed
    )


def test_empty_mapping_is_refused() -> None:
    with pytest.raises(ValueError, match="at least one"):
        national_dataset_version({}, "0.1.0", CFG)


@pytest.mark.parametrize(
    "bad", ["", "a" * 63, "a" * 65, "A" * 64, "g" * 64, " " + "a" * 63, "a" * 64 + "\n"]
)
def test_hash_must_be_64_lower_case_hex(bad: str) -> None:
    with pytest.raises(ValueError, match="64 lower-case hex"):
        national_dataset_version({"sk": HASHES["sk"], "ab": bad}, "0.1.0", CFG)
    with pytest.raises(ValueError, match="'configSha256' is not 64 lower-case hex"):
        national_dataset_version(HASHES, "0.1.0", bad)
