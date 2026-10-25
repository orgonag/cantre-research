"""Regenerate ``app/e2e/fixtures/``, the data the Playwright tests serve as the site's ``data/``.

There is one network definition: the synthetic golden one in ``pipeline/tests/fixtures/``. The
fixture is laid out the way the site lays out its data (ruling P11):

* ``data/manifest.json`` names the CURRENT build by relative path;
* ``data/<dir>/snapshot.bin.gz`` and ``data/<dir>/asset-details.json.gz`` are its files.

Two builds are written, so the tests can exercise an update:

* ``v1`` is a byte copy of the committed two-province golden bundle
  (``pipeline/tests/golden/synthetic/national/``); only the manifest's two ``path`` values are
  rewritten to the ``<dir>/`` layout. Its snapshot and asset-details bytes are the golden bytes.
* ``v2`` is the same synthetic network built again by the real national code path with one
  provenance input changed (the fake ``ab`` package's recorded hash), which is exactly what makes
  the dataset version different. Its manifest is written to ``next-manifest.json``, not to
  ``data/manifest.json``: the test serves it in place of the manifest to simulate a new release,
  and its files sit under ``data/<dir2>/`` beside the first build's.

It contains no NRWN data. ``<dir>`` is the dataset version with ``+`` replaced by ``-``, because
the data client accepts only ``A-Z a-z 0-9 . _ -`` in a manifest path.

Usage, from the repository root: ``python pipeline/scripts/make_e2e_fixture.py [OUT_DIR]``.
Without ``OUT_DIR`` the committed ``app/e2e/fixtures`` directory is replaced.
"""

import shutil
import sys
import tempfile
from dataclasses import replace
from pathlib import Path

PIPELINE = Path(__file__).absolute().parents[1]
sys.path[:0] = [str(PIPELINE / "src"), str(PIPELINE / "tests")]

from cantre_pipeline.config import PipelineConfig  # noqa: E402
from cantre_pipeline.encode import canonical_json  # noqa: E402
from cantre_pipeline.national import ProvinceInput, build_national  # noqa: E402
from cantre_pipeline.site_layout import place  # noqa: E402
from fixtures.synthetic import (  # noqa: E402
    NATIONAL_SOURCES,
    SYNTHETIC_SOURCES,
    national_fixtures,
)

GOLDEN_NATIONAL = PIPELINE / "tests" / "golden" / "synthetic" / "national"
DEFAULT_OUT = PIPELINE.parent / "app" / "e2e" / "fixtures"


def build_next(root: Path) -> tuple[Path, bytes]:
    """Build the synthetic network again with the fake ``ab`` package's hash changed (v2)."""
    fixtures = national_fixtures(root / "in")
    changed = {
        **NATIONAL_SOURCES,
        "ab": replace(NATIONAL_SOURCES["ab"], sha256="3" * 64),
    }
    inputs = [
        ProvinceInput(code, fx.write(), changed[code]) for code, fx in sorted(fixtures.items())
    ]
    build_national(
        inputs, fixtures["sk"].tc_path, SYNTHETIC_SOURCES[1], root / "out", PipelineConfig()
    )
    out = root / "out"
    return out, (out / "manifest.json").read_bytes()


def main(argv: list[str]) -> int:
    """Write the fixture tree and print what it holds."""
    out = Path(argv[1]) if len(argv) > 1 else DEFAULT_OUT
    if out.exists():
        shutil.rmtree(out)
    data_dir = out / "data"
    data_dir.mkdir(parents=True)

    current = place(GOLDEN_NATIONAL, (GOLDEN_NATIONAL / "manifest.json").read_bytes(), data_dir)
    (data_dir / "manifest.json").write_bytes(canonical_json(current))

    with tempfile.TemporaryDirectory() as tmp:
        built, manifest_bytes = build_next(Path(tmp))
        following = place(built, manifest_bytes, data_dir)
    (out / "next-manifest.json").write_bytes(canonical_json(following))

    print(f"wrote {out}: current {current['datasetVersion']}, next {following['datasetVersion']}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
