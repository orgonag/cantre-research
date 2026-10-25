"""The fixed synthetic scenario set and its build (committed as ``tests/golden/synthetic/``).

Every value is invented; no NRWN data is used. Each scenario sits in its own latitude band and
subdivision so its effect on the output is easy to read. All tracks run east along a parallel,
0.01 degree (about 685 m at 52 N) per step ``i``; the tile edge at longitude -106 is ``i == 0``.

========  ======  =====================================================================
Band      Sub     Scenario
========  ======  =====================================================================
52.10     Alpha   Two segments joined across the tile edge. Posted, TC and unverified
                  anchors; a merged and a conflicting CROSSINGID pair; an outlier; sentinels;
                  a siding crossing; a subdivision mismatch; a residual too large; a TC
                  spur row, a TC disagreement and a duplicated TC number; an unverified
                  deviation; a bridge, a culvert and a diamond.
52.40     Beta    A mileage reset (two intervals).
52.60     Gamma   Mileage decreasing along the chain (one interval, decreasing).
52.80     Delta   A gap: two chains in one subdivision that do not meet.
53.00     Epsilon A branch: three segments at one node.
53.20     Zeta    Double track: two parallel mains, one crossing posted on both.
53.40     Eta     A loop: four segments closing on themselves.
53.60     Theta   A subdivision change at a shared node.
53.80     Iota    A posted anchor and a Transport Canada anchor: calibrated only with the
                  extra tier (posted-only coverage is 0).
54.00     Kappa   A posted anchor that two agreeing unverified anchors would bridge away: it is
                  kept (ruling R18), and the unverified anchor that disagrees with the posted
                  line is dropped.
54.20     Lambda  Two posted anchors and a Transport Canada anchor that is wrong: the TC
                  anchor breaks the all-tier interval but not the posted-only rebuild, so
                  posted-only coverage (ruling R17) exceeds the all-tier figure here.
========  ======  =====================================================================

``build_synthetic`` writes the fixture into a temporary directory and runs
:func:`cantre_pipeline.build.build_province` on it, so the golden test, the determinism test and
``pipeline/scripts/make_golden.py`` share one definition.
"""

import hashlib
import random
import tempfile
from pathlib import Path

from cantre_pipeline.acquire import SourceRecord
from cantre_pipeline.build import BuildResult, build_province
from cantre_pipeline.config import PipelineConfig
from cantre_pipeline.geodesy import METRES_PER_MILE, LatLon, distance_m
from fixtures.builder import NrwnFixture

__all__ = ["SYNTHETIC_SOURCES", "build_synthetic", "scenarios", "tree_sha256"]

CFG = PipelineConfig()

SYNTHETIC_SOURCES = (
    SourceRecord(
        sourceId="sk",
        kind="zip",
        url="synthetic://nrwn-sk",
        publisher="synthetic",
        catalogueUrl="synthetic://nrwn-sk",
        licenceName="none (invented data)",
        licenceUrl="synthetic://none",
        httpLastModified=None,
        contentLength=0,
        sha256="0" * 64,
        retrievedUtc="2026-01-01T00:00:00Z",
        packageVersion="synthetic",
        crsWkt=None,
        metadataMember=None,
        members=(),
    ),
    SourceRecord(
        sourceId="tc-gci",
        kind="file",
        url="synthetic://tc-gci",
        publisher="synthetic",
        catalogueUrl="synthetic://tc-gci",
        licenceName="none (invented data)",
        licenceUrl="synthetic://none",
        httpLastModified=None,
        contentLength=0,
        sha256="1" * 64,
        retrievedUtc="2026-01-01T00:00:00Z",
        packageVersion="synthetic",
        crsWkt=None,
        metadataMember=None,
        members=(),
    ),
)
"""Fixed provenance records for the synthetic build (hashes are placeholders, not real files)."""


def P(i: float, lat: float) -> LatLon:  # noqa: N802
    """Point ``i`` * 0.01 deg east of (lat, -106)."""
    return LatLon(round(lat, 6), round(-106.0 + 0.01 * i, 6))


def mp(a: LatLon, b: LatLon, mp_a: float) -> float:
    """Posted mileage (2 decimals) at ``b`` given ``mp_a`` at ``a``, rising with distance."""
    return round(mp_a + distance_m(a, b) / METRES_PER_MILE, 2)


