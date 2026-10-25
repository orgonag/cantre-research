# M4 National App and Public Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put a working CANTRE web app online for all of Canada. A person opens it on a
phone, downloads one small national snapshot once, and sees which track they are on, the calculated
milepost with its uncertainty, nearby assets, and an explicit choice when the evidence is
ambiguous. Evaluation and research continue afterwards (M5), and the app is labelled as
research software throughout.

**Why this plan changes the roadmap:** On 2026-10-25 the owner asked for a public launch
covering all of Canada first, with tests and research added slowly afterwards, while
keeping plan-then-approve per milestone. So the national build and the public site move
into M4. M5 becomes evaluation and the datum study. M6 stays the methods write-up and
release kit. The roadmap is updated in this plan's PR.

**Architecture:**
- **Pipeline** (`pipeline/`): every NRWN province and territory package is built. A national
  step then writes one dated **national snapshot** (`cantre.snapshot/1`). It holds:
  - the whole country's calculation data in one compact binary file, gzip-compressed;
  - a second national file with the full source attributes of every asset;
  - one national manifest listing both, with sizes and SHA-256.
  The existing `cantre.tile/1` tiles stay as the reference format that the snapshot is
  tested against.
- **`@cantre/core`:**
  - gains `networkFromSnapshot`, which decodes the snapshot into the same `NetworkView` as
    `networkFromTiles`;
  - gains decoded assets and three lookups: nearby assets along a chain, the place at a
    given subdivision and milepost, and the milepost at a tapped point.
- **`@cantre/data-client`** (new package):
  - reads the manifest;
  - downloads the national snapshot and the asset-details file once;
  - verifies their hashes;
  - keeps them in the browser's Cache Storage, pinned to the dataset version;
  - returns one `NetworkView` for the whole country.
- **`app/`** (new): a Vite + Preact phone web app.
  - It feeds geolocation into the M3 reducer and draws `currentResult` once a second.
  - It runs on GitHub Pages. A service worker serves the app shell offline.

**Tech Stack:** TypeScript 6.0.3 (existing), Vite, Preact, MapLibre GL JS,
vite-plugin-pwa, Playwright, @axe-core/playwright. Python 3.12 pipeline (existing).
Candidate versions checked 2026-10-25:

| Package | Version | Licence |
|---|---|---|
| vite | 8.3.5 | MIT |
| preact | 11.0.2 | MIT |
| maplibre-gl | 6.15.0 | BSD-3-Clause |
| vite-plugin-pwa | 2.0.0 | MIT |
| @playwright/test | 1.64.1 | Apache-2.0 |
| @axe-core/playwright | 4.14.0 | MPL-2.0, test-only and not shipped |

Task 1 re-checks each one and pins the exact version with no range. A version must have
been published at least 14 days before the pin.

