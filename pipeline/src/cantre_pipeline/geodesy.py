"""Geodesy for the pipeline: a line-for-line port of ``@cantre/core``.

The operation order of every expression matches the TypeScript source so that Python and
TypeScript agree to within 1e-6 m on ``fixtures/geodesy-golden.json``. Both are held within
1 mm of GeographicLib (GRS80) on segments of 2 km or less. Source: CANTRE spec section 6
(Geodesy); TypeScript counterparts are named in each docstring.

Method in one paragraph: work in a local tangent plane (equirectangular) whose metres-per-degree
scales are evaluated at the segment mid-latitude; subdivide edges longer than 2 km for distance
only; clamp projections to the segment. Coordinates are (lat, lon) in degrees, NAD83(CSRS98) on
the GRS80 ellipsoid, with no datum transformation. Z values are never used.
"""

import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal, NamedTuple

# --- Units (packages/core/src/units.ts) -----------------------------------------------------

METRES_PER_MILE = 1609.344
"""Metres in one international mile, exact (units.ts ``METRES_PER_MILE``)."""

# --- Ellipsoid (packages/core/src/ellipsoid.ts) ---------------------------------------------

GRS80_A = 6378137.0
"""GRS80 semi-major axis, metres (exact by definition)."""

GRS80_F = 1 / 298.257222101
"""GRS80 flattening, dimensionless (the defining value)."""

GRS80_E2 = GRS80_F * (2 - GRS80_F)
"""First eccentricity squared, e^2 = f (2 - f), dimensionless (ellipsoid.ts ``GRS80.e2``)."""

# Longest segment treated as one tangent-plane patch, metres (distance.ts ``MAX_PATCH_M``).
MAX_PATCH_M = 2000

# Two cross-track residuals closer than this are equal when picking the best edge; lowest index
# wins. Metres. Guards float round-off only (polyline.ts ``TIE_EPSILON_M``).
TIE_EPSILON_M = 1e-9


class LatLon(NamedTuple):
    """A position in decimal degrees: ``lat`` positive north, ``lon`` positive east."""

    lat: float
    lon: float


# Scope guard: a rectangle around Canada, degrees (coords.ts ``CANADA_ENVELOPE``). It catches
# swapped lat/lon and positive-west longitudes; it is not a geofence.
CANADA_MIN_LAT = 41.5
CANADA_MAX_LAT = 83.5
CANADA_MIN_LON = -141.5
CANADA_MAX_LON = -52.0


def _assert_finite(value: float, name: str) -> None:
    """Raise ``ValueError`` unless ``value`` is finite (units.ts ``assertFinite``)."""
    if not math.isfinite(value):
        raise ValueError(f"{name} must be a finite number, got {value}")


def assert_lat_lon_range(p: LatLon) -> None:
    """Check that ``p`` is a real point on the globe (coords.ts ``assertLatLonRange``).

    Order, first failure wins: both finite, then ``|lat| <= 90``, then ``|lon| <= 180``. Degrees.

    Raises:
        ValueError: if a rule fails.
    """
    _assert_finite(p.lat, "lat")
    _assert_finite(p.lon, "lon")
    if abs(p.lat) > 90:
        raise ValueError(f"lat must be within [-90, 90], got {p.lat}")
    if abs(p.lon) > 180:
        raise ValueError(f"lon must be within [-180, 180], got {p.lon}")


def assert_lat_lon(p: LatLon) -> None:
    """Check ``p`` is on the globe and inside the Canada envelope (coords.ts ``assertLatLon``).

    The envelope is inclusive of its boundary. Degrees.

    Raises:
        ValueError: if a rule fails.
    """
    assert_lat_lon_range(p)
    if (
        p.lat < CANADA_MIN_LAT
        or p.lat > CANADA_MAX_LAT
        or p.lon < CANADA_MIN_LON
        or p.lon > CANADA_MAX_LON
    ):
        raise ValueError(
            f"({p.lat}, {p.lon}) is outside the Canada envelope; "
            "longitude is negative west of Greenwich"
        )


