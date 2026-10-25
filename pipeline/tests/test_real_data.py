"""Tests for the shared real-data gate (tests/real_data.py)."""

from pathlib import Path

import pytest

import real_data


def test_gate_skips_with_a_reason_when_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CANTRE_RAW_DIR", raising=False)
    assert real_data.raw_dir() is None
    assert "not set" in (real_data._skip_reason() or "")


def test_gate_skips_when_directory_missing_or_empty(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("CANTRE_RAW_DIR", str(tmp_path / "nope"))
    assert "does not exist" in (real_data._skip_reason() or "")
    monkeypatch.setenv("CANTRE_RAW_DIR", str(tmp_path))
    assert "acquire --source sk" in (real_data._skip_reason() or "")
    (tmp_path / "abc").mkdir()
    (tmp_path / "abc" / "NRWN_SK_2_0_TRACK.shp").write_bytes(b"")
    assert "acquire --source tc-gci" in (real_data._skip_reason() or "")
    (tmp_path / "def").mkdir()
    (tmp_path / "def" / "en-grade-crossing-inventory-2023-update.csv").write_bytes(b"")
    assert real_data._skip_reason() is None
    shp, csv = real_data.real_sk_paths()
    assert shp == tmp_path / "abc" and csv.name.endswith(".csv")
