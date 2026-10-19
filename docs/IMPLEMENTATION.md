# Implementation brief (proposal)

## Product contract

A user opens a phone web page, grants location permission and sees fix age/accuracy,
source bundle/version, plausible subdivision, calculated milepost or an explicit
reason it cannot be calculated, plus available public crossings and bridges.
Permission denial, missing source data and ambiguity are first-class states.
Do not claim a reliable track from a single noisy point in a parallel-track corridor.

## Suggested separation

1. Source preparation: validate licence and schema; preserve immutable raw inputs;
   transform into versioned corridor bundles with stable track/subdivision IDs,
   ordered geometry, connectivity and independently qualified calibration anchors.
2. Pure calculation core: candidate projection, cumulative path length, bracketed
   calibration, explicit unit conversion and structured failure reasons.
3. Matching worker: spatial candidate search and ranked candidates; optionally use
   heading, speed and continuity, with ambiguity retained rather than hidden.
4. Mobile UI: consenting GPS session, freshness/accuracy display, accessible map and
   text output, provenance, asset categories and no default remote trace retention.

Suggested fix contract: latitude, longitude, timestamp, accuracyMetres and nullable
headingDegrees/speedMetresPerSecond. Validate ranges, finite values and units.
Suggested result: status, candidate track/subdivision IDs, projected position,
crossTrackMetres, alongTrackMetres, nullable milepost, anchor IDs, sourceVersion,
fixAgeMs and ambiguity/rejection reasons. These are contracts to refine, not existing APIs.

Do not confuse a null milepost with zero. Carry CRS through preparation. Confirm GPS
and dataset datum compatibility and document any transformation before claiming a
spatial tolerance. Topology, station equations and official mileage discontinuities
must be represented explicitly rather than forced into monotonic interpolation.

## Matching and uncertainty

The inspected original prefers main-track candidates initially, scores distance,
optionally incorporates bidirectional heading above 3 m/s, and reduces a previous
segment's score by 0.7 within 150 m; it rejects selected matches beyond 200 m.
These historical settings are not validated defaults for the new implementation.
Compare a simple baseline with proposed continuity logic on synthetic and authorized
field evidence. Heading cannot resolve equally oriented parallel tracks alone.
Choose ambiguity, freshness and off-track policies explicitly and test their boundaries.

Show device-reported accuracy, cross-track residual, source accuracy and candidate
ambiguity separately. Do not convert one into an unsupported statistical confidence.
Any dead reckoning must be clearly marked estimated, time-limited and tested separately
from the raw fix calculation; it is deferred from the first milestone.

## Deferred decisions

Confirm desired local/offline behavior, corridor bundle size, whether a server is
needed, mobile browser targets, GPS retention policy, tolerance metric and independent
validation sources. Validate current dependency versions/licences before selecting
React/Vite/Leaflet or alternatives. No deployment target is chosen.
