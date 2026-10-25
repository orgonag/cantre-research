# @cantre/core

The calculation core of CANTRE (Canada Track Rail Estimation). Given a GPS fix, a track
centreline and a set of milepost anchors, it computes the distance along the track, the
sideways offset from it, an interpolated milepost, and the milepost band that GPS accuracy
alone implies. It has no I/O, no timers and no dependencies, and its matching state machine is a pure
reducer over an immutable state value (see the matching section below). Every function takes degrees
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
hiding it. The matching state machine (below) decides what to do with it.

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

## Matching state machine (milestone M3)

On top of the calculation functions, `@cantre/core` decides which track a fix is on. It is a
pure reducer, `reduce(state, event)`, over an immutable state value: no I/O, no timers and no
clock. Time enters only through each fix's timestamp and the `nowMs` argument to
`currentResult`. Tile fetching, caching and version pinning are not here (M4); there is no UI.

### Matching API

| Export | Signature / value | Units | Spec |
|---|---|---|---|
| `networkFromTiles` | `(tiles: unknown[]) => NetworkView` (pure decode of `cantre.tile/1` objects; throws `CoreInputError` on a malformed tile, mixed `datasetVersion`, an interval that fails `validateInterval`, a decreasing chain `sMm` or a vertex outside the Canada envelope) | deg, m, mi | §6, §8, §9 |
| `initialMatchState` | `(net, cfg = MATCH_CONFIG) => MatchState` (status `NO_FIX`) | n/a | §6 |
| `reduce` | `(state, event) => { state, ignored }`; `ignored` is the reason code for an ignored fix, else null | ms | §6 |
| `currentResult` | `(state, nowMs) => Result` (applies staleness; throws on non-finite `nowMs`) | ms | §6 |
| `MATCH_CONFIG` | frozen thresholds, table below | per field | §6 |
| `MATCH_STATUSES`, `MATCH_REASONS` | the nine statuses and the 24 reason codes, each once | n/a | §6 |
| `searchRadiusM` | `(accuracyM, cfg) => m` | m | §6 |
| `findCandidates` | `(net, fix, cfg) => Candidate[]`, one per distinct pass of a chain, sorted by `(residualM, chainId, segmentKey, s)` | m | §6 |
| `coverageOf` | `(net, fix, radiusM) => 'outside' \| 'partial' \| 'covered'` | m | §6 |
| `networkFromSnapshot` | `(bytes: Uint8Array) => NetworkView` (decodes the national snapshot of `pipeline/schema/snapshot.md`, after gunzip; deep-equal to `networkFromTiles` on the tiles it was written from; throws `CoreInputError` `INVALID_SNAPSHOT` with a `byte N:` message for any layout, varint, range or invariant violation) | deg, m, mi | §6, §8 |
| `assetsAlong` | `(net, chainBaseId, s, rangeM) => { asset, deltaM }[]` (assets within `rangeM` of `s` along one chain, signed `deltaM` = asset position minus `s`, nearest first) | m | §7 |
| `locateMilepost` | `(net, subdivisionNid, mp) => { chainId, sM, at, intervalId }[]` (inverse of `interpolateMilepost` inside each calibrated interval; never extrapolates; one entry per track) | mi, m, deg | §7 |
| `milepostAtPoint` | `(net, p, cfg?) => { candidate, milepost }[]` (tracks within `searchRadiusMinM` of a tapped point and the milepost each gives, at nominal accuracy 0; "from map position, no GPS") | deg, m, mi | §7 |
| `diamondsNear` | `(net, candidates, radiusM) => DiamondPosition[]` | m | §6 |
| `milepostFor` | `(net, candidate, accuracyM) => CandidateMilepost` | m in; mi out | §6 |
| `lowerTier` | `(a, b) => AnchorTier` (the lower-ranked of two tiers) | n/a | §3 |
| `selectCandidate` | `(input: SelectionInput) => Selection` (the rule list below, pure) | m | §6 |
| `bearingDeg`, `axialDifferenceDeg` | track bearing in `[0, 360)`; difference modulo 180 | deg | §6 |

