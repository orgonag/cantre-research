"""Tests for cantre_pipeline.geodesy: ports of the M1 core cases plus the shared golden file."""

import json
import math
from pathlib import Path
from typing import Any

import pytest
from geographiclib.geodesic import Geodesic  # type: ignore[import-untyped]
from hypothesis import given, settings
from hypothesis import strategies as st

from cantre_pipeline.geodesy import (
    LatLon,
    cumulative_lengths_m,
    distance_m,
    from_local_m,
    metres_per_degree,
    project_onto_range,
    project_onto_segment,
    to_local_m,
)

GOLDEN = Path(__file__).resolve().parents[2] / "fixtures" / "geodesy-golden.json"
GRS80 = Geodesic(6378137.0, 1 / 298.257222101)


def load_golden() -> dict[str, Any]:
    """Read the shared golden file."""
    with GOLDEN.open(encoding="utf-8") as fh:
        data: dict[str, Any] = json.load(fh)
    return data


def geodesic_m(a: LatLon, b: LatLon) -> float:
    """GeographicLib GRS80 inverse distance in metres."""
    s12: float = GRS80.Inverse(a.lat, a.lon, b.lat, b.lon)["s12"]
    return s12


def test_distance_matches_geographiclib_within_1mm() -> None:
    for case in load_golden()["distance"]:
        assert abs(distance_m(LatLon(*case["a"]), LatLon(*case["b"])) - case["geodesicM"]) < 1e-3


# The golden file was written on Windows (UCRT libm) but CI runs on Linux (glibc). math.sin, cos
# and pow may differ by 1 ulp between them, so recorded values are compared to an explicit
# absolute tolerance (metres for distances, dimensionless for t) rather than with ==.
GOLDEN_TOL = 1e-9


def test_distance_reproduces_recorded_python_values_within_tolerance() -> None:
    for case in load_golden()["distance"]:
        d = distance_m(LatLon(*case["a"]), LatLon(*case["b"]))
        assert abs(d - case["pythonM"]) < GOLDEN_TOL


def test_golden_header_is_as_documented() -> None:
    golden = load_golden()
    assert golden["seed"] == 20261024
    assert len(golden["distance"]) == 2000
    assert len(golden["projection"]) == 500


def test_projection_matches_golden() -> None:
    for case in load_golden()["projection"]:
        r = project_onto_segment(LatLon(*case["p"]), LatLon(*case["a"]), LatLon(*case["b"]))
        assert abs(r.t - case["t"]) < GOLDEN_TOL
        assert abs(r.cross_track_m - case["crossTrackM"]) < GOLDEN_TOL
        assert abs(r.along_segment_m - case["alongM"]) < GOLDEN_TOL


def test_projection_interior_endpoint_and_zero_length() -> None:
    a, b = LatLon(52.0, -106.0), LatLon(52.0, -105.99)
    mid = project_onto_segment(LatLon(52.0001, -105.995), a, b)
    assert 0.49 < mid.t < 0.51 and mid.clamped == "none"
    assert abs(mid.cross_track_m - 11.13) < 0.05
    assert project_onto_segment(LatLon(52.0, -106.01), a, b).clamped == "start"
    z = project_onto_segment(LatLon(52.0001, -106.0), a, a)
    assert z.t == 0.0 and z.segment_length_m == 0.0 and z.clamped == "none"


def test_projection_clamps_past_the_end() -> None:
    a, b = LatLon(52.0, -106.0), LatLon(52.0, -105.99)
    r = project_onto_segment(LatLon(52.0, -105.98), a, b)
    assert r.clamped == "end" and r.t == 1.0 and r.point == b
    assert r.along_segment_m == r.segment_length_m


def test_long_edges_are_subdivided_for_distance_only() -> None:
    a, b = LatLon(54.0, -110.0), LatLon(54.0, -109.9)  # ~6.5 km
    assert abs(distance_m(a, b) - geodesic_m(a, b)) < 1e-3


def test_cumulative_lengths() -> None:
    pts = [LatLon(52.0, -106.0), LatLon(52.0, -105.99), LatLon(52.0, -105.99)]
    cum = cumulative_lengths_m(pts)
    assert cum[0] == 0.0 and cum[2] == cum[1] and cum[1] == distance_m(pts[0], pts[1])
    assert cumulative_lengths_m([pts[0]]) == [0.0]
    with pytest.raises(ValueError, match="no vertices"):
        cumulative_lengths_m([])


def test_project_onto_range_ignores_edges_outside_range() -> None:
    pts = [LatLon(52.0, -106.0), LatLon(52.0, -105.99), LatLon(52.0, -105.98)]
    cum = cumulative_lengths_m(pts)
    r = project_onto_range(LatLon(52.0, -105.975), pts, cum, 0, 1)
    assert r.index == 0 and r.t == 1.0 and r.s_m == cum[1]