def _alpha(fx: NrwnFixture) -> None:
    lat = 52.10
    fx.track("T1a", [P(i, lat) for i in range(-10, 1)])
    fx.track("T1b", [P(i, lat) for i in range(0, 11)])
    fx.track("SD", [P(-10, lat + 0.0003), P(10, lat + 0.0003)], cls="Siding")
    origin = P(-9.5, lat)

    def at(i: float, base: float = 10.0) -> float:
        return mp(origin, P(i, lat), base)

    fx.crossing("X1", P(-9.5, lat), "T1a", mp=10.0)
    fx.crossing("X2", P(-5.5, lat), "T1a", mp=at(-5.5), tcid=1002)
    fx.crossing("X3", P(-0.5, lat), "T1a", mp=at(-0.5), crossing_id="C3")
    fx.crossing("X3b", P(-0.49, lat), "T1a", mp=at(-0.5), crossing_id="C3")  # merged pair
    fx.crossing("X4", P(3.5, lat), "T1b", mp=at(3.5), crossing_id="C4")
    fx.crossing("X4b", P(3.5, lat), "T1b", mp=at(3.5) + 0.5, crossing_id="C4")  # conflict
    fx.crossing("X5", P(5.5, lat), "T1b", mp=at(5.5) + 4.0)  # outlier
    fx.crossing("X6", P(9.5, lat), "T1b", mp=at(9.5))
    fx.crossing("X7", P(7.5, lat), "T1b", mp=None)  # POSTED_SENTINEL
    fx.station("ST1", P(8.0, lat), "T1b", mp=None)  # MILEAGE_SENTINEL
    fx.crossing("X8", P(-4.5, lat), "SD", mp=at(-4.5), track_class="Siding")
    fx.crossing("X9", P(-3.5, lat), "T1a", mp=at(-3.5), qualifier="Unknown", tcid=1009)
    fx.crossing("X10", P(-7.5, lat), "T1a", mp=None, qualifier="Unknown", tcid=1010)
    fx.crossing("X11", P(1.5, lat), "T1b", mp=at(1.5), tcid=1011)  # disagrees with TC
    fx.crossing("X12", P(-6.5, lat + 0.002), "T1a", mp=at(-6.5))  # 220 m off the track
    fx.crossing("X13", P(-8.5, lat), "T1a", mp=at(-8.5), sub=("S9", "Other"))
    fx.crossing("X14", P(6.5, lat), "T1b", mp=None, qualifier="Unknown", tcid=1020)
    # M1, M2 and ST2 sit away from X5 so that its neighbours are posted (ruling R18).
    fx.markerpost("M1", P(-9.0, lat), "T1a", mp=at(-9.0))
    fx.markerpost("M2", P(-4.5, lat), "T1a", mp=at(-4.5) + 0.4)  # unverified deviation
    fx.station("ST2", P(9.8, lat), "T1b", mp=at(9.8))
    fx.bridge("BR", [P(1.0, lat + 0.0001), P(1.4, lat + 0.0001)], "T1b")
    fx.culvert("CU", P(4.0, lat + 0.0001), "T1b")
    fx.junction("J1", P(0, lat), "Diamond")
    fx.junction("J2", P(-10, lat), "End")
    fx.junction("J3", P(10, lat), "End")
    sub = "Alpha"
    fx.tc_row(1002, mile=at(-5.5), subdivision=sub)
    fx.tc_row(1009, mile=at(-3.5), subdivision=sub)
    fx.tc_row(1010, mile=at(-7.5), subdivision=sub, spur_mile_point="2.5", spur_name="Spur")
    fx.tc_row(1011, mile=at(1.5) + 0.3, subdivision=sub)
    fx.tc_row(1020, mile=at(6.5), subdivision=sub)
    fx.tc_row(1020, mile=at(6.5) + 1.0, subdivision=sub)  # TC_DUPLICATE_NUMBER


def _line(
    fx: NrwnFixture,
    prefix: str,
    lat: float,
    marks: list[tuple[float, float]],
    *,
    sub: tuple[str, str],
    span: tuple[int, int] = (0, 12),
) -> None:
    """Add a straight main ``<prefix>T`` and a crossing ``<prefix><k>`` per ``(i, mp)`` mark."""
    fx.track(f"{prefix}T", [P(i, lat) for i in range(span[0], span[1] + 1)], sub=sub)
    for k, (i, value) in enumerate(marks):
        fx.crossing(f"{prefix}{k}", P(i, lat), f"{prefix}T", mp=value, sub=sub)


