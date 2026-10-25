"""Tests for the one national dataset version (M4 Task 1, Review Focus 2)."""

import hashlib
import re

from cantre_pipeline import __version__
from cantre_pipeline.manifest import national_dataset_version

HASHES = {"sk": "a" * 64, "ab": "b" * 64, "bc": "c" * 64}


def test_format_and_value() -> None:
    lines = "\n".join(f"{p}={h}" for p, h in sorted(HASHES.items()))
    sha8 = hashlib.sha256(lines.encode("utf-8")).hexdigest()[:8]
    v = national_dataset_version(HASHES, __version__)
    assert v == f"nrwn-national-{sha8}+cantre.{__version__}"
    assert re.fullmatch(r"nrwn-national-[0-9a-f]{8}\+cantre\..+", v)


def test_national_version_stable_and_order_free() -> None:
    forward = national_dataset_version(HASHES, "0.1.0")
    backward = national_dataset_version(dict(reversed(list(HASHES.items()))), "0.1.0")
    assert forward == backward
    changed = {**HASHES, "ab": "d" * 64}
    assert national_dataset_version(changed, "0.1.0") != forward


def test_pipeline_version_and_province_set_matter() -> None:
    base = national_dataset_version(HASHES, "0.1.0")
    assert national_dataset_version(HASHES, "0.2.0") != base
    assert national_dataset_version({"sk": HASHES["sk"]}, "0.1.0") != base
