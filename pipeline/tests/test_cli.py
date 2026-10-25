"""Tests for the ``build`` command: exit codes, output tree and the hash check (Task 9)."""

import hashlib
import json
import zipfile
from dataclasses import asdict
from pathlib import Path

import pytest

from cantre_pipeline import cli
from cantre_pipeline.acquire import SourceRecord, _members_of, write_source
from cantre_pipeline.config import PipelineConfig
from cantre_pipeline.errors import PipelineError
from fixtures.synthetic import SYNTHETIC_SOURCES, scenarios


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def fake_cache(tmp_path: Path) -> tuple[Path, Path, Path]:
    """Return ``(cache dir, sources dir, tc cache file)`` holding the synthetic scenario set.

    The cache has exactly the layout ``acquire`` leaves behind (``<sha>.zip`` and ``<sha>.bin``)
    and ``sources`` has records that match, so ``build`` runs in verify mode without a network.
    """
    fx = scenarios(tmp_path / "fx")
    shp = fx.write()
    cache, sources = tmp_path / "cache", tmp_path / "sources"
    cache.mkdir(parents=True)
    zip_tmp = cache / "tmp.zip"
    with zipfile.ZipFile(zip_tmp, "w") as zf:
        for member in sorted(shp.iterdir()):
            zf.write(member, member.name)
    sk_sha, tc_sha = sha256(zip_tmp), sha256(fx.tc_path)
    zip_tmp.rename(cache / f"{sk_sha}.zip")
    tc_cache = cache / f"{tc_sha}.bin"
    tc_cache.write_bytes(fx.tc_path.read_bytes())
    record = {r.sourceId: r for r in SYNTHETIC_SOURCES}
    write_source(
        sources,
        SourceRecord(
            **{
                **asdict(record["sk"]),
                "sha256": sk_sha,
                "contentLength": (cache / f"{sk_sha}.zip").stat().st_size,
                "members": _members_of(shp),
            }
        ),
    )
    write_source(
        sources,
        SourceRecord(
            **{
                **asdict(record["tc-gci"]),
                "sha256": tc_sha,
                "contentLength": tc_cache.stat().st_size,
                "members": (),
            }
        ),
    )
    return cache, sources, tc_cache


def run_build(tmp_path: Path, *extra: str, province: str = "sk") -> tuple[int, Path]:
    cache, sources, _ = fake_cache(tmp_path / "in")
    out = tmp_path / "out"
    args = ["build", "--province", province, "--out", str(out), "--raw", str(cache), *extra]
    return cli.main(args, sources_dir=sources), out


def test_cli_build_writes_the_output_tree(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    code, out = run_build(tmp_path, "--check-budget")
    assert code == 0
    assert sorted(p.name for p in out.iterdir()) == ["audit", "manifest.json", "reports", "tiles"]
    assert (out / "audit" / "sk.jsonl").is_file()
    assert (out / "reports" / "coverage-sk.json").is_file()
    assert (out / "reports" / "coverage-sk.md").is_file()
    manifest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
    assert sorted(t["path"] for t in manifest["tiles"]) == sorted(
        f"tiles/{p.stem}.json" for p in (out / "tiles").iterdir()
    )
    assert [s["sourceId"] for s in manifest["sources"]] == ["sk", "tc-gci"]
    assert "built sk: 16 tiles" in capsys.readouterr().out


def test_cli_build_exit_code_on_budget_breach(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(cli, "CONFIG", PipelineConfig(tile_budget_gzip_bytes=100))
    code, out = run_build(tmp_path, "--check-budget")
    assert code == 3
    assert "OVER_BUDGET: tile 208_-212" in capsys.readouterr().err
    assert (out / "manifest.json").is_file()  # the build is still written for inspection


def test_cli_build_without_check_budget_ignores_the_budget(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(cli, "CONFIG", PipelineConfig(tile_budget_gzip_bytes=100))
    assert run_build(tmp_path)[0] == 0


def test_cli_build_fails_with_hash_mismatch_when_the_cached_tc_copy_differs(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    cache, sources, tc_cache = fake_cache(tmp_path / "in")
    tc_cache.write_bytes(tc_cache.read_bytes() + b"tampered")
    out = tmp_path / "out"
    code = cli.main(
        ["build", "--province", "sk", "--out", str(out), "--raw", str(cache)], sources_dir=sources
    )
    assert code == 2
    assert "HASH_MISMATCH" in capsys.readouterr().err
    assert not out.exists()  # nothing is built from a source that fails its hash


def test_cli_build_unknown_province_is_a_pipeline_error(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    code, _ = run_build(tmp_path, province="zz")
    assert code == 2
    assert "UNKNOWN_PROVINCE" in capsys.readouterr().err


def test_tc_csv_needs_exactly_one_file(tmp_path: Path) -> None:
    (tmp_path / "a.csv").write_text("x", encoding="utf-8")
    assert cli._tc_csv(tmp_path).name == "a.csv"
    (tmp_path / "b.csv").write_text("x", encoding="utf-8")
    with pytest.raises(PipelineError) as e:
        cli._tc_csv(tmp_path)
    assert e.value.code == "INCOMPLETE_EXTRACTION"