Types: `MatchEvent`, `MatchState`, `Result`, `MatchStatus`, `MatchReason`, `MatchConfig`,
`Fix`, `Lock`, `Candidate`, `CandidateMilepost`, `Selection`, `SelectionInput`,
`PreviousMatch`, `NetworkView`, `NetworkAsset`, `AssetKind`, `AssetPosition`, `AssetPosted`, `AssetAlong`, `LocatedMilepost`, `PointMilepost`, `NetworkChain`, `NetworkSegment`, `NetworkInterval`,
`DiamondPosition`, `TileBounds`, `AnchorTier`.

Events: `{ type: 'fix', fix }`, `{ type: 'permission', state: 'granted' | 'denied' }`,
`{ type: 'locationError', code }`, `{ type: 'lock', lock }` and `{ type: 'unlock' }`. A `Fix` is
`{ lat, lon, timestampMs, accuracyM, headingDeg?, speedMps? }` (degrees, milliseconds, metres,
degrees clockwise from north, metres per second). A `Lock` is `{ kind: 'chain', chainId }` or
`{ kind: 'subdivision', subdivisionNid }`. A chain lock's `chainId` may be the pipeline chain id
(`Candidate.chainBaseId`, which survives a chain split across unloaded tiles) or a decoded piece
id such as `id#2` (`Candidate.chainId`); a candidate matches when either equals it, so passing
`result.chosen.chainId` back is safe. A piece-id lock covers only that piece.

```ts
let state = initialMatchState(networkFromTiles(tiles));
state = reduce(state, { type: 'fix', fix }).state;
const result = currentResult(state, nowMs); // result.status, result.milepost, result.reasons ...
```

### Statuses

| Status | Meaning | Carries |
|---|---|---|
| `NO_PERMISSION` | Location permission denied. | no position |
| `NO_FIX` | Permitted, but no usable fix yet, or a device error before any fix. | no position |
| `STALE` | The last accepted fix is older than `staleAfterMs` (or stamped in the future). | the last result as `historical` only; nothing current |
| `NO_COVERAGE` | The fix is outside every loaded tile. | no candidates |
| `OFF_NETWORK` | Covered, but no track within the search radius. | no candidates |
| `AMBIGUOUS_ROUTE` | More than one route is plausible, a diamond is near, or the search disk is only partly covered. No route is chosen. | the choices in `candidates` |
| `MATCHED_SUBDIVISION` | One subdivision is certain, the parallel track is not. | `candidates`, and `mpRange` when the tracks agree |
| `MATCHED` | One track is selected, by evidence or by the user's lock. | `chosen`, `s`, `milepost` (null when the chain is uncalibrated, the position is in a gap, or the track is unchained), and every other plausible track in `candidates` |
| `LOCK_CONFLICT` | The user's lock does not fit the fix. The lock is kept; no milepost is shown. | the alternatives in `candidates` |

### Rules

`selectCandidate` applies these in order. Distances are metres; the first rule that settles the
status wins. Every number is a `MATCH_CONFIG` value and is experimental.

1. Search radius = max(50 m, 3 x accuracy). A fix outside every loaded tile is `NO_COVERAGE`.
2. No chain or unchained segment within the radius is `OFF_NETWORK`. A chain gives one candidate
   per distinct pass: every local minimum of the cross-track residual within the radius that is
   more than the radius along the chain from every better pass (a closed cycle wraps at its seam).
   A straight or gently curved chain gives one; a hairpin or loop that passes the fix twice gives
   two. An unchained segment gives its best projection. A zero-length or single-vertex track is a
   point candidate (residual = distance to the point, no bearing); it is never skipped.
3. d_min is the smallest residual over all candidates. The indistinguishable set I holds every
   candidate within d_min + max(accuracy, 10 m). A small residual is not a confidence interval.
   `Result.candidates` reports this whole set I, before any narrowing below, so every other
   plausible route stays visible.
4. A user lock keeps only candidates inside it. If the lock's best candidate is missing or outside
   I the result is `LOCK_CONFLICT`: the lock is kept and never switched silently. Otherwise it is
   `MATCHED` with `selectionOrigin: 'user'`. The heading is not consulted under a lock. A lock
   changes the chosen set, never the reported accuracy, and a lock-decided match never becomes
   continuity: after `unlock` the last fix is re-evaluated from the evidence alone.