def _w2(lat_deg: float) -> float:
    """Return W^2 = 1 - e^2 sin^2(phi), dimensionless (ellipsoid.ts ``w2``)."""
    _assert_finite(lat_deg, "latitude")
    s = math.sin((lat_deg * math.pi) / 180)  # degrees to radians
    return 1 - GRS80_E2 * s * s


def meridional_radius_m(lat_deg: float) -> float:
    """Return the meridional radius of curvature M in metres (ellipsoid.ts).

    Formula: ``M = a (1 - e^2) / (1 - e^2 sin^2 phi)^(3/2)``. Latitude in degrees.

    Raises:
        ValueError: if ``lat_deg`` is not finite.
    """
    return (GRS80_A * (1 - GRS80_E2)) / math.pow(_w2(lat_deg), 1.5)


def prime_vertical_radius_m(lat_deg: float) -> float:
    """Return the prime-vertical radius of curvature N in metres (ellipsoid.ts).

    Formula: ``N = a / (1 - e^2 sin^2 phi)^(1/2)``. Latitude in degrees.

    Raises:
        ValueError: if ``lat_deg`` is not finite.
    """
    return GRS80_A / math.sqrt(_w2(lat_deg))


def metres_per_degree(lat_deg: float) -> tuple[float, float]:
    """Return ``(lat_m, lon_m)``, metres per degree of latitude and longitude (ellipsoid.ts).

    Formulas: ``lat_m = M(phi) pi/180`` (north-south), ``lon_m = N(phi) cos(phi) pi/180``
    (east-west; N cos(phi) is the radius of the parallel). Latitude in degrees.

    Raises:
        ValueError: if ``lat_deg`` is not finite.
    """
    rad_per_deg = math.pi / 180
    return (
        meridional_radius_m(lat_deg) * rad_per_deg,
        prime_vertical_radius_m(lat_deg) * math.cos(lat_deg * rad_per_deg) * rad_per_deg,
    )


def _assert_scale_lat(scale_lat: float) -> None:
    """Require a finite ``scale_lat`` with ``|scale_lat| < 90`` (east-west scale is 0 at 90)."""
    _assert_finite(scale_lat, "scale_lat")
    if abs(scale_lat) >= 90:
        raise ValueError(f"scale_lat must be strictly within (-90, 90), got {scale_lat}")


def to_local_m(origin: LatLon, p: LatLon, scale_lat: float) -> tuple[float, float]:
    """Project ``p`` into the tangent plane at ``origin``; return ``(x, y)`` in metres.

    Formulas (coords.ts ``toLocalM``): ``x = (lon - lon0) lonM(scale_lat)``,
    ``y = (lat - lat0) latM(scale_lat)``; x is metres east, y metres north.
    Error: below 1 mm for 2 km patches at the mid-latitude scale (worst case 0.734 mm at lat
    83.5, azimuth 56 degrees; see the core docstring), growing as L^3.
    Limits: no antimeridian wrap; range checks only, no envelope check.

    Raises:
        ValueError: on a non-finite, out-of-range or degenerate (|scale_lat| >= 90) input.
    """
    assert_lat_lon_range(origin)
    assert_lat_lon_range(p)
    _assert_scale_lat(scale_lat)
    lat_m, lon_m = metres_per_degree(scale_lat)
    return ((p.lon - origin.lon) * lon_m, (p.lat - origin.lat) * lat_m)


def from_local_m(origin: LatLon, x: float, y: float, scale_lat: float) -> LatLon:
    """Inverse of :func:`to_local_m`: tangent-plane metres back to a position (coords.ts).

    Formulas: ``lon = lon0 + x / lonM``, ``lat = lat0 + y / latM``. Metres in, degrees out.
    The result is not range-checked.

    Raises:
        ValueError: on a non-finite input or ``|scale_lat| >= 90``.
    """
    assert_lat_lon_range(origin)
    _assert_finite(x, "x")
    _assert_finite(y, "y")
    _assert_scale_lat(scale_lat)
    lat_m, lon_m = metres_per_degree(scale_lat)
    return LatLon(origin.lat + y / lat_m, origin.lon + x / lon_m)


