# Research log and unresolved decisions

## 2026-10-16 — Local exploratory pilot

Located and inspected the original application without modifying its archive.
Compared the original numerical calculation locally with a public Sutherland track
calibrated from eight Posted crossings, MP 109.88–112.52. Found marker coverage and
subdivision-name collision issues; retained unscored outside-bracket locations.
Recorded 57.91 m mean and 145.56 m max absolute disagreement across 63 synthetic
samples. Eleven local harness tests passed. Saved a bounded public raw package and
provenance locally. Raw/private inputs and tests are not included in this repo.

## 2026-10-19 — Curve explanation and handoff

Read-only inspection verified projection onto consecutive segments and cumulative
polyline-length interpolation. The copied numerical/matching files matched the
archived originals byte-for-byte at inspection. Public calculation preserves vertices
between crossing brackets. No test isolated the discrepancy's cause. Prepared this
independently authored documentation handoff at the owner's request. No app built,
no deployment, no public release and no new bulk data acquisition.

## Decision register

| Decision | State / evidence needed |
| --- | --- |
| Canada first, conventional rail | Agreed scope; LRT optional. |
| US extension | Conditional on suitable public data and rights. |
| One-percent definition | Unresolved denominator, near-zero rule and absolute bound. |
| Independent truth | Not obtained; identify authorized survey/calibration evidence. |
| Original reference rights | Not established for redistribution; exclude source/data/fixtures. |
| New stack | Chosen in the v1 spec (2026-10-23): Python pipeline, TypeScript core, Preact + MapLibre PWA. Versions pinned at plan time. |
| Geometry/datum error contribution | Unisolated; controlled experiments required. |
| Parallel-track and junction selection | Public pilot preselected a track; not validated. |
| GPS freshness/uncertainty thresholds | To define and test, not inherited blindly. |
| Offline, storage and backend | v1 spec: static PWA, regional JSON tiles plus manifest, GitHub Pages once public. No server. |
| Open-source/public release | Owner chose MIT for code and release readiness (2026-10-23). Going public and deploying remain owner-gated. |
| M2 decision 1: segment key | `TRACKSEGID`; a repeat gets `~1`, `~2` in file order (`DUPLICATE_SEGID`). A repeated `NID` is kept and audited (`DUPLICATE_NID`); a record naming a repeated `NID` is matched against every segment with it. |
| M2 decision 2: chains | Only `TRACKCLASS == Main` and `STATUS == Operational`, grouped by `SUBDI1NID`. `SUBDI2*` is ignored in v1 and its records counted (`SECOND_SUBDIVISION_IGNORED`). |
| M2 decision 3: slope test | NRWN mileage has 0.01 mi resolution (about 8 m per anchor), so the slope test applies only when the anchor spacing is at least `slope_min_span_m` (800 m); below that only monotonicity is tested. Experimental. |
| M2 decision 4: close repeats | Anchors with equal `mp` (within 0.005 mi) and no more than 30 m apart collapse to one anchor at their mean `s` (`ANCHOR_COLLAPSED`). Equal mileage farther apart is a monotonicity failure. |
| M2 decision 5: tile membership | An edge or line is in a tile when its bounding box overlaps the tile's buffered bounds: never a miss, a few extras. Amended by R15 below. |
| M2 decision 6: derived mileposts | Computed in the pipeline with core's formula; the Vitest contract test checks every one against `interpolateMilepost` (1e-9 mi). |
| M2 decision 7: Transport Canada join | A TC row joins a crossing when the number matches (not `-1`), the province matches, `Spur Mile Point` is empty or `-`, the normalised subdivision names match and `Mile` parses to 0 or more. Failures are audited, none silently. A crossing that is not usable as posted and whose TC row fails the join is rejected with `TC_SPUR_CROSSING`, `TC_SUBDIVISION_MISMATCH` or `TC_BAD_MILE`. A Posted crossing whose TC cross-check could not run (no usable `TCID`, no row of that number and province, or a row that fails the join) keeps its tier and value and gets one `info` line with the failure (`TC_NO_ROW`, `TC_SPUR_CROSSING`, `TC_SUBDIVISION_MISMATCH` or `TC_BAD_MILE`; ruling R21). `TC_NO_ROW` is therefore only ever `info`. A crossing that is not usable as posted and has no TC row gets `NOT_POSTED` or `POSTED_SENTINEL`, not `TC_NO_ROW`. A TC number that occurs twice is used for neither record (`TC_DUPLICATE_NUMBER`, info). |
| M2 decision 8: tier precedence | `posted` > `tc` > `unverified`. A collapsed anchor keeps the higher tier's `mp`, id and tier; when one of a conflicting pair must go, the lower tier goes first. |
| M2 rulings R10 to R12: coincident conflicts | Two anchors within 30 m whose `mp` differ by more than 0.005 mi conflict. Conflicts are resolved by tier as clusters (connected components), before the collapse, independent of id strings and input order: among the best-tier members, if none conflicts with another all are kept and the rest dropped; otherwise the whole cluster is dropped (`ANCHOR_CONFLICT`). A conflicting lower-tier anchor can no longer keep two agreeing postings apart. |
| M2 ruling R14: asset audit channel | `extract_assets` returns `(assets, audit)`. An asset that ends with no chain position is kept and audited `ASSET_UNPOSITIONED` (info, cause in the detail); an unknown structure type is `UNKNOWN_DOMAIN_VALUE`; a withheld posted value is `UNIT_NOT_MILE` (info); a renamed repeat is `DUPLICATE_NID` (info). "Nothing dropped silently" outranks the plan's bare-list interface. |
| M2 ruling R15: tile buffer | Amends decision 5. The east-west buffer is computed at the poleward edge and the north-south buffer at the equatorward end of the margin, so the margin is at least 2 km on every edge (tested against GeographicLib). A single scale left the equatorward margin about 0.6 m short; the cost is at most 0.001 % extra tile area. |
| M2 ruling R17: posted-only coverage | `calibrated_km_posted_only` is rebuilt from the qualified `posted` anchors (the output of `qualify_anchors`, before any interval step), passed to `coverage_rows` as `qualified_posted`. Rebuilding from the anchors the all-tier pass kept inherited lower-tier decisions (a posted anchor dropped as an outlier because unverified anchors bridged it). The synthetic Lambda case covers it (see R18 for why Kappa no longer does). |
| M2 ruling R18: a lower tier never evicts a higher one | In the outlier pass an anchor `k` is never dropped when either bridge end (`k-1` or `k+1`) has a worse tier (higher `TIER_RANK`) than `k`. Two agreeing unverified anchors could bridge a posted anchor away (the old Kappa scenario). Kappa now shows that the posted anchor stays and the unverified anchor that deviates from the posted line goes (`UNVERIFIED_DEVIATION`). Lambda keeps a legitimate posted-only versus all-tier difference: a TC anchor 0.5 mi off, one step from a posted anchor, breaks the all-tier interval but not the posted-only rebuild. |
| M2 ruling R19: conflicts take posting spacing into account | Amends R10 to R12. A conflict edge needs |ds| <= `anchor_collapse_span_m`, |dmp| > `mp_equal_tol_mi` and the spacing must not explain the mileage difference within one posting step: ||dmp| x 1609.344 - |ds|| > `posting_step_mi` x 1609.344 m (new experimental config `posting_step_mi = 0.01`, NRWN's step, 16.09 m). 0.19 and 0.20 posted 20.5 m apart are neighbours; 10.0 and 10.9 at one spot still conflict. The collapse rule is unchanged. On real SK `ANCHOR_CONFLICT` fell from 82 to 33. |
| M2 ruling R20: tiles carry `GEOACCURA` | Each tile segment has `geoAccuracyM` (integer metres, `null` for `-1` or absent), per spec section 6(e). The value is the source's stated accuracy, not verified. |
| M2 ruling R21: Transport Canada cross-check audit | A Posted crossing whose TC cross-check could not run gets one `info` line (`TC_NO_ROW`, `TC_SPUR_CROSSING`, `TC_SUBDIVISION_MISMATCH` or `TC_BAD_MILE`); tier and acceptance are unchanged. Before, such failures were audited only when they decided a record's fate. |
| M2 canonical output direction | Found by the determinism test: segment and line-asset vertices are written in the lexicographically smaller direction, so reversing a record cannot change a byte. A line asset's `sStartMm <= sEndMm` (direction not preserved). Tile `sMm` of chain pieces is delta-encoded like `latE6` and `lonE6`. |
| M2 derived mileposts use stored millimetres | Found by the contract test: interpolating from unrounded `s` differed from core (which reads `sMm / 1000`) by up to 0.5 mm of track, about 3e-7 mi. The deriver now rounds anchor and asset `s` to the millimetre first. |
| Residual check is not evidence of position accuracy | In the Saskatchewan data every crossing, marker post and station that reaches the residual check sits exactly on the track: residual 0.0 m for all 7,553 qualified anchors (5,017 crossings, 2,288 marker posts, 248 stations) and for every positioned crossing, station, bridge, culvert, tunnel and diamond. NRWN points were evidently snapped to the geometry, so `anchor_max_residual_m` only catches wrong-track and wrong-subdivision records (the 17 `RESIDUAL_TOO_LARGE` cases are 396.48 m to 13,938.97 m). It cannot show how close a point is to the true feature. Position accuracy needs independent ground truth (M5). Evidence: `CANTRE_RAW_DIR=C:/cv-raw-v python pipeline/scripts/measure_residuals.py sk` printed `crossing: qualified=5017 max_residual_m=0.0 residual_above_zero=0`, `markerpost: qualified=2288 max_residual_m=0.0 residual_above_zero=0`, `station: qualified=248 max_residual_m=0.0 residual_above_zero=0`, `all: qualified=7553 max_residual_m=0.0`, `RESIDUAL_TOO_LARGE: n=17 min_m=396.48 max_m=13938.97`. The same script, extended to assets, printed `asset bridge: positions=399 max_residual_m=0.0 residual_above_zero=0 residualMm_above_zero=0`, `asset crossing: positions=6436 max_residual_m=0.0 residual_above_zero=0 residualMm_above_zero=0`, `asset culvert: positions=4 ...=0`, `asset diamond: positions=34 ...=0`, `asset station: positions=248 ...=0`, `asset tunnel: positions=1 ...=0` (all with max_residual_m=0.0) and `assets: positions=7122 max_residual_m=0.0 residual_above_zero=0 residualMm_above_zero=0`. |
| M3 Decision 1: tile decoding lives in core | `networkFromTiles` decodes `cantre.tile/1` objects as a pure function with no fetching; M4's `@cantre/data-client` will fetch, cache and version-pin tiles, then call it. The roadmap line "mirrored as TypeScript types in `@cantre/data-client`" now reads "defined in `@cantre/core` and reused by `@cantre/data-client`". |
| M3 Decision 2: heading filter | Applies only when speed is above `headingMinSpeedMps` (3 m/s) and a heading is present; drops a candidate whose track bearing differs from the heading by more than `headingToleranceDeg` (30), axially (modulo 180, "direction-agnostic"). If it would drop every candidate it is not applied (`HEADING_INCONSISTENT`). Thresholds experimental and unevaluated. Amended by R22: it acts only within the position-based set and not under a lock. |
| M3 Decision 3: continuity | The previous chain resolves an ambiguity only when it is in the indistinguishable set (`CONTINUITY`); when it is in the radius but outside the set it is held for under `continuityMaxMs` (5000 ms) from the first contradicting fix (`CONTINUITY_HOLD`), then the evidence wins; never across a stale gap, a non-matched result or the radius. 5000 ms is experimental and unevaluated. Amended by R23 (no hold against a different railway) and R24 (never seeded by a lock). |
| M3 Decision 4: candidates | One candidate per chain (best projection onto its whole geometry) plus one per unchained segment; a segment candidate has no `s` and never a milepost. Ambiguity groups are keyed by (subdivision NID, operator set). Amended by R26 (point candidates) and R27 (one candidate per pass). |
| M3 Decision 5: partial coverage | The search disk counts as covered when its bounding box, inflated by the radius, lies inside the union of unbuffered tile bounds. Not covered with one route: `AMBIGUOUS_ROUTE` (`PARTIAL_COVERAGE`); outside every tile: `NO_COVERAGE`. |
| M3 Decision 6: diamond rule | A diamond within the search radius, along-track, of a candidate blocks automatic selection (`AMBIGUOUS_ROUTE`, `DIAMOND_NEARBY`) even when one line is closer, unless a user lock resolves it. |
| M3 Decision 7: locks | Only candidates inside a chain or subdivision lock are eligible. A lock whose best candidate is missing or outside the set gives `LOCK_CONFLICT` with the lock kept and no milepost; only `unlock` clears a lock; a lock never changes the reported accuracy. |
| M3 Decision 8: milepost for a chain candidate | Inside an interval: M1 interpolation with its GPS band and the lower anchor tier; before the first or after the last interval: uncalibrated; between two intervals: null with `DISCONTINUITY_GAP`; no intervals: null with `CHAIN_UNCALIBRATED`. Nothing is bridged or extrapolated. |
| M3 Decision 9: `MATCHED_SUBDIVISION` range | `mpRange` only when every parallel track is a calibrated chain candidate and the mileposts differ by no more than the widest GPS band; otherwise null with `TRACK_MP_DISAGREE` or `TRACK_UNCALIBRATED` (an unchained siding counts as uncalibrated). |
| M3 Decision 10: time | `currentResult(state, nowMs)` returns `STALE` (reason `FIX_STALE`, last result kept only as `historical`) when the last fix is older than `staleAfterMs` (15000 ms, experimental). The reducer never reads a clock. |
| M3 ruling R7: diamond rule over any candidate | The diamond is tested against every candidate within the search radius, before the heading filter, not only the indistinguishable set: the golden diamond is registered on one chain only, so a set-only test would miss it from the crossing line. Costs extra ambiguity near diamonds (safe side). |
| M3 ruling R9: no continuity hold at a partial tile edge | `CONTINUITY_HOLD` is not applied when coverage is partial (spec: a sole candidate in a partly loaded tile blocks automatic selection). Costs a shorter hold at tile edges. |
| M3 ruling R10: `Result.candidates` | Superseded by R25: it is the full position-based indistinguishable set, never narrowed after `CONTINUITY`, a lock or the heading; empty for `NO_COVERAGE`, `OFF_NETWORK`, `NO_FIX`, `NO_PERMISSION` and `STALE`; for `LOCK_CONFLICT` it holds the alternatives. (Before the final review it was narrowed to the kept route, which hid a nearer railway.) A field with every candidate in the radius can be added later. |
| M3 ruling R11: range result fields | With an `mpRange`, `mpBandMi` is the widest band in the group, `tier` the lowest tier and `anchorIds` the sorted union; without a range they are null or empty (no band without a value). |
| M3 ruling R12: gap ends continuity | The reducer drops continuity when an accepted fix is more than `staleAfterMs` after the last accepted one (the pure reducer has no `nowMs`; this is the same stale boundary). |
| M3 ruling R13: permission and device errors | A fix while permission is denied is ignored (`FIX_IGNORED_INVALID`, counted); a grant after a denial returns to `NO_FIX`, dropping the last result and continuity but keeping the last timestamp for ordering; a `locationError` after a fix leaves the stored result unchanged (staleness follows by time). Costs one extra fix before a match after a re-grant. |
| M3 ruling R18: `HEADING_USED` meaning | Emitted only when the heading filter actually removed a candidate, so it means "the heading changed the outcome". |
| M3 ruling R19: lock and result wiring | Lock and unlock re-evaluate the last accepted fix without the out-of-order check; `Result.lock` shows in every status; a `STALE` view has no current position and keeps the stored result as `historical`. Amended by R24: continuity is carried only from an automatic `MATCHED` result, never from a lock-decided one. |
| M3 ruling R20: future-stamped fix | `currentResult` returns `STALE` with `FIX_STALE` and `FIX_FROM_FUTURE` when the last fix is stamped more than `futureFixToleranceMs` (1000 ms, experimental) ahead of `nowMs`, so a bad device clock cannot pin a current match. The reducer cannot see `nowMs`, so later real fixes stay ignored as out of order until the clock passes the bad stamp; the caller may start a new state. Costs liveness after a clock jump. |
| M3 ruling R22: heading only within the set | The heading filter may only remove members of the position-based indistinguishable set; it never changes d_min or promotes a candidate position rejected; if it would remove every member it is not applied (`HEADING_INCONSISTENT`); it is not applied under a lock. Final-review probe: a fix 2 m from a north-south CN line and 40 m from an east-west CPKC line, heading 90 at 4 m/s, was MATCHED on CPKC; it is now MATCHED on CN with `HEADING_INCONSISTENT`. Costs heading help outside the set. |
| M3 ruling R23: hold only on the same railway | `CONTINUITY_HOLD` applies only when every member of the set shares the held chain's subdivision and operator; a different railway in the set ends the hold at once. Final-review case: the held CN milepost was shown for up to 5 s while the set held only CPKC. Costs some flicker between `AMBIGUOUS_ROUTE` and `MATCHED` near parallel railways. |
| M3 ruling R24: a lock never seeds continuity | Amends R19. Continuity is never set from a lock-decided result, and lock and unlock re-evaluate the last fix with no continuity. Final-review Critical: after lock A and unlock, a fix 6 m from each of two railways stayed MATCHED on A by `CONTINUITY` on every later fix; it is now `AMBIGUOUS_ROUTE`. Costs one fix of continuity after an unlock. |
| M3 ruling R25: full set in `Result.candidates` | Amends R10. `Result.candidates` is the full position-based set before any narrowing by `CONTINUITY`, a lock or the heading; the narrowed choice or range set stays internal. On `CONTINUITY_HOLD` the chosen track is not in it. Final-review probe: 1 m from CPKC and 11 m from CN after a CN match gave candidates [CN]; it now gives [CPKC, CN]. |
| M3 ruling R26: point candidates | A zero-length or single-vertex chain or segment is a point candidate (residual = distance to the point; `s` = stored `sM` for a chain, null for a segment; `bearingDeg` null and exempt from the heading filter), per spec section 6. Before, it was skipped: a zero-length siding at the fix left a CN line 30 m away as a sole match. Costs a nullable bearing field. |
| M3 ruling R27: one candidate per pass | A chain yields one candidate per distinct pass: every local minimum of the cross-track residual within the radius whose `s` is more than the radius from every better pass (closed cycles wrap); candidates sort with `s` as a final tie-break; two passes in the set are one route, so `MATCHED_SUBDIVISION` with `mpRange` null (`TRACK_MP_DISAGREE`, or the range rule if their mileposts agree). Final-review probe: hairpin legs 8 m apart, fix 3 m and 5 m from them, was MATCHED at MP 10.937 although MP 10.31 on the other leg was as well supported. Costs more candidates per chain. |
| M3 ruling R28: decoder rejects what the matcher cannot use | `networkFromTiles` throws `INVALID_TILE` with the path for an interval that fails `validateInterval`, a chain `sMm` that decreases and a vertex outside the Canada envelope, so `reduce` never throws on a decoded network (spec section 8: corrupt tiles are rejected loudly). Costs rejecting a whole load for one bad record. |
| M3 ruling R29: lock by piece or base id | A chain lock matches a candidate whose `chainId` or `chainBaseId` equals the lock's `chainId`, so a UI that passes back `chosen.chainId` (for example `id#2`) never gets a permanent `LOCK_CONFLICT`. |
| M3 ruling R30: no win by heading elimination | The heading filter applies only if at least one member of I that has a bearing agrees with the heading; otherwise it is not applied (`HEADING_INCONSISTENT`). A point candidate (no bearing) stays beside an agreeing track. Before, a CN line 2 m away (bearing 0) and a CPKC point siding 6 m away with heading 90 at 10 m/s gave `MATCHED` on the point; now `AMBIGUOUS_ROUTE`. Owner approved 2026-10-25. Costs a little heading help where only point candidates remain. |

## Hypothesis discipline

Potential geometry, calibration, datum and candidate-selection differences are
hypotheses, not findings about the 57.91 m value. Hold other factors fixed when
experimenting. Report a failed or inconclusive experiment as such. Adding more
vertices to the same polyline alone does not add missing real-world curvature.
Never optimize against a private-reference score and then call it surveyed accuracy.

## 2026-10-19 — Owner clarification: projection and route choice

Added a vector projection tutorial and worked metre-coordinate examples. Owner
prioritizes diamonds/perpendicular crossings and different Class I railways close
together. Automatic choice requires unambiguous validated evidence; ambiguous cases
need explicit selection, a visible lock and no silent switching. Fix freshness and
uncertainty remain visible; a choice cannot improve underlying GPS precision.

The spoken CN “Havrelock/Havelock” versus Wilkie example is **unverified illustrative
input**. Spelling, railway attribution, geography and the suggested relationship were
not checked. Do not promote it to a real-world fixture, source fact or map label. Use
synthetic route A/route B cases until independently verified public evidence exists.

## 2026-10-19 — Controlled comparison and collaborative learning decision

Completed the bounded NRCan/NARN/OSM comparison with shared NRCan anchors and fixed
synthetic positions; see SOURCE-COMPARISON.md. Geometry substitution changed outputs
little and did not establish field accuracy or discrepancy cause. RAC remains
qualitative pending rights. TrackPilot was studied at a pinned commit, not executed
or copied; see PRIOR-ART.md. No national data download occurred.

Approved working method: teach the owner math and coding, build together in small
understandable steps, explain each line and calculation, and pause for discussion
before the next substantive implementation step. Agents must not autonomously build
the entire project. LEARNING.md governs future sessions; the staged plan is not
blanket implementation authorization.

Proposals: React/TypeScript/Vite, Leaflet, Cloudflare Pages frontend and R2 regional
bundles selected locally from a small manifest/index with boundary buffers. Full
calculation geometry remains separate from display tiles. Backup destination, bundle
format, precision, buffering, cache policy and privacy remain unresolved.

Proposed research: audit actual crossing/structure/junction populations using the
NRWN catalogue and related CanVec schema. Terrain/LiDAR/hydrography are optional
future context, not committed scope or an engineering-accuracy promise. Corrected
the earlier unsupported interpretation of NRCan accuracy field `10`; it remains
uninterpreted pending the matching schema definition.

Current repository visibility remains private. Eventual public/open-source release
requires rights and privacy review. No implementation, deployment or merge is implied
by this documentation update. The original calculation is a comparison baseline,
not ground truth. Independent controls, held-out calibration validation, ambiguity
tests and the definition of the 1% metric remain open research work.

## 2026-10-20 — Illustrated projection lesson

Saved [the learning session](lessons/2026-10-20-projection/README.md) with original synthetic diagrams, horizontal and diagonal projection arithmetic, endpoint clamping and coordinate-unit limitations. Discussed qualified crossings and other known-position/known-milepost anchors. Owner reaffirmed explicit choice when multiple tracks remain plausible; selection does not improve GPS precision.

Owner selected the private research repository as the destination for invited collaborators. No public release, app implementation or deployment. Next agreed teaching topic is a small projection function explained line by line, at the owner's pace.

## 2026-10-23 — Rename, new working method and v1 spec

Renamed RailHUD to **CANTRE (Canada Track Rail Estimation)** for an intended NRC Canada
submission, and moved the repository to `orgonag/cantre-research`. The owner replaced the
line-by-line learning method: build to research grade, comment thoroughly and prepare for
open-source release. Defaults chosen: offline-first static PWA, every NRWN province, MIT for
code, GitHub Pages once public, English and French UI.

Inspected the Ontario NRWN 2.0 SHP package (2019-07-25) to ground the spec: CRS is
NAD83(CSRS98); 8,747 of 12,718 crossing records carry Posted mileage, all 671 stations are
Posted, but 3,745 of 3,867 marker posts are Unknown-qualified; 41 diamond junctions. See
[the v1 spec](superpowers/specs/2026-10-23-cantre-v1-design.md). No code is built yet.

## 2026-10-24 — M1 calculation core built

Built `@cantre/core` (milestone M1) on branch `feat/m1-calculation-core`: units, GRS80
radii, coordinate checks, tangent-plane distance, segment and polyline projection, anchor
intervals, milepost interpolation and the GPS band. See
[the package README](../packages/core/README.md). Commands run and results:

- `npm ci`: exit 0; summary line "found 0 vulnerabilities".
- `npm run lint`, `npm run format:check`, `npm run typecheck`: each exit 0.
- `npm run coverage`: 11 test files, 89 tests passed. Four property tests ran 1000 generated
  cases each, 4000 property runs in total (perpendicular residual, monotonic `alongM`,
  interpolation between bracket mileposts, finite outputs). No property failed. Coverage of
  `packages/core/src`: statements 98.62 %, branches 97.19 %, functions 100 %, lines 98.57 %,
  against a gate of lines 95, branches 90, functions 100.
- Distance against GeographicLib on GRS80. The repo tests in
  `packages/core/test/distance.test.ts` assert only a 1 mm bound (a latitude 80-83.5 by azimuth
  0-359 sweep and 2000 random draws). The measured maxima come from the committed script
  `packages/core/scripts/measure-distance-error.mjs` (`npm run measure:distance -w
  @cantre/core`, GeographicLib on GRS80). It printed: sweep maximum 0.734 mm (latitude 83.5
  degrees, azimuth 56 degrees, d = 2000 m); 50000 seeded random draws (seed 20261023) peaked at
  0.660 mm; a 50 km due-east segment at latitude 83 had relative error 1.69e-4. Segments over
  2 km are subdivided for distance only. Projection agreed within 0.1 % at a 5 km
  cross-track offset.

Not done or not claimed: no datum transform (NAD83(CSRS) used as-is against WGS 84, roughly
1 to 2 m bias, spec section 3); along-chain ambiguity is flagged, not resolved (milestone M3);
no real track data was used, only synthetic geometry.

## 2026-10-24 — M2 pipeline built (Saskatchewan)

Built `pipeline/` (milestone M2) on branch `feat/m2-pipeline-sk`: the NRWN SK package and the
Transport Canada Grade Crossings Inventory become chains, tiered anchors, calibrated intervals,
assets, regional tiles, a manifest, an audit log and a per-subdivision coverage report. See
[the pipeline README](../pipeline/README.md). The thresholds are experimental and the coverage
figures are internal coverage, not surveyed accuracy. Commands run and measured results
(Windows 11, Python 3.12.10, raw cache `CANTRE_RAW_DIR=C:/cv-raw-v`, outputs in `C:/tmp`):

- `python -m cantre_pipeline acquire --source sk` printed `sk sha256=f25a91d230619b9f73093955c69f02e9ed7f93e425214c940e328c359f1a796a bytes=3239574`; `acquire --source tc-gci` printed `tc-gci sha256=5ab3f3b75b20b186800cee244a482a65451ea1c7841fb136c827f69058708a41 bytes=4000479`. Both exit 0 (verify mode, hash matches `pipeline/sources/*.json`).
- `PYTHONHASHSEED=0 python -m cantre_pipeline build --province sk --out C:/tmp/m2a --check-budget` printed `built sk: 274 tiles, max gzip 131856 bytes, chain 8446.523479 km, calibrated 8041.703461 km (95.207 %), 11594 audit lines, 12.5 s`, exit 0. The same command with `PYTHONHASHSEED=12345` and `--out C:/tmp/m2b` printed the same line and `diff -r C:/tmp/m2a C:/tmp/m2b` printed nothing. The tree SHA-256 (sorted path and file-hash pairs) of both is `902d142a8d3617e8960ae26071e5770ff179531061b50407f827971c3c47ed19`.
- Dataset version `nrwn-2.0+cantre.0.1.0`; source SHA-256 as above; configuration SHA-256 `eec00a0301149b4367d386562b2c5f531cb4491111899a90752acc507542ab7f`.
- Tiles: 274; gzip total 4,386,496 bytes; maximum 131,856 bytes (budget 500,000); uncompressed total 19,479,671 bytes, maximum 631,827.
- Coverage (`reports/coverage-sk.json`, 74 subdivisions with chain): chain 8446.523479 km; calibrated 8041.703461 km (95.207 %); calibrated from the qualified posted anchors alone (ruling R17) 7708.982867 km. Subdivisions where posted-only still exceeds all-tier: Blackfoot (134.531827 vs 134.511659 km), Elrose (167.258416 vs 167.036082), Lampman (135.662187 vs 135.487614) and St. Brieux (84.572673 vs 83.543084). `python pipeline/scripts/diagnose_posted_only.py sk` (run after R18) printed, for the four, all-tier interval breaks at pairs with slope 0.844 and 0.686 (St. Brieux), 0.699 and 0.810 (Elrose), 1.253 and 0.998 (Lampman) and 0.798 (Blackfoot, between `posted 25.99 @ 63586 m` and `unverified 26.0 @ 63606 m`), and `posted anchors qualified but not kept by the all-tier pass: 0` in each, so R18 removed the old mechanism of a posted anchor lost to an unverified bridge. In Elrose, Lampman and St. Brieux (and the Watrous subdivision's chain, `155.25 @ 5398 m`) the posted-only pass still drops one posted anchor as an outlier (`26.5 @ 126191 m`, `31.7 @ 87728 m`, `34.55 @ 31207 m`) that the all-tier pass keeps. Why the all-tier pass keeps it was not tested; the nearest all-tier kept anchors include an unverified one in Elrose, St. Brieux and Watrous and none in Lampman. Assiniboia (91.787 km against 0.000 posted-only) and Prince Albert (117.455 against 0.000) have no posted anchors at all: their anchors are 43 and 53 `tc` tier.
- Kept anchors by tier: posted 4,889, tc 122, unverified 2,213 (7,224 in all). By source: crossing 5,011, markerpost 2,011, station 202, structure 0. Isolated anchors (in no interval): 10. Intervals: 155 on 115 chains (counted from the tiles; a chain counts once).
- Rejections by reason (severity `rejected`): ANCHOR_CONFLICT 33, ANCHOR_OUTLIER 8, MILEAGE_SENTINEL 455, NOT_POSTED 1,922, POSTED_SENTINEL 50, RESIDUAL_TOO_LARGE 17, SOURCE_DISAGREEMENT 22, SUBDIVISION_MISMATCH 19, TC_SPUR_CROSSING 53, TC_SUBDIVISION_MISMATCH 11, TRACK_NOT_CHAINED 664, UNVERIFIED_DEVIATION 189 (3,443 in all). Info lines include ANCHOR_COLLAPSED 204, ANCHOR_MERGED 58, the Posted-crossing TC notes of ruling R21 (TC_NO_ROW 976, TC_SPUR_CROSSING 256, TC_SUBDIVISION_MISMATCH 22, TC_BAD_MILE 0; 1,254 in all), ASSET_UNPOSITIONED 1,284, NOT_CHAINED_CLASS 5,303, SECOND_SUBDIVISION_IGNORED 23, DUPLICATE_NID 18, DUPLICATE_SEGID 1, UNKNOWN_DOMAIN_VALUE 2, VERTEX_DEDUPED 4.
- Chain cycles: 0. Subdivisions with chain but 0 % calibrated: 4 (Colony 0.730 km, Flin Flon 2.296 km, Paddockwood Spur 14.758 km, Weyerhaeuser Spur 13.441 km).
- Assets: 8,392 in all (bridge 450, crossing 7,660, culvert 4, diamond 21, station 256, tunnel 1); 7,108 have a chain position and 6,888 of those have a derived milepost.
- Synthetic golden build (`pipeline/tests/golden/synthetic/`, no NRWN data): 18 tiles, 63 audit lines. `python -m pytest pipeline`: 295 passed, 6 skipped, line coverage 99.63 % (gate 95 %); with `CANTRE_RAW_DIR=C:/cv-raw-v` the 6 real-data tests run: 301 passed (the real-data tests skip with a stated reason when the directory or its `<sha256>/` folders are missing; CI runs pytest after `acquire`). `ruff check`, `ruff format --check` and `mypy --strict pipeline/src pipeline/tests` pass. `npm run coverage`: 13 test files, 99 tests passed; lines 98.6 %, branches 97.29 %, functions 100 %.
- The determinism and contract tests found two defects in earlier output, fixed here (see the decision register): vertex direction leaked into tile bytes, and derived mileposts were interpolated from unrounded `s`.

Not done or not claimed: no datum transform (NAD83(CSRS98) used as-is); the residual check cannot test position accuracy (see the register); the synthetic golden was generated on Windows and has not been run on Linux. Tile numbers are integer-quantised (microdegrees and millimetres), so a libm difference could change a byte only at a 0.5 mm rounding boundary; the more plausible platform difference is the manifest's `gzipBytes`, which depends on zlib's deflate output. The golden test now names the first differing file. Other provinces, offline downloads and the evaluation are M5; hosting is owner-gated.

## 2026-10-25 — Repository made public

The owner made `orgonag/cantre-research` public, accepting that the full history, the
commit emails and the private-reference summary figures are published. Reason: GitHub
Actions minutes are free on public repositories, and the account's free private-repository
allowance for October was used up (billing page: $12.33 gross usage, $12.33 covered by the
included allowance, $0 owed), which had stopped CI from starting on `main`. Before the
change, a scan of tracked files found no passwords, keys or tokens. The six branches
already merged into `main` were deleted. Deployment, GitHub Pages and the NRC submission
remain owner-gated.

## 2026-10-25 — M3 matching state machine built

Built the matching state machine in `@cantre/core` (milestone M3) on branch `feat/m3-matching`:
`networkFromTiles` (a pure decoder of the M2 tiles), candidate search, coverage and diamond
checks, a selection policy for routes, tracks, diamonds and user locks, milepost lookup with tier
and band, and a pure reducer with nine statuses and 24 reason codes. See
[the package README](../packages/core/README.md). The PR is pending the owner's review. Every
threshold is in `MATCH_CONFIG` and is **experimental and unevaluated**: no field trace has been
replayed, and nothing here measures how often the matcher is right on a real railway.

The acceptance replays in `packages/core/test/scenarios/` are **synthetic**: networks built from
metre offsets, plus the committed golden tiles (themselves synthetic M2 output). They show that
the rules behave as written, step by step; they are not field traces and support no accuracy
claim. 22 scenarios assert the full status sequence of each step: diamond approach, standstill and
departure, with and without a lock; parallel Class I lines 12 m apart that diverge, with
continuity, and with a lock then an unlock; double track with a range, an uncalibrated track and
disagreeing mileposts; a junction (five variants, one of them the bounded same-railway hold); the
session life cycle and a future-stamped fix; coverage edges; and four on the golden tiles (a walk
along a tile-edge chain within one tile, the golden diamond (the scenario whose fixes cross the shared tile edge), a parallel pair, a milepost gap and an
unchained siding). A final test replays all of them and asserts that the union of statuses
reached is all nine of spec section 6, the spec section 13 done-when, and that every one of the 24
reason codes is produced by some replay (in `Result.reasons` or as `reduce`'s `ignored`). Commands run and results
(Windows 11, Node via npm, from the worktree):

- `npm run lint`, `npm run format:check`, `npm run typecheck`: each exit 0.
- `npm run coverage`: 28 test files, 374 tests passed (the scenario folder holds 8 files and 58
  of them: 22 scenario replays and 36 in the status-coverage file, 24 of those the reason-code
  guard). Coverage of `packages/core/src`: statements 99.62 % (793/796), branches 94.10 %
  (495/526), functions 100 % (167/167), lines 99.59 % (744/747), against the gate of lines 95,
  branches 90, functions 100. The gate held. (Figures after the final-review fix wave and the
  R30 heading fix below.)
- Mutation check of the scenarios, rerun after the fix wave: with the diamond rule disabled
  (`diamonds.length > 99`) two scenarios failed (the diamond approach and the golden diamond); with
  `continuityMaxMs` set to 6000 one failed (the same-railway junction hold); with the R23
  same-railway condition removed two failed (the parallel continuity scenario and the
  different-subdivision junction). Each edit was reverted. That shows those scenarios depend on
  those rules, not that the rules are right.
- `pytest pipeline` was run once with `CANTRE_RAW_DIR=<raw dir>`: 294 passed, 7 failed. All 7
  are in `pipeline/tests/test_determinism.py` and stop at `FileNotFoundError` opening
  `pipeline\tests\golden\synthetic\tiles\208_-212.json` under this worktree's very long path
  (Windows path-length limit); the pipeline is untouched by M3 and CI runs it from a short path.
  Not rerun elsewhere.

Not done or not claimed: no field validation of any threshold; no datum transform; the heading
filter, the 10 m margin and the 5 s hold are starting points; a future-stamped fix blocks later real
fixes until the clock passes it (documented limit); the scenarios assert every one of the 24
reason codes (checked by replaying all scenarios and collecting `Result.reasons` plus the `ignored`
reason of `reduce`: none missing), but only on synthetic data. Fetching and caching tiles, the network-wide
candidate index and EN/FR message text are M4; the HMM research matcher and real-trace evaluation
are M5. Ten decisions beyond the spec and the behaviour-changing controller rulings are in the
decision register above.

Final-review fix wave (same branch). A whole-branch review found one Critical and six Important
issues; the controller ruled on each (R22 to R29 in the register). Fixed, each with a reproducing
test first: a user lock no longer turns into an automatic match after unlock (R24); the heading
can no longer match a different railway that position rejected (R22); `Result.candidates` keeps
every plausible route (R25); zero-length and single-vertex tracks are point candidates (R26); a
chain passing the fix twice gives two candidates and no single milepost (R27); the decoder rejects
intervals, positions and vertices that would make the matcher throw (R28); a continuity hold never
shows another railway's milepost (R23); a chain lock accepts a piece id (R29). Scenario
expectations changed under these rulings: the parallel-class1 and different-subdivision junction
replays no longer hold (R23); the CONTINUITY steps now list both routes (R25); the diamond
leave-on-B step with `HEADING_USED` moved to 8 m past the crossing, where both lines are in the set
(R22). Still synthetic only; no threshold is validated.

## 2026-10-25 — Owner decision: public national launch in M4

The owner asked for a working public copy for all of Canada first, with tests and research
added afterwards, keeping plan-then-approve per milestone. Answers given: run as a public
website; build all of Canada before the first run; keep the plan-first rule. So the national
build and a GitHub Pages deployment move into M4
([plan](superpowers/plans/2026-10-25-m4-national-app.md)), M5 becomes evaluation, and the spec
section 13 table and section 12 note are updated. Deploying is approved; enabling Pages is a
repository setting the owner turns on, or approves explicitly. Nothing is measured here: the
national data size is unknown until the M4 build (on 2026-10-25 the NRCan server answered size
requests for AB 3,818,082 bytes, NB 947,884 and NL 130,539, and timed out for the rest).

## 2026-10-25 — M4 national app built (not deployed)

Built milestone M4 on branch `feat/m4-national-app`: the pipeline's `national` command (every NRWN
province with a published package, plus the Transport Canada inventory, merged into one snapshot),
`@cantre/core` snapshot decoding and lookups, `@cantre/data-client` (fetch, hash-check, cache),
the phone web app in `app/`, Playwright, privacy and accessibility tests, a GitHub Pages deploy
workflow and a size gate. Merged and deployed on 2026-10-25 to
<https://orgonag.github.io/cantre-research/>. Every matcher threshold is still
**experimental and unevaluated**, and there is **no field validation yet** of anything the app
shows. The numbers below are sizes, counts and test results, not accuracy.

### What the national build holds (measured)

Dataset version `nrwn-national-c400fd8d+cantre.0.1.0`, snapshot date 2026-10-25, from 11 NRWN
packages retrieved 2026-10-24 and 2026-10-25 and the Transport Canada 2023-update inventory
retrieved 2026-10-24 (versions and hashes in [DATA-LICENSES.md](DATA-LICENSES.md)). Nunavut and
Prince Edward Island have no NRWN package: the conventional package address answered HTTP 404 on
2026-10-25 (it is not proof that there is no track there). Newfoundland and Labrador, the
Northwest Territories and Yukon are NRWN 1.0; the other eight are 2.0.

| What | Value |
| --- | --- |
| Chains / vertices / unchained segments | 1,252 / 489,913 / 53,110 |
| Anchors (posted / tc / unverified) | 42,917 (28,657 / 463 / 13,797) |
| Calibrated intervals / assets / coverage cells | 1,385 / 64,061 / 1,657 |
| Total chain length | 47,766.5 km (longest chain 473.5 km) |
| `snapshot.bin.gz` | 12,366,628 bytes served; 28,766,587 bytes unzipped |
| `asset-details.json.gz` | 1,871,505 bytes served; 11,837,310 bytes unzipped |
| `manifest.json` | 85,415 bytes |
| One first-run download (snapshot plus asset details) | 14,238,133 bytes |
| Pipeline tiles (built and checked, not deployed) | 1,725; largest 433,499 bytes gzip (Quebec), limit 500,000 |
| `national` wall time | 164.9 s, and 161.1 s with `PYTHONHASHSEED=12345`; the three published files byte-identical |

Per-province counts are in the `national` command output and the Task 2 report; the province
columns sum exactly to the national row, so no id was shared between provinces and the
merge-conflict check never fired. YT calibrates 0 km (one anchor, no interval) and NL 307 of
393 km; NL, NT and YT have 25, 40 and 1 anchors. These are data facts, not errors.

**The plan's estimate was wrong.** The M4 plan projected the snapshot at about 4 to 6 MB from the
Saskatchewan trial. The measured national snapshot is 12.37 MB (12,366,628 bytes), two to three
times that (12.37 / 6 is 2.1 and 12.37 / 4 is 3.1), and the first-run download with asset details is 14.24 MB. It is inside the 15 MB target,
the 100 MB per-file limit and the 1 GB site limit, so no hosting change was needed, but the
projection method (scaling from one province) should not be reused.

### Size gate (`scripts/check-budget.mjs`)

Run on 2026-10-25 against the national output and the app built for the `/cantre-research/`
sub-path with the data laid out as the site:

| Limit | Measured | Limit |
| --- | --- | --- |
| App shell, gzip (11 files, with the licence notices, excluding maplibre-gl) | 60,363 bytes | 300,000 |
| maplibre-gl chunk, CSS and worker, gzip (4 files, loaded only when the map opens) | 440,802 bytes | not in the shell |
| Largest file (the snapshot) | 12,366,628 bytes | 100,000,000 |
| Site total (18 files) | 16,208,489 bytes | 1,000,000,000 |
| Largest tile, gzip | 433,499 bytes | 500,000 |

The shell figure gzips each file separately with Node's zlib at level 9 and adds them. The tile
figure is the pipeline's own recorded size (Python zlib), because Node's zlib compresses the same
tile to a different size. The gate also failed, as intended, when each limit was lowered below its
measured value, on an unlisted tile and on a tile whose size differs from the manifest.

### Decoding cost (measured on one desktop)

AMD Ryzen 9 5900X (12 cores), 15.9 GiB RAM, Windows 11 x64, Node 22.12.0 (V8 12.4.254.21-node.21):
unzip 89 ms and decode 418 ms (median of 5 runs) for the national snapshot. Heap in use grew by
127.3 MiB (median of the same 5 runs, forced garbage collection, decoded network kept alive). The
whole `loadNetwork` path with the asset-details file (download, hash, unzip, decode, parse JSON)
grew it by 143.6 MiB in one run inside a test worker; parsing the asset-details JSON alone adds
27.1 MiB (these two figures were measured on the previous dataset version, whose content is the
same apart from the version string). A download now also decodes both files once before storing
them, so a build the app cannot read never replaces a working one: that check (unzip, decode,
parse the asset details) took a median of 710 ms in Node over 5 runs, once per new build. **No phone has been measured.** A low-end phone will be slower and may have less memory,
so these heap figures need a check on real devices before anyone relies on them.

### Tests

- `npm run coverage`: 43 test files, 659 tests passed. Statements 99.74 %, branches 95.3 %,
  functions 100 %, lines 99.73 % overall; `app/src/logic` 99.58 / 93.01 / 100 / 99.57 against the
  gate of 90 / 85 / 95; core and data-client hold their 95 / 90 / 100 gate.
- Playwright (`CI=1 npm run -w app e2e`, against the built app, desktop Chromium, Pixel 7 and an
  iPhone 13 viewport, all on Chromium): 195 passed, 0 failed, 0 skipped (65 per project: 24 flow, 9
  privacy and 32 accessibility tests). Every request is checked against an allowlist of the app's
  own files and the three data files, none carries a coordinate, and storage (localStorage,
  sessionStorage, cookies, IndexedDB, Cache Storage) is inspected afterwards. axe (WCAG 2.2 AA) found
  no violations in 15 states in light and dark themes. These are synthetic-data tests with mocked
  GPS in headless Chromium; they are not field tests and say nothing about Safari.
- `pytest pipeline`: 390 passed, 6 skipped, 7 failed on this Windows machine. All 7 are in
  `test_determinism.py` and stop on a file-not-found for a golden file under a very long checkout
  path (Windows path length), not on a comparison; run from a short-path copy all 8 tests in that
  file pass, and CI runs them from a short path. Pipeline line
  coverage 99.54 % (gate 95 %). `ruff check`, `ruff format --check` and `mypy --strict` pass.
- Browser check of the deploy shape (2026-10-25, a local static server, not GitHub Pages): the app
  built with base `/cantre-research/` loads under that sub-path, downloads the real national
  snapshot and lists its subdivisions.

### Not done, not verified, or deferred

- **No field validation.** The matcher's thresholds are unevaluated. Accuracy, the datum offset
  study and leave-one-anchor-out evaluation are M5.
- Live deploy check (2026-10-25, GitHub Pages, deploy run 40240582126): the snapshot and asset
  details are served at their exact gzip sizes (12,366,628 B and 1,871,505 B) with no
  `content-encoding` header, and the snapshot SHA-256 matches the manifest. In a 375 px wide
  Chromium viewport the app downloaded the data, listed the national subdivisions and placed
  Albreda MP 50 at 53.01410, -119.13995. GPS was not tested (no location in that browser).
- WebKit is not run: the "iPhone" project uses Chromium.
- The synthetic diamond has one route, so a two-route diamond chooser is not tested in a browser;
  the two-route chooser, lock and unlock are tested at the border.
- Asset type filters (for example only bridges) are not built.
- When another route also fits beside a match (a `MATCHED` track kept by continuity, or a
  `MATCHED_SUBDIVISION` double track with a different railway nearby), the card says how many
  other routes fit but offers no chooser for them; the chooser appears only for
  `AMBIGUOUS_ROUTE` and `LOCK_CONFLICT`.
- The French text is a draft and needs native review.
- The service worker's clean-up of its library cache is unproven across two real releases (it
  needs two builds).
- Memory and speed on real phones are unmeasured (above).
- Licence notices: the build writes `third-party-licenses.txt` into the site (29 packages shipped in
  the site, including maplibre-gl, preact and the Workbox runtime, with their licence texts, linked from the About page and precached), and the size gate fails if
  it is missing. Not yet checked by a person against each package's own repository.
- Nunavut and Prince Edward Island are not covered (no NRWN package).

## 2026-10-25 — Core RailHUD browser implementation (not deployed)

Owner-authorized follow-up to M4: [CORE-RAILHUD.md](CORE-RAILHUD.md). Independently
implemented the approved map-first interface, automatic verified data startup alongside
one GPS watch, normal-match route selection, persistent map, follow/recenter, native
modal sheets and wake lock. Existing core calculation/matching and pipeline source files
are unchanged. No private reference source/data was imported.

Validation on the local branch:

- `npm run lint`, `npm run typecheck`, `npm run format:check`: pass.
- `npm run coverage`: 668 tests in 44 files pass; lines 99.58%, branches 94.81%,
  statements 99.50%, functions 100% under the repository's configured coverage scope.
- Core package and production frontend builds pass. This is a static app: no server build.
- Full browser suite: 231 tests pass across desktop, Pixel 7, iPhone 13 Chromium emulation and the WebKit core suite. Physical phone GPS and field endurance remain unverified.
- `.venv/bin/python -m pytest pipeline`: **397 passed, 6 skipped, 1 failed**;
  coverage 99.49%. The six real-source-gated tests were skipped without their raw inputs.
  HTTP-fixture tests must run where local port binding is allowed.
- Existing Python failure: `test_property_renaming_ids_does_not_change_membership`.
  Minimal generated anchors `(s metres, MP miles, tier)` are `(20, 0, tc)`,
  `(20, .01, tc)`, `(40, 0, posted)`. Reversing the ID ordering can produce a retained
  position at 30 m instead of 40 m. Both `pipeline/src` and `pipeline/tests` are unchanged
  from the base commit. The failure reproduced on a second full run. No property was
  disabled and no calibration semantics were changed to make this UI branch pass.
- Consequently the full-suite commit gate is **not satisfied**: no commit, push, release
  PR or deployment was performed. Resolve the pipeline defect separately before release.
- National dataset diagnostic: `nrwn-national-c400fd8d+cantre.0.1.0`, 1,252 chains,
  64,061 assets, 25 sampled fixes in Node 26 on this Mac. Verified load from local bytes
  1,384 ms including 788 ms network decode; display construction 114 ms; matching median
  6.98 ms / maximum 24.91 ms; visible-asset selection maximum 14.65 ms. These numbers
  exclude internet transfer, do not characterize phones, and are not accuracy evidence.

The WebKit test-provider timestamp unit correction is confined to tests. MapLibre marker
updates no longer depend on `isStyleLoaded()` while sources are updating. Safari pointer
clicks do not necessarily focus their buttons: sheets explicitly remember their opener
so Escape restores focus. Physical iPhone/Android GPS, enlarged system text, a sustained
15-minute device run and field accuracy remain pending. The production Pages site is unchanged.


## Pipeline ID-order repair and core RailHUD release preparation — 2026-10-26

The owner authorized resolving the full-suite blocker and preparing deployment for
phone testing. The failure was not removed or marked expected: IDs previously broke
ties between different mileages at the same position and tier. With postings
`(20 m, MP 0, tc)`, `(20 m, MP 0.01, tc)`, `(40 m, MP 0, posted)`, reversing names
could change collapse membership and move an interval endpoint from 40 m to 30 m.

Pipeline 0.1.1 sorts by position, tier, mileage and then ID. Collapsed representatives
use tier, mileage, position and then ID; equal-error outliers use position and mileage
before ID. These are canonical ordering rules, not a claim that lower mileage is more
accurate. Tier precedence, conflict thresholds and interpolation remain unchanged.
Three explicit regressions cover coincident postings across name/input permutations,
near-equal collapsed representative mileage and equal-error outlier ordering. The
original Hypothesis ID-renaming property remains active.

The pipeline version, synthetic golden files and browser fixtures were regenerated
together. Decoded synthetic snapshot/tile changes are version-only; manifests also
carry the corresponding new compressed sizes/hashes. Real Saskatchewan builds under
`PYTHONHASHSEED=0` and `12345` are byte-identical and pass the size budget.

A separate build of the prior committed 0.1.0 source against the same verified inputs
measured 8,041.703461 calibrated km; 0.1.1 measures 8,040.593118 km on the same
8,446.523479 chain km (95.207% to 95.194%). The 1.110343 km change is confined to
St. Brieux, with one additional unverified anchor rejected by the existing deviation
rule. Posted-only calibration changes from 7,708.982867 to 7,708.763762 km. Other
changed subdivision report fields reflect representative source provenance. These
are internal coverage metrics, not field accuracy evidence. Source records and
thresholds were not changed.

Validation: full Python suite with acquired Saskatchewan and TC sources: **407 passed,
zero skipped**, coverage 99.49%; Ruff lint/format and strict mypy pass. JavaScript
coverage: **668 passed**, plus typecheck, lint and formatting pass. Core package built
before the frontend. Full browser suite: **231 passed**, including WebKit core checks.
The production sub-path frontend build and size gate pass; regenerated browser
fixtures match the committed fixture tree. The release is ready for PR review.

Deployment remains manual through the existing GitHub Pages workflow. It rebuilds the
national data before the frontend, publishes a versioned snapshot alongside the app,
and verifies served hashes and sizes. No application server is required. This local
repair does not itself publish the new UI or data. Physical-phone location permission,
GPS and screen-awake behavior remain acceptance checks after an approved deployment.


Hosted verification follow-up: the first PR CI passed the pipeline and verification
jobs but Linux WebKit returned a blank map screenshot for the GPS-dot pixel assertion
(230/231 browser checks passed). Network trace requests all succeeded; the cause is
not established as an application regression. The identical assertion passes in
local macOS WebKit. CI now runs the 222 Chromium checks on Linux and the nine unchanged
WebKit checks on macOS, following Playwright's recommendation to use macOS for the
closest Safari behavior: https://playwright.dev/docs/next/browsers. No assertion,
threshold or test was removed, skipped or relaxed. Physical Safari testing remains
necessary; this change does not claim support for Linux WebKit rendering.


## Phone follow-up: centered HUD, nearest track, basemap default — 2026-10-26

The owner reported an off-center card and no milepost about two miles from Wilkie,
then requested basemap-on-by-default and authorized push/merge. The card lacked
horizontal auto margins once its 390 px cap applied. Those margins now center it.
The strict matching radius (max of 50 m and three times GPS accuracy) deliberately
has no candidates at that distance. A separate HUD projection now expands the
search, honors the route lock, labels the nearest track and distance, and uses
existing calibration only. The strict matching policy is unchanged. No source
coordinates supplied by the user were retained or used in fixtures.

Synthetic regression: a 3,218 m lateral offset from a line calibrated through
MP 4.44 returns that projection even with no coverage tiles. Tests also cover a
closer uncalibrated track, selected-route restriction, absent routes, empty geometry
and calibration gaps. Browser regressions verify centering at 320/390/430/844/1280 px,
a distant reading clearing on stale GPS, fresh default basemap loading and a saved
opt-out surviving reload. Existing privacy cases explicitly seed an off preference;
the fresh-default case does not. OpenFreeMap receives viewport tile requests as
explained in the existing disclosure; no exact GPS coordinate is put in a URL.

Validation: core then frontend production builds passed; `npm run coverage` passed
673 tests, the full Playwright suite passed 243 tests (including macOS WebKit), and
the pipeline suite with cached real source data passed 407 tests with 99.49% coverage.
Lint, type checking and formatting passed. Rendered desktop and phone screenshots
were inspected. Mocked location tests do not replace a physical-phone field check.

## Nearest usable mainline and explicit choice — 2026-10-26

The owner approved bypassing a closer spur/siding in the HUD to show the nearest
Main-class route whose closest projection has usable mileage. The chooser retains
uncalibrated mainlines with distance and unavailable labels, shows unverified
reference points, and preserves manual locks until Auto is chosen. Strict matching
remains diagnostic in Position details. No dataset or calibration policy changed.
The superseded nearest-track helper was replaced with the mainline selector.

Validation: core then frontend builds, lint, type checking and format checks passed.
Unit coverage passed 683 tests; full Playwright passed 251 tests across desktop,
Android/iPhone Chromium emulation and macOS WebKit. Pipeline tests with cached real
source data passed 407 tests (99.49% coverage). Synthetic regressions cover closer
spurs, unavailable-mileage alternatives, manual locks, Auto restoration, calibration
gaps, distance expansion, missing geometry and stale GPS. Phone-size HUD and chooser
screenshots were inspected. The supplied example was checked locally against the
hash-verified public snapshot `nrwn-national-c400fd8d+cantre.0.1.1`; its coordinates
and per-location results are not committed. Physical-phone GPS remains a field check.

## Follow-along and map exploration — 2026-10-26

The owner clarified two primary uses: a GPS-following mainline milepost counter and
free map exploration with asset information. Exploration now compacts the GPS HUD,
keeps its origin explicit, highlights a tapped asset and opens a non-modal information
panel. GPS processing and explicit mainline locks survive panning and inspection.
Follow me closes inspection and restores camera following while retaining zoom.
Keyboard arrows enter exploration; zoom alone does not. Asset touch targets are
ranked by screen distance rather than renderer order. No calculation/data changes.

The panel has a fixed header and a separate scrolling body. Chromium painted a blank
rectangle above the fixed overflow-auto panel over WebGL; separating the scrollable
body resolved it. A screenshot pixel regression catches that exposed-map defect.
Phone and desktop screenshots were inspected using synthetic fixtures.

Validation: 683 JavaScript tests with coverage; 407 pipeline tests with cached real
source inputs and no skips; 259 browser tests across desktop, Pixel/iPhone Chromium
layouts and macOS WebKit. Lint, typecheck and formatting pass. Core was built before
the production frontend. Browser checks include moving GPS while an asset stays
selected, preserving a mainline lock, pan/recenter, keyboard navigation and Escape.
Physical-device GPS and field accuracy remain unverified. This change is prepared
for review and has not been deployed.
