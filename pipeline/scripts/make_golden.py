"""Regenerate ``pipeline/tests/golden/synthetic/``, the committed synthetic build.

The tree is the output of ``build_golden`` (the fixed scenario set in
``pipeline/tests/fixtures/synthetic.py``): manifest, tiles, audit and coverage report, plus

* ``snapshot.bin.gz``, the snapshot of those same tiles (it carries the tiles' own
  ``datasetVersion``, so a decoder can be checked against the tiles), and
* ``national/``, the three files of a national build (``manifest.json``, ``snapshot.bin.gz``,
  ``asset-details.json.gz``) made by the real ``national`` code path from two fake provinces,
  ``sk`` (the whole synthetic network) and ``ab`` (a line that starts where an ``sk`` line ends).

It contains no NRWN data. The golden test and the Vitest contract test both read it, and the
determinism test runs this script under two ``PYTHONHASHSEED`` values.

Usage, from the repository root: ``python pipeline/scripts/make_golden.py [OUT_DIR]``. Without
``OUT_DIR`` the committed golden directory is replaced.
"""

import shutil
import sys
from pathlib import Path

PIPELINE = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PIPELINE / "src"), str(PIPELINE / "tests")]

from fixtures.synthetic import build_golden  # noqa: E402

GOLDEN_DIR = PIPELINE / "tests" / "golden" / "synthetic"


def main(argv: list[str]) -> int:
    out = Path(argv[1]) if len(argv) > 1 else GOLDEN_DIR
    if out.exists():
        shutil.rmtree(out)
    result = build_golden(out)
    print(
        f"wrote {out}: {len(result.gzip_bytes)} tiles, {result.audit_lines} audit lines, "
        "snapshot.bin.gz and national/"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