def _planar_length_m(a: LatLon, b: LatLon) -> float:
    """Return the tangent-plane length of a->b in metres (distance.ts ``planarLengthM``)."""
    mid_lat = (a.lat + b.lat) / 2  # scale at the mid-latitude cancels the first-order drift
    x, y = to_local_m(a, b, mid_lat)
    return math.hypot(x, y)


def distance_m(a: LatLon, b: LatLon) -> float:
    """Return the GRS80 distance between two positions in metres (distance.ts ``distanceM``).

    Method: ``d = sqrt(dx^2 + dy^2)`` on the tangent plane scaled at the mid-latitude. If that
    exceeds 2000 m the segment is split into ``n = ceil(L / 2000)`` equal parts by linear
    interpolation in lat/lon and the planar part lengths are summed (spec section 6: subdivided
    for distance only, so no curvature is invented).
    Units: degrees in, metres out. Error: at most 0.734 mm per 2 km patch (see
    :func:`to_local_m`). Beyond one patch the straight lat/lon path differs from the true geodesic
    at second order (about 1.7e-4 relative for 50 km due east at lat 83).
    Limits: range checked (finite, |lat| <= 90, |lon| <= 180) but not against the envelope.

    Raises:
        ValueError: on a non-finite or out-of-range coordinate.
    """
    assert_lat_lon_range(a)  # rejects unit blunders before the subdivision count is computed
    assert_lat_lon_range(b)
    rough = _planar_length_m(a, b)
    if rough <= MAX_PATCH_M:
        return rough
    n = math.ceil(rough / MAX_PATCH_M)  # number of equal sub-segments
    total = 0.0
    prev = a
    for i in range(1, n + 1):
        f = i / n  # fraction of the way from a to b
        nxt = b if i == n else LatLon(a.lat + f * (b.lat - a.lat), a.lon + f * (b.lon - a.lon))
        total += _planar_length_m(prev, nxt)
        prev = nxt
    return total


@dataclass(frozen=True)
class SegmentProjection:
    """Result of projecting a position onto one straight segment (segment.ts).

    Attributes:
        t: Clamped fraction in [0, 1] (0 is ``a``, 1 is ``b``), dimensionless.
        point: Projected point Q, degrees (``a`` or ``b`` exactly when clamped).
        cross_track_m: Distance from the position to ``point``, metres. A geometric residual only.
        along_segment_m: Distance from ``a`` to ``point`` along the segment, ``t * length``, metres.
        segment_length_m: Length of a->b from :func:`distance_m`, metres.
        clamped: Which end the raw projection was clamped to, or ``"none"``.
    """

    t: float
    point: LatLon
    cross_track_m: float
    along_segment_m: float
    segment_length_m: float
    clamped: Literal["none", "start", "end"]


def project_onto_segment(p: LatLon, a: LatLon, b: LatLon) -> SegmentProjection:
    """Project ``p`` onto the straight segment ``a``->``b``, clamped (segment.ts).

    Method (spec section 6; docs/PROJECTION.md): in the tangent plane at ``a`` with scales at the
    segment mid-latitude, ``D = B - A``, ``V = P - A``, ``t_raw = (V . D) / (D . D)``,
    ``t = clamp(t_raw, 0, 1)``, ``Q = A + t D``, ``cross = |P - Q|``, ``along = t * length``.
    Zero-length segment (``D . D = 0``): ``t = 0``, ``along = 0``, ``clamped = "none"`` and the
    cross-track is the distance to ``a``.
    Units: degrees in, metres out. Error: as :func:`to_local_m` (below 1 mm up to 2 km).
    Limits: all three points are checked against the Canada envelope; the residual is a geometric
    quantity, not survey accuracy.

    Raises:
        ValueError: on a non-finite, out-of-range or out-of-envelope coordinate.
    """
    assert_lat_lon(p)
    assert_lat_lon(a)
    assert_lat_lon(b)

    scale_lat = (a.lat + b.lat) / 2  # segment mid-latitude, degrees
    segment_length_m = distance_m(a, b)  # metres, subdivided for long segments

    # Step 1: D = B - A and V = P - A, metres east (x) and north (y) of A.
    dx, dy = to_local_m(a, b, scale_lat)
    vx, vy = to_local_m(a, p, scale_lat)

    # Step 2: squared segment length D . D (m^2); zero means a degenerate (point) segment.
    dd = dx * dx + dy * dy

    # Steps 3 and 4: unbounded fraction t_raw = (V . D) / (D . D), then clamp to the segment.
    t = 0.0
    clamped: Literal["none", "start", "end"] = "none"
    if dd > 0:
        t_raw = (vx * dx + vy * dy) / dd
        if t_raw < 0:
            t = 0.0
            clamped = "start"
        elif t_raw > 1:
            t = 1.0
            clamped = "end"
        else:
            t = t_raw

    # Step 5: Q = A + t D (exactly a or b when clamped, avoiding round-off).
    qx, qy = t * dx, t * dy
    if t == 0:
        point = a
    elif t == 1:
        point = b
    else:
        point = from_local_m(a, qx, qy, scale_lat)

    # Step 6: residual |P - Q| (m) and distance along the segment, t * length (m).
    cross_track_m = math.hypot(vx - qx, vy - qy)
    along_segment_m = t * segment_length_m

    return SegmentProjection(t, point, cross_track_m, along_segment_m, segment_length_m, clamped)


