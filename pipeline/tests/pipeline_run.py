"""Shared helper: run the whole pipeline on a synthetic fixture up to tiles (Task 8 tests)."""

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from cantre_pipeline.anchors import QualifiedAnchor, qualify_anchors
from cantre_pipeline.assets import Asset, extract_assets
from cantre_pipeline.chains import ChainSet, build_chains
from cantre_pipeline.config import PipelineConfig
from cantre_pipeline.encode import delta_decode
from cantre_pipeline.geodesy import METRES_PER_MILE, LatLon, distance_m
from cantre_pipeline.intervals import Interval, build_intervals
from cantre_pipeline.model import Network
from cantre_pipeline.reader import read_tc_inventory
from cantre_pipeline.tiles import DATASET_VERSION, build_tiles
from cantre_pipeline.validate import load_network
from fixtures.builder import NrwnFixture

CFG = PipelineConfig()


def pt(i: float, lat: float = 52.1) -> LatLon:
    """Point ``i`` * 0.01 deg east of (lat, -106): the tile edge at lon -106 is at ``i == 0``."""
    return LatLon(round(lat, 6), round(-106.0 + 0.01 * i, 6))


def mp_between(a: LatLon, b: LatLon, mp_a: float) -> float:
    """Posted mileage (2 decimals) of ``b`` given that ``a`` is at ``mp_a``, mileage rising east."""
    return round(mp_a + distance_m(a, b) / METRES_PER_MILE, 2)


@dataclass
class Run:
    """Everything the pipeline produced for one fixture."""

    net: Network
    chains: ChainSet
    anchors: list[QualifiedAnchor]
    intervals: list[Interval]
    assets: list[Asset]
    tiles: dict[str, dict[str, Any]]


def run(fx: NrwnFixture, cfg: PipelineConfig = CFG) -> Run:
    """Run every stage on ``fx`` and build the tiles."""
    net = load_network(fx.write(), "sk", cfg)
    chains = build_chains(net, cfg)
    tc = read_tc_inventory(fx.tc_path, "SK")
    qa, _ = qualify_anchors(net, chains, tc, cfg)
    intervals: list[Interval] = []
    kept: list[QualifiedAnchor] = []
    for ch in chains.chains:
        ivs, k, _ = build_intervals(ch, qa, cfg)
        intervals += ivs
        kept += k
    assets, _ = extract_assets(net, chains, intervals, kept, tc, cfg)
    tiles = build_tiles("sk", chains, net.segments, kept, intervals, assets, cfg, DATASET_VERSION)
    return Run(net, chains, kept, intervals, assets, tiles)


def decode_piece(piece: dict[str, Any]) -> tuple[list[int], list[int], list[int]]:
    """Return ``(latE6, lonE6, sMm)`` of a tile chain piece after delta decoding."""
    return (
        delta_decode(piece["latE6"]),
        delta_decode(piece["lonE6"]),
        delta_decode(piece["sMm"]),
    )


def straddling_fixture(tmp_path: Path) -> NrwnFixture:
    """Main ``T1`` from lon -106.10 to -105.90 crossing the tile edge at lon -106.

    Posted crossings A (west, -106.095), E (-106.005, inside both buffers), B (-105.905); a
    siding ``SD`` along the chain, and a second subdivision S2 whose single crossing ``Z`` is
    isolated (no interval) near the west end of ``T2``.
    """
    fx = NrwnFixture(tmp_path)
    fx.track("T1", [pt(i) for i in range(-10, 11)])
    fx.track("SD", [pt(-10, 52.1003), pt(10, 52.1003)], cls="Siding")
    pa, pe, pb = pt(-9.5), pt(-0.5), pt(9.5)
    fx.crossing("A", pa, "T1", mp=10.0)
    fx.crossing("E", pe, "T1", mp=mp_between(pa, pe, 10.0))
    fx.crossing("B", pb, "T1", mp=mp_between(pa, pb, 10.0))
    fx.track("T2", [pt(i, 52.6) for i in range(-10, 11)], sub=("S2", "Beta"))
    fx.crossing("Z", pt(-9.5, 52.6), "T2", mp=5.0, sub=("S2", "Beta"))
    return fx
