"""Lay a ``national`` build out as the site's ``data/`` folder.

Usage, from the repository root:
``python pipeline/scripts/lay_out_site_data.py NATIONAL_DIR SITE_DIR``

Writes ``SITE_DIR/data/manifest.json`` and ``SITE_DIR/data/<dataset version, + as ->/`` holding
the snapshot and the asset-details file. The layout code is
:mod:`cantre_pipeline.site_layout`, the same code the browser-test fixture uses. Tiles are not
copied: they are built and size-checked but not deployed.
"""

import sys
from pathlib import Path

PIPELINE = Path(__file__).absolute().parents[1]
sys.path[:0] = [str(PIPELINE / "src")]

from cantre_pipeline.site_layout import lay_out  # noqa: E402


def main(argv: list[str]) -> int:
    """Run the layout and print the dataset version."""
    if len(argv) != 3:
        print("usage: lay_out_site_data.py NATIONAL_DIR SITE_DIR", file=sys.stderr)
        return 2
    version = lay_out(Path(argv[1]), Path(argv[2]))
    print(f"laid out {version} under {Path(argv[2]) / 'data'}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
