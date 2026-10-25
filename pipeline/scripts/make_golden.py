"""Regenerate ``pipeline/tests/golden/synthetic/``, the committed synthetic build.

The tree is the output of ``build_synthetic`` (the fixed scenario set in
``pipeline/tests/fixtures/synthetic.py``): manifest, tiles, audit and coverage report. It
contains no NRWN data. The golden test and the Vitest contract test both read it, and the
determinism test runs this script under two ``PYTHONHASHSEED`` values.

Usage, from the repository root: ``python pipeline/scripts/make_golden.py [OUT_DIR]``. Without
``OUT_DIR`` the committed golden directory is replaced.
"""

import shutil
import sys
from pathlib import Path

PIPELINE = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(PIPELINE / "src"), str(PIPELINE / "tests")]

from fixtures.synthetic import build_synthetic  # noqa: E402

GOLDEN_DIR = PIPELINE / "tests" / "golden" / "synthetic"


def main(argv: list[str]) -> int:
    out = Path(argv[1]) if len(argv) > 1 else GOLDEN_DIR
    if out.exists():
        shutil.rmtree(out)
    result = build_synthetic(out)
    print(f"wrote {out}: {len(result.gzip_bytes)} tiles, {result.audit_lines} audit lines")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
