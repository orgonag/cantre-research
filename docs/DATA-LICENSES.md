# Data sources and licences

What the CANTRE app and its published data are made from, and under which terms. The app shows
the attribution below in its About page and in the map corner. Code and data are separate: the
code is MIT, and every dataset stays under its own source's licence. Nothing here claims rights
over material CANTRE did not author.

**Attribution sentence (required by the Open Government Licence – Canada), shown as written:**

Contains information licensed under the Open Government Licence – Canada

Licence text: <https://open.canada.ca/en/open-government-licence-canada>

## Sources in the national snapshot

All sources were retrieved with `python -m cantre_pipeline acquire`, which records each source's
publisher, licence, URL, retrieval time, package version, CRS and SHA-256 in
[`pipeline/sources/`](../pipeline/sources/). A later run fails with `HASH_MISMATCH` if the bytes
differ from the recorded ones. The raw packages are not stored in this repository and are not
served by the site.

### National Railway Network (NRWN), Natural Resources Canada

- Publisher: Natural Resources Canada (NRCan), GeoBase series.
- Licence: Open Government Licence – Canada.
- Catalogue: <https://open.canada.ca/data/en/dataset/ac26807e-a1e8-49fa-87bf-451175a859b8>
- One English shapefile package per province or territory, from
  `https://ftp.maps.canada.ca/pub/nrcan_rncan/vector/geobase_nrwn_rfn/<code>/nrwn_rfn_<code>_shp_en.zip`.
- Provinces are clipped at their borders by the publisher. CANTRE joins nothing across a border.

| Code | Package version | Retrieved (UTC) | SHA-256 (first 12 hex) |
| --- | --- | --- | --- |
| ab | 2.0 | 2026-10-25 | ab1233f88fba |
| bc | 2.0 | 2026-10-25 | 2ed031b9bc31 |
| mb | 2.0 | 2026-10-25 | 6ac70bf6f76c |
| nb | 2.0 | 2026-10-25 | 5a1a411c1a76 |
| nl | 1.0 | 2026-10-25 | 63131a63b63f |
| ns | 2.0 | 2026-10-25 | f5049fe10241 |
| nt | 1.0 | 2026-10-25 | 34c5d672c321 |
| on | 2.0 | 2026-10-25 | fda17afffeaa |
| qc | 2.0 | 2026-10-25 | 15c2a925fe8d |
| sk | 2.0 | 2026-10-24 | f25a91d23061 |
| yt | 1.0 | 2026-10-25 | f506e9b9a125 |

Nunavut (nu) and Prince Edward Island (pe) are not in the snapshot. On 2026-10-25 the
conventional package address for each answered HTTP 404, so no package could be acquired. A 404 is
not proof that the network has no track there. The app therefore has no data for those two
territories, and says "outside the loaded data" rather than guessing. Newfoundland and Labrador,
the Northwest Territories and Yukon are NRWN version 1.0; the others are 2.0. The pipeline reads
the one layer each of these packages lacks (`MARKERPOST` in nl and yt, `STRUCTURE_0` in mb) as
empty and records that in the audit log.

### Grade Crossings Inventory, Transport Canada

- Publisher: Transport Canada.
- Licence: Open Government Licence – Canada.
- File: the "2023 update" CSV, retrieved 2026-10-24, SHA-256 beginning `5ab3f3b75b20`.
- Source URL as recorded in [`pipeline/sources/tc-gci.json`](../pipeline/sources/tc-gci.json).
- Used as a second source for crossing mileposts (anchor tier `tc`). It does not replace the
  mileposts NRWN publishes.

### Dataset version and snapshot date

The current national build is dataset version `nrwn-national-c400fd8d+cantre.0.1.0`, snapshot
date 2026-10-25. The version is derived from the SHA-256 of every input package and the
inventory, the SHA-256 of the pipeline configuration and the pipeline version, so any change of
an input or a threshold is a new version (a code change must bump the pipeline version; see
`pipeline/README.md`). NRWN features are mostly from 2016 or earlier; the
snapshot date is the retrieval date, not the date of the features. The app shows the snapshot
date on the status card.

## Optional basemap

The map can show a basemap. It is off by default and fetched only after the user turns it on and
reads the notice that map tiles are requested for the area shown, that OpenFreeMap then sees the
user's internet address and that area, and that because the map opens around the GPS fix, the
requests show roughly where the user is.

- Provider: OpenFreeMap (`tiles.openfreemap.org`, "liberty" style).
- Data: © OpenStreetMap contributors, available under the Open Database Licence (ODbL),
  <https://www.openstreetmap.org/copyright>.
- Attribution shown in the map corner only while the basemap is on: "Basemap: © OpenStreetMap
  contributors, OpenFreeMap".
- CANTRE does not download, copy or store any OpenStreetMap data. The tiles are fetched by the
  browser from OpenFreeMap and are not cached by the app.

## Code and libraries

- CANTRE's own code is MIT-licensed ([`LICENSE`](../LICENSE)).
- The site ships maplibre-gl 6.13.0 (BSD-3-Clause), preact 11.0.1 (MIT), the packages they
  depend on, and the Workbox runtime of the service worker (workbox-core, workbox-precaching,
  workbox-routing and workbox-strategies 7.4.1, MIT): 29 packages in all, under MIT (15), ISC (8),
  BSD-3-Clause (3), BSD-2-Clause (2) and MIT OR Apache-2.0 (1). Their notices and full licence
  texts are built into the site as `third-party-licenses.txt` (linked from the About page;
  generated from node_modules by `app/licenses-plugin.ts`). The chunk packages come from the
  built bundle; the Workbox packages come from the `workbox:<name>` markers in the emitted
  `sw.js` and `workbox-*.js`. No dev tool is listed. The size gate fails if the file is missing
  or lacks maplibre-gl, preact or a `workbox-` entry.
- Build and test tools (Vite, Workbox, Playwright, axe-core and others) are not part of the
  published site. Nine transitive build packages (all dev-only in
  `package-lock.json`, pulled in by the service-worker plugin's `workbox-build` and by the
  browser-support data) carry licences outside MIT, BSD, Apache, ISC and MPL:
  - BlueOak-1.0.0: `@isaacs/cliui` 9.0.0, `glob` 11.1.0, `jackspeak` 4.2.3, `minimatch` 10.2.6,
    `minipass` 7.1.3, `package-json-from-dist` 1.0.1, `path-scurry` 2.0.2, `lru-cache` 11.5.3.
  - CC-BY-4.0: `caniuse-lite` 1.0.30001819 (browser-support data).

  They were accepted for the build (controller ruling P23). None is in the site: the notices file
  lists only packages found in the built bundle, and none of these is among them. The owner has
  not yet confirmed them; replacing `workbox-build` with a hand-written service worker would
  remove most of them.

## What these licences do not give

Research use conveys no access authority and no safety guarantee. A calculated milepost is not a
surveyed position. See the About page and [AGENTS.md](../AGENTS.md).
