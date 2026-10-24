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

## SK SHP package (pipeline source)

The M2 pipeline reads the English shapefile package, not the GML snapshot above. Provenance is
recorded by `python -m cantre_pipeline acquire --province sk --record` in
`pipeline/sources/sk.json`; verify mode (`acquire --province sk`) re-checks the bytes against it.

- URL: https://ftp.maps.canada.ca/pub/nrcan_rncan/vector/geobase_nrwn_rfn/sk/nrwn_rfn_sk_shp_en.zip
- Retrieved 2026-10-24T17:39:19Z. 3,239,574 bytes. `Last-Modified: Thu, 25 Jul 2019 00:03:12 GMT`.
- ZIP SHA-256: `f25a91d230619b9f73093955c69f02e9ed7f93e425214c940e328c359f1a796a`
  (the value inspected when M2 was planned; NRCan had not republished).
- 43 members: `NRWN_SK_2_0_{CROSSING,JUNCTION,MARKERPOST,STATION,STRUCTURE_0,STRUCTURE_1,TRACK}`
  each as `.dbf .prj .sbn .sbx .shp .shx`, plus the metadata `RFN_SK_2.0_20161006-135018.xml`.
  Per-member sizes and SHA-256 values are in `sk.json`. Package version 2.0 comes from the member
  names.
- CRS: the TRACK `.prj` text is stored verbatim in `sk.json` (`GCS_North_American_1983_CSRS98`,
  GRS 1980). Coordinates are read as x = longitude, y = latitude, with no datum transformation.
- Licence: Open Government Licence - Canada. Raw bytes are cached under `.cache/raw/`
  (override `CANTRE_RAW_DIR`) and never committed; the cache is re-hashed before every use.
- Windows note: the extracted tree is `<cache>/<sha256>/<member>`, about 100 characters of path
  below the cache directory. Keep the cache directory short (for example set `CANTRE_RAW_DIR`),
  or enable long paths, if the repository sits deep in the file system.

## `GEOACCURA`