5. Heading filter, within I only. Only when speed is above 3 m/s and a heading is given, a member
   of I whose track bearing differs from the heading by more than 30 degrees (axially, so a train
   may run either way) is dropped from the choice. It never changes d_min and never promotes a
   candidate that position rejected. If no member of I that has a bearing agrees with the heading,
   it is not applied (`HEADING_INCONSISTENT`). A point candidate has no bearing: it is kept beside
   an agreeing track, but a heading can never make it win by elimination. A stale heading at a
   standstill is never used.
6. A diamond within the search radius, along-track, of any candidate blocks automatic selection:
   `AMBIGUOUS_ROUTE` (`DIAMOND_NEARBY`), even if one line is nearer and even with a heading.
7. Continuity hold. If the previous automatically matched chain is still within the radius but
   outside I, and every member of I is on that chain's own railway (same subdivision and
   operator), it is held as `MATCHED` (`CONTINUITY_HOLD`) while less than 5000 ms have passed
   since the first contradicting fix (exactly 5000 ms is no longer held), then the evidence wins.
   A different railway in I ends the hold at once. Not used when coverage is partial. Continuity
   never crosses a `STALE` gap, any non-`MATCHED` result, a lock change or the radius. On a hold,
   `chosen` is the held track, which is outside I and so not in `candidates`.
8. More than one route (subdivision and operator) left in the choice: if the previous chain is in
   it keep its route (`CONTINUITY`), else `AMBIGUOUS_ROUTE` (`MULTIPLE_ROUTES`).
9. Partly covered search disk with one route in I: `AMBIGUOUS_ROUTE` (`PARTIAL_COVERAGE`).
10. One candidate left is `MATCHED`. Several tracks of one route, including two passes of one
    chain, are `MATCHED_SUBDIVISION` (`MULTIPLE_TRACKS`).

Milepost of a chain candidate: inside a calibrated interval it is the M1 interpolation with its GPS
band and the lower tier of the two bracketing anchors; before or after the intervals it is
uncalibrated; between two intervals it is null with `DISCONTINUITY_GAP`; with no interval, null
with `CHAIN_UNCALIBRATED`. An unchained segment has no milepost (`UNCHAINED_TRACK`). For
`MATCHED_SUBDIVISION`, `mpRange` is given only when every track is calibrated and the mileposts
differ by no more than the widest band; otherwise it is null with `TRACK_MP_DISAGREE` or
`TRACK_UNCALIBRATED`. Nothing is averaged or bridged.

Fixes with non-finite values, outside the Canada envelope, with negative accuracy, or with a
timestamp that does not increase are ignored, counted in `ignoredFixes` and change nothing. A fix
that arrives while permission is denied is also ignored as `FIX_IGNORED_INVALID` (the app should
not send one); `reduce` returns the code as `ignored`, it is never in `Result.reasons`.

A decoded network never makes `reduce` throw: `networkFromTiles` rejects an interval that fails
`validateInterval`, a decreasing chain `sMm` and any vertex outside the Canada envelope with
`INVALID_TILE` and the failing path.

### Configuration

`MATCH_CONFIG` is frozen and exported. Every value is **experimental**: an engineering starting
point from the spec or a controller decision, not validated against field data. Changing one
changes which fixes are called ambiguous, so any change needs a new evidence run.

| Field | Default | Unit | Source | Status |
|---|---|---|---|---|
| `searchRadiusMinM` | 50 | m | spec §6 | experimental |
| `searchRadiusAccuracyFactor` | 3 | none | spec §6 | experimental |
| `indistinguishableMinM` | 10 | m | spec §6 | experimental |
| `staleAfterMs` | 15000 | ms | spec §6 | experimental |
| `headingMinSpeedMps` | 3 | m/s | M3 plan | experimental |
| `headingToleranceDeg` | 30 | deg | M3 Decision 2 | experimental |
| `continuityMaxMs` | 5000 | ms | M3 Decision 3 | experimental |
| `futureFixToleranceMs` | 1000 | ms | M3 ruling R20 | experimental |

### Reason codes

`MatchReason` is a closed union of 24 `SCREAMING_SNAKE_CASE` codes; `Result.reasons` lists the
ones that apply, in rule order, with no repeats. No free text. EN/FR message text comes with M4.

