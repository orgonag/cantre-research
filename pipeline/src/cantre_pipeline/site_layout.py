"""Lay a national build out as the site's ``data/`` folder (M4 rulings P11 and P32).

The site serves a manifest at the fixed path ``data/manifest.json``. The manifest names the
current build's two data files by relative path, ``<dir>/snapshot.bin.gz`` and
``<dir>/asset-details.json.gz``, where ``<dir>`` is the dataset version with ``+`` replaced by
``-`` (the data client accepts only ``A-Z a-z 0-9 . _ -`` in a manifest path). A GitHub Pages
deploy replaces the whole site, so each release's ``data/`` holds the manifest and that one
build's folder only; the old build's files are not kept on the site. Because the folder is named
by version, one path never serves the files of two different builds.

The browser-test fixture (``pipeline/scripts/make_e2e_fixture.py``) and the deploy workflow
(``pipeline/scripts/lay_out_site_data.py``) both use these functions, so the two layouts cannot
differ. No file is rewritten: the data files are copied byte for byte, and only the two ``path``
values of the manifest change.
"""

import json
import shutil
from pathlib import Path
from typing import Any

from cantre_pipeline.encode import canonical_json

DATA_FILES = ("snapshot.bin.gz", "asset-details.json.gz")
"""The two files a manifest names, in the order the layout copies them."""

MANIFEST_FILE = "manifest.json"


def directory_name(dataset_version: str) -> str:
    """Return the folder name for a build: the dataset version made safe for a manifest path."""
    return dataset_version.replace("+", "-")


def relocated(manifest_bytes: bytes) -> tuple[dict[str, Any], str]:
    """Return the manifest with its file paths moved under ``<dir>/``, and that ``<dir>``."""
    manifest: dict[str, Any] = json.loads(manifest_bytes)
    folder = directory_name(manifest["datasetVersion"])
    for key in ("snapshot", "assetDetails"):
        manifest[key]["path"] = f"{folder}/{Path(manifest[key]['path']).name}"
    return manifest, folder


def place(source: Path, manifest_bytes: bytes, data_dir: Path) -> dict[str, Any]:
    """Copy a build's two data files into ``data_dir/<dir>/``; return its relocated manifest."""
    manifest, folder = relocated(manifest_bytes)
    (data_dir / folder).mkdir(parents=True, exist_ok=True)
    for name in DATA_FILES:
        shutil.copyfile(source / name, data_dir / folder / name)
    return manifest


def lay_out(national_dir: Path, site_dir: Path) -> str:
    """Write ``site_dir/data/`` from a ``national`` output directory; return the dataset version.

    ``data/manifest.json`` is written last, so a partly written folder never has a manifest that
    points at files not yet there.
    """
    data_dir = site_dir / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    manifest = place(national_dir, (national_dir / MANIFEST_FILE).read_bytes(), data_dir)
    (data_dir / MANIFEST_FILE).write_bytes(canonical_json(manifest))
    return str(manifest["datasetVersion"])