def cumulative_lengths_m(pts: Sequence[LatLon]) -> list[float]:
    """Return cumulative along-chain distance to every vertex, metres (polyline.ts).

    Formula: ``c[0] = 0``, ``c[i] = c[i-1] + distance_m(v[i-1], v[i])``. A duplicate vertex adds
    0; a one-vertex line gives ``[0.0]``. Every vertex is checked against the envelope.

    Raises:
        ValueError: on an empty line or an invalid vertex.
    """
    if len(pts) == 0:
        raise ValueError("polyline has no vertices")
    for v in pts:
        assert_lat_lon(v)
    cum = [0.0]
    for i in range(1, len(pts)):
        cum.append(cum[i - 1] + distance_m(pts[i - 1], pts[i]))  # metres
    return cum


@dataclass(frozen=True)
class RangeProjection:
    """Best projection of a position onto a range of polyline edges.

    Attributes:
        index: Index ``i`` of the best edge (vertex ``i`` to vertex ``i + 1``).
        t: Clamped fraction in [0, 1] along that edge, dimensionless.
        s_m: Position along the chain from vertex 0, ``cum[i] + along``, metres.
        cross_track_m: Distance from the position to the projected point, metres.
    """

    index: int
    t: float
    s_m: float
    cross_track_m: float


def project_onto_range(
    p: LatLon, pts: Sequence[LatLon], cum: Sequence[float], i0: int, i1: int
) -> RangeProjection:
    """Project ``p`` onto edges ``i0 .. i1 - 1`` of a polyline only (polyline.ts, restricted).

    As ``projectOntoPolyline`` in core, ``s = cum[i] + t * length(i)`` for the edge ``i`` with the
    least cross-track; ties within 1e-9 m go to the lowest index. Edges outside ``[i0, i1)`` are
    never considered, which lets the caller confine a match to one chain section. ``cum`` must
    come from :func:`cumulative_lengths_m` for the same ``pts``; only its length is checked.
    Units: degrees in, metres out. Cost: O(i1 - i0) edges.

    Raises:
        ValueError: if ``cum`` and ``pts`` differ in length, the edge range is not
            ``0 <= i0 < i1 <= len(pts) - 1``, or a coordinate is invalid.
    """
    if len(cum) != len(pts):
        raise ValueError(f"cumulative has {len(cum)} entries for {len(pts)} vertices")
    if not 0 <= i0 < i1 <= len(pts) - 1:
        raise ValueError(f"edge range [{i0}, {i1}) invalid for {len(pts)} vertices")
    best_i = i0
    best = project_onto_segment(p, pts[i0], pts[i0 + 1])
    for i in range(i0 + 1, i1):
        r = project_onto_segment(p, pts[i], pts[i + 1])
        if r.cross_track_m < best.cross_track_m - TIE_EPSILON_M:
            best_i = i
            best = r
    return RangeProjection(best_i, best.t, cum[best_i] + best.along_segment_m, best.cross_track_m)