def _along(lat: float, first: float, marks: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """``(i, mileage)`` marks: ``first`` at ``marks[0][0]``, then distance-consistent values."""
    origin = P(marks[0][0], lat)
    return [(i, mp(origin, P(i, lat), first + extra)) for i, extra in marks]


def _others(fx: NrwnFixture) -> None:
    # Beta: a reset. Mileage rises 20 -> 22, then restarts near 2 and rises again.
    lat = 52.40
    fwd = _along(lat, 20.0, [(0.5, 0.0), (3.5, 0.0), (6.5, 0.0)])
    back = _along(lat, 2.0, [(8.5, 0.0), (11.5, 0.0)])
    _line(fx, "B", lat, fwd + back, sub=("S2", "Beta"))
    # Gamma: mileage decreases along the chain.
    lat = 52.60
    pts = [(0.5, 0.0), (5.5, 0.0), (9.5, 0.0)]
    down = [(i, round(60.0 - (v - 60.0), 2)) for i, v in _along(lat, 60.0, pts)]
    _line(fx, "G", lat, down, sub=("S3", "Gamma"), span=(0, 10))
    # Delta: a gap between i = 4 and i = 6.
    lat = 52.80
    sub = ("S4", "Delta")
    for name, span, first in (("DA", (0, 4), 30.0), ("DB", (6, 10), 33.0)):
        fx.track(f"{name}T", [P(i, lat) for i in range(span[0], span[1] + 1)], sub=sub)
        a, b = P(span[0] + 0.5, lat), P(span[1] - 0.5, lat)
        fx.crossing(f"{name}0", a, f"{name}T", mp=first, sub=sub)
        fx.crossing(f"{name}1", b, f"{name}T", mp=mp(a, b, first), sub=sub)
    # Epsilon: a branch. A stem to node i = 5, then an east arm and a north arm.
    lat = 53.00
    sub = ("S5", "Epsilon")
    fx.track("ES", [P(i, lat) for i in range(0, 6)], sub=sub)
    fx.track("EE", [P(i, lat) for i in range(5, 11)], sub=sub)
    fx.track("EN", [P(5, lat + 0.01 * k) for k in range(0, 6)], sub=sub)
    for name, a, b in (("ES", P(0.5, lat), P(4.5, lat)), ("EE", P(5.5, lat), P(9.5, lat))):
        fx.crossing(f"{name}0", a, name, mp=40.0, sub=sub)
        fx.crossing(f"{name}1", b, name, mp=mp(a, b, 40.0), sub=sub)
    # Zeta: double track. One road crossing is posted on both mains with the same CROSSINGID.
    lat = 53.20
    sub = ("S6", "Zeta")
    fx.track("ZA", [P(i, lat) for i in range(0, 11)], sub=sub)
    fx.track("ZB", [P(i, lat + 0.0003) for i in range(0, 11)], sub=sub)
    for name, off in (("ZA", 0.0), ("ZB", 0.0003)):
        a, b = P(1.5, lat + off), P(8.5, lat + off)
        fx.crossing(f"{name}0", a, name, mp=70.0, crossing_id="CZ", sub=sub)
        fx.crossing(f"{name}1", b, name, mp=mp(a, b, 70.0), crossing_id="CZ2", sub=sub)
    # Eta: a loop of four segments.
    lat = 53.40
    sub = ("S7", "Eta")
    ring = [P(0, lat), P(3, lat), P(3, lat + 0.02), P(0, lat + 0.02), P(0, lat)]
    for k in range(4):
        fx.track(f"HL{k}", [ring[k], ring[k + 1]], sub=sub)
    fx.crossing("HL-X", P(1.5, lat), "HL0", mp=5.0, sub=sub)
    # Theta: the subdivision changes at the shared node i = 5.
    lat = 53.60
    for name, span, sub, first in (
        ("TA", (0, 5), ("S8a", "Theta A"), 80.0),
        ("TB", (5, 10), ("S8b", "Theta B"), 3.0),
    ):
        fx.track(f"{name}T", [P(i, lat) for i in range(span[0], span[1] + 1)], sub=sub)
        a, b = P(span[0] + 0.5, lat), P(span[1] - 0.5, lat)
        fx.crossing(f"{name}0", a, f"{name}T", mp=first, sub=sub)
        fx.crossing(f"{name}1", b, f"{name}T", mp=mp(a, b, first), sub=sub)
    # Iota: a posted crossing and a TC-tier crossing; the TC tier is what calibrates the chain.
    lat = 53.80
    sub = ("S10", "Iota")
    fx.track("IT", [P(i, lat) for i in range(0, 11)], sub=sub)
    a, b = P(0.5, lat), P(9.5, lat)
    fx.crossing("I0", a, "IT", mp=60.0, sub=sub)
    fx.crossing("I1", b, "IT", mp=None, qualifier="Unknown", tcid=1100, sub=sub)
    fx.tc_row(1100, mile=mp(a, b, 60.0), subdivision="Iota")
    # Kappa: posted X agrees with posted A (slope 0.88) but not with the unverified M1 and M2
    # around it, which agree with each other (slope 1.0). Bridging M1-M2 would drop X as an
    # outlier, but ruling R18 forbids a worse tier evicting a better one: X stays and M1, which
    # deviates from the posted line A-X, is dropped as UNVERIFIED_DEVIATION.
    lat = 54.0
    sub = ("S11", "Kappa")
    fx.track("KT", [P(i, lat) for i in range(0, 10)], sub=sub)
    origin = P(0.5, lat)

    def base(i: float) -> float:
        return mp(origin, P(i, lat), 0.0)

    fx.crossing("K0", origin, "KT", mp=30.0, sub=sub)
    fx.markerpost("KM1", P(3.5, lat), "KT", mp=round(30.0 + 1.12 * base(3.5), 2), sub=sub)
    fx.crossing("KX", P(5.0, lat), "KT", mp=round(30.0 + 0.88 * base(5.0), 2), sub=sub)
    fx.markerpost("KM2", P(6.5, lat), "KT", mp=round(30.0 + 1.12 * base(3.5) + 1.236, 2), sub=sub)
    # Lambda: posted L0 and LX are 8 steps apart and agree. The TC-tier anchor LT sits one step
    # (about 650 m, under slope_min_span_m, so the pair always passes) from L0 with a mileage
    # 0.5 mi too high: L0-LT is "ok", LT-LX has slope 0.82, so LT is not an outlier and breaks
    # the all-tier interval at LT. The posted-only rebuild has L0-LX in one piece.
    lat = 54.2
    sub = ("S12", "Lambda")
    fx.track("LT", [P(i, lat) for i in range(0, 10)], sub=sub)
    l0, lt, lx = P(0.5, lat), P(1.5, lat), P(8.5, lat)
    fx.crossing("L0", l0, "LT", mp=50.0, sub=sub)
    fx.crossing("LT1", lt, "LT", mp=None, qualifier="Unknown", tcid=1200, sub=sub)
    fx.tc_row(1200, mile=round(mp(l0, lt, 50.0) + 0.5, 2), subdivision="Lambda")
    fx.crossing("LX", lx, "LT", mp=mp(l0, lx, 50.0), sub=sub)


def scenarios(tmp_path: Path, shuffle_seed: int | None = None) -> NrwnFixture:
    """Return the fixture holding every scenario (not yet written).

    With ``shuffle_seed`` the queued rows of every layer, the TC rows and the vertex direction of
    roughly half of the lines are shuffled. The pipeline must not care (Review Focus 1), so the
    build output must be byte-identical either way.
    """
    fx = NrwnFixture(tmp_path)
    _alpha(fx)
    _others(fx)
    if shuffle_seed is not None:
        rng = random.Random(shuffle_seed)  # noqa: S311 - test shuffling, not security
        for rows in fx._rows.values():
            rng.shuffle(rows)
            for row in rows:
                if row.parts is not None and len(row.parts[0]) > 1 and rng.random() < 0.5:
                    row.parts = [part[::-1] for part in row.parts]
        rng.shuffle(fx._tc)
    return fx


def build_synthetic(out: Path, shuffle_seed: int | None = None) -> BuildResult:
    """Write the scenario fixture to a temporary directory and build it into ``out``."""
    with tempfile.TemporaryDirectory() as tmp:
        fx = scenarios(Path(tmp), shuffle_seed)
        nrwn = fx.write()
        return build_province("sk", nrwn, fx.tc_path, SYNTHETIC_SOURCES, out, CFG)


def tree_sha256(root: Path) -> str:
    """SHA-256 over the sorted ``(POSIX relative path, file SHA-256)`` pairs under ``root``."""
    digest = hashlib.sha256()
    for path in sorted(p for p in root.rglob("*") if p.is_file()):
        digest.update(path.relative_to(root).as_posix().encode("utf-8") + b"\0")
        digest.update(hashlib.sha256(path.read_bytes()).hexdigest().encode("ascii") + b"\n")
    return digest.hexdigest()
