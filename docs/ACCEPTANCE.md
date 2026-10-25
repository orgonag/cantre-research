# Acceptance-test specification

This is a test specification. The third column names the synthetic scenario replay in
`packages/core/test/scenarios/` that exercises a case, where one exists (milestone M3); every
other row is still a specification, not a claim of executed tests. The replays are synthetic
networks and the committed golden tiles, not field traces, and say nothing about field accuracy.
Use independently authored synthetic fixtures first. Fix numeric tolerances according
to the chosen representation and units; document them separately from field accuracy.

| Case | Required assertion | Scenario replay (synthetic, M3) |
| --- | --- | --- |
| Straight track | Endpoint anchors reproduce their mileposts; interior distance fractions interpolate correctly. | None yet. |
| Curved polyline | An asymmetric bent path uses sum of segment lengths, not endpoint chord distance; projection on each segment gives expected progress. | None yet. |
| Geometry density | Coarse and dense samples of a known synthetic arc quantify approximation effects; no claim that densification recovers missing real geometry. | None yet. |
| Decreasing MPs | Increasing path distance can decrease milepost; endpoint and interior values remain correct. | None yet. |
| Projection bounds | Fix before/after a segment clamps locally; outside the outer calibration bracket returns uncalibrated rather than extrapolated MP. | None yet. |
| Bad geometry | Empty/single-point paths, duplicate vertices, zero total length and nonfinite coordinates fail or handle explicitly without NaN leaking as a usable MP. | None yet. |
| Anchors | Missing/unknown units, sentinels and unknown qualifiers rejected; valid zero retained; duplicate positions and conflicting/discontinuous mileage flagged. | None yet. |
| Units | Known mile/kilometre inputs convert consistently; output units cannot be inferred silently. | None yet. |
| Junction | Near branch point retain plausible branches until evidence resolves them; avoid an unsupported jump in subdivision/MP. | [`junction.test.ts`](../packages/core/test/scenarios/junction.test.ts): four variants (same subdivision, different subdivisions cold to M, cold to Br, approached with a hold); the no-milepost-jump check runs in two of them (same subdivision, approach with hold). |
| Diamond/perpendicular crossing | At the intersection, equal residuals remain ambiguous without adequate direction/history; geometric crossing alone creates no connectivity. Test approach, standstill, noisy heading and departure on both routes. | [`diamond.test.ts`](../packages/core/test/scenarios/diamond.test.ts): approach, standstill with a stale heading, departure on both routes; [`golden-tiles.test.ts`](../packages/core/test/scenarios/golden-tiles.test.ts): the golden diamond. A heading that contradicts the only track is covered too. Noisy heading beyond that is not. |
| Different nearby Class I railways | Preserve separate stable route identities; closest or main-track preference alone cannot force a selection. Show source-supported labels and explicit choice when unresolved. | [`parallel-class1.test.ts`](../packages/core/test/scenarios/parallel-class1.test.ts): two operators 12 m apart, then diverging; [`diamond.test.ts`](../packages/core/test/scenarios/diamond.test.ts): different subdivisions and operators. Source-supported labels are M4. |
| Unique candidate | Automatic selection requires validated evidence, freshness and coverage checks; an incomplete bundle returning one record must not masquerade as certainty. | [`coverage.test.ts`](../packages/core/test/scenarios/coverage.test.ts): a sole candidate at a tile edge is `AMBIGUOUS_ROUTE` (`PARTIAL_COVERAGE`); [`golden-tiles.test.ts`](../packages/core/test/scenarios/golden-tiles.test.ts). Freshness is in lifecycle. |
| User route/subdivision lock | Explicit choice constrains candidates and stays visible; a subdivision lock may leave track ambiguity. No silent switching at a diamond, conflicting fix or dataset update. | [`diamond.test.ts`](../packages/core/test/scenarios/diamond.test.ts): a chain lock stays `MATCHED` through a diamond, then `LOCK_CONFLICT`; [`double-track.test.ts`](../packages/core/test/scenarios/double-track.test.ts): a chain lock inside a subdivision. A subdivision lock is covered by unit tests only. |
| Lock conflict / stale fix | Keep the visible choice, withhold current matching when unsupported, label historical output, and require explicit change/unlock to consider another route. Newer fixes cannot be replaced by older ones. | [`diamond.test.ts`](../packages/core/test/scenarios/diamond.test.ts): conflict keeps the lock and shows no milepost, only unlock clears it; [`lifecycle.test.ts`](../packages/core/test/scenarios/lifecycle.test.ts): `STALE` with history, older fixes ignored, no continuity across the gap. A dataset update is not covered. |
| Choice versus precision | User selection changes candidate scope but never reduces device-reported accuracy radius or implies surveyed certainty. | [`diamond.test.ts`](../packages/core/test/scenarios/diamond.test.ts) and [`double-track.test.ts`](../packages/core/test/scenarios/double-track.test.ts): `accuracyM` is unchanged by a lock. |
| Parallel tracks | Equidistant and same-heading tracks yield ambiguity; noisy fixes do not fabricate certainty; continuity cannot override strong contrary evidence indefinitely. | [`double-track.test.ts`](../packages/core/test/scenarios/double-track.test.ts): tracks 5 m apart, range, uncalibrated and disagreeing mileposts; [`parallel-class1.test.ts`](../packages/core/test/scenarios/parallel-class1.test.ts): noisy fixes, and the 5 s continuity hold ending. |
| Gaps | Disconnected geometry and missing calibration remain gaps; never create a straight connector or mileage through missing topology. | [`golden-tiles.test.ts`](../packages/core/test/scenarios/golden-tiles.test.ts): a fix between two intervals has no milepost (`DISCONTINUITY_GAP`). Disconnected topology is not exercised by a scenario. |
| Identity | Shared subdivision names do not merge distinct IDs; asset joins require valid stable references. | None yet. |
| Assets | Bridges/crossings without source MPs remain explicitly uncalibrated unless a calculated MP is labelled as derived; culverts are not bridges; duplicate/grouped records not counted as distinct assets. | None yet. |
| GPS lifecycle | Permission denied/unavailable, old or out-of-order fixes, background/resume and missing heading/speed have explicit states. Stale fixes do not appear current. | [`lifecycle.test.ts`](../packages/core/test/scenarios/lifecycle.test.ts): denied, error, ignored and out-of-order fixes, stale, re-select, future-stamped fix. Background/resume is not covered. |
| Uncertainty | Display fix accuracy, source limits, cross-track residual and ambiguity separately; no invented confidence interval or survey guarantee. | Partly: `accuracyM` is asserted unchanged in [`double-track.test.ts`](../packages/core/test/scenarios/double-track.test.ts). The band excludes residual and survey accuracy by design (README). |
| Reproducibility | Identical pinned input and transform configuration yield identical normalized results/hashes; corrupt input fails validation. | None yet. |
| Calculation versus display | Simplifying display tiles cannot silently change calculation geometry or mileposts; validate any deliberate calculation precision conversion. | None yet. |
| Regional boundary | Buffered bundles preserve needed route/anchor continuity; missing adjacent data produces a visible gap, not a route switch. Mixed versions are detected. | [`golden-tiles.test.ts`](../packages/core/test/scenarios/golden-tiles.test.ts): the golden diamond walk crosses a shared tile edge on one chain with continuous `s` (the other golden walk stays inside one tile); [`coverage.test.ts`](../packages/core/test/scenarios/coverage.test.ts): partial and missing coverage. Mixed versions: `network-decode.test.ts`. |
| Privacy | No raw GPS fix or trace leaves the device or persists without explicit opt-in. Disclose approximate location revealed by regional bundle requests before enabling delivery; browser tests inspect requests and storage. | None yet. |

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
