"""List where the posted-only rebuild covers chain that the all-tier intervals do not.

For each subdivision whose posted-only calibrated length exceeds its all-tier length, print per
chain the s-ranges covered only by the posted-only intervals, and the anchors the all-tier pass
dropped or left isolated inside or next to those ranges, with their audit reason. This is the
evidence behind the RESEARCH.md explanation of the posted-only gap (ruling R17).

Usage, from the repository root, with the raw cache acquired::

    CANTRE_RAW_DIR=C:/cv-raw-v python pipeline/scripts/diagnose_posted_only.py sk
"""

import itertools
import sys
from collections import defaultdict
from pathlib import Path

PIPELINE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PIPELINE / "src"))

from cantre_pipeline.acquire import acquire  # noqa: E402
from cantre_pipeline.anchors import QualifiedAnchor, qualify_anchors  # noqa: E402
from cantre_pipeline.chains import build_chains  # noqa: E402
from cantre_pipeline.cli import SOURCES_DIR, TC_SOURCE, _tc_csv, raw_dir  # noqa: E402
from cantre_pipeline.config import PipelineConfig  # noqa: E402
from cantre_pipeline.intervals import build_intervals  # noqa: E402
from cantre_pipeline.reader import read_tc_inventory  # noqa: E402
from cantre_pipeline.validate import load_network  # noqa: E402


def spans(chain_anchors: list[QualifiedAnchor], ivs: list) -> list[tuple[float, float]]:  # type: ignore[type-arg]
    by_id = {a.id: a for a in chain_anchors}
    return [(by_id[iv.anchor_ids[0]].s_m, by_id[iv.anchor_ids[-1]].s_m) for iv in ivs]


def main(province: str) -> int:
    cfg = PipelineConfig()
    _, nrwn_dir = acquire(province, cache_dir=raw_dir(), sources_dir=SOURCES_DIR)
    _, tc_dir = acquire(TC_SOURCE, cache_dir=raw_dir(), sources_dir=SOURCES_DIR)
    net = load_network(nrwn_dir, province, cfg)
    chains = build_chains(net, cfg)
    tc = read_tc_inventory(_tc_csv(tc_dir), province.upper())
    qualified, _ = qualify_anchors(net, chains, tc, cfg)
    by_chain: dict[str, list[QualifiedAnchor]] = defaultdict(list)
    for a in qualified:
        by_chain[a.chain_id].append(a)
    totals: dict[str, list[float]] = defaultdict(lambda: [0.0, 0.0])
    for ch in chains.chains:
        ivs, kept, _ = build_intervals(ch, by_chain[ch.id], cfg)
        pivs, pkept, _ = build_intervals(
            ch, [a for a in by_chain[ch.id] if a.tier == "posted"], cfg
        )
        all_m = sum(b - a for a, b in spans(kept, ivs))
        post_m = sum(b - a for a, b in spans(pkept, pivs))
        totals[ch.sub_name][0] += all_m
        totals[ch.sub_name][1] += post_m
        if post_m <= all_m:
            continue
        print(f"{ch.sub_name} chain {ch.id}: all-tier {all_m:.1f} m, posted-only {post_m:.1f} m")
        print(f"  all-tier intervals   {[(round(a), round(b)) for a, b in spans(kept, ivs)]}")
        print(f"  posted-only intervals{[(round(a), round(b)) for a, b in spans(pkept, pivs)]}")
        kept_by_id = {a.id: a for a in kept}
        for left, right in itertools.pairwise(ivs):
            a, b = kept_by_id[left.anchor_ids[-1]], kept_by_id[right.anchor_ids[0]]
            slope = abs(b.mp - a.mp) * 1609.344 / (b.s_m - a.s_m)
            print(
                f"  all-tier break between {a.tier} {a.mp} @ {a.s_m:.0f} m and "
                f"{b.tier} {b.mp} @ {b.s_m:.0f} m: slope {slope:.3f}"
            )
        dropped_posted = [
            a for a in by_chain[ch.id] if a.tier == "posted" and a.id not in kept_by_id
        ]
        print(
            f"  posted anchors qualified but not kept by the all-tier pass: {len(dropped_posted)}"
        )
        pkept_ids = {a.id for a in pkept}
        for a in sorted(by_chain[ch.id], key=lambda a: a.s_m):
            if a.tier == "posted" and a.id not in pkept_ids:
                near = [
                    f"{b.tier} {b.mp} @ {b.s_m:.0f} m"
                    for b in sorted(kept, key=lambda b: abs(b.s_m - a.s_m))[:4]
                ]
                print(
                    f"  posted-only pass dropped posted {a.mp} @ {a.s_m:.0f} m; "
                    f"nearest all-tier kept anchors: {near}"
                )
    for name, (a, p) in sorted(totals.items()):
        if p > a:
            print(f"SUBDIVISION {name}: all-tier {a / 1000:.3f} km, posted-only {p / 1000:.3f} km")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "sk"))
