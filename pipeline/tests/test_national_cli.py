"""Tests for the ``national`` command and ``build_national`` (M4 Task 2).

Two fake provinces, ``sk`` (the whole synthetic network) and ``ab`` (a line that starts exactly
where an ``sk`` line ends), stand in for the real ones. Nothing here reads NRWN data.
"""

import copy
import gzip
import hashlib
import json
import os
import zipfile
from dataclasses import asdict, replace
from pathlib import Path
from typing import Any

import pytest
from jsonschema import Draft202012Validator  # type: ignore[import-untyped]

from cantre_pipeline import __version__, cli, national, snapshot
from cantre_pipeline.acquire import SourceRecord, _members_of, write_source
from cantre_pipeline.config import PipelineConfig, config_sha256
from cantre_pipeline.errors import PipelineError
from cantre_pipeline.manifest import national_dataset_version
from cantre_pipeline.national import ProvinceInput, build_national
from cantre_pipeline.snapshot import read_snapshot
from fixtures.synthetic import (
    NATIONAL_SOURCES,
    SYNTHETIC_SOURCES,
    build_synthetic_national,
    national_fixtures,
    national_inputs,
)

PIPELINE = Path(__file__).resolve().parents[1]
SCHEMA = json.loads((PIPELINE / "schema" / "manifest.schema.json").read_text(encoding="utf-8"))
GOLDEN_NATIONAL = PIPELINE / "tests" / "golden" / "synthetic" / "national"
BORDER = (52_100_000, -105_900_000)  # latE6, lonE6 of the point where the fake provinces meet


def read_long(path: Path) -> bytes:
    """Read a file even when a deep checkout pushes its path past Windows' 260 characters."""
    return Path("\\\\?\\" + str(path)).read_bytes() if os.name == "nt" else path.read_bytes()


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def fake_national_cache(root: Path) -> tuple[Path, Path]:
    """Return ``(cache dir, sources dir)`` for the two fake provinces and the TC file."""
    fixtures = national_fixtures(root / "fx")
    cache, sources = root / "cache", root / "sources"
    cache.mkdir(parents=True)
    for code, fx in fixtures.items():
        shp = fx.write()
        tmp_zip = cache / "tmp.zip"
        with zipfile.ZipFile(tmp_zip, "w") as zf:
            for member in sorted(shp.iterdir()):
                # A fixed timestamp: zip's own mtime field would make the package hash (and so
                # the dataset version) depend on when the test ran.
                info = zipfile.ZipInfo(member.name, date_time=(2026, 1, 1, 0, 0, 0))
                zf.writestr(info, member.read_bytes())
        digest = sha256(tmp_zip)
        tmp_zip.rename(cache / f"{digest}.zip")
        write_source(
            sources,
            replace(
                NATIONAL_SOURCES[code],
                sha256=digest,
                contentLength=(cache / f"{digest}.zip").stat().st_size,
                members=_members_of(shp),
            ),
        )
    tc = fixtures["sk"].tc_path
    tc_sha = sha256(tc)
    (cache / f"{tc_sha}.bin").write_bytes(tc.read_bytes())
    write_source(
        sources,
        SourceRecord(
            **{**asdict(SYNTHETIC_SOURCES[1]), "sha256": tc_sha, "contentLength": tc.stat().st_size}
        ),
    )
    return cache, sources


