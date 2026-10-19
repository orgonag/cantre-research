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
| New stack | Proposed only; choose current supported versions after requirements review. |
| Geometry/datum error contribution | Unisolated; controlled experiments required. |
| Parallel-track and junction selection | Public pilot preselected a track; not validated. |
| GPS freshness/uncertainty thresholds | To define and test, not inherited blindly. |
| Offline, storage and backend | Requirements decision pending; default location processing local. |
| Open-source/public release | Desired eventually; separate rights review and approval required. |

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