| Group | Codes |
|---|---|
| Availability | `PERMISSION_DENIED` (permission denied), `LOCATION_UNAVAILABLE` (device error before a fix), `NO_FIX_YET` (permitted, no fix), `FIX_STALE` (last fix older than `staleAfterMs`), `FIX_FROM_FUTURE` (last fix stamped more than `futureFixToleranceMs` ahead of `nowMs`), `FIX_IGNORED_OUT_OF_ORDER` and `FIX_IGNORED_INVALID` (returned by `reduce` as `ignored`) |
| Network | `OUTSIDE_LOADED_TILES`, `PARTIAL_COVERAGE`, `NO_CANDIDATE_IN_RADIUS` |
| Selection | `DIAMOND_NEARBY`, `MULTIPLE_ROUTES`, `MULTIPLE_TRACKS`, `HEADING_USED` (the filter removed a candidate), `HEADING_INCONSISTENT`, `CONTINUITY`, `CONTINUITY_HOLD` |
| Lock | `LOCKED_BY_USER`, `LOCK_NOT_SUPPORTED` (the lock has no supporting candidate; carried by `LOCK_CONFLICT`) |
| Milepost | `DISCONTINUITY_GAP`, `CHAIN_UNCALIBRATED`, `TRACK_MP_DISAGREE`, `TRACK_UNCALIBRATED`, `UNCHAINED_TRACK` |

### Matching limits

- The thresholds are experimental and unevaluated. No field trace has been replayed; the scenario
  tests are synthetic replays and the committed golden tiles. They show that the rules behave as
  written, not that they are right on a real railway.
- `Result.mpBandMi` is the GPS-propagated band only. It is not a confidence interval and omits the
  cross-track residual and the survey accuracy of the anchors. No probability is produced.
- A user choice never changes `accuracyM` or the band. The matcher cannot tell whether the
  user's choice is correct.
- A held match (`CONTINUITY_HOLD`) shows the previous track's milepost for under 5 s while the
  fixes point at another track of the same railway. It never holds against a different railway
  (some fix-to-fix flicker between `AMBIGUOUS_ROUTE` and `MATCHED` near parallel railways is the
  cost).
- After `unlock` there is no continuity for one fix: a withdrawn user choice is never kept as an
  automatic match.
- The heading only chooses among tracks that position cannot separate; it does not help when the
  nearest track is clearly nearer.
- A fix stamped far in the future is accepted by the reducer (it cannot see `nowMs`);
  `currentResult` reports it as `STALE` with `FIX_FROM_FUTURE`, and real fixes stay ignored as out
  of order until the clock passes it. Start a new state after a clock jump.
- `locationError` after a fix leaves the stored result unchanged; staleness follows by time.
- A chain that passes the fix twice (hairpin, loop) gives two candidates of one route, so the
  result is `MATCHED_SUBDIVISION` with `mpRange` null when their mileposts disagree; the matcher
  never picks one pass's milepost. An unchained segment's passes are not separated (it has no
  milepost).
- A whole tile load is rejected for one bad interval, sorted `sMm` error or out-of-envelope vertex.
- When a tile in the middle of a chain is not loaded, the loaded pieces stay separate chains
  (`id`, `id#2`) and nothing is interpolated across the gap.
- The matcher recomputes bounds and lengths per fix and holds no spatial index; M4 owns
  network-wide candidate search.
- `Result` and the state are frozen shallowly; the network view is shared, not copied.
- No datum transform, and the 1 % compliance claim is still undefined (see Limits below).

## Limits

- No datum transform. NAD83(CSRS) track data is used as-is against WGS 84 GPS fixes, which
  adds roughly 1 to 2 m of bias (spec §3). This is a limit, not a correction.
- Canada envelope only: latitude 41.5 to 83.5, longitude −141.5 to −52. Points outside it
  raise `OUTSIDE_CANADA_ENVELOPE`. Longitude must be negative west of Greenwich.
- `projectOntoPolyline` only flags along-chain ambiguity through `nearTieAlongM`. The matcher does
  not resolve it: `findCandidates` reports each distinct pass of a chain as its own candidate and
  the selection keeps them as one route without a single milepost (see the matching limits above).
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

The scenario replays in `packages/core/test/scenarios/` drive the matching state machine through
synthetic networks and the committed golden tiles and assert the full status sequence of each; a
final test checks that all nine statuses and all 24 reason codes are reached. They are not field
traces.

The test suite checks distance and projection against GeographicLib
(`geographiclib-geodesic`), and runs four property tests of 1000 generated cases each
(perpendicular residual, monotonic `alongM`, interpolation between brackets, finite outputs).
