"""The site's data layout (M4 rulings P11 and P32), shared by the deploy and the e2e fixture."""

import json
from pathlib import Path

import pytest

from cantre_pipeline.site_layout import directory_name, lay_out, relocated

VERSION = "nrwn-national-6d2ca5d6+cantre.0.1.0"


def write_national(directory: Path) -> None:
    """A minimal ``national`` output: a manifest and the two files it names (bytes are opaque)."""
    directory.mkdir()
    manifest = {
        "datasetVersion": VERSION,
        "snapshot": {"path": "snapshot.bin.gz", "sha256": "a" * 64},
        "assetDetails": {"path": "asset-details.json.gz", "sha256": "b" * 64},
    }
    (directory / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    (directory / "snapshot.bin.gz").write_bytes(b"\x1f\x8bsnapshot")
    (directory / "asset-details.json.gz").write_bytes(b"\x1f\x8bdetails")


def test_directory_name_replaces_plus_only() -> None:
    assert directory_name(VERSION) == "nrwn-national-6d2ca5d6-cantre.0.1.0"


def test_relocated_changes_only_the_two_paths() -> None:
    original = json.dumps(
        {
            "datasetVersion": VERSION,
            "snapshot": {"path": "snapshot.bin.gz", "bytes": 5},
            "assetDetails": {"path": "asset-details.json.gz", "bytes": 7},
        }
    ).encode()
    manifest, folder = relocated(original)
    assert folder == "nrwn-national-6d2ca5d6-cantre.0.1.0"
    assert manifest["snapshot"] == {"path": f"{folder}/snapshot.bin.gz", "bytes": 5}
    assert manifest["assetDetails"] == {"path": f"{folder}/asset-details.json.gz", "bytes": 7}
    assert manifest["datasetVersion"] == VERSION


def test_lay_out_copies_bytes_and_writes_the_manifest_at_the_fixed_path(tmp_path: Path) -> None:
    national = tmp_path / "national"
    write_national(national)
    site = tmp_path / "site"

    assert lay_out(national, site) == VERSION

    folder = site / "data" / "nrwn-national-6d2ca5d6-cantre.0.1.0"
    assert (folder / "snapshot.bin.gz").read_bytes() == b"\x1f\x8bsnapshot"
    assert (folder / "asset-details.json.gz").read_bytes() == b"\x1f\x8bdetails"
    manifest = json.loads((site / "data" / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["snapshot"]["path"] == f"{folder.name}/snapshot.bin.gz"
    assert manifest["snapshot"]["sha256"] == "a" * 64  # untouched
    # Only the data folder and the manifest exist: no tiles, no raw data.
    assert sorted(p.name for p in (site / "data").iterdir()) == ["manifest.json", folder.name]


def test_lay_out_refuses_a_missing_data_file(tmp_path: Path) -> None:
    national = tmp_path / "national"
    write_national(national)
    (national / "snapshot.bin.gz").unlink()
    with pytest.raises(FileNotFoundError):
        lay_out(national, tmp_path / "site")
    # The manifest is written last, so a failed layout leaves none.
    assert not (tmp_path / "site" / "data" / "manifest.json").exists()
