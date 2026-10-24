# Data rights and reproducibility

## Public pilot source

NRCan National Railway Network, GeoBase Series. Catalogue:
https://open.canada.ca/data/en/dataset/ac26807e-a1e8-49fa-87bf-451175a859b8

Raw source:
https://ftp.maps.canada.ca/pub/nrcan_rncan/vector/geobase_nrwn_rfn/sk/nrwn_rfn_sk_gml_en.zip

Licence:
https://open.canada.ca/en/open-government-licence-canada

Contains information licensed under the Open Government Licence – Canada.
Confirm licence applicability and exclusions for each new resource; this licence
does not clear private reference material or unrelated third-party data. No software
licence is granted by this documentation repository pending owner rights review.

## Preserved local snapshot (not committed)

Retrieved 2026-10-16 (date precision; exact retrieval time was not recorded).
ZIP SHA-256: `2c8fda4dba44686c46f94a58f392f6da24bd9cff782610e8bfd4fe21ab0c7d48`.
Original 3,693,881 bytes; expanded members total 75,761,891 bytes:

- `NRWN_SK_2_0_eng.gml`: 75,580,599 bytes.
- `NRWN_SK_2_0_eng.xsd`: 43,707 bytes.
- `RFN_SK_2.0_20161006-135018.xml`: 137,585 bytes.

Names evidence package version 2.0; package date, server modification, catalogue
update and feature observation/revision dates must remain distinct. Source CRS is
LL-83, NAD83 geographic, coordinate pairs read as longitude/latitude. No datum
transformation was applied in the pilot.

## Reproduction recipe and boundary

The completed local harness used Python 3.14.7 to read ZIP/GML with standard-library
XML parsing, retain scalar properties and coordinate parts, and select unique records
whose first or second subdivision name is SUTHERLAND. Stable subdivision and track
IDs then disambiguated selection and joins. It used eight Posted numeric crossing
anchors within 25 m of the selected track, rejected unknown qualifiers and clipped
between brackets. Node 26.8.1 ran the local calculation with Float32 geometry and
anchor MPs. Nine synthetic interior samples per interval produced 63 samples.

This is a methodological recipe, not a runnable repository command. The private
reference implementation and inputs are intentionally absent. Public normalization
can be reimplemented independently; exact original-vs-public numbers cannot be
reproduced from this repository alone. Ask the owner for permitted aggregate evidence
or independent validation rather than importing the private baseline.

## New ingestion requirements

Store immutable original bytes outside git, separated from processed outputs. Each
manifest must include publisher, source/catalogue/licence URLs, retrieved UTC time,
version evidence, file and archive-member sizes/checksums, source CRS/axis order,
transform code version/options, datum steps, output checksums and attribution.
Keep unknown dates and accuracy unknown; do not substitute retrieval time.

Validate schema, unique IDs, joins, missing units, qualifiers, multipart geometry,
track connectivity, geometry density and mileage discontinuities. Preserve IDs and
rejection reasons. Demonstrate deterministic bounded-corridor regeneration before
scaling. No national download or private data upload is authorized by this plan.

## Future coverage

The 2026-10-16 national directory inventory counted eleven English SHP ZIPs totalling
29,643,408 bytes using headers only; no PEI/Nunavut package appeared in that listing.
It is an NRWN inventory, not every Canadian government railway dataset. It establishes
neither completeness nor every yard track, tie, ballast asset or LRT route. US sources
must be evaluated separately for reuse rights, geometry, calibration and freshness.

## Additional bounded study and storage decisions

The October 19 comparison added bounded NARN GeoJSON and OSM XML extracts locally,
not national downloads. OSM retrieval was independent of TrackPilot. RAC geometry
was not extracted because reuse rights remain unresolved. See SOURCE-COMPARISON.md.
Raw snapshots, licence terms, hashes, retrieval timestamps and feature/source vintage
must stay distinct and preserved. Regional browser delivery is a proposal described
in IMPLEMENTATION.md; original shapefiles need not be served by the Mac mini.
Preserve full calculation geometry separately from simplified display tiles. Optional
additional layer audits are in LAYERS.md; schema presence is not coverage evidence.
