"""Generate ``fixtures/geodesy-golden.json``, the golden file shared by pytest and Vitest.

Seed 20261024. Draws 2,000 distance pairs and 500 projection triples spread over lat 41.5-83.5
and lon -141 to -52 (the Canada envelope). Distance pairs: 1,950 with length 0-2 km plus 50 of
2-10 km. Expected distances come from GeographicLib on GRS80 (not WGS84).

``geodesicM`` is the true geodesic length for a pair of 2 km or less. For the 2-10 km pairs it is
the sum of true geodesic lengths over the same equal lat/lon subdivision that ``distance_m`` uses,
because the subdivided path is deliberately a straight line in lat/lon, which differs from the
true geodesic by a second-order amount (tens of millimetres at high latitude, spec section 6).
This keeps the "within 1 mm of GeographicLib" statement checkable for every row.

``pythonM`` and the projection values come from the Python implementation; the TypeScript test
holds them to 1e-6 m. Output is canonical JSON (sorted keys, compact, UTF-8, trailing newline).

Usage: ``python pipeline/scripts/make_geodesy_golden.py`` from the repository root.
"""

import json
import math
import random
from pathlib import Path
from typing import Any

from geographiclib.geodesic import Geodesic

from cantre_pipeline.geodesy import (
    CANADA_MAX_LAT,
    CANADA_MAX_LON,
    CANADA_MIN_LAT,
    CANADA_MIN_LON,
    MAX_PATCH_M,
    LatLon,
    distance_m,
    project_onto_segment,
)

SEED = 20261024
N_DISTANCE = 2000
N_LONG = 50
N_PROJECTION = 500
GRS80 = Geodesic(6378137.0, 1 / 298.257222101)
OUT = Path(__file__).resolve().parents[2] / "fixtures" / "geodesy-golden.json"


def inside(p: LatLon) -> bool:
    """Return True when ``p`` lies inside the Canada envelope used by the projection checks."""
    return CANADA_MIN_LAT <= p.lat <= CANADA_MAX_LAT and CANADA_MIN_LON <= p.lon <= CANADA_MAX_LON


def direct(p: LatLon, azimuth_deg: float, length_m: float) -> LatLon:
    """Return the point ``length_m`` from ``p`` along ``azimuth_deg`` on GRS80."""
    r = GRS80.Direct(p.lat, p.lon, azimuth_deg, length_m)
    return LatLon(r["lat2"], r["lon2"])


def geodesic_m(a: LatLon, b: LatLon) -> float:
    """Return the GeographicLib GRS80 inverse distance in metres."""
    s12: float = GRS80.Inverse(a.lat, a.lon, b.lat, b.lon)["s12"]
    return s12


def subdivided_geodesic_m(a: LatLon, b: LatLon) -> float:
    """Return the geodesic length summed over the equal lat/lon subdivision of a->b.

    Uses the same split rule as ``distance_m``: ``n = ceil(L / 2000)`` equal parts in lat/lon.
    """
    n = math.ceil(geodesic_m(a, b) / MAX_PATCH_M)
    total = 0.0
    prev = a
    for i in range(1, n + 1):
        f = i / n
        nxt = b if i == n else LatLon(a.lat + f * (b.lat - a.lat), a.lon + f * (b.lon - a.lon))
        total += geodesic_m(prev, nxt)
        prev = nxt
    return total


def draw_start(rng: random.Random) -> LatLon:
    """Draw a start point inside the envelope with a margin for 10 km offsets."""
    return LatLon(rng.uniform(41.6, 83.4), rng.uniform(-141.0, -52.0))


def distance_cases(rng: random.Random) -> list[dict[str, Any]]:
    """Draw the distance pairs."""
    cases: list[dict[str, Any]] = []
    for k in range(N_DISTANCE):
        long_pair = k >= N_DISTANCE - N_LONG
        length = rng.uniform(2000.0, 10000.0) if long_pair else rng.uniform(0.0, 2000.0)
        while True:
            a = draw_start(rng)
            b = direct(a, rng.uniform(0.0, 360.0), length)
            if inside(b):
                break
        cases.append(
            {
                "a": [a.lat, a.lon],
                "b": [b.lat, b.lon],
                "geodesicM": subdivided_geodesic_m(a, b) if long_pair else geodesic_m(a, b),
                "pythonM": distance_m(a, b),
            }
        )
    return cases


def projection_cases(rng: random.Random) -> list[dict[str, Any]]:
    """Draw projection triples: segment of 0-2 km, point 0-500 m off, t_raw in [-0.3, 1.3]."""
    cases: list[dict[str, Any]] = []
    for _ in range(N_PROJECTION):
        while True:
            a = draw_start(rng)
            azimuth = rng.uniform(0.0, 360.0)
            length = rng.uniform(0.0, 2000.0)
            b = direct(a, azimuth, length)
            along = direct(a, azimuth, length * rng.uniform(-0.3, 1.3))
            side = azimuth + rng.choice((90.0, -90.0))
            p = direct(along, side, rng.uniform(0.0, 500.0))
            if inside(b) and inside(p) and inside(a):
                break
        r = project_onto_segment(p, a, b)
        cases.append(
            {
                "p": [p.lat, p.lon],
                "a": [a.lat, a.lon],
                "b": [b.lat, b.lon],
                "t": r.t,
                "crossTrackM": r.cross_track_m,
                "alongM": r.along_segment_m,
            }
        )
    return cases


def main() -> None:
    """Write the golden file."""
    rng = random.Random(SEED)  # noqa: S311 - reproducible test data, not security
    doc = {
        "generator": "pipeline/scripts/make_geodesy_golden.py (GeographicLib GRS80, Python port)",
        "seed": SEED,
        "distance": distance_cases(rng),
        "projection": projection_cases(rng),
    }
    text = json.dumps(doc, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n"
    OUT.write_text(text, encoding="utf-8", newline="\n")
    print(f"wrote {OUT} ({len(text)} bytes)")


if __name__ == "__main__":
    main()