`GEOACCURA` is the shapefile name of the NRWN geometry attribute `geometryPlanimetricAccuracy`.
It is one number per feature, and its meaning is verified from NRCan's NRWN documentation, found in
the `doc/` directory beside the packages
(https://ftp.maps.canada.ca/pub/nrcan_rncan/vector/geobase_nrwn_rfn/doc/). All four documents
are Edition 1.0, 2012-11-07, served with `Last-Modified: Thu, 25 Jul 2019 00:03:10 GMT`, and
were retrieved 2026-10-24:

| Document | Title in the PDF | SHA-256 | What it establishes |
|---|---|---|---|
| `GeoBase_nrwn_en_Distribution_Formats.pdf` | GeoBase - Product Distribution Formats, Edition 1.0 | `a5ab02394e9b8f490fa6e27c35b2b870b97aba5a7e080f4c582ebcf0f8014744` | Field table: `geometryPlanimetricAccuracy` is `GEOACCURA`, `NUMBER(3)`, in shapefile, GML and KML. |
| `GeoBase_nrwn_en_Catalogue.pdf` | GeoBase - Feature Catalogue, Edition 1.0 | `68ef8439c2fd936d75e448e384dda59d9296ad7b4e39a70d11f15a25fdb84002` | `GeometryObjectMD.planimetricAccuracy`, an Integer: planimetric accuracy of the object, in metres, as a circular map accuracy standard (CMAS). |
| `GeoBase_nrwn_en_Specifications.pdf` | GeoBase - Data Product Specifications, Edition 1.0 | `1b665ffab8d84e42197586b70df2e80c85d9fc1e923f52b84628803706c568b1` | Section 6.3.1, absolute external positional accuracy: given per feature, in CMAS; product aim "10 meters or better". |
| `GeoBase_nrwn_en_Release_Notes.pdf` | (release notes, 2017-09-12) | `870f4d8509e75a0b3f3fcb4bdadac9c3c563b8d5ebc5dc9f6530a2873eb16b8c` | Read for edition context only; says nothing about accuracy. |

- Unit: metres, horizontal (planimetric).
- Statistic: CMAS, the 90 % circular error. The specification defines the standard circular error
  as `c = 0.7071 (x² + y²)^½` with `x`, `y` the standard deviations on each axis, and
  `CMAS = 2.1460 c`.
- The package metadata XML (`RFN_SK_2.0_20161006-135018.xml`) repeats this definition, and its
  minimum/maximum accuracy elements read "horizontal positional accuracy of the source dataset in
  meters". For federal source data it states a generally 30 m or better CMAS, which is a
  statement about source data and is looser than the 10 m product aim.
- Method and limits: the specification says the evaluation method is set by the data provider,
  and that no systematic validation of accuracy is performed during maintenance. The value is
  therefore the producer's stated accuracy, not a measured one.
- Edition gap: the documents are Edition 1.0 (2012); the data is package version 2.0 (2016
  metadata, 2019 server date). The attribute definition is taken to be unchanged. This is an
  inference; the top level of `doc/` lists only Edition 1.0 files (its `Publication/` and
  `archive/` subdirectories were not opened).
- SK values counted 2026-10-24 with pyshp: `10` on all 7,084 TRACK and 5,163 JUNCTION records,
  and `-1` on every record of the other five layers (7,660 CROSSING, 2,430 MARKERPOST, 256
  STATION, 4 STRUCTURE_0, 451 STRUCTURE_1). The catalogue uses `-1` as its "unknown" code for coded attributes; it does not
  define `-1` for `planimetricAccuracy`, so `-1` is read as unknown by that convention.
- How v1 uses it: the value is shown as the source's stated accuracy (a CMAS in metres), never as
  a confidence interval and never combined into an uncertainty (spec §6e).

## TC Grade Crossings Inventory (pipeline source)

Transport Canada's Grade Crossings Inventory supplies mileage for crossings that NRWN does not
post. Provenance is in `pipeline/sources/tc-gci.json`.

- URL: https://open.canada.ca/data/dataset/d0f54727-6c0b-4e5a-aa04-ea1463cf9f4c/resource/a53fda5b-134f-449d-a639-9b896065fc21/download/en-grade-crossing-inventory-2023-update.csv
- Catalogue: https://open.canada.ca/data/en/dataset/d0f54727-6c0b-4e5a-aa04-ea1463cf9f4c
- Publisher: Transport Canada. Licence: Open Government Licence - Canada. Version: 2023 update
  (from the file name).
- Retrieved 2026-10-24T17:40:20Z. 4,000,479 bytes. `Last-Modified: Wed, 09 Oct 2024 15:29:18 GMT`.
- SHA-256: `5ab3f3b75b20b186800cee244a482a65451ea1c7841fb136c827f69058708a41`
  (matches the value inspected at planning time). UTF-8 with a BOM; kind `file`, so it is hashed
  and copied, not extracted.
- Columns used: `TC Number`, `Province`, `Mile`, `Subdivision`, `Spur Mile Point`, `Spur Name`,
  `Railway Company`, `Latitude`, `Longitude`.
- Join rule (plan Decision 7): a row joins an NRWN SK crossing when its stripped `TC Number`
  equals `TCID` (not `-1`), `Province` matches, `Spur Mile Point` is `-` or empty, the normalised
  subdivision names agree (trailing `" - <word>"` operator suffix removed, case-folded, letters
  a-z only), and `Mile` parses to 0 or more. Failing rows are audited, not dropped silently
  (`TC_NO_ROW`, `TC_SPUR_CROSSING`, `TC_SUBDIVISION_MISMATCH`, `TC_BAD_MILE`); a `TC Number` that
  appears twice is used for neither record (`TC_DUPLICATE_NUMBER`).
- Coordinates are not used for geometry. `Latitude` and `Longitude` have 0 to 5 decimals and serve
  only as a sanity distance.