@pytest.fixture
def two_provinces(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(cli, "PROVINCES", {"ab": "x", "sk": "x"})


def run_national(
    tmp_path: Path, *extra: str, out_name: str = "out"
) -> tuple[int, Path, Path, Path]:
    cache, sources = fake_national_cache(tmp_path / "in")
    out = tmp_path / out_name
    code = cli.main(
        ["national", "--out", str(out), "--raw", str(cache), *extra], sources_dir=sources
    )
    return code, out, cache, sources


def load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


@pytest.mark.usefixtures("two_provinces")
def test_national_writes_snapshot_details_and_manifest(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    code, out, _, _ = run_national(tmp_path)
    assert code == 0
    assert sorted(p.name for p in out.iterdir() if p.is_file()) == [
        "asset-details.json.gz",
        "manifest.json",
        "snapshot.bin.gz",
    ]
    said = capsys.readouterr().out
    assert "built national: 2 provinces" in said
    assert "ab:" in said
    assert "sk:" in said

    manifest = load(out / "manifest.json")
    Draft202012Validator(SCHEMA).validate(manifest)
    assert manifest["tiles"] == []  # tiles are built and size-checked, not deployed
    assert sorted(manifest["provinces"]) == ["ab", "sk"]
    assert manifest["provinces"]["ab"]["packageVersion"] == "synthetic-ab"
    assert manifest["provinces"]["sk"]["packageVersion"] == "synthetic"

    # One national version, derived from the package hashes (and the TC file's) and the config.
    source = {s["sourceId"]: s["sha256"] for s in manifest["sources"]}
    assert sorted(source) == ["ab", "sk", "tc-gci"]
    assert manifest["configSha256"] == config_sha256(PipelineConfig())
    expected = national_dataset_version(source, __version__, manifest["configSha256"])
    assert manifest["datasetVersion"] == expected
    # The snapshot's byte-layout version, so a client can refuse a format before downloading.
    assert manifest["snapshotFormat"] == snapshot.FORMAT_VERSION

    for name, field in (("snapshot.bin.gz", "snapshot"), ("asset-details.json.gz", "assetDetails")):
        ref = manifest[field]
        raw = (out / name).read_bytes()
        assert ref["path"] == name
        assert ref["sha256"] == hashlib.sha256(raw).hexdigest()  # hash of the file as served
        assert ref["gzipBytes"] == len(raw)
        assert ref["bytes"] == len(gzip.decompress(raw))
    snap = read_snapshot((out / "snapshot.bin.gz").read_bytes())
    assert snap.meta["datasetVersion"] == expected
    assert snap.meta["packageVersions"] == {"ab": "synthetic-ab", "sk": "synthetic"}
    assert snap.meta["snapshotDate"] == manifest["snapshotDate"] == "2026-01-02"
    details = json.loads(gzip.decompress((out / "asset-details.json.gz").read_bytes()))
    assert sorted(details) == sorted(a["id"] for a in snap.assets)

    # Every tile written for the size check carries the national version too.
    for pr in ("ab", "sk"):
        tiles = sorted((out / "build" / pr / "tiles").glob("*.json"))
        assert tiles
        assert {load(t)["datasetVersion"] for t in tiles} == {expected}


@pytest.mark.usefixtures("two_provinces")
def test_border_not_bridged(tmp_path: Path) -> None:
    code, out, _, _ = run_national(tmp_path)
    assert code == 0
    snap = read_snapshot((out / "snapshot.bin.gz").read_bytes())
    ends_here = [c for c in snap.chains if (c["latE6"][-1], c["lonE6"][-1]) == BORDER]
    starts_here = [c for c in snap.chains if (c["latE6"][0], c["lonE6"][0]) == BORDER]
    assert len(ends_here) == 1
    assert len(starts_here) == 1
    west, east = ends_here[0], starts_here[0]
    assert west["id"] != east["id"]  # two chains in one snapshot
    assert west["subdivisionNid"] != east["subdivisionNid"]
    # Neither reaches into the other: the west chain stops at the border and the east one starts
    # there with its own along-chain distance, so nothing was joined or renumbered.
    assert max(west["lonE6"]) == BORDER[1]
    assert min(east["lonE6"]) == BORDER[1]
    assert east["sMm"][0] == 0
    assert west["sMm"][0] == 0
    assert all(
        v not in zip(east["latE6"], east["lonE6"], strict=True)
        for v in list(zip(west["latE6"], west["lonE6"], strict=True))[:-1]
    )
    # Intervals and anchors stay on their own side.
    own: dict[str, set[str]] = {west["id"]: set(), east["id"]: set()}
    for iv in snap.intervals:
        if iv["chainId"] in own:
            own[iv["chainId"]].update(iv["anchorIds"])
    anchor_chain = {(a["chainId"], a["id"]) for a in snap.anchors}
    assert all((cid, aid) in anchor_chain for cid, ids in own.items() for aid in ids)
    # Both tiles that cover the border cell are one coverage cell.
    cells = snap.meta["coverage"]
    assert len(cells) == len({tuple(c) for c in cells})


@pytest.mark.usefixtures("two_provinces")
def test_per_province_counts_are_printed_and_consistent(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    code, out, _, _ = run_national(tmp_path)
    assert code == 0
    snap = read_snapshot((out / "snapshot.bin.gz").read_bytes())
    said = capsys.readouterr().out
    sk_line = next(line for line in said.splitlines() if line.startswith("  sk:"))
    ab_line = next(line for line in said.splitlines() if line.startswith("  ab:"))
    assert "chains" in sk_line
    assert "vertices" in sk_line
    assert "anchors" in sk_line
    assert "assets" in sk_line
    total_chains = len(snap.chains)
    n_sk = int(sk_line.split("chains")[0].split()[-1])
    n_ab = int(ab_line.split("chains")[0].split()[-1])
    assert n_sk + n_ab == total_chains


@pytest.mark.usefixtures("two_provinces")
def test_snapshot_date_is_the_latest_retrieval_and_can_be_overridden(tmp_path: Path) -> None:
    _, out, _, _ = run_national(tmp_path)
    assert load(out / "manifest.json")["snapshotDate"] == "2026-01-02"
    _, out2, _, _ = run_national(tmp_path / "again", "--snapshot-date", "2027-03-04")
    assert load(out2 / "manifest.json")["snapshotDate"] == "2027-03-04"
    snap = read_snapshot((out2 / "snapshot.bin.gz").read_bytes())
    assert snap.meta["snapshotDate"] == "2027-03-04"


@pytest.mark.usefixtures("two_provinces")
@pytest.mark.parametrize("bad", ["2027-13-01", "yesterday", "2027-3-4", ""])
def test_snapshot_date_must_be_a_real_iso_date(tmp_path: Path, bad: str) -> None:
    cache, sources = fake_national_cache(tmp_path / "in")
    with pytest.raises(SystemExit) as exit_info:
        cli.main(
            ["national", "--out", str(tmp_path / "o"), "--raw", str(cache), "--snapshot-date", bad],
            sources_dir=sources,
        )
    assert exit_info.value.code == 2
    assert not (tmp_path / "o").exists()


@pytest.mark.usefixtures("two_provinces")
def test_national_is_byte_identical_across_runs(tmp_path: Path) -> None:
    _, one, _, _ = run_national(tmp_path / "a")
    _, two, _, _ = run_national(tmp_path / "b")
    for name in ("snapshot.bin.gz", "asset-details.json.gz", "manifest.json"):
        assert (one / name).read_bytes() == (two / name).read_bytes(), name


@pytest.mark.usefixtures("two_provinces")
def test_rerun_into_the_same_directory_replaces_the_files(tmp_path: Path) -> None:
    cache, sources = fake_national_cache(tmp_path / "in")
    argv = ["national", "--out", str(tmp_path / "o"), "--raw", str(cache)]
    assert cli.main(argv, sources_dir=sources) == 0
    first = (tmp_path / "o" / "snapshot.bin.gz").read_bytes()
    assert cli.main(argv, sources_dir=sources) == 0
    assert (tmp_path / "o" / "snapshot.bin.gz").read_bytes() == first


def test_size_gate(tmp_path: Path) -> None:
    inputs, tc_csv, tc_record = national_inputs(tmp_path / "fx")
    ok_dir = tmp_path / "ok"
    ok = build_national(inputs, tc_csv, tc_record, ok_dir, PipelineConfig())
    biggest = max(ok.snapshot_gzip_bytes, ok.details_gzip_bytes)

    # Exactly at the limit passes; one byte over fails, loudly, and writes no final file.
    build_national(
        inputs, tc_csv, tc_record, tmp_path / "at", PipelineConfig(), max_file_bytes=biggest
    )
    over = tmp_path / "over"
    with pytest.raises(PipelineError, match="exceeds") as err:
        build_national(
            inputs, tc_csv, tc_record, over, PipelineConfig(), max_file_bytes=biggest - 1
        )
    assert err.value.code == "SIZE_GATE"
    assert "100,000,000" not in str(err.value)
    for name in ("snapshot.bin.gz", "asset-details.json.gz", "manifest.json"):
        assert not (over / name).exists()


def test_a_changed_configuration_is_a_new_dataset_version(tmp_path: Path) -> None:
    """Final fix wave 5: same inputs and pipeline version, one threshold changed."""
    inputs, tc_csv, tc_record = national_inputs(tmp_path / "fx")
    base = build_national(inputs, tc_csv, tc_record, tmp_path / "a", PipelineConfig())
    tuned = build_national(
        inputs, tc_csv, tc_record, tmp_path / "b", PipelineConfig(slope_tolerance=0.16)
    )
    assert base.dataset_version != tuned.dataset_version
    assert base.manifest["configSha256"] != tuned.manifest["configSha256"]


def test_size_gate_default_is_the_pages_limit() -> None:
    assert national.MAX_FILE_BYTES == 100_000_000


@pytest.mark.usefixtures("two_provinces")
def test_size_gate_through_the_cli(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(national, "MAX_FILE_BYTES", 100)
    code, out, _, _ = run_national(tmp_path)
    assert code == 2
    assert "SIZE_GATE" in capsys.readouterr().err
    assert not (out / "snapshot.bin.gz").exists()


@pytest.mark.usefixtures("two_provinces")
def test_check_budget_exits_3_but_still_writes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(cli, "CONFIG", PipelineConfig(tile_budget_gzip_bytes=1))
    code, out, _, _ = run_national(tmp_path, "--check-budget")
    assert code == 3
    assert "OVER_BUDGET" in capsys.readouterr().err
    assert (out / "snapshot.bin.gz").is_file()
    plain, _, _, _ = run_national(tmp_path / "plain")
    assert plain == 0  # without the flag the same overrun is not an error


@pytest.mark.usefixtures("two_provinces")
def test_a_hash_mismatch_stops_the_national_build(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    cache, sources = fake_national_cache(tmp_path / "in")
    record = load(sources / "ab.json")
    (cache / f"{record['sha256']}.zip").write_bytes(b"not the package")
    code = cli.main(
        ["national", "--out", str(tmp_path / "o"), "--raw", str(cache)], sources_dir=sources
    )
    assert code == 2
    assert "HASH_MISMATCH" in capsys.readouterr().err
    assert not (tmp_path / "o" / "snapshot.bin.gz").exists()


def test_build_national_rejects_misuse(tmp_path: Path) -> None:
    inputs, tc_csv, tc_record = national_inputs(tmp_path / "fx")
    cfg = PipelineConfig()
    with pytest.raises(ValueError, match="at least one"):
        build_national([], tc_csv, tc_record, tmp_path / "o", cfg)
    with pytest.raises(ValueError, match="twice"):
        build_national([inputs[0], inputs[0]], tc_csv, tc_record, tmp_path / "o", cfg)
    wrong = ProvinceInput("ab", inputs[0].nrwn_dir, inputs[1].record)
    with pytest.raises(ValueError, match="source record"):
        build_national([wrong], tc_csv, tc_record, tmp_path / "o", cfg)
    with pytest.raises(ValueError, match="snapshot date"):
        build_national(inputs, tc_csv, tc_record, tmp_path / "o", cfg, snapshot_date="2027-1-1")


def test_a_province_conflict_stops_the_build(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A second province that carries the first one's asset id with different bytes."""
    inputs, tc_csv, tc_record = national_inputs(tmp_path / "fx")
    real = snapshot.NetworkMerger.add_tiles
    first: list[tuple[str, dict[str, Any]]] = []

    def tampered(self: Any, province: str, tiles: dict[str, Any]) -> Any:
        assets = [a for t in tiles.values() for a in t["assets"]]
        if not first:
            first.append((province, copy.deepcopy(assets[0])))
        else:
            twin = {**first[0][1], "name": "changed"}
            next(iter(tiles.values()))["assets"].append(twin)
        return real(self, province, tiles)

    monkeypatch.setattr(snapshot.NetworkMerger, "add_tiles", tampered)
    with pytest.raises(PipelineError) as err:
        build_national(inputs, tc_csv, tc_record, tmp_path / "diff", PipelineConfig())
    assert err.value.code == "MERGE_CONFLICT"
    assert first[0][1]["id"] in str(err.value)
    assert "ab and sk" in str(err.value)
    assert not (tmp_path / "diff" / "snapshot.bin.gz").exists()


def test_golden_national_bundle_matches_a_fresh_build(tmp_path: Path) -> None:
    build_synthetic_national(tmp_path)
    for name in ("manifest.json", "snapshot.bin.gz", "asset-details.json.gz"):
        assert (tmp_path / name).read_bytes() == read_long(GOLDEN_NATIONAL / name), name
    assert sorted(p.name for p in tmp_path.iterdir()) == [
        "asset-details.json.gz",
        "manifest.json",
        "snapshot.bin.gz",
    ]


def test_golden_national_bundle_is_valid_and_small() -> None:
    manifest = json.loads(read_long(GOLDEN_NATIONAL / "manifest.json"))
    Draft202012Validator(SCHEMA).validate(manifest)
    snap = read_snapshot(read_long(GOLDEN_NATIONAL / "snapshot.bin.gz"))
    assert (
        manifest["snapshot"]["sha256"]
        == hashlib.sha256(read_long(GOLDEN_NATIONAL / "snapshot.bin.gz")).hexdigest()
    )
    assert snap.meta["datasetVersion"] == manifest["datasetVersion"]
    assert sorted(snap.meta["packageVersions"]) == ["ab", "sk"]
    assert len(snap.chains) > 5
    assert len(read_long(GOLDEN_NATIONAL / "snapshot.bin.gz")) < 60_000
    longest = max(
        len(p.relative_to(PIPELINE.parent).as_posix()) for p in GOLDEN_NATIONAL.rglob("*")
    )
    assert longest <= 70


def test_national_fixture_provinces_meet_at_the_border(tmp_path: Path) -> None:
    fx = national_fixtures(tmp_path)
    assert sorted(fx) == ["ab", "sk"]
