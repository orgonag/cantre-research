"""Measure the point-to-chain residual of every qualified anchor of a province.

Evidence for the RESEARCH.md finding that NRWN crossings, marker posts and stations sit exactly
on the track, so the residual check cannot be independent evidence of position accuracy.
Prints, per anchor source, the number of qualified anchors (``qualify_anchors`` output, before
any interval step), the largest residual in metres and how many residuals are above zero, then
the residual range of the records rejected as ``RESIDUAL_TOO_LARGE``. It then does the same for
the positions of every extracted asset, per asset kind: the number of positions, the largest
residual in metres, how many are above zero and how many have a non-zero ``residualMm`` as
written to the tiles (metres rounded to millimetres, ``s_scale``). Diamonds are positioned at
chain vertices with residual 0 by construction.

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
from cantre_pipeline.anchors import QualifiedAnchor, qualify_anchors  # noqa: E402
from cantre_pipeline.assets import extract_assets  # noqa: E402
from cantre_pipeline.chains import build_chains  # noqa: E402
from cantre_pipeline.cli import SOURCES_DIR, TC_SOURCE, _tc_csv, raw_dir  # noqa: E402
from cantre_pipeline.config import PipelineConfig  # noqa: E402
from cantre_pipeline.encode import to_e6  # noqa: E402
from cantre_pipeline.intervals import Interval, build_intervals  # noqa: E402
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
    intervals: list[Interval] = []
    kept: list[QualifiedAnchor] = []
    for chain in chains.chains:
        ivs, k, _ = build_intervals(chain, anchors, cfg)
        intervals += ivs
        kept += k
    assets, _ = extract_assets(net, chains, intervals, kept, tc, cfg)
    astats: dict[str, list[float]] = defaultdict(lambda: [0, 0.0, 0, 0])  # n, max, > 0, mm > 0
    for asset in assets:
        for p in asset.positions:
            st = astats[asset.kind]
            st[0] += 1
            st[1] = max(st[1], p.residual_m)
            st[2] += p.residual_m > 0
            st[3] += to_e6(p.residual_m, cfg.s_scale) > 0
    for kind, (n, worst, above, above_mm) in sorted(astats.items()):
        print(
            f"asset {kind}: positions={int(n)} max_residual_m={worst} "
            f"residual_above_zero={int(above)} residualMm_above_zero={int(above_mm)}"
        )
    total = [sum(v[i] for v in astats.values()) for i in (0, 2, 3)]
    worst_all = max((v[1] for v in astats.values()), default=0.0)
    print(
        f"assets: positions={int(total[0])} max_residual_m={worst_all} "
        f"residual_above_zero={int(total[1])} residualMm_above_zero={int(total[2])}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "sk"))