def test_project_onto_range_picks_nearest_edge_and_lowest_on_tie() -> None:
    pts = [LatLon(52.0, -106.0), LatLon(52.0, -105.99), LatLon(52.0, -105.98)]
    cum = cumulative_lengths_m(pts)
    r = project_onto_range(LatLon(52.0001, -105.985), pts, cum, 0, 2)
    assert r.index == 1 and 0.49 < r.t < 0.51
    assert abs(r.s_m - (cum[1] + r.t * (cum[2] - cum[1]))) < 1e-9
    # A point on the shared vertex ties between edge 0 (t=1) and edge 1 (t=0): lowest index wins.
    tie = project_onto_range(pts[1], pts, cum, 0, 2)
    assert tie.index == 0 and tie.s_m == cum[1]


@pytest.mark.parametrize(("i0", "i1"), [(-1, 1), (1, 1), (2, 1), (0, 3)])
def test_project_onto_range_rejects_bad_range(i0: int, i1: int) -> None:
    pts = [LatLon(52.0, -106.0), LatLon(52.0, -105.99), LatLon(52.0, -105.98)]
    with pytest.raises(ValueError, match="edge range"):
        project_onto_range(pts[0], pts, cumulative_lengths_m(pts), i0, i1)


def test_project_onto_range_rejects_mismatched_cumulative() -> None:
    pts = [LatLon(52.0, -106.0), LatLon(52.0, -105.99)]
    with pytest.raises(ValueError, match="cumulative"):
        project_onto_range(pts[0], pts, [0.0], 0, 1)


@pytest.mark.parametrize(
    "bad",
    [
        LatLon(math.nan, -106.0),
        LatLon(52.0, math.inf),
        LatLon(91.0, -106.0),
        LatLon(52.0, -181.0),
        LatLon(52.0, 106.0),  # positive-west blunder: on the globe, outside the envelope
    ],
)
def test_invalid_coordinates_raise(bad: LatLon) -> None:
    good = LatLon(52.0, -106.0)
    with pytest.raises(ValueError, match=r"lat|lon"):
        project_onto_segment(bad, good, good)


@pytest.mark.parametrize(
    "bad", [LatLon(math.nan, -106.0), LatLon(91.0, -106.0), LatLon(52.0, 181.0)]
)
def test_distance_checks_range(bad: LatLon) -> None:
    with pytest.raises(ValueError, match=r"lat|lon"):
        distance_m(bad, LatLon(52.0, -106.0))


def test_distance_has_no_envelope_check() -> None:
    assert distance_m(LatLon(0.0, 0.0), LatLon(0.0, 0.001)) > 100


def test_local_plane_round_trip_and_scale_guard() -> None:
    o, p = LatLon(52.0, -106.0), LatLon(52.001, -105.999)
    x, y = to_local_m(o, p, 52.0005)
    q = from_local_m(o, x, y, 52.0005)
    assert abs(q.lat - p.lat) < 1e-12 and abs(q.lon - p.lon) < 1e-12
    for bad in (90.0, math.nan):
        with pytest.raises(ValueError, match="scale_lat"):
            to_local_m(o, p, bad)
        with pytest.raises(ValueError, match="scale_lat"):
            from_local_m(o, 1.0, 1.0, bad)
    with pytest.raises(ValueError, match="x"):
        from_local_m(o, math.nan, 0.0, 52.0)
    with pytest.raises(ValueError, match="y"):
        from_local_m(o, 0.0, math.inf, 52.0)


def test_metres_per_degree_known_values() -> None:
    # Equator: M*pi/180 = 110574.276 m/deg, N*pi/180 = 111319.49 m/deg (GRS80).
    lat_m, lon_m = metres_per_degree(0.0)
    assert abs(lat_m - 110574.2758) < 1e-3 and abs(lon_m - 111319.4908) < 1e-3
    with pytest.raises(ValueError, match="latitude"):
        metres_per_degree(math.nan)


# Integer micro-degree strategies keep hypothesis shrinking readable and the inputs exactly
# representable on a 1e-6 degree grid (about 0.1 m).
_lat = st.integers(49_000_000, 60_000_000)
_lon = st.integers(-110_000_000, -101_000_000)
_off = st.integers(-9_000, 9_000)  # micro-degrees, up to ~1 km


@settings(max_examples=300, deadline=None)
@given(_lat, _lon, _off, _off, _off, _off)
def test_property_cross_track_is_perpendicular(
    lat0: int, lon0: int, dlat: int, dlon: int, plat: int, plon: int
) -> None:
    a = LatLon(lat0 / 1e6, lon0 / 1e6)
    b = LatLon((lat0 + dlat) / 1e6, (lon0 + dlon) / 1e6)
    p = LatLon((lat0 + plat) / 1e6, (lon0 + plon) / 1e6)
    r = project_onto_segment(p, a, b)
    if r.clamped != "none" or r.cross_track_m < 1e-3 or r.segment_length_m == 0.0:
        return
    scale_lat = (a.lat + b.lat) / 2
    dx, dy = to_local_m(a, b, scale_lat)
    px, py = to_local_m(a, p, scale_lat)
    qx, qy = r.t * dx, r.t * dy
    # (P - Q) . D / |D| is the component of the residual along the segment: must vanish.
    along_component = ((px - qx) * dx + (py - qy) * dy) / math.hypot(dx, dy)
    assert abs(along_component) < 1e-6
