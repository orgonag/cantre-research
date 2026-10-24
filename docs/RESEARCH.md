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
