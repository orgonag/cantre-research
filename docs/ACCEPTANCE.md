# Acceptance-test specification

This is a test specification, not a claim of executed tests in this repository.
Use independently authored synthetic fixtures first. Fix numeric tolerances according
to the chosen representation and units; document them separately from field accuracy.

| Case | Required assertion |
| --- | --- |
| Straight track | Endpoint anchors reproduce their mileposts; interior distance fractions interpolate correctly. |
| Curved polyline | An asymmetric bent path uses sum of segment lengths, not endpoint chord distance; projection on each segment gives expected progress. |
| Geometry density | Coarse and dense samples of a known synthetic arc quantify approximation effects; no claim that densification recovers missing real geometry. |
| Decreasing MPs | Increasing path distance can decrease milepost; endpoint and interior values remain correct. |
| Projection bounds | Fix before/after a segment clamps locally; outside the outer calibration bracket returns uncalibrated rather than extrapolated MP. |
| Bad geometry | Empty/single-point paths, duplicate vertices, zero total length and nonfinite coordinates fail or handle explicitly without NaN leaking as a usable MP. |
| Anchors | Missing/unknown units, sentinels and unknown qualifiers rejected; valid zero retained; duplicate positions and conflicting/discontinuous mileage flagged. |
| Units | Known mile/kilometre inputs convert consistently; output units cannot be inferred silently. |
| Junction | Near branch point retain plausible branches until evidence resolves them; avoid an unsupported jump in subdivision/MP. |
| Diamond/perpendicular crossing | At the intersection, equal residuals remain ambiguous without adequate direction/history; geometric crossing alone creates no connectivity. Test approach, standstill, noisy heading and departure on both routes. |
| Different nearby Class I railways | Preserve separate stable route identities; closest or main-track preference alone cannot force a selection. Show source-supported labels and explicit choice when unresolved. |
| Unique candidate | Automatic selection requires validated evidence, freshness and coverage checks; an incomplete bundle returning one record must not masquerade as certainty. |
| User route/subdivision lock | Explicit choice constrains candidates and stays visible; a subdivision lock may leave track ambiguity. No silent switching at a diamond, conflicting fix or dataset update. |
| Lock conflict / stale fix | Keep the visible choice, withhold current matching when unsupported, label historical output, and require explicit change/unlock to consider another route. Newer fixes cannot be replaced by older ones. |
| Choice versus precision | User selection changes candidate scope but never reduces device-reported accuracy radius or implies surveyed certainty. |
| Parallel tracks | Equidistant and same-heading tracks yield ambiguity; noisy fixes do not fabricate certainty; continuity cannot override strong contrary evidence indefinitely. |
| Gaps | Disconnected geometry and missing calibration remain gaps; never create a straight connector or mileage through missing topology. |
| Identity | Shared subdivision names do not merge distinct IDs; asset joins require valid stable references. |
| Assets | Bridges/crossings without source MPs remain explicitly uncalibrated unless a calculated MP is labelled as derived; culverts are not bridges; duplicate/grouped records not counted as distinct assets. |
| GPS lifecycle | Permission denied/unavailable, old or out-of-order fixes, background/resume and missing heading/speed have explicit states. Stale fixes do not appear current. |
| Uncertainty | Display fix accuracy, source limits, cross-track residual and ambiguity separately; no invented confidence interval or survey guarantee. |
| Reproducibility | Identical pinned input and transform configuration yield identical normalized results/hashes; corrupt input fails validation. |
| Calculation versus display | Simplifying display tiles cannot silently change calculation geometry or mileposts; validate any deliberate calculation precision conversion. |
| Regional boundary | Buffered bundles preserve needed route/anchor continuity; missing adjacent data produces a visible gap, not a route switch. Mixed versions are detected. |
| Privacy | No raw GPS fix or trace leaves the device or persists without explicit opt-in. Disclose approximate location revealed by regional bundle requests before enabling delivery; browser tests inspect requests and storage. |

For interpolation tests, include exact anchor positions and uneven segment lengths;
a symmetric halfway example alone can accidentally pass chord interpolation.
For stateful matching, replay sequences through switches, reversal, standstill and
GPS jumps. Define freshness/off-track thresholds before testing their boundary cases.

## Evaluation reporting

Publish sample counts, source vintage, filtering/exclusions and error distributions.
Report held-out internal consistency separately from independently surveyed accuracy.
Reproducing the historical 57.91 m mean is not a required success condition; this repo
contains no private fixture to reproduce it. Pending 1% semantics blocks a 1% verdict,
not synthetic-core development. Field acceptance requires an agreed denominator,
near-zero handling, absolute bound and independent evidence; thresholds remain TBD.