**Spec:** [2026-10-23-cantre-v1-design.md](../specs/2026-10-23-cantre-v1-design.md):
- §2 principles;
- §7 app;
- §8 errors;
- §9 app tests;
- §11 size budget;
- §12 owner-gated steps;
- §13 M4 done-when ("Status card, assets, chooser and lock, find-a-location, EN/FR;
  Playwright, privacy and axe pass").

The national-build parts of the old M5 line are added to M4.

Also read:
- [IMPLEMENTATION.md](../../IMPLEMENTATION.md#route-selection-and-user-control), the
  selection contract;
- [ACCEPTANCE.md](../../ACCEPTANCE.md), the Privacy, GPS lifecycle, Lock and Choice rows;
- the [M3 plan](2026-10-25-m3-matching.md) for the matcher API.

## Measured so far (2026-10-25)

- **Saskatchewan (M2 build):**
  - NRWN package: 3,239,574 bytes;
  - 274 tiles, 19,479,671 bytes uncompressed, 4,386,496 bytes gzipped;
  - 8,446.5 km of chain.
- **Other packages (HTTP `Content-Length`):**
  - AB: 3,818,082 bytes;
  - NB: 947,884 bytes;
  - NL: 130,539 bytes.
- **No answer yet:** BC, MB, NS, NT, NU, ON, PE, QC and YT gave no answer within the probe's
  timeout. So did SK, whose package is known to exist, so these are server timeouts and not
  evidence of missing packages. The NRCan server timed out repeatedly that day, so
  acquisition needs retries (Task 1).
- **SK snapshot trial** (Node script over the M2 SK tiles, 2026-10-25). Content: 132 chains,
  38,562 chain vertices, 5,303 unchained segments, 7,224 anchors and 8,392 assets, at full
  M2 precision (microdegrees, millimetres).

  | Format | Size |
  |---|---|
  | One JSON file with the tile overlap removed | 10.10 MB, 2.05 MB gzip, 1.43 MB brotli |
  | Lean binary layout: zigzag varint deltas for geometry, chained-segment geometry stored once inside its chain, and only the fields the app uses | geometry 0.43 MB + attributes 3.05 MB = 0.86 MB brotli (0.36 MB geometry, 0.48 MB attributes) |
  | The full asset attributes the lean layout leaves out | about 0.3 MB brotli (1.33 MB total for everything vs 0.86 MB lean) |

  The trial measured brotli only. Task 2 re-measures with the gzip actually shipped.
- **National size:** not measured. If SK is a fifth to a sixth of the network, the national
  snapshot would be about 4–6 MB compressed and about 20 MB decoded. That is an estimate,
  which Task 2 replaces with a measurement and Task 9 checks against the GitHub Pages limits
  (1 GB site, 100 MB per file).

## Owner decisions (defaults used unless the owner changes them at plan review)

| # | Decision | Default | Why |
|---|---|---|---|
| D1 | How data reaches the phone | The whole national snapshot is downloaded once, from the first-run screen, and loaded whole, with no province picker. The asset-details file comes in the same download. The app never fetches data by position. | Everyone downloads the same files, so the host learns nothing about where anyone is (ACCEPTANCE Privacy row; spec §7 Offline). The SK trial puts the national size at a few megabytes. Fetching asset details one asset at a time would reveal which asset the user is near. This replaces spec §7's per-province downloads, if the owner approves. |
| D2 | Basemap (OpenFreeMap) | Off by default. One tap turns it on, after a plain notice that map tiles are fetched for the area shown. | Basemap tile requests reveal the area being viewed. With it off, the app still works: tracks and assets draw on a plain background (spec §14 fallback). |
| D3 | French text | Drafted in this milestone and marked "needs native review" in the catalogue and the About page. | §13 needs EN/FR. An unreviewed translation must not pass as reviewed. |
| D4 | Hosting | GitHub Pages for the app and the data, at `https://orgonag.github.io/cantre-research/`. The owner gave the go-ahead to deploy on 2026-10-25. | Free on a public repo. The data stays inside the measured limits (Task 9 checks). Cloudflare R2 remains a fallback if the size check fails. |
| D8 | Snapshot updates | A snapshot is dated, for example `NRWN snapshot 2026-10-25`, and replaced only by a deliberate rebuild. The app shows its date and offers "Update data" when the manifest names a newer one. | NRWN features are mostly from 2016 and change rarely, so a frozen dated copy is honest about its vintage. |
| D5 | "Ahead / behind" for assets | Shown as "toward higher MP / toward lower MP" until two fresh matched fixes on the same chain give a direction. Then they are labelled ahead and behind. | A single fix has no direction. Guessing one would mislabel half the list. |
| D6 | Lock lifetime | It lasts for the session (until reload). At start-up the app shows "Lock cleared on reload" if one was set before. | IMPLEMENTATION.md asks for a documented, visible lifecycle and no silent migration. |
| D7 | Labelling | Every screen footer says "Research software. Not for safety, operations or track access." The About page carries the full disclaimer. | AGENTS.md: research use conveys no access authority or safety guarantee. |

## Global Constraints

- **Rights.** Data stays under each source's licence: NRWN and the TC Grade Crossings Inventory
  (OGL-Canada), and the OpenFreeMap/OSM basemap (ODbL attribution). The OGL-Canada
  attribution sentence and the OSM attribution appear in the About page and in the map corner
  (spec §11). Downloading every NRWN province package is authorized by the v1 spec. No other
  source.
- **Privacy** (spec §9, AGENTS.md):
  - No request carries coordinates. The app fetches only:
    - its own files;
    - the manifest;
    - the national snapshot and the asset-details file;
    - basemap tiles, only after D2 consent.
  - No fix or trace is stored: not in localStorage, IndexedDB, Cache Storage or cookies.
  - Settings may store units, language, basemap consent and the downloaded snapshot's version.
  - There are no analytics and no telemetry.
- **Honest output** (spec §2, §6):
  - The UI shows what `Result` says and never more:
    - no milepost unless `status === 'MATCHED'`;
    - a range only on `MATCHED_SUBDIVISION`;
    - `STALE` is labelled "historical".
  - It never shows a probability or confidence score.
  - The GPS band is labelled "from GPS accuracy only".
  - A milepost from `unverified` anchors is visibly labelled.
  - Dataset vintage is shown on the status card.
- **Matcher input** (M3 carry-over): the app drops any fix whose timestamp is more than
  `MATCH_CONFIG.futureFixToleranceMs` ahead of `Date.now()` before calling `reduce`, and counts
  it. The app is the only place `Date.now()` is read. `@cantre/core` stays clock-free.
- **i18n:** every user-visible string goes through the catalogue (`app/src/i18n/en.json`,
  `fr.json`). Each `MatchReason` and `MatchStatus` has an EN and an FR message. Proper names
  stay as published (spec §7).
- **Accessibility:**
  - WCAG 2.2 AA.
  - The status card is text-first.
  - An ARIA live region announces milepost or status changes at most once every 10 s.
  - Full keyboard use.
  - Light and dark themes.
  - The map is never the only way to get information (spec §7).
- **Size budget** (spec §11):
  - App shell under 300 kB gzipped, excluding maplibre-gl.
  - Each tile under 500 kB compressed, unchanged.
  - The national snapshot and the asset-details file each under 100 MB, the Pages per-file limit.
    Target: under 15 MB compressed for the snapshot (the SK trial projects about 4–6 MB).
  - Task 9 enforces all of these in CI.
- **Units:** miles by default; kilometres by explicit conversion (`milesToKilometres`). Never mix.
- **Determinism:** pipeline outputs stay byte-identical across runs (M2 rule). The snapshot is
  written in a fixed record order with integer values only, so the same input gives the same bytes.
- **Code and comments:** every formula is commented with its units, source and limits (AGENTS.md).
- **Coverage gates:**
  - Core and data-client keep 95 / 90 / 100.
  - App logic modules (`app/src/logic/`) keep 90 / 85 / 95.
  - UI components are covered by Playwright, not line coverage.
- **Commits:** LF line endings. No attribution lines in commits or PRs (owner rule).

## Review Focus

1. **Moving between provinces.** NRWN clips each province at its border, so a train crossing
   from SK into AB changes chain.
   - Expected: the snapshot holds both provinces, so a fix near the border has candidates on
     both chains, with no bridging across the border. A fix near Canada's outer edge (the end of
     the snapshot's coverage) is `AMBIGUOUS_ROUTE`/`PARTIAL_COVERAGE`, never a confident match.
   - Pinned in Task 2 (two fake provinces in one snapshot) and Task 8 (Playwright).
2. **Mixed dataset versions.** Provinces carry different NRWN package versions, but M3 throws
   `MIXED_DATASET_VERSION` when tiles disagree.
   - Expected: one national `datasetVersion` per build, with each province's NRWN version
     listed separately.
   - Pinned in Task 1.
3. **Phone backgrounded or GPS off.**
   - Expected: on resume the card shows `STALE` (historical), never a fresh match from an old
     fix. A denied permission gives `NO_PERMISSION` with a reason.
   - Pinned in Task 4.
4. **A snapshot that fails its hash or is half-downloaded.**
   - Expected: it is rejected and never decoded, the user sees a typed error with a retry,
     and an older cached version, if present, stays in use.
   - Pinned in Task 3.
5. **A lock carried into a new dataset version.**
   - Expected: no silent migration. A new dataset version clears the lock visibly
     (D6, IMPLEMENTATION.md).
   - Pinned in Task 4.

---

### Task 1: National pipeline sources and one dataset version

**Files:**
- Modify:
  - `pipeline/src/cantre_pipeline/provinces.py`: register every NRWN province and territory;
  - `pipeline/src/cantre_pipeline/acquire.py`: add retries;
  - `pipeline/src/cantre_pipeline/build.py` and `manifest.py`: one national `datasetVersion`.
- Create: `pipeline/sources/<pr>.json` for each new province, written by
  `acquire --source <pr>`.
- Modify: root `package.json`, adding the new workspaces `packages/data-client` and `app`,
  plus their pinned devDependencies.
- Test:
  - `pipeline/tests/test_provinces.py`;
  - `pipeline/tests/test_acquire_retry.py`;
  - `pipeline/tests/test_dataset_version.py`.

**Interfaces:**
- Produces:
  - `PROVINCES` with keys `ab bc mb nb nl ns nt nu on pe qc sk yt`, each with a package that
    exists. A code with no package (for example NU, if NRCan publishes none) is listed in
    `NO_PACKAGE: frozenset[str]` with the HTTP evidence in a comment.
  - `national_dataset_version(packages: Mapping[str, str], pipeline_version: str) -> str`,
    returning `f"nrwn-national-{sha8}+cantre.{pipeline_version}"`. `sha8` is the first
    8 hex characters of the SHA-256 of the sorted `province=packageSha256` lines.
  - The manifest gains `provinces[].packageVersion`.
- Consumes: the existing `acquire` and `build` CLI.

- [ ] **Step 1: Write the failing tests.**
  - `test_every_code_registered_or_explained`: `set(PROVINCES) | NO_PACKAGE` equals the 13 codes.
  - `test_retry_then_verify`: a fake opener fails twice with `TimeoutError` and then returns
    the bytes. `acquire` succeeds after 3 attempts, with backoff `1, 2` seconds injected as a
    sleep function. A hash mismatch is never retried, and raises `HASH_MISMATCH`.
  - `test_national_version_stable_and_order_free`: the same mapping in any order gives the
    same string. Changing one hash changes it.
- [ ] **Step 2: Run** `C:/cv/Scripts/python -m pytest pipeline/tests/test_provinces.py pipeline/tests/test_acquire_retry.py pipeline/tests/test_dataset_version.py -q`.
  Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Retries: at most 5 attempts, with exponential backoff (1, 2, 4, 8 s) on timeout or
    connection error only.
  - Download every package once with `acquire --source <pr>`, and commit its
    `sources/<pr>.json`.
  - Record in the task report each package's bytes and its NRWN version from the metadata XML.
- [ ] **Step 4: Run** the three tests (PASS), then `python -m pytest pipeline -q` (all pass;
  real-data tests with `CANTRE_RAW_DIR`), `ruff check`, `ruff format --check` and `mypy --strict`.
- [ ] **Step 5: Commit** `feat(pipeline): register every NRWN province, retry downloads, one national dataset version`.

### Task 2: The national snapshot and asset-details file

**Files:**
- Create:
  - `pipeline/src/cantre_pipeline/snapshot.py`: the writer, plus a reader used only by tests;
  - `pipeline/schema/snapshot.md`: the byte layout below, as the shared contract with core.
- Modify:
  - `pipeline/src/cantre_pipeline/cli.py`: add a `national --out DIR` command. It builds every
    province's tiles as today, merges them into one network, then writes
    `snapshot.bin.gz`, `asset-details.json.gz` and `manifest.json`.
  - `pipeline/schema/manifest.schema.json`: add `snapshot` and `assetDetails`, each `{ path,
    sha256, bytes, gzipBytes }`, plus `snapshotDate`.
  - `pipeline/scripts/make_golden.py`: also write the synthetic golden `snapshot.bin.gz`,
    which Task 3 uses.
- Test:
  - `pipeline/tests/test_snapshot.py`;
  - `pipeline/tests/test_national_cli.py`, using the synthetic golden network split into two
    fake provinces.

**Interfaces:**
- Produces `snapshot.bin.gz`: gzip, level 9, of the bytes below. All integers are
  little-endian.
  1. Magic `CNTS`, then `u8` format version `1`.
  2. `u32` length, then a UTF-8 JSON **meta** object:
     `{ datasetVersion, snapshotDate, attribution, packageVersions: { pr: version },
     coverage: [[southE6, westE6, northE6, eastE6], …] }`. `coverage` holds the tile cells,
     unbuffered and sorted.
  3. `u32` length, then a UTF-8 JSON **records** object holding the fields the app uses, as
     positional arrays:
     - `chains: [id, subdivisionNid, subdivisionName, operators, cycle, trackClasses]`, sorted
       by id;
     - `segments: [key, trackClass, status, subdivisionNid, subdivisionName, operator,
       geoAccuracyM]`, unchained only, sorted by key;
     - `anchors: [chainId, id, sMm, mp, source, tier]`;
     - `intervals: [id, chainId, anchorIds]`;
     - `assets: [id, kind, name, posted, [[chainId, sStartMm, sEndMm, residualMm,
       derivedMpStart, derivedMpEnd], …], latE6, lonE6]`.
  4. **Geometry**: a stream of zigzag LEB128 varints. Each chain, in records order, is
     written as `n` and then `n` triples `(ΔlatE6, ΔlonE6, ΔsMm)`. Each unchained segment
     follows as `n` and then `n` pairs `(ΔlatE6, ΔlonE6)`. Every delta is taken from the
     previous vertex, and the first vertex from 0.

  Chains are whole: they are merged across tiles before writing, so the snapshot has no
  split pieces.
- Produces `asset-details.json.gz`: `{ assetId: { layer, attrs } }` for every asset, sorted by
  id. It is downloaded together with the snapshot (D1).
- Consumes: Task 1 `national_dataset_version`; existing `tiles.py` output.

- [ ] **Step 1: Write the failing tests.**
  - `test_snapshot_round_trips_tiles`: reading the snapshot back gives exactly the tiles'
    chains, unchained segments, anchors, intervals and assets, after removing overlap.
    Integers are equal, with no rounding.
  - `test_snapshot_deterministic`: two runs give byte-identical files.
  - `test_varint_zigzag`: a round trip of 0, ±1, ±2^31 and ±2^40 (millimetre `s` on long
    chains).
  - `test_border_not_bridged`: two fake provinces sharing a border give two chains in one
    snapshot. Both end at the border, and nothing joins them (Review Focus 1).
  - `test_size_gate`: `national` fails loudly when either file exceeds 100,000,000 bytes.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** Comment the units of each field (microdegrees, millimetres,
  miles) and the format's limits: integers only, and the full M2 precision is kept.
- [ ] **Step 4: Run the full national build** (`python -m cantre_pipeline national --out C:/tmp/nat`)
  and record the following in the task report:
  - the snapshot's bytes and gzip bytes;
  - the asset-details file's bytes and gzip bytes;
  - per-province counts of chains, vertices, anchors and assets.

  These are the national size figures for docs/RESEARCH.md. If the snapshot exceeds 15 MB
  gzipped, report it before going on.
- [ ] **Step 5: Run** the pytest suite, ruff and mypy.
- [ ] **Step 6: Commit** `feat(pipeline): national snapshot, asset details and manifest`.

### Task 3: `@cantre/core` snapshot decoding, assets and lookups; `@cantre/data-client`

**Files:**
- Modify:
  - `packages/core/src/network/types.ts` and `decode.ts`: decode every asset into a
    `NetworkAsset`;
  - `packages/core/src/network/snapshot.ts` (new): `networkFromSnapshot(bytes: Uint8Array):
    NetworkView`, reading the Task 2 layout from the bytes after gunzip;
  - `packages/core/src/index.ts`.
- Create:
  - `packages/core/src/lookup/assets.ts`;
  - `packages/core/src/lookup/locate.ts`;
  - `packages/data-client/src/{manifest,store,client}.ts`;
  - `packages/data-client/package.json`.
- Test:
  - `packages/core/test/network-snapshot.test.ts`;
  - `packages/core/test/lookup-assets.test.ts`;
  - `packages/core/test/lookup-locate.test.ts`;
  - `packages/data-client/test/client.test.ts`, with a fake `fetch` and a fake `CacheStorage`.

**Interfaces:**
- Produces (core):
  - **`networkFromSnapshot`:** returns a `NetworkView` deep-equal to `networkFromTiles` on
    the same data, coverage included. Bad bytes throw `INVALID_SNAPSHOT` naming the offset.
    The format version must be 1.
  - **`NetworkAsset`:** `{ id, kind, name: string | null, posted: { mp, subdivisionNid, tier }
    | null, positions: readonly { chainId, sM, residualM, derivedMp: number | null }[], at:
    LatLon }`. `positions[].sM` is the midpoint of the start and end, as M3 does for diamonds.
  - **`assetsAlong(net, chainBaseId, s, rangeM): readonly { asset: NetworkAsset; deltaM:
    number }[]`:** `deltaM = asset s − s` in metres, with a sign. Sorted by `|deltaM|`, then
    by id. Limited to `|deltaM| ≤ rangeM`.
  - **`locateMilepost(net, subdivisionNid, mp): readonly { chainId, sM, at: LatLon, intervalId
    }[]`:** the inverse of interpolation inside each calibrated interval containing `mp`. It
    never extrapolates. It returns an empty list when no interval contains `mp`, and several
    entries for double track.
  - **`milepostAtPoint(net, p: LatLon, cfg?)`:** the candidates within
    `cfg.searchRadiusMinM` of `p`, each with `milepostFor` at a nominal accuracy of 0. For
    desk use, labelled "from map position, no GPS".
- Produces (data-client):
  - `fetchManifest(baseUrl): Promise<Manifest>`, validating `schema === 'cantre.manifest/1'`.
  - `downloadSnapshot(baseUrl, manifest, onProgress?): Promise<void>`. It fetches the snapshot
    and the asset-details file, verifies both SHA-256 values with `crypto.subtle` before
    storing, and stores them in Cache Storage under the `cantre-data-<datasetVersion>` cache.
    The previous version is deleted only after the new one is stored.
  - `loadNetwork(): Promise<{ net: NetworkView; details: AssetDetails }>`. It gunzips the
    snapshot with `DecompressionStream('gzip')` and calls `networkFromSnapshot`. It records
    the decode time in ms.
  - `installedSnapshot(): Promise<{ datasetVersion, snapshotDate, bytes } | null>`.
  - `AssetDetails = Readonly<Record<string, { layer: string; attrs: Readonly<Record<string, string>> }>>`.
    Task 5's asset list opens these source attributes when an asset is tapped. No network request is made.
  - `DataClientError` codes: `MANIFEST_INVALID`, `FETCH_FAILED`, `HASH_MISMATCH`.

- [ ] **Step 1: Write the failing tests** (core).
  - `networkFromSnapshot`:
    - on the committed golden snapshot it deep-equals `networkFromTiles(goldenTiles())`;
    - a truncated file, a wrong magic or a version of 2 each throw `INVALID_SNAPSHOT`.
  - `assetsAlong`: signs, order, range limit, and split chains via `chainBaseId`.
  - `locateMilepost`:
    - it round-trips `interpolateMilepost` within 1e-6 m;
    - an MP outside every interval returns `[]`;
    - an MP at a gap between intervals returns `[]`;
    - double track returns 2 entries.
  - `milepostAtPoint`: a point on a calibrated chain gives the interpolated MP; an off-track
    point gives `[]`.
- [ ] **Step 2: Write the failing tests** (data-client).
  - A hash mismatch never stores and throws `HASH_MISMATCH`.
  - A failed fetch keeps the old cached version.
  - A half-downloaded snapshot (the fetch stops early) is rejected and the old one is kept
    (Review Focus 4).
  - `loadNetwork` on the two-fake-province golden snapshot gives candidates on both chains
    at their shared border (Review Focus 1).
  - Decode time and JS heap after `loadNetwork` are measured in Node for the SK snapshot,
    and recorded in the report.
- [ ] **Step 3: Run** `npx vitest run packages/core packages/data-client`. Expected: FAIL.
- [ ] **Step 4: Implement**, with no runtime dependencies in either package. Comment the
  inverse interpolation formula: s = s₁ + (mp − mp₁)/(mp₂ − mp₁)·(s₂ − s₁), in metres and
  miles, inside one interval only.
- [ ] **Step 5: Run** `npm run lint`, `format:check`, `typecheck` and `coverage`. All gates hold.
- [ ] **Step 6: Commit** `feat(core,data-client): snapshot decoder, assets, milepost lookups and data client`.

### Task 4: App shell, geolocation and the matcher store

**Files:**
- Create:
  - `app/package.json`, `app/vite.config.ts`, `app/index.html`;
  - `app/src/main.tsx`;
  - `app/src/logic/geolocation.ts`;
  - `app/src/logic/session.ts`;
  - `app/src/i18n/{index.ts,en.json,fr.json}`;
  - `app/src/logic/settings.ts`.
- Test:
  - `app/test/logic/geolocation.test.ts`;
  - `app/test/logic/session.test.ts`;
  - `app/test/i18n.test.ts`.

**Interfaces:**
- Produces:
  - **`watchFixes(geo: Geolocation, nowMs: () => number, onEvent: (e: MatchEvent) => void):
    () => void`:**
    - maps `GeolocationPosition` to `{ type: 'fix', fix }`: `accuracyM` from
      `coords.accuracy`; `headingDeg` and `speedMps` only when they are non-null and finite;
    - maps `PERMISSION_DENIED` to `permission: denied`;
    - maps the other errors to `locationError`;
    - drops a fix more than `MATCH_CONFIG.futureFixToleranceMs` ahead of `nowMs()`, counting
      it as `droppedFutureFixes`.
  - **`createSession(net, datasetVersion)`:** returns `{ dispatch(e), result(nowMs): Result,
    lock(l), unlock(), state }`, wrapping `initialMatchState`, `reduce` and `currentResult`.
    A new `datasetVersion` starts a new session and sets `lockClearedByUpdate: true`
    (Review Focus 5).
  - **`t(key, params?)`:** reads the catalogue. EN and FR hold the same keys, including one
    message per `MATCH_REASONS` and `MATCH_STATUSES` code.
  - **`settings`:** `units: 'mi'|'km'`, `lang: 'en'|'fr'`, `basemap: boolean`. Stored in
    localStorage under `cantre.settings.v1`, inside try/catch. Nothing else is stored.

- [ ] **Step 1: Write the failing tests.**
  - `geolocation`:
    - denied gives `NO_PERMISSION`;
    - a timeout gives `locationError`;
    - a future fix 2 s ahead is dropped and counted;
    - a null heading is omitted, not 0.
  - `session`:
    - a tick 16 s after the last fix gives `STALE` (Review Focus 3);
    - a lock survives within a session;
    - a new dataset version clears it and sets the flag.
  - `i18n`:
    - EN and FR key sets are equal;
    - every reason and status code has a key;
    - no FR value is empty.
- [ ] **Step 2: Run** `npx vitest run app/test`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The Vite app uses Preact. `main.tsx` mounts an empty layout inside an error boundary,
    which shows the error code with a "Reset" button that reloads the app (spec §8: no
    exception reaches the user as a blank screen). The UI comes in Task 5.
  - On `visibilitychange` to visible, re-render from `result(Date.now())`.
- [ ] **Step 4: Run** the tests (PASS), `npm run -w app build` (shell gzip size printed),
  lint, format and typecheck.
- [ ] **Step 5: Commit** `feat(app): shell, geolocation adapter, matcher session and EN/FR catalogue`.

### Task 5: Status card, lock chip, route chooser and assets list

**Files:**
- Create:
  - `app/src/ui/StatusCard.tsx`;
  - `app/src/ui/LockChip.tsx`;
  - `app/src/ui/RouteChooser.tsx`;
  - `app/src/ui/AssetList.tsx`;
  - `app/src/ui/LiveRegion.tsx`;
  - `app/src/logic/present.ts`.
- Test: `app/test/logic/present.test.ts`.

**Interfaces:**
- Produces:
  - **`present(result: Result, net, settings): CardModel`.** It is a pure function, and the
    UI only renders its output. `CardModel = { headline, subdivision, operator, trackClass,
    mpText | null, rangeText | null, bandText | null, accuracyText, residualText | null,
    fixAgeText, anchorsText | null, tierBadge: 'posted'|'tc'|'unverified'|null, vintageText,
    reasons: string[], historical: boolean, lockText | null, choices: Choice[] }`.
  - **`direction(prev: Result | null, cur: Result): 'up'|'down'|null`** (D5): non-null only when
    both are `MATCHED` on the same `chainBaseId`, both are fresh, and `|Δs| ≥ 10 m`.
  - **`announce(model, lastAnnouncedMs, nowMs): string | null`:** returns a string at most
    once every 10,000 ms, and only when the status or the milepost text changed.
- Consumes: Task 3 `assetsAlong`; Task 4 `t` and `settings`.

- [ ] **Step 1: Write the failing tests for `present`.** One per status:
  - `MATCHED` shows the MP with "± x mi from GPS only".
  - `MATCHED_SUBDIVISION` shows a range or "no single MP".
  - `AMBIGUOUS_ROUTE` gives `choices` with operator, subdivision and residual, and no MP.
  - `LOCK_CONFLICT` keeps `lockText`, has no MP and offers unlock.
  - `STALE` sets `historical: true`, with the last MP prefixed "Last known".
  - `NO_FIX`, `NO_PERMISSION`, `NO_COVERAGE` and `OFF_NETWORK` each show their reason text.
  - An `unverified` tier sets the badge.
  - `km` units convert with `milesToKilometres` and are labelled km.
  - A milepost of 0 shows "MP 0.00", never blank.
  - `direction` and `announce` timing tests.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement** the pure logic.
  - The components render `CardModel` only.
  - Choosing a route calls `session.lock({ kind: 'chain', chainId })`.
  - The lock chip shows "auto" or "locked: <subdivision>", with an unlock button.
  - The asset list shows `toward higher MP`/`toward lower MP`, or `ahead`/`behind` once
    `direction` is known, with posted and derived mileage labelled differently.
- [ ] **Step 4: Run** the tests, lint, format and typecheck.
- [ ] **Step 5: Commit** `feat(app): status card, lock chip, route chooser, assets and live region`.

### Task 6: Map and find-a-location

**Files:**
- Create:
  - `app/src/ui/MapView.tsx`;
  - `app/src/ui/FindLocation.tsx`;
  - `app/src/logic/find.ts`.
- Test: `app/test/logic/find.test.ts`.

**Interfaces:**
- Produces:
  - **`MapView`:** maplibre-gl drawing tracks from a GeoJSON source built in memory from the
    `NetworkView`. MapLibre simplifies its own copy for display. The calculation geometry is
    never altered, so it stays separate from what is drawn (AGENTS.md). Assets come from the
    network. A "you" marker uses the last accepted fix, with an accuracy circle.
    The basemap style URL is loaded only when `settings.basemap` is true (D2). Tapping the map
    calls `milepostAtPoint`. Attribution shows OGL-Canada always, and OSM when the basemap is on.
  - **`findBySubdivision(net, subdivisionNid, mp)`:** wraps `locateMilepost`. It returns pins,
    or the message key `find.noInterval`. **`subdivisionsOf(net)`** gives the sorted list for
    the picker.
- Consumes: Task 3 lookups; Task 4 settings.

- [ ] **Step 1: Write the failing tests.**
  - `find`: an MP inside an interval gives a pin; an MP in a gap gives `find.noInterval`;
    double track gives 2 pins; the picker list is sorted and de-duplicated.
- [ ] **Step 2: Run** them (FAIL), **Step 3: implement**, **Step 4: run** them (PASS), plus
  lint, format and typecheck.
- [ ] **Step 5: Commit** `feat(app): map with opt-in basemap, tap-to-milepost and find-a-location`.

### Task 7: Offline data, settings, about and the service worker

**Files:**
- Create:
  - `app/src/ui/OfflineData.tsx`;
  - `app/src/ui/Settings.tsx`;
  - `app/src/ui/About.tsx`;
  - `app/src/ui/FirstRun.tsx`.
- Modify: `app/vite.config.ts`, adding vite-plugin-pwa with the app shell only. The plugin
  does not cache data; data-client owns that.
- Test: `app/test/logic/offline.test.ts`, covering size formatting and the state machine:
  `idle → downloading(progress) → verifying → ready | error(code)`.

**Interfaces:**
- **Offline data:** shows the installed snapshot's date, dataset version and size. When the
  manifest names a newer snapshot, it shows "Update data" with that snapshot's download size
  (D8). A "Remove data" button deletes the cached snapshot. All of these call data-client.
- **First run:**
  - explains, in about 60 words per language, what leaves the device: one national download
    that is the same for everyone, and the basemap only if turned on;
  - shows the D7 disclaimer;
  - offers one "Download data for Canada (N MB)" button, with N taken from the manifest.
- **About:** methods summary, data sources and licences (OGL-Canada sentence verbatim, OSM),
  snapshot date and the NRWN package version per province, D3 translation note, D7 disclaimer, link to the repo.

- [ ] **Step 1: Write the failing offline state-machine tests**, including that a
  `HASH_MISMATCH` goes to `error` while the old version stays loaded (Review Focus 4).
- [ ] **Step 2: Run** (FAIL), **Step 3: implement**, **Step 4: run** (PASS), plus lint,
  format and typecheck.
- [ ] **Step 5: Commit** `feat(app): offline snapshot, settings, about and first run`.

### Task 8: Playwright, privacy and accessibility tests in CI

**Files:**
- Create:
  - `app/playwright.config.ts`;
  - `app/e2e/flows.spec.ts`;
  - `app/e2e/privacy.spec.ts`;
  - `app/e2e/a11y.spec.ts`;
  - `app/e2e/fixtures/`: a manifest plus a snapshot made from the synthetic golden network,
    split into two fake provinces by `pipeline/scripts/make_e2e_fixture.py`.
- Modify: `.github/workflows/ci.yml`, adding an `app` job that installs Playwright Chromium,
  builds, then runs `npm run -w app e2e`.

**Interfaces:** the tests drive the built app (`vite preview`), with geolocation mocked
through Playwright `context.setGeolocation` and `grantPermissions`. Mobile viewports are
Pixel 7 and iPhone 13 emulation.

- [ ] **Step 1: Write the flows.**
  - First run, then download the snapshot, then a fix on a chain: `MATCHED` with an MP.
  - A fix at the golden diamond: `AMBIGUOUS_ROUTE`. The chooser lists both, choosing one
    locks it, and unlock returns to the chooser.
  - Deny permission: `NO_PERMISSION`.
  - Stop fixes for 16 s (clock mocked with `page.clock`): `STALE`, labelled historical.
  - Find-a-location by subdivision and MP drops a pin.
  - Switching to FR shows FR text for the visible status.
  - A fix at the fake provinces' shared border has candidates on both chains, with no single
    milepost from bridging. A fix at the outer edge of the snapshot's coverage is
    `AMBIGUOUS_ROUTE`, shown as partial coverage (Review Focus 1).
- [ ] **Step 2: Write the privacy tests.**
  - Record every request during all flows, and assert that each URL is in the allowlist:
    app origin files, `manifest.json`, `snapshot.bin.gz`, `asset-details.json.gz`.
  - No URL or body contains the mocked latitude or longitude, to 3 decimals.
  - With the basemap off, no request goes to the OpenFreeMap host.
  - After the flows, localStorage holds only `cantre.settings.v1`. IndexedDB is empty. Cache
    Storage holds only app-shell and `cantre-data-*` entries, and no entry contains the
    coordinates.
- [ ] **Step 3: Write the axe tests.** Run axe (`wcag2a`, `wcag2aa`, `wcag22aa`) on the first
  run, status card, chooser, settings and about pages, in light and dark. Zero violations.
- [ ] **Step 4: Run** `npm run -w app e2e`. All pass. Record the counts.
- [ ] **Step 5: Commit** `test(app): Playwright flows, privacy and axe in CI`.

### Task 9: Pages deployment, size gate, docs and roadmap

**Files:**
- Create:
  - `.github/workflows/deploy.yml`, triggered by `workflow_dispatch` and by pushes to `main`
    once the owner enables Pages;
  - `scripts/check-budget.mjs`.
- Modify:
  - `README.md`, adding the live link and "research software" wording;
  - `docs/RESEARCH.md`, adding an M4 entry with measured national sizes, test counts and
    coverage;
  - `docs/superpowers/plans/2026-10-23-cantre-roadmap.md`, so that M4 reads "Built (PR pending)";
  - `docs/ACCEPTANCE.md`, mapping the Privacy and GPS-lifecycle rows to the e2e specs;
  - `docs/DATA-LICENSES.md` (new) with the attribution text.

**Interfaces:**
- **Deploy job:**
  - restores the cached raw packages (`actions/cache`, keyed by the SHA-256 values in
    `pipeline/sources/*.json`);
  - runs `acquire` with retries and verification;
  - runs `national`;
  - builds the app with `base: '/cantre-research/'`;
  - copies the manifest, snapshot and asset-details file under `data/<datasetVersion>/`;
  - runs `check-budget.mjs`;
  - uploads with `actions/upload-pages-artifact` and deploys with `actions/deploy-pages`.
- **`check-budget.mjs`** fails the job when:
  - the shell is over 300 kB gzipped, excluding maplibre;
  - any pipeline tile is over 500 kB gzipped (tiles are built and checked but not deployed);
  - any file is over 100 MB;
  - the site is over 1 GB.

- [ ] **Step 1: Run `check-budget.mjs`** against the Task 2 national output and the app build,
  and record the figures. If the site exceeds a limit, stop, report the figures, and switch
  hosting per D4 only with the owner.
- [ ] **Step 2: Write the deploy workflow and docs.** RESEARCH quotes only measured figures,
  states that thresholds are unevaluated, and says that "no field validation yet" applies to
  every result shown.
- [ ] **Step 3: Verify** lint, format, typecheck, coverage, pytest and e2e all pass locally.
- [ ] **Step 4: Commit** `ci: GitHub Pages deploy with size gate; docs for the national app`.
- [ ] **Step 5: After the owner merges the PR:**
  - Enabling Pages (Settings → Pages → Source: GitHub Actions) is a repository setting, so
    the owner does it, or gives an explicit yes for it to be done with `gh api`.
  - Run the deploy workflow once.
  - Open the live URL on a phone-sized viewport and confirm that the first run, the national
    download and the status card work.
  - Report the URL.

---

## Out of scope for M4 (owned later)

- **M5:**
  - leave-one-anchor-out evaluation;
  - the HMM research matcher;
  - EVALUATION.md;
  - the datum offset study;
  - tuning any `MATCH_CONFIG` threshold;
  - joining chains across province borders.
- **M6:** METHODS.md, CITATION.cff, the contributing and security files, and the changelog.
- **Not planned:** native app-store apps; any data source beyond NRWN and the TC inventory
  without owner approval; telemetry of any kind.
