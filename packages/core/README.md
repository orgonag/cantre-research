# @cantre/core

The calculation core of CANTRE (Canada Track Rail Estimation). Given a GPS fix, a track
centreline and a set of milepost anchors, it computes the distance along the track, the
sideways offset from it, an interpolated milepost, and the milepost band that GPS accuracy
alone implies. It has no I/O, no state and no dependencies. Every function takes degrees
and metres (mileposts in miles), and rejects bad input with a typed `CoreInputError` instead
of repairing it. This package is research code. It states what it computes and what it does
not, and it is not a survey instrument.

Full design: [v1 design spec](../../docs/superpowers/specs/2026-10-23-cantre-v1-design.md),
section 6. Worked projection maths: [PROJECTION.md](../../docs/PROJECTION.md).

## API

All names are exported from `src/index.ts`. Latitude and longitude are decimal degrees
(`LatLon = { lat, lon }`, longitude negative west of Greenwich). Spec section numbers refer
to the v1 design spec.

| Export | Signature | Units | Spec |
|---|---|---|---|
| `CoreInputError` | `new CoreInputError(code, message?)`, has `.code`, `.name` | n/a | §6, §8 |
| `CoreInputCode` (type) | closed union of reason codes | n/a | §6 |
| `METRES_PER_MILE` | `1609.344` | m/mi, exact | §6 |
| `milesToMetres` | `(mi) => m` | mi to m | §6 |
| `metresToMiles` | `(m) => mi` | m to mi | §6 |
| `milesToKilometres` | `(mi) => km` | mi to km | §6 |
| `GRS80` | `{ a, f, e2 }` | a in m; f, e2 dimensionless | §6 |
| `meridionalRadiusM` | `(latDeg) => M` | deg to m | §6 |
| `primeVerticalRadiusM` | `(latDeg) => N` | deg to m | §6 |
| `metresPerDegree` | `(latDeg) => { latM, lonM }` | deg to m/deg | §6 |
| `CANADA_ENVELOPE` | `{ minLat, maxLat, minLon, maxLon }` | deg | §6 |
| `assertLatLonRange` | `(p) => void` | deg | §6 |
| `assertLatLon` | `(p) => void`, range plus Canada envelope | deg | §6 |
| `toLocalM` | `(origin, p, scaleLat) => { x, y }` | deg to m east/north | §6 |
| `fromLocalM` | `(origin, { x, y }, scaleLat) => LatLon` | m to deg | §6 |
| `distanceM` | `(a, b) => m` | deg to m | §6 |
| `projectOntoSegment` | `(p, a, b) => SegmentProjection` | deg in; m out | §6 |
| `cumulativeLengthsM` | `(line) => Float64Array` | deg to m | §6 |
| `projectOntoPolyline` | `(p, line, cumulative?) => PolylineProjection` | deg in; m out | §6 |
| `NEAR_TIE_TOLERANCE_M` | `1` | m | §6 |
| `validateInterval` | `(anchors) => IntervalIssue[]` | s in m, mp in mi | §6 |
| `interpolateMilepost` | `(s, anchors) => MilepostResult` | m in; mi out | §6 |
| `gpsMilepostBandMi` | `(accuracyM, lower, upper) => mi` | m in; mi out | §6 |

Types: `LatLon`, `SegmentProjection`, `Polyline`, `PolylineProjection`, `Anchor`,
`AnchorSource`, `IntervalIssue`, `IntervalIssueCode`, `MilepostResult`, `UncalibratedReason`.

## Method

**Distance.** The core works in a local tangent plane, a flat map of a small patch of the
GRS80 ellipsoid. For two points it takes the mid-latitude, converts degrees of latitude and
longitude to metres with the ellipsoid's meridional and prime-vertical radii, and applies
Pythagoras. Scaling at the mid-latitude cancels the first-order drift between the two ends.
Against GeographicLib's exact geodesic, the worst case found for a segment of up to 2 km is
0.734 mm, at latitude 83.5 degrees, azimuth 56 degrees and d = 2000 m, from a deterministic
sweep; 50000 seeded random draws peaked at 0.660 mm. Both come from
`scripts/measure-distance-error.mjs` (`npm run measure:distance -w @cantre/core`), which
anyone can rerun. The textbook term
L³·tan²φ/(24R²) describes the same-parallel case only and is not the worst case. Segments
longer than 2 km are split into equal parts whose planar lengths are summed. This is for
distance only, and over long east-west spans at high latitude it drifts: about 1.69e-4
relative error at 83 degrees over 50 km due east (same script).

**Projection.** To place a point on a segment, both are mapped into a tangent plane scaled at
the segment's mid-latitude. The point is dropped onto the segment's line with a dot product,
the fraction `t` is clamped to the range 0 to 1, and the result is the foot of the
perpendicular, the cross-track distance (sideways offset, metres) and the along-segment
distance (`t` times the segment length). A projection test at a 5 km cross-track offset agreed
to within 0.1 %. For a polyline the core projects onto every segment, keeps the nearest, and
adds the cumulative length of the preceding segments to give the chain position `alongM`. Any
other segment within 1 m of the best cross-track distance, and more than 1 m away along the
chain, is listed in `nearTieAlongM`. That rule can also report a neighbouring segment near,
but not on, a sharp-angle vertex. This is deliberate: it over-reports ambiguity rather than
hiding it. Milestone M3 refines how ambiguity is used.

**Interpolation.** Anchors are points on the chain with a known chain position `s` (metres)
and posted milepost `mp` (miles). `validateInterval` requires at least two anchors, finite
values, strictly increasing `s` and strictly monotonic `mp`. `interpolateMilepost` finds the
bracketing pair and interpolates linearly in `s`:
`mp = mp₁ + (s − s₁) / (s₂ − s₁) · (mp₂ − mp₁)`. It interpolates along the track, not along the
chord. An exact anchor hit returns that anchor's milepost. Outside the first and last anchor it returns
`uncalibrated` and never extrapolates.

**GPS band.** `gpsMilepostBandMi` converts the reported GPS accuracy into miles using the
local milepost slope: `accuracyM · |mp₂ − mp₁| / (s₂ − s₁)`. It reflects GPS accuracy only. It
is not a confidence interval, and it does not include cross-track offset, the survey accuracy of
the anchors, or the chance that the true position lies outside the accuracy circle. Those stay
separate.

## Limits

- No datum transform. NAD83(CSRS) track data is used as-is against WGS 84 GPS fixes, which
  adds roughly 1 to 2 m of bias (spec §3). This is a limit, not a correction.
- Canada envelope only: latitude 41.5 to 83.5, longitude −141.5 to −52. Points outside it
  raise `OUTSIDE_CANADA_ENVELOPE`. Longitude must be negative west of Greenwich.
- Along-chain ambiguity (for example at diamonds and parallel routes) is flagged through
  `nearTieAlongM` but not resolved here.
- A calculated milepost is not a survey result. Its accuracy is bounded by the anchors and
  the centreline it is built on. Anchors are never invented, and nothing is extrapolated or
  bridged across a gap.
- No claim is made about a 1 % compliance figure; its denominator and near-zero rule are not
  agreed (see AGENTS.md).

## Tests

```text
npm test            # unit and property tests
npm run coverage    # adds the coverage gate: lines 95, branches 90, functions 100
```

The test suite checks distance and projection against GeographicLib
(`geographiclib-geodesic`), and runs four property tests of 1000 generated cases each
(perpendicular residual, monotonic `alongM`, interpolation between brackets, finite outputs).
