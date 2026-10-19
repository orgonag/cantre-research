# Controlled Sutherland geometry comparison — observed 2026-10-19

Sanitized aggregate record of a completed local experiment. No coordinates, private
code, fixtures or per-point outputs are included. The original calculation remains
a local comparison baseline, not ground truth. Exact private-baseline replay is not
possible from this documentation-only repository.

## Question and controls

Would substituting public geometry materially change the earlier calculation?
Keep the same eight NRCan Posted crossing anchors, MP 109.88–112.52, the same 63
synthetic locations (nine per interval), the same Float32 representation and the same
projection/along-polyline interpolation. Reproject original public crossing locations
onto each selected route; retain vertices between bracketing anchors. All eight
anchors pass the existing 25 m experimental gate and all 63 locations are bracketed.
That gate is inherited experimental configuration, not a validated product threshold.
No extrapolation. Samples originated on NRCan geometry, not observed phone GPS.

| Geometry | Length between outer anchors (m) | Clipped vertices | Mean / max absolute MP difference vs NRCan (m) | Mean / max disagreement vs private reference (m) |
| --- | ---: | ---: | ---: | ---: |
| NRCan | 4101.484 | 69 | 0 / 0 | 57.91 / 145.56 |
| NARN | 4101.471 | 69 | 0.0036 / 0.0211 | 57.91 / 145.56 |
| OSM | 4102.841 | 91 | 0.1274 / 0.5736 | 57.88 / 145.43 |
| RAC | Unavailable | — | Rights/access unresolved | — |

These are milepost differences expressed as metres, not surveyed errors or a claim
of 58 m GPS accuracy. NARN's 75 full-feature vertices differ from NRCan's corresponding
vertices by 0.0341 m on average, 0.0653 m maximum. This is near-identical representation,
not independent confirmation; Canadian lineage remains unestablished. OSM geometry
differs slightly: sample cross-track residual averages 2.368 m, maximum 5.950 m.
Its maximum clipped vertex gap is 770.16 m versus 314.98 m for NRCan/NARN; more vertices
alone do not prove better curves, and a long segment can be straight.

## Identity and source-native mileage

- NRCan: selected main-track feature has geometry/attribute revisions `2015`,
  acquisition `Vector Data`, provider `Federal`, sourceID `Unknown`. Accuracy field
  `10` remains uninterpreted until the matching schema definition/units are verified.
  Eighteen linked crossings include eight Posted numeric anchors, five numeric
  Unknown-qualified values and five missing values. Crossing geometry is `Computed`
  with unknown accuracy, so close projection residuals are not independent validation.
- NARN: official bounded query returned all 94 lines, including 86 SUTHERLAND and
  eight WARMAN. Selected a single SUTHERLAND CPKC main feature, FRAARCID 703107;
  no path stitching across yards or other railways. hasM=false; MILES/KM are lengths,
  not native milepost endpoints. Overall July 21, 2026 update is not Canadian feature
  vintage. The advertised 1:24,000-or-better scale applies within the US.
- OSM: official bounded map API succeeded after three Overpass service failures.
  Nine CPKC Sutherland main ways form a single unbranched chain, confirmed by shared
  node IDs and route relation 18330075. No shortest-path route guessing. All selected
  ways carry source=Esri; October 8/13, 2026 edits are not survey/imagery dates.
  No railway:position* tags occurred in this extract. OSM and Geofabrik are the same
  data family, not independent candidate sources.
- Both NARN and OSM calculations BORROW NRCan anchor labels. Their MPs were not
  supplied natively. RAC is qualitative only pending verified geometry export/reuse
  rights; no RAC geometry was extracted and local native mileage completeness is unknown.

## Verification and interpretation

Original inputs remained unchanged; repeated offline regeneration was byte-identical.
All three parsing and eight calculation tests passed. Source snapshots and manifests
retain URLs, byte counts, hashes, CRS and transformation recipes locally, with
retrieval timestamps where recorded. The original NRCan retrieval was recorded only
to date precision (2026-10-16); do not invent a UTC time.
NRCan LL-83/NAD83, NARN EPSG:4326 and OSM WGS84 were compared numerically without a
new datum adjustment. No national bulk data was downloaded.

The experiment isolates sensitivity to geometry substitution under shared calibration
and representation. It does not isolate the cause of private-reference disagreement.
Samples and anchors favour NRCan; this is not three independent chainage systems.
Route choice was preselected, not validated at diamonds or parallel railways.

Next: obtain independent known chainage controls with datum/provenance, hold them out
of calibration, and evaluate predictions. Separate ordinary anchor leave-one-out
internal consistency from independent field validation. Investigate calibration,
mileage discontinuities and geometry one factor at a time; do not tune to the private
reference. Add ambiguity/lock tests separately. The 1% denominator remains unresolved.

## Public sources

- [NRCan catalogue](https://open.canada.ca/data/en/dataset/ac26807e-a1e8-49fa-87bf-451175a859b8)
- [NARN official layer](https://services.arcgis.com/xOi1kZaI0eWDREZv/arcgis/rest/services/NTAD_North_American_Rail_Network_Lines/FeatureServer/0)
- [OSM route relation](https://www.openstreetmap.org/relation/18330075)
- [OSM attribution/licence](https://www.openstreetmap.org/copyright)
- [RAC atlas](https://rac.jmaponline.net/canadianrailatlas/)

Contains information licensed under the Open Government Licence – Canada. OSM data:
© OpenStreetMap contributors, ODbL. NARN: FRA/BTS, metadata states unrestricted public
use. Public source licence does not clear the private reference.
