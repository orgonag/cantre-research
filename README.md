# CANTRE research

**CANTRE — Canada Track Rail Estimation** (formerly RailHUD).

An open-source research tool that works out where a GPS position is on the Canadian
railway network, and what railway assets are near it, from public data. The repository
is public (since 2026-10-25). Code is MIT-licensed; data stays under each source's own
licence. Built so far: the calculation core and matching state machine (`packages/core`,
milestones M1 and M3), the data pipeline (`pipeline/`, M2, now run for every NRWN province
with a published package) and the phone web app with its data client (`app/`,
`packages/data-client`, M4, pull request pending). No source app, private railway data,
credentials, photographs or database is included.

## The app (research software)

CANTRE is a phone web app that shows a calculated railway milepost for the device's GPS fix,
using public National Railway Network (NRWN) geometry and Transport Canada crossing data for
all provinces and territories that have a published NRWN package (not Nunavut or Prince Edward
Island). It is **research software**: mileposts are calculated, not surveyed, every threshold in
the matcher is experimental and unevaluated, and there has been **no field validation yet**. It
is not for safety, operations or track access.

- One download of the national data (about 14 MB), then it works offline.
- Your GPS position stays on the device: no request carries a coordinate, and no fix or trace
  is stored. The only storage is your settings, the downloaded data and a one-bit "lock was set"
  flag. There is no analytics or telemetry.
- Ambiguous places (diamonds, nearby routes, edges of the data) show a route chooser instead of
  a guess; a chosen route stays visible until you unlock it or reload.
- English and French (the French text is a draft that needs native review).

**Live link:** <https://orgonag.github.io/cantre-research/>. This address is **not live yet**. It
becomes active only after the owner enables GitHub Pages for the repository and runs the
[deploy workflow](.github/workflows/deploy.yml) by hand. Until then, build and run it locally
(`npm ci`, `npm run -w app build`, then serve `app/dist`; the data comes from the pipeline's
`national` command).

Data sources, versions and the required attribution are in
[docs/DATA-LICENSES.md](docs/DATA-LICENSES.md); measured sizes, test counts and the open items
are in the M4 entry of [docs/RESEARCH.md](docs/RESEARCH.md).

## How we work — approved method

Since 2026-10-23 CANTRE is built to research grade, milestone by milestone, each on a
branch with a reviewed PR that the owner approves, following the
[v1 spec](docs/superpowers/specs/2026-10-23-cantre-v1-design.md) and the
[plan roadmap](docs/superpowers/plans/2026-10-23-cantre-roadmap.md). Every formula is
commented with its units, source and limits. The earlier teach-and-build-together
method is kept in the [learning roadmap](docs/LEARNING.md). Enabling Pages and
running the deploy still need the owner's go-ahead.

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

- [Illustrated learning journal — October 20](docs/lessons/2026-10-20-projection/README.md): projection math, anchors and track choice.
- [v1 design spec](docs/superpowers/specs/2026-10-23-cantre-v1-design.md): what CANTRE v1 will be and how it is built.
- [Calculation core](packages/core/README.md): the built `@cantre/core` package: its API, method and limits, and the matching state machine (statuses, rules, experimental thresholds, reason codes), tested by synthetic scenario replays.
- [Data pipeline](pipeline/README.md): the built `cantre-pipeline` (NRWN and Transport Canada to chains, anchors, intervals, tiles, manifest, audit and coverage report, and the national snapshot), its output formats and determinism guarantee.
- [Data sources and licences](docs/DATA-LICENSES.md): the sources, versions, the required attribution and the optional basemap.
- [Learning roadmap](docs/LEARNING.md): the earlier teach-and-build-together method (superseded 2026-10-23).
- [Controlled source comparison](docs/SOURCE-COMPARISON.md): verified aggregate findings.
- [Prior-art study](docs/PRIOR-ART.md): TrackPilot lessons and limits, without copying.
- [Additional public layers](docs/LAYERS.md): schema evidence and proposed audits.
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

## Controlled geometry comparison — observed results

A later bounded study kept the same eight NRCan anchors and 63 sample positions,
then substituted NARN or OSM geometry using the same calculation. NARN changed MPs
by 0.0036 m mean absolute / 0.0211 m maximum; OSM by 0.1274 m / 0.5736 m. Their mean
private-reference disagreements remained 57.91 m and 57.88 m respectively.
These are calculation disagreements, **not 58-metre GPS accuracy**.

NRCan and NARN have nearly identical geometry here. OSM differs slightly, but its
MPs borrowed the same NRCan anchors and are not independently sourced mileposts.
No independent field accuracy was established. RAC is a qualitative reference until
export/reuse rights are verified. See [methods, evidence and limitations](docs/SOURCE-COMPARISON.md).

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

Selected public feature revisions were historical (2015). The track accuracy field
contains `10`; its units and definition remain unverified, so it is not a 10 m
accuracy claim. Asset/marker accuracy was unknown. LL-83 (NAD83 geographic) was used without
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

## Hosting and storage

**M4 decision (2026-10-25):** the app and one national data download are hosted on GitHub Pages
at the address above, with Cloudflare R2 as the fallback if a size limit fails. The deploy
workflow exists but has not been run, and the repository's Pages setting is off. The older
proposal below (Cloudflare Pages, R2 and regional bundles requested by position) is superseded
for v1: a request by region would reveal approximate location to the host, which is why the app
downloads the whole national snapshot instead.

Earlier proposal, kept for the record: Cloudflare Pages for the frontend and R2 for regional public-data bundles.
The website supplies a small versioned manifest/index; phone-local GPS identifies
relevant regions and boundary buffers, then requests those bundles. Raw shapefiles
or other originals need not be served from the Mac mini. Keep immutable source
snapshots and an independent backup separately from processed delivery data; the
backup destination remains undecided. Preserve full calculation geometry separately
from simplified map/display tiles. Exact formats, precision, region boundaries,
cache policy, hosting configuration and costs remain to be evaluated together.
Region requests can reveal approximate location to the host even if GPS is processed
locally; review that privacy boundary before deployment. See the
[storage proposal](docs/IMPLEMENTATION.md#proposed-storage-and-delivery).

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
was 29,643,408 bytes; PEI and Nunavut were absent from that listing. At that time no
national bulk download had occurred; the M4 national build later acquired all eleven
packages on 2026-10-24 and 2026-10-25 (see [docs/DATA-LICENSES.md](docs/DATA-LICENSES.md)).
These historical counts are not promises of current availability.

The owner made the repository public on 2026-10-25. Public visibility is not a licence
to import employer material or any other unlicensed data. See the data plan for replay
boundaries and provenance requirements.
