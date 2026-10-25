"""Measure the point-to-chain residual of every qualified anchor of a province.

Evidence for the RESEARCH.md finding that NRWN crossings, marker posts and stations sit exactly
on the track, so the residual check cannot be independent evidence of position accuracy.
Prints, per anchor source, the number of qualified anchors (``qualify_anchors`` output, before
any interval step), the largest residual in metres and how many residuals are above zero, then
the residual range of the records rejected as ``RESIDUAL_TOO_LARGE``.

Usage, from the repository root, with the raw cache already acquired (verify mode)::

    CANTRE_RAW_DIR=C:/cv-raw-v python pipeline/scripts/measure_residuals.py [sk]
"""

import re
import sys
from collections import defaultdict
from pathlib import Path

PIPELINE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PIPELINE / "src"))

from cantre_pipeline.acquire import acquire  # noqa: E402
from cantre_pipeline.anchors import qualify_anchors  # noqa: E402
from cantre_pipeline.chains import build_chains  # noqa: E402
from cantre_pipeline.cli import SOURCES_DIR, TC_SOURCE, _tc_csv, raw_dir  # noqa: E402
from cantre_pipeline.config import PipelineConfig  # noqa: E402
from cantre_pipeline.reader import read_tc_inventory  # noqa: E402
from cantre_pipeline.validate import load_network  # noqa: E402


def main(province: str) -> int:
    cfg = PipelineConfig()
    _, nrwn_dir = acquire(province, cache_dir=raw_dir(), sources_dir=SOURCES_DIR)
    _, tc_dir = acquire(TC_SOURCE, cache_dir=raw_dir(), sources_dir=SOURCES_DIR)
    net = load_network(nrwn_dir, province, cfg)
    chains = build_chains(net, cfg)
    tc = read_tc_inventory(_tc_csv(tc_dir), province.upper())
    anchors, audit = qualify_anchors(net, chains, tc, cfg)
    stats: dict[str, list[float]] = defaultdict(lambda: [0, 0.0, 0])  # n, max residual, n > 0
    for a in anchors:
        s = stats[a.source]
        s[0] += 1
        s[1] = max(s[1], a.residual_m)
        s[2] += a.residual_m > 0
    for source, (n, worst, above) in sorted(stats.items()):
        print(
            f"{source}: qualified={int(n)} max_residual_m={worst} residual_above_zero={int(above)}"
        )
    print(f"all: qualified={len(anchors)} max_residual_m={max(a.residual_m for a in anchors)}")
    too_far = [
        float(m.group(1))
        for r in audit
        if r.reason == "RESIDUAL_TOO_LARGE" and (m := re.search(r"residual ([0-9.]+) m", r.detail))
    ]
    print(f"RESIDUAL_TOO_LARGE: n={len(too_far)} min_m={min(too_far)} max_m={max(too_far)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "sk"))
