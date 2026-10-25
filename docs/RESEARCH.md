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
| M2 ruling R17: posted-only coverage | `calibrated_km_posted_only` is rebuilt from the qualified `posted` anchors (the output of `qualify_anchors`, before any interval step), passed to `coverage_rows` as `qualified_posted`. Rebuilding from the anchors the all-tier pass kept inherited lower-tier decisions (a posted anchor dropped as an outlier because unverified anchors bridged it). The synthetic Kappa case covers it. |
| M2 canonical output direction | Found by the determinism test: segment and line-asset vertices are written in the lexicographically smaller direction, so reversing a record cannot change a byte. A line asset's `sStartMm <= sEndMm` (direction not preserved). Tile `sMm` of chain pieces is delta-encoded like `latE6` and `lonE6`. |
| M2 derived mileposts use stored millimetres | Found by the contract test: interpolating from unrounded `s` differed from core (which reads `sMm / 1000`) by up to 0.5 mm of track, about 3e-7 mi. The deriver now rounds anchor and asset `s` to the millimetre first. |
| Residual check is not evidence of position accuracy | In the Saskatchewan data every crossing, marker post and station that reaches the residual check sits exactly on the track: residual 0.0 m for all 7,553 qualified anchors (5,017 crossings, 2,288 marker posts, 248 stations) and for every positioned crossing, station, bridge, culvert, tunnel and diamond. NRWN points were evidently snapped to the geometry, so `anchor_max_residual_m` only catches wrong-track and wrong-subdivision records (the 17 `RESIDUAL_TOO_LARGE` cases are 396.48 m to 13,938.97 m). It cannot show how close a point is to the true feature. Position accuracy needs independent ground truth (M5). Evidence: `CANTRE_RAW_DIR=C:/cv-raw-v python pipeline/scripts/measure_residuals.py sk` printed `crossing: qualified=5017 max_residual_m=0.0 residual_above_zero=0`, `markerpost: qualified=2288 max_residual_m=0.0 residual_above_zero=0`, `station: qualified=248 max_residual_m=0.0 residual_above_zero=0`, `all: qualified=7553 max_residual_m=0.0`, `RESIDUAL_TOO_LARGE: n=17 min_m=396.48 max_m=13938.97`. (Asset residuals: every `residualMm` in the real tiles is 0.) |

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
- `PYTHONHASHSEED=0 python -m cantre_pipeline build --province sk --out C:/tmp/m2a --check-budget` printed `built sk: 274 tiles, max gzip 131029 bytes, chain 8446.523479 km, calibrated 8041.425081 km (95.204 %), 10385 audit lines, 12.5 s`, exit 0 (`time`: real 12.763 s). The same command with `PYTHONHASHSEED=12345` and `--out C:/tmp/m2b` printed the same line and `diff -r C:/tmp/m2a C:/tmp/m2b` printed nothing. The tree SHA-256 (sorted path and file-hash pairs) of both is `72a322e10b29ec66e9c781425746c6a28b81a9eafecb6f7fae040ce68045292b`.
- Dataset version `nrwn-2.0+cantre.0.1.0`; source SHA-256 as above; configuration SHA-256 `948fe6863344f9b25957644a7ffc92ba600a37f88fd43da600d0b2f7afa3d61a`.
- Tiles: 274; gzip total 4,382,955 bytes; maximum 131,029 bytes (budget 500,000); uncompressed total 19,342,075 bytes, maximum 619,878.
- Coverage (`reports/coverage-sk.json`, 74 subdivisions with chain): chain 8446.523479 km; calibrated 8041.425081 km (95.204 %); calibrated from the qualified posted anchors alone (ruling R17) 7708.982867 km. Subdivisions where posted-only exceeds all-tier: Elrose (167.258416 vs 167.059103 km), Lampman (135.662187 vs 135.513304) and St. Brieux (84.572673 vs 83.543084). `python pipeline/scripts/diagnose_posted_only.py sk` shows the mechanism: in each, the posted-only pass drops one posted anchor as an outlier (`posted 26.5 @ 126191 m` in Elrose, `31.7 @ 87728 m` in Lampman, `34.55 @ 31207 m` in St. Brieux, `155.25 @ 5398 m` in the Watrous subdivision's chain) while the all-tier pass keeps it, and the all-tier pass has an interval break next to it (pair slope 0.810, 0.998, 0.686 and 0.849) that the posted-only intervals run through. In Elrose, St. Brieux and Watrous an unverified anchor lies 653 m, 338 m and 262 m from the dropped anchor; whether that anchor is what saves it in the all-tier pass was not tested, and in Lampman the four nearest kept anchors are all posted, so the cause there is not yet diagnosed. Assiniboia (91.787 km against 0.000 posted-only) and Prince Albert (117.455 against 0.000) have no posted anchors at all: their anchors are 43 and 53 `tc` tier.
- Kept anchors by tier: posted 4,881, tc 122, unverified 2,174 (7,177 in all). By source: crossing 5,003, markerpost 1,977, station 197, structure 0. Isolated anchors (in no interval): 9. Intervals: 151 on 132 chains.
- Rejections by reason (severity `rejected`): ANCHOR_CONFLICT 82, ANCHOR_OUTLIER 8, MILEAGE_SENTINEL 455, NOT_POSTED 1,922, POSTED_SENTINEL 50, RESIDUAL_TOO_LARGE 17, SOURCE_DISAGREEMENT 22, SUBDIVISION_MISMATCH 19, TC_SPUR_CROSSING 53, TC_SUBDIVISION_MISMATCH 11, TRACK_NOT_CHAINED 664, UNVERIFIED_DEVIATION 189 (3,492 in all). Info lines include ANCHOR_COLLAPSED 200, ANCHOR_MERGED 58, ASSET_UNPOSITIONED 1,284, NOT_CHAINED_CLASS 5,303, SECOND_SUBDIVISION_IGNORED 23, DUPLICATE_NID 18, DUPLICATE_SEGID 1, UNKNOWN_DOMAIN_VALUE 2, VERTEX_DEDUPED 4.
- Chain cycles: 0. Subdivisions with chain but 0 % calibrated: 4 (Colony 0.730 km, Flin Flon 2.296 km, Paddockwood Spur 14.758 km, Weyerhaeuser Spur 13.441 km).
- Assets: 8,392 in all (bridge 450, crossing 7,660, culvert 4, diamond 21, station 256, tunnel 1); 7,108 have a chain position and 6,886 of those have a derived milepost.
- Synthetic golden build (`pipeline/tests/golden/synthetic/`, no NRWN data): 18 tiles, 24 audit lines. `python -m pytest pipeline`: 278 passed, 6 skipped, line coverage 99.63 % (gate 95 %); with `CANTRE_RAW_DIR=C:/cv-raw-v` the 6 real-data tests run: 284 passed. `ruff check`, `ruff format --check` and `mypy --strict pipeline/src pipeline/tests` pass. `npm run coverage`: 13 test files, 99 tests passed; lines 98.6 %, branches 97.29 %, functions 100 %.
- The determinism and contract tests found two defects in earlier output, fixed here (see the decision register): vertex direction leaked into tile bytes, and derived mileposts were interpolated from unrounded `s`.

Not done or not claimed: no datum transform (NAD83(CSRS98) used as-is); the residual check cannot test position accuracy (see the register); the synthetic golden was generated on Windows and has not been run on Linux. Tile numbers are integer-quantised (microdegrees and millimetres), so a libm difference could change a byte only at a 0.5 mm rounding boundary; the more plausible platform difference is the manifest's `gzipBytes`, which depends on zlib's deflate output. The golden test now names the first differing file. Other provinces, offline downloads and the evaluation are M5; hosting is owner-gated.
