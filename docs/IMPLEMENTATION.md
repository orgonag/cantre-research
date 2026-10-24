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

## Route selection and user control

This is an owner requirement for future implementation, not existing functionality.
Prioritize diamonds/perpendicular crossings and nearby different Class I railways;
same-railway parallel tracks are only one subset of ambiguity.

- **Automatic/unambiguous:** choose only when fresh fixes, candidate coverage,
  geometry, source-supported identities and available heading/continuity evidence
  support a unique route under a validated policy. Do not equate the highest score
  or sole returned record with certainty. A single well-supported subdivision can
  be selected automatically, while track-level ambiguity within it remains visible.
- **Ambiguous:** show plausible route/subdivision choices with verified railway
  identity where available, source vintage and why selection is unresolved. Permit
  explicit user choice or continued unresolved status; never force a confident MP.
- **User-locked:** record the explicit route/subdivision constraint visibly. Match
  only within that constraint; a subdivision lock can still leave multiple tracks
  unresolved. Do not silently switch to a nearby railway, rename the lock after a
  source update or treat the lock as improved GPS precision.
- **Contradiction/no match:** if fresh evidence cannot support the locked route,
  retain the visible lock but withhold a current validated match and explain the
  conflict. Offer an explicit unlock/change action; no automatic fallback outside it.
- **Stale/unavailable:** retain the choice, label any last result historical and
  withhold a current match until fresh acceptable evidence returns. Reassess inside
  the lock; out-of-order fixes cannot replace newer state. Resetting a lock on
  session end/reload requires a documented visible lifecycle, not silent migration.

At a diamond both routes may have near-zero residual at the same point. A geometric
intersection is not evidence of a connecting switch or permission to transfer routes.
Reliable movement history may distinguish perpendicular directions; stationary or
noisy heading may not. Nearby different railways require stable route/subdivision IDs
and source-supported operator identity, not guessing ownership from names or proximity.
Do not assign authoritative candidate probabilities without calibrated evidence.

Specify and validate freshness, acceptable fix/source accuracy, candidate coverage,
score separation and continuity policies before enabling automatic choice. Numeric
thresholds are deliberately not invented here. Retain reason codes and selection
origin (automatic or user) in the proposed result contract. A user lock is a candidate
constraint, not a guarantee of location, track occupancy or operational safety.

## Deferred decisions

Confirm desired local/offline behavior, corridor bundle size, whether a server is
needed, mobile browser targets, GPS retention policy, tolerance metric and independent
validation sources. Validate current dependency versions/licences before selecting
React/Vite/Leaflet or alternatives. Cloudflare Pages/R2 is a proposal; no deployment
configuration or approval is established. Follow LEARNING.md before implementation.

## Proposed storage and delivery

- GitHub holds independently authored code/research, not raw private data.
- Preserve raw public ZIP/shapefile/GML/GeoPackage snapshots, terms, checksums and
  retrieval dates on controlled storage; an independent backup is proposed. The
  existing pilot source is a Saskatchewan GML ZIP, not a downloaded national SHP set.
- Keep canonical processing outputs separate, with source IDs, CRS, feature vintage,
  anchors and transformation versions. A canonical database/file format is unresolved.
- Proposed Cloudflare Pages serves the frontend and small versioned region index.
  Proposed R2 holds processed public regional bundles. This is a design idea, not
  an installed service, account configuration, purchase or deployment instruction.
- The phone uses GPS locally to choose regions plus overlap/boundary buffers, loads
  needed bundles, and matches locally. Boundary logic must avoid losing a route at
  a file edge or silently changing source versions. Buffer sizes need validation.
- Retain source-resolution calculation geometry and validate any precision conversion;
  simplified display geometry and map tiles are separate. Never derive chainage
  from raster tiles or silently reuse a zoom-simplified display line.
- Offline cache eviction, version pinning, prefetch choice, map provider, bundle
  format/size and costs remain open. The Mac mini need not be a public data server.
- Local GPS processing does not eliminate request metadata: regional downloads can
  reveal approximate whereabouts to hosts. No location telemetry by default; explain
  this boundary and obtain approval for any additional retention/upload.
