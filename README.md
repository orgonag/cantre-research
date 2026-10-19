# RailHUD research

Private, documentation-first research handoff for a future implementation agent.
**No application is implemented in this repository.** No source app, private railway
data, coordinates, fixtures, credentials, photographs or database is included.

## Goal and intended experience

Build a phone-accessible web research app that uses a consenting user's GPS fix to
identify a plausible Canadian railway subdivision and calculate a milepost from
public track geometry and qualified calibration evidence. Show available public
crossings and bridges, source vintage, match ambiguity and uncertainty. Begin with
conventional mainline and shortline rail. LRT coverage is optional. Extend to the US
only after finding suitable public sources and confirming rights and calibration.

Research use only: this app grants no railway access authority and provides no
operational safety guarantee. A calculated milepost is not a surveyed position,
movement authority, protection limit or substitute for railway rules.

## Start here

- [Projection math tutorial](docs/PROJECTION.md): vectors, worked examples and limits.
- [Agent instructions](AGENTS.md): scope, privacy and implementation discipline.
- [Implementation brief](docs/IMPLEMENTATION.md): proposed architecture and contracts.
- [Staged plan](docs/PLAN.md): deliverables and stop conditions.
- [Acceptance specification](docs/ACCEPTANCE.md): meaningful behavior tests.
- [Data, licensing and reproducibility](docs/DATA.md): provenance and lawful inputs.
- [Research log and decisions](docs/RESEARCH.md): evidence, gaps and decisions.

## Actual calculation method

Represent a track as an ordered polyline. For each consecutive vertex pair,
project the GPS position onto the segment using a local longitude scaling by
cos(latitude), clamp the projection to the segment, and compare haversine distances.
Select the closest projected point on that candidate polyline. Sum the distances
between all vertices before that point plus the partial last segment.

For two calibrated endpoints A and B, calculate:

`MP = MP_A + (distance_along_A_to_projection / distance_along_A_to_B) * (MP_B - MP_A)`

This follows the saved bends. It does not interpolate across a single straight
line between distant anchors. The curve is still a polyline approximation: sparse
vertices can cut across a real bend. No circular arc or spline reconstructs missing
geometry. Spherical distances, local projection and Float32 coordinates also have
limits. Rescaling to endpoint mileposts means this is not simply converting metres
to miles. Decreasing mileposts work with the same expression.

Example: a bending mapped path of 1,600 metres between MP 100 and MP 101 assigns
MP 100.25 at 400 metres along the path, irrespective of the shorter endpoint chord.

The completed local pilot projected qualified crossing anchors onto a preselected
public track, sorted them along the geometry, bracketed each sample, retained the
vertices between anchors and reused the original numerical interpolation locally.
It rejected duplicate-position and nonmonotonic anchors and did not extrapolate
outside the outer anchors. Missing milepost evidence remained missing.

## Verified Sutherland pilot

Exploratory comparison completed October 16, 2026 near Saskatoon. Eight public
crossing anchors explicitly qualified **Posted** span **MP 109.88–112.52**; maximum
adjacent gap is **0.93 mile**. Five numeric crossings with Unknown qualifiers were
excluded as anchors. No overlapping public marker posts were available: the ten
Sutherland marker records were on the Norco spur. A similarly named Tisdale candidate
was rejected because different subdivision identifiers share the name.

The selected main track has 18 crossing records, three bridge line records and an
excluded culvert. Repeated/missing group IDs mean records are not distinct physical
assets. Bridges lack usable source mileposts. Fifteen crossings fall inside anchor
brackets; three are unscored. Bridge vertices are sample points, not authoritative
engineering mileposts.

| Samples | Scored / total | Mean absolute disagreement (m) | Maximum (m) |
| --- | ---: | ---: | ---: |
| Crossing locations | 15 / 18 | 61.20 | 153.08 |
| Bridge vertices | 9 / 9 | 58.62 | 83.92 |
| Synthetic locations | 63 / 63 | **57.91** | **145.56** |

These are differences between public-calibrated and original calculated mileposts,
converted from miles using 1609.344 m/mile. **They are not surveyed accuracy or GPS
position errors.** All scored public-minus-reference differences were negative.
The 63 points were generated along public geometry, nine inside each anchor interval;
they were not recorded phone fixes. Six interior-anchor leave-one-out checks gave
15.61 m mean absolute and 26.44 m maximum disagreement, an internal-consistency test
rather than independent truth. The local harness passed three parsing and eight
calculation tests; these tests and private fixtures are not shipped here.

