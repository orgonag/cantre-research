"""Tests for cantre_pipeline.manifest and the JSON Schemas (Task 8)."""

import hashlib
import json
import os
import subprocess
import sys
from dataclasses import replace
from pathlib import Path
from typing import Any

import pytest
from jsonschema import Draft202012Validator  # type: ignore[import-untyped]

from cantre_pipeline import __version__
from cantre_pipeline.acquire import Member, SourceRecord
from cantre_pipeline.config import config_sha256
from cantre_pipeline.encode import canonical_json, gzip_size
from cantre_pipeline.manifest import ProvinceTotals, build_manifest, write_build
from cantre_pipeline.tiles import ATTRIBUTION, DATASET_VERSION, tile_bounds
from pipeline_run import CFG, Run, run, straddling_fixture

SCHEMA_DIR = Path(__file__).resolve().parents[1] / "schema"


def validator(name: str) -> Draft202012Validator:
    schema = json.loads((SCHEMA_DIR / name).read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


SOURCE = SourceRecord(
    sourceId="sk",
    kind="zip",
    url="https://example.invalid/sk.zip",
    publisher="Natural Resources Canada",
    catalogueUrl="https://example.invalid/cat",
    licenceName="Open Government Licence - Canada",
    licenceUrl="https://example.invalid/ogl",
    httpLastModified="Thu, 25 Jul 2019 00:03:12 GMT",
    contentLength=10,
    sha256="a" * 64,
    retrievedUtc="2026-10-24T00:00:00Z",
    packageVersion="2.0",
    crsWkt="GEOGCS[]",
    metadataMember="m.xml",
    members=(Member("a.shp", 3, "b" * 64),),
)
TC_SOURCE = SourceRecord(
    "tc-gci", "file", "u", "Transport Canada", "c", "n", "l", None, 5, "c" * 64,
    "2026-10-24T00:00:00Z", "2023", None, None, (),
)  # fmt: skip


def totals_for(tiles: dict[str, Any]) -> dict[str, ProvinceTotals]:
    return {
        "sk": ProvinceTotals(
            chain_km=12.5,
            calibrated_km=10.25,
            calibrated_km_posted_only=9.0,
            anchors_by_tier={"posted": 4, "tc": 0, "unverified": 0},
            isolated_anchors=1,
            assets_by_kind={"crossing": 4},
            tiles=tuple(sorted(tiles)),
        )
    }


@pytest.fixture
def built(tmp_path: Path) -> tuple[Run, dict[str, bytes], dict[str, Any]]:
    r = run(straddling_fixture(tmp_path))
    tb = {k: canonical_json(t) for k, t in r.tiles.items()}
    m = build_manifest([TC_SOURCE, SOURCE], tb, totals_for(r.tiles), CFG)
    return r, tb, m


def test_tiles_and_manifest_validate_against_json_schema(
    built: tuple[Run, dict[str, bytes], dict[str, Any]],
) -> None:
    r, _, manifest = built
    tv = validator("tile.schema.json")
    for tile in r.tiles.values():
        assert sorted(tv.iter_errors(json.loads(canonical_json(tile))), key=str) == []
    assert sorted(validator("manifest.schema.json").iter_errors(manifest), key=str) == []


def test_schema_rejects_bad_tile_and_manifest(
    built: tuple[Run, dict[str, bytes], dict[str, Any]],
) -> None:
    r, _, manifest = built
    tv, mv = validator("tile.schema.json"), validator("manifest.schema.json")
    bad = json.loads(canonical_json(r.tiles["208_-213"]))
    bad["anchors"][0]["tier"] = "guess"
    assert not tv.is_valid(bad)
    bad = json.loads(canonical_json(r.tiles["208_-213"]))
    bad["chains"][0]["latE6"][0] = 52.1
    assert not tv.is_valid(bad)
    bad = json.loads(canonical_json(r.tiles["208_-213"]))
    bad["extra"] = 1
    assert not tv.is_valid(bad)
    broken = json.loads(json.dumps(manifest))
    del broken["configSha256"]
    assert not mv.is_valid(broken)


def test_manifest_fields(built: tuple[Run, dict[str, bytes], dict[str, Any]]) -> None:
    _, tb, m = built
    assert m["schema"] == "cantre.manifest/1"
    assert m["datasetVersion"] == DATASET_VERSION == f"nrwn-2.0+cantre.{__version__}"
    assert m["pipelineVersion"] == __version__ and m["attribution"] == ATTRIBUTION
    assert m["configSha256"] == config_sha256(CFG) and m["config"]["tile_lat_deg"] == 0.25
    assert [s["sourceId"] for s in m["sources"]] == ["sk", "tc-gci"]
    assert m["sources"][0]["members"] == [{"name": "a.shp", "size": 3, "sha256": "b" * 64}]
    sk = m["provinces"]["sk"]
    assert sk["chainKm"] == 12.5 and sk["calibratedKmPostedOnly"] == 9.0
    assert sk["anchorsByTier"]["posted"] == 4 and sk["isolatedAnchors"] == 1
    assert sk["assetsByKind"] == {"crossing": 4} and sk["tiles"] == sorted(tb)
    entry = next(t for t in m["tiles"] if t["key"] == "208_-213")
    assert entry["path"] == "tiles/208_-213.json" and entry["provinces"] == ["sk"]
    b = tile_bounds("208_-213", CFG)
    assert entry["bounds"] == {"south": b.south, "west": b.west, "north": b.north, "east": b.east}
    assert [t["key"] for t in m["tiles"]] == sorted(tb)


def test_manifest_hashes_match_written_bytes(
    built: tuple[Run, dict[str, bytes], dict[str, Any]], tmp_path: Path
) -> None:
    _, tb, m = built
    out = tmp_path / "build"
    write_build(out, tb, m)
    for t in m["tiles"]:
        data = (out / t["path"]).read_bytes()
        assert hashlib.sha256(data).hexdigest() == t["sha256"]
        assert len(data) == t["bytes"] and gzip_size(data) == t["gzipBytes"]
        assert b"\r" not in data and data.endswith(b"\n")
    on_disk = (out / "manifest.json").read_bytes()
    assert on_disk == canonical_json(m) and json.loads(on_disk) == m


def test_write_build_removes_stale_tiles(
    built: tuple[Run, dict[str, bytes], dict[str, Any]], tmp_path: Path
) -> None:
    _, tb, m = built
    out = tmp_path / "build"
    (out / "tiles").mkdir(parents=True)
    (out / "tiles" / "999_999.json").write_bytes(b"{}\n")
    write_build(out, tb, m)
    assert sorted(p.name for p in (out / "tiles").iterdir()) == sorted(f"{k}.json" for k in tb)


def test_tile_provinces_come_from_the_totals(
    built: tuple[Run, dict[str, bytes], dict[str, Any]],
) -> None:
    r, tb, _ = built
    two = {
        "sk": totals_for(r.tiles)["sk"],
        "ab": ProvinceTotals(0.0, 0.0, 0.0, {}, 0, {}, ("208_-213",)),
    }
    m = build_manifest([SOURCE, replace(SOURCE, sourceId="ab")], tb, two, CFG)
    by_key = {t["key"]: t["provinces"] for t in m["tiles"]}
    assert by_key["208_-213"] == ["ab", "sk"] and by_key["208_-212"] == ["sk"]


def test_manifest_rejects_tile_without_province(
    built: tuple[Run, dict[str, bytes], dict[str, Any]],
) -> None:
    r, tb, _ = built
    t = totals_for(r.tiles)
    t["sk"] = ProvinceTotals(1.0, 1.0, 1.0, {}, 0, {}, ("208_-213",))
    with pytest.raises(ValueError, match="no province"):
        build_manifest([SOURCE], tb, t, CFG)


def test_build_bytes_stable_across_hash_seeds(tmp_path: Path) -> None:
    code = (
        "import hashlib, sys, tempfile\n"
        "from pathlib import Path\n"
        "from pipeline_run import run, straddling_fixture\n"
        "from cantre_pipeline.encode import canonical_json\n"
        "r = run(straddling_fixture(Path(tempfile.mkdtemp())))\n"
        "h = hashlib.sha256()\n"
        "for k in sorted(r.tiles): h.update(canonical_json(r.tiles[k]))\n"
        "print(h.hexdigest())\n"
    )
    here = Path(__file__).resolve().parent
    paths = os.pathsep.join([str(here), str(here.parent / "src")])
    outs = []
    for seed in ("1", "2"):
        env = {**os.environ, "PYTHONHASHSEED": seed, "PYTHONPATH": paths}
        res = subprocess.run(  # noqa: S603 - fixed argv, our own interpreter
            [sys.executable, "-c", code], env=env, capture_output=True, check=True, text=True
        )
        outs.append(res.stdout.strip())
    assert outs[0] == outs[1] and len(outs[0]) == 64


def test_province_package_version_and_dataset_version_override(
    built: tuple[Run, dict[str, bytes], dict[str, Any]],
) -> None:
    r, tb, m = built
    assert m["provinces"]["sk"]["packageVersion"] == SOURCE.packageVersion
    national = build_manifest([SOURCE], tb, totals_for(r.tiles), CFG, "nrwn-national-00000000+x")
    assert national["datasetVersion"] == "nrwn-national-00000000+x"


def test_manifest_rejects_province_without_source(
    built: tuple[Run, dict[str, bytes], dict[str, Any]],
) -> None:
    r, tb, _ = built
    with pytest.raises(ValueError, match="no source record"):
        build_manifest([TC_SOURCE], tb, totals_for(r.tiles), CFG)
