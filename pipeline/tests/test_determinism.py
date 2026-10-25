"""Determinism and the committed synthetic golden build (Review Focus 1, Task 9)."""

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest
from jsonschema import Draft202012Validator  # type: ignore[import-untyped]

from fixtures.synthetic import build_synthetic, tree_sha256

PIPELINE = Path(__file__).resolve().parents[1]
GOLDEN_DIR = PIPELINE / "tests" / "golden" / "synthetic"
SCRIPT = PIPELINE / "scripts" / "make_golden.py"


def json_of(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def test_synthetic_build_matches_committed_golden(tmp_path: Path) -> None:
    build_synthetic(tmp_path)
    assert tree_sha256(tmp_path) == tree_sha256(GOLDEN_DIR)


def test_build_is_byte_identical_across_runs_and_hash_seeds(tmp_path: Path) -> None:
    env = {**os.environ, "PYTHONPATH": str(PIPELINE / "src")}
    hashes = []
    for seed in ("0", "12345"):
        out = tmp_path / f"seed{seed}"
        env["PYTHONHASHSEED"] = seed
        subprocess.run([sys.executable, str(SCRIPT), str(out)], env=env, check=True)  # noqa: S603
        hashes.append(tree_sha256(out))
    assert hashes[0] == hashes[1] == tree_sha256(GOLDEN_DIR)


@pytest.mark.parametrize("seed", [1, 2, 3])
def test_shuffled_records_and_reversed_lines_give_the_same_bytes(tmp_path: Path, seed: int) -> None:
    build_synthetic(tmp_path, shuffle_seed=seed)
    assert tree_sha256(tmp_path) == tree_sha256(GOLDEN_DIR)


def test_golden_paths_are_short_enough_for_windows_checkouts() -> None:
    longest = max(len(p.relative_to(PIPELINE.parent).as_posix()) for p in GOLDEN_DIR.rglob("*"))
    assert longest <= 70  # repo-relative; a deep checkout still stays under MAX_PATH (260)


def test_golden_validates_against_the_published_schemas() -> None:
    schemas = PIPELINE / "schema"
    tile = Draft202012Validator(json_of(schemas / "tile.schema.json"))
    manifest = Draft202012Validator(json_of(schemas / "manifest.schema.json"))
    manifest.validate(json_of(GOLDEN_DIR / "manifest.json"))
    tiles = sorted((GOLDEN_DIR / "tiles").glob("*.json"))
    assert len(tiles) == 16
    for path in tiles:
        tile.validate(json_of(path))


def test_golden_holds_every_scenario() -> None:
    lines = (GOLDEN_DIR / "audit" / "sk.jsonl").read_text(encoding="utf-8").splitlines()
    reasons = {json.loads(line)["reason"] for line in lines}
    assert reasons >= {
        "ANCHOR_CONFLICT",
        "ANCHOR_MERGED",
        "ANCHOR_OUTLIER",
        "UNVERIFIED_DEVIATION",
        "SOURCE_DISAGREEMENT",
        "TC_SPUR_CROSSING",
        "TC_DUPLICATE_NUMBER",
        "POSTED_SENTINEL",
        "MILEAGE_SENTINEL",
        "SUBDIVISION_MISMATCH",
        "RESIDUAL_TOO_LARGE",
        "TRACK_NOT_CHAINED",
        "NOT_CHAINED_CLASS",
        "CHAIN_CYCLE",
    }
    tiles = {p.stem: json_of(p) for p in (GOLDEN_DIR / "tiles").glob("*.json")}
    # A chain crossing the tile edge appears in both tiles.
    west, east = tiles["208_-213"], tiles["208_-212"]
    assert {c["id"] for c in west["chains"]} & {c["id"] for c in east["chains"]}
    tiers = {a["tier"] for t in tiles.values() for a in t["anchors"]}
    assert tiers == {"posted", "tc", "unverified"}
    kinds = {a["kind"] for t in tiles.values() for a in t["assets"]}
    assert kinds >= {"crossing", "bridge", "culvert", "diamond", "station"}
    mp_by_id = {a["id"]: a["mp"] for t in tiles.values() for a in t["anchors"]}
    decreasing = [
        iv
        for t in tiles.values()
        for iv in t["intervals"]
        if mp_by_id[iv["anchorIds"][0]] > mp_by_id[iv["anchorIds"][-1]]
    ]
    assert decreasing  # mileage running against the chain direction is one valid interval