## Route choice and user control

Priority cases include diamonds/perpendicular crossings and different Class I
railways close together, as well as parallel tracks. Automatic subdivision choice
requires unambiguous evidence under a validated policy. A sole candidate in an
incomplete dataset is not proof. If several routes remain plausible, present explicit
choices with source-supported identities and uncertainty. Let the user lock a route
or subdivision; never silently switch the lock. Contradictory or stale fixes produce
a warning/unresolved state, not an automatic route change. User choice constrains
candidates but cannot improve GPS precision. Thresholds remain to be validated.
See the [selection contract](docs/IMPLEMENTATION.md#route-selection-and-user-control).

## What remains unresolved

The discrepancy cause is **unisolated**. Both sides used the same interpolation
function with different geometry/calibration inputs. No experiment demonstrated
that curves, datum, anchors or track choice caused the observed difference. Do not
fit away the offset or present densification as a fix without controlled evidence.

The public pilot used one preselected track; it did not validate automatic selection
among public parallel tracks or junction branches. The private reference comparison
was cold-start, without heading or prior-track state; its bounding-box candidate
query used a linear equivalent, whose exact-tie order may differ from the original
spatial index. Full GPS/UI history and display extrapolation were not exercised.

Selected public feature revisions were historical (2015). Track accuracy was recorded
as 10 m; asset/marker accuracy was unknown. LL-83 (NAD83 geographic) was used without
a datum transformation beside reference coordinates. Source-derived offsets below
0.24 m do not prove survey quality. Neither whole-network coverage nor current track
status is established.

The requested **1% tolerance has no agreed denominator or near-zero rule**. Do not
measure it against the absolute milepost label. Agree an absolute chainage tolerance,
a meaningful interval denominator, reporting percentiles, source quality and field
validation method before any pass/fail accuracy claim.

## Stack: observed versus proposed

The inspected original app uses React 19, TypeScript/TSX, Vite 7, pnpm, Leaflet,
Flatbush in a Web Worker and browser `navigator.geolocation.watchPosition`.
Its Node/Hono backend uses Zod/OpenAPI, better-sqlite3 and @duckdb/node-api;
supporting libraries include Tailwind 4, Radix UI, Zustand, TanStack Query and React
Router 7. Vitest and Playwright are its test tools. This is descriptive evidence,
not permission to copy its code or a dependency lock for a new app.

**Proposal:** independently implement a small TypeScript calculation core with a
React/Vite mobile web shell, Leaflet and an indexed matching worker. Consider local
versioned corridor bundles first; add a backend only for a demonstrated requirement.
Evaluate current versions, licences, browser support, bundle size and alternatives
at implementation time. SQLite/DuckDB are optional preparation tools, not required
browser dependencies. No stack decision is settled by this document.

## Sources and preservation

Publisher: Natural Resources Canada (NRCan), National Railway Network (NRWN),
GeoBase Series. Do not conflate NRCan with Transport Canada or infer other agencies'
coverage from this dataset.

- [Official catalogue](https://open.canada.ca/data/en/dataset/ac26807e-a1e8-49fa-87bf-451175a859b8)
- [Saskatchewan English GML ZIP](https://ftp.maps.canada.ca/pub/nrcan_rncan/vector/geobase_nrwn_rfn/sk/nrwn_rfn_sk_gml_en.zip)
- [National directory](https://ftp.maps.canada.ca/pub/nrcan_rncan/vector/geobase_nrwn_rfn/)
- [Open Government Licence – Canada](https://open.canada.ca/en/open-government-licence-canada)

Contains information licensed under the Open Government Licence – Canada.
The Saskatchewan raw archive was preserved locally, separate from processed JSON:
3,693,881 bytes compressed, 75,761,891 bytes across its GML/XSD/XML members. The
October 16 size-only inventory of eleven English provincial/territorial SHP ZIPs
was 29,643,408 bytes; PEI and Nunavut were absent from that listing. No national
bulk download occurred. These historical counts are not promises of current availability.

The repository includes documentation only. Eventual open-source publication is
gated on rights review; private repository visibility is not a licence to import
employer material. See the data plan for replay boundaries and provenance requirements.
