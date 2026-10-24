# M2 Pipeline (Saskatchewan) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `pipeline/`, a deterministic Python pipeline. It turns the NRCan NRWN
Saskatchewan package into chains, qualified anchors, calibrated intervals, assets,
regional tiles, a manifest, an audit log and a per-subdivision coverage report. The
pipeline is written to take any province. M2 runs only Saskatchewan (SK), and M5 runs the rest.

**Architecture:** This is a plain Python 3.12 package, `cantre_pipeline`, that runs as one
step after another, each in its own module:
- `acquire`: downloads the package and records where it came from;
- `reader`, then `validate`: reads the shapefiles and checks them;
- `chains`;
- `anchors`;
- `intervals`;
- `assets`;
- `tiles`, then `manifest`, then `report`.

Each step is a pure function over typed dataclasses. Only `acquire`, the CLI and the
writers touch the disk or the network. The geodesy matches `@cantre/core` line for line.
One golden file, generated from GeographicLib, is checked by both the pytest and Vitest
suites, so the two languages provably agree. The tile and manifest formats are JSON
Schemas in `pipeline/schema/`. A Vitest contract test runs `@cantre/core` on the
pipeline's committed synthetic output.

**Tech Stack:**
- Runtime: Python 3.12 and pyshp 3.1.6 (MIT, the only runtime dependency).
- Dev tools: geographiclib 2.1 (MIT), pytest 9.1.1 (MIT), pytest-cov 7.1.0 (MIT),
  hypothesis 6.168.5 (MPL-2.0, dev only), ruff 0.17.0 (MIT), mypy 2.4.0 (MIT) and
  jsonschema 4.26.0 (MIT).
- Each version is the newest release at least two weeks old on 2026-10-24.
- The existing Node toolchain from M1 is unchanged.

**Spec:** [2026-10-23-cantre-v1-design.md](../specs/2026-10-23-cantre-v1-design.md):
- §3 Data, §5 Pipeline, §6 Geodesy and §9 Testing;
- §13 M2 done-when: "Deterministic tiles, manifest, audit and coverage report;
  `GEOACCURA` meaning verified from the spec."

Cross-milestone names are in the [roadmap](2026-10-23-cantre-roadmap.md). Data rules are in
[DATA.md](../../DATA.md).

## What the Saskatchewan data actually contains

The SK SHP package was inspected on 2026-10-24.
- **Source:** `nrwn_rfn_sk_shp_en.zip`, 3,239,574 bytes, `Last-Modified: Thu, 25 Jul 2019
  00:03:12 GMT`, SHA-256 `f25a91d230619b9f73093955c69f02e9ed7f93e425214c940e328c359f1a796a`.
- **Status:** these counts shape the plan. They are planning evidence, not results. M2's
  report regenerates them.

| Layer | Records | What matters |
|---|---|---|
| TRACK (PolyLineZ, single part) | 7,084 | 1,781 Main; Siding 2,326, Yard 1,538, Spur 1,285. 39 `Discontinued`. Main track is about 8,400 km over 73 subdivisions (rough probe). |
| TRACK IDs | — | `NID` repeats 9 times on records with **different** geometry and attributes. `TRACKSEGID` repeats once. Neither is a unique key on its own. |
| TRACK `SUBD1START`/`SUBD1END` | — | Constant within each subdivision: all 665 Indian Head segments say 0.00–135.10. **They are subdivision extents, not per-segment mileage.** This settles the spec §14 question. |
| TRACK topology | — | Main endpoints within one subdivision: 1,649 meet one other end, 33 meet two (branches), 165 are free ends. Exact coordinate match gives the same result as the 1e-7° snap. |
| CROSSING | 7,660 | 5,274 `Posted`, but 61 of those have the `-1` sentinel. 4,964 Posted are on Main. `TRACKNID` always matches a TRACK `NID`. 550 `CROSSINGID` groups, up to 25 records each. |
| STATION | 256 | **All `Unknown`.** (Ontario's were all Posted.) |
| MARKERPOST | 2,430 | All `Unknown`. |
| STRUCTURE_0 (points) | 4 | Culverts, no mileage. |
| STRUCTURE_1 (lines) | 451 | 450 Bridge, 1 Tunnel. No posted mileage. |
| JUNCTION | 5,163 | Switch 4,443; End 638; Administrative 59; **Diamond 21**; blank type 2. Every junction sits on a track endpoint. |
| `GEOACCURA` | — | `10` on TRACK and JUNCTION, `-1` on every other layer. The package metadata (`RFN_SK_2.0_…xml`) describes the attribute as the horizontal positional accuracy of the source data, in metres. |

**So in SK, only crossings qualify as anchors.** The anchor code still handles all four
source layers, because other provinces differ.

## Global Constraints

- Python 3.12 (`requires-python = ">=3.12"`). Runtime dependency: `pyshp==3.1.6` only. Every
  dev dependency is pinned exactly in `pipeline/pyproject.toml` at the versions above.
- Geodesy is identical to `@cantre/core`:
  - GRS80 with `a = 6378137` m and `f = 1/298.257222101`;
  - a tangent plane at the segment's mid-latitude;
  - segments over 2 km are subdivided for distance only;
  - a clamped projection.
- The shared golden file `fixtures/geodesy-golden.json` holds the two languages within
  **1e-6 m**. Both are held within **1 mm** of GeographicLib on segments of 2 km or less.
- Coordinates in the shapefiles are (x = longitude, y = latitude), NAD83(CSRS98), with no
  datum transformation (spec §3). Z values are read and ignored, and the README says so.
- Topology uses coordinates snapped to `1e-7°`. After snapping, all geometry is quantised
  to integer microdegrees (`round(v * 1_000_000)`), and every distance and `s` is computed
  from the **quantised** coordinates. This keeps what the pipeline computes and what core
  later recomputes from a tile identical.
- `s` is stored in tiles as integer millimetres (`sMm`). Mileposts are miles, as published.
  `METRES_PER_MILE = 1609.344`.
- Data handling:
  - Nothing is dropped silently. Every rejected or altered record gets an audit line with a
    reason code from the closed set in Task 3.
  - The pipeline fails loudly (`PipelineError`) on a schema drift, a hash mismatch or a CRS
    mismatch.
  - Raw source bytes and build outputs are never committed. The cache is `.cache/raw/`
    (override: `CANTRE_RAW_DIR`) and outputs go to `build/`, both git-ignored. The one
    exception is the committed **synthetic** golden build in `pipeline/tests/golden/`,
    which contains no NRWN data.
- Thresholds live in one frozen `PipelineConfig`. Every threshold is labelled experimental,
  and the manifest records the configuration and its SHA-256.
- Determinism: the same raw bytes and the same config must give byte-identical outputs,
  whatever the segment order, the input order or `PYTHONHASHSEED`. To get this:
  - JSON output is canonical: sorted keys, `separators=(",", ":")`,
    `ensure_ascii=False`, UTF-8, one trailing `\n`;
  - gzip size is measured with `mtime=0` and level 9;
  - no wall-clock time is written to any output.
- Stable IDs:
  - Chain IDs are content hashes:
    `"ch_" + sha256("\n".join(sorted(segmentKeys)))[:16]`.
  - Interval IDs are `f"{chainId}.i{n}"`, with n counted along `s`.
  - Tile keys are `f"{floor(lat/0.25)}_{floor(lon/0.5)}"`.
- Code quality gates:
  - `ruff check` and `ruff format --check` pass;
  - `mypy --strict` passes on `src/` and `tests/`;
  - pytest line coverage of at least 95 %, enforced with `--cov-fail-under=95`.
- Every public function has a docstring giving its formula or rule, its units, its source
  (a spec section) and its limits. Every non-obvious line of maths has a comment.
- Files use LF line endings. Code is MIT. NRWN-derived outputs carry the OGL-Canada
  attribution string: "Contains information licensed under the Open Government Licence –
  Canada."
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Decisions beyond the spec

The spec leaves these choices open. Each is fixed here and recorded as a decision in
RESEARCH.md in Task 9.

1. **Segment key.** The key is `TRACKSEGID`. A repeated `TRACKSEGID` gets the suffix
   `~1`, `~2`… in file order, with an audit line `DUPLICATE_SEGID`. A repeated `NID` is
   kept and audited as `DUPLICATE_NID` (info). A record whose `TRACKNID` names a repeated
   `NID` is matched against every segment with that NID.
2. **Chains use only operational track.** A chain is built from `TRACKCLASS == "Main"` and
   `STATUS == "Operational"`, grouped by `SUBDI1NID`. `SUBDI2*` is ignored in v1; its
   record count is reported.
3. **The slope test needs a minimum span.** NRWN mileage has 0.01 mi of resolution, which is
   ±8 m of rounding per anchor. The slope test is therefore applied only when
   `Δs ≥ slopeMinSpanM = 800` m. Below that, only monotonicity is tested.
4. **Close repeat postings are collapsed.** Anchors on one chain with equal `mp` (within
   0.005 mi) and `|Δs| ≤ anchorCollapseSpanM = 30` m are collapsed into one anchor at their
   mean `s`, with an audit line `ANCHOR_COLLAPSED` (info). Equal mileage more than 30 m apart
   is a monotonicity failure.
5. **Tile membership is decided by bounding boxes.** An edge or line belongs to a tile when
   its own bounding box overlaps the tile's buffered bounding box. This can include a few
   extra edges but never misses one. The buffer in degrees is computed at the tile's
   poleward edge, so it is at least 2 km everywhere in the tile.
6. **Derived mileposts are computed in the pipeline.** Each asset's derived MP is
   interpolated in Python with core's formula, and the Vitest contract test checks it
   against core.

## Review Focus

1. **Segments arriving in a different order or direction.** Shuffling TRACK records or
   reversing segment vertex order must give byte-identical chains, IDs, `s` values and
   tiles. Tested in Task 4 (a hypothesis property) and Task 9 (the determinism test).
2. **A posted crossing that can't be used.** A Posted crossing with `-1` (61 in SK), one on
   a siding, or one whose subdivision differs from its track's must be rejected with a
   reason. It must never become an anchor at MP −1 or on the wrong chain. Tested in Task 5.
3. **Mileage running against the chain direction.** When mileage decreases along `s`, the
   result must be one valid interval with decreasing MP. It must not be split at every pair,
   and core's `validateInterval` must accept it. Tested in Task 6 and the Task 9 contract
   test.
4. **A chain that crosses a tile edge.** Pieces of one chain in two tiles must share
   identical `sMm` and coordinates at the overlapping vertices. An asset within 2 km of the
   edge must appear in both tiles. Tested in Task 8.
5. **Loops and wyes.** A balloon loop (a Main chain that closes on itself) must stop, get a
   deterministic start vertex and be flagged `CHAIN_CYCLE`. It must not hang or come out
   twice. Tested in Task 4.

---

### Task 1: Pipeline scaffold, geodesy port, shared golden file, CI job and M1 carry-overs

**Files:**
- Create:
  - `pipeline/pyproject.toml` and `pipeline/README.md`;
  - `pipeline/src/cantre_pipeline/__init__.py`, which holds `__version__ = "0.1.0"`;
  - `pipeline/src/cantre_pipeline/config.py`, `errors.py` and `geodesy.py`;
  - `pipeline/scripts/make_geodesy_golden.py` and `fixtures/geodesy-golden.json`;
  - `packages/core/test/geodesy-golden.test.ts`.
- Modify:
  - `.github/workflows/ci.yml`, to add a `pipeline` job;
  - `.gitignore`, to add `build/`, `.cache/`, `.venv/`, `__pycache__/`, `.pytest_cache/`,
    `.mypy_cache/`, `.ruff_cache/` and `*.egg-info/`;
  - `.prettierignore`, to add `fixtures/*.json` and `pipeline/`;
  - `package.json`, to set `engines.node` to `">=22.13"`;
  - `packages/core/src/anchors.ts` and `packages/core/test/interpolate-brackets.test.ts`;
  - `docs/RESEARCH.md`, to correct the M1 entry to 89 tests and statements 98.62 % /
    lines 98.57 %.
- Test: `pipeline/tests/test_geodesy.py` and `pipeline/tests/test_config.py`.

**Interfaces:**
- Produces, in `geodesy.py`:
  - `class LatLon(NamedTuple): lat: float; lon: float`;
  - `distance_m(a: LatLon, b: LatLon) -> float`;
  - `project_onto_segment(p, a, b) -> SegmentProjection`, where `SegmentProjection` is a
    frozen dataclass of `t`, `point: LatLon`, `cross_track_m`, `along_segment_m`,
    `segment_length_m` and `clamped: Literal["none","start","end"]`;
  - `cumulative_lengths_m(pts: Sequence[LatLon]) -> list[float]`;
  - `project_onto_range(p, pts, cum, i0, i1) -> RangeProjection(index, t, s_m, cross_track_m)`,
    which projects onto edges `i0..i1-1` only.
- Produces, in `config.py`:
  - `PipelineConfig`, a frozen dataclass with `snap_deg=1e-7`, `coord_scale=1_000_000`,
    `s_scale=1000`, `anchor_max_residual_m=25.0`, `slope_tolerance=0.15`,
    `slope_min_span_m=800.0`, `anchor_collapse_span_m=30.0`, `mp_equal_tol_mi=0.005`,
    `tile_lat_deg=0.25`, `tile_lon_deg=0.5`, `tile_buffer_m=2000.0`,
    `tile_budget_gzip_bytes=500_000`;
  - `EXPERIMENTAL: frozenset[str]`, the threshold field names;
  - `config_json(cfg) -> str`, canonical JSON;
  - `config_sha256(cfg) -> str`.
- Produces, in `errors.py`:
  - `class PipelineError(Exception)` with a `code: PipelineErrorCode`;
  - `PipelineErrorCode = Literal["SCHEMA_DRIFT","HASH_MISMATCH","CRS_MISMATCH",
    "DOWNLOAD_FAILED","UNKNOWN_PROVINCE"]`.
- The golden file format:
  - `{ "generator": str, "seed": 20261024, "distance": [{ "a": [lat,lon], "b": [lat,lon],
    "geodesicM": float, "pythonM": float }], "projection": [{ "p", "a", "b",
    "t", "crossTrackM", "alongM" }] }`;
  - projection values come from the Python implementation.

- [ ] **Step 1: Scaffold.**
  - `pipeline/pyproject.toml`:
    - project `cantre-pipeline` 0.1.0, MIT, `requires-python >=3.12`;
    - dependency `pyshp==3.1.6`;
    - optional `dev` extra with the pinned dev tools;
    - build backend `setuptools>=80` with the `src/` layout;
    - console script `cantre-pipeline = cantre_pipeline.cli:main`.
  - Tool configuration:
    - ruff: `line-length = 100`, `target-version = "py312"`, lint `select =
      ["E","F","W","I","B","UP","N","S","D","RUF"]`, pydocstyle convention `google`,
      `S101` allowed in `tests/`;
    - mypy: `strict = true`;
    - pytest: `addopts = "--cov=cantre_pipeline --cov-fail-under=95"`.
  - Install with `py -3.12 -m pip install -e "pipeline[dev]"` (locally) or
    `pip install -e "pipeline[dev]"` (CI).

- [ ] **Step 2: Write the failing tests** in `pipeline/tests/test_geodesy.py`. These are
  the M1 cases, ported:

```python
def test_distance_matches_geographiclib_within_1mm() -> None:
    for case in load_golden()["distance"]:
        assert abs(distance_m(LatLon(*case["a"]), LatLon(*case["b"])) - case["geodesicM"]) < 1e-3

def test_projection_interior_endpoint_and_zero_length() -> None:
    a, b = LatLon(52.0, -106.0), LatLon(52.0, -105.99)
    mid = project_onto_segment(LatLon(52.0001, -105.995), a, b)
    assert 0.49 < mid.t < 0.51 and mid.clamped == "none"
    assert abs(mid.cross_track_m - 11.13) < 0.05
    assert project_onto_segment(LatLon(52.0, -106.01), a, b).clamped == "start"
    z = project_onto_segment(LatLon(52.0001, -106.0), a, a)
    assert z.t == 0.0 and z.segment_length_m == 0.0 and z.clamped == "none"

def test_long_edges_are_subdivided_for_distance_only() -> None:
    a, b = LatLon(54.0, -110.0), LatLon(54.0, -109.9)   # ~6.5 km
    assert abs(distance_m(a, b) - geodesic_m(a, b)) < 1e-3

def test_project_onto_range_ignores_edges_outside_range() -> None:
    pts = [LatLon(52.0, -106.0), LatLon(52.0, -105.99), LatLon(52.0, -105.98)]
    cum = cumulative_lengths_m(pts)
    r = project_onto_range(LatLon(52.0, -105.975), pts, cum, 0, 1)
    assert r.index == 0 and r.t == 1.0 and r.s_m == cum[1]

def test_property_cross_track_is_perpendicular() -> None: ...  # hypothesis, integer-mapped
    # strategies over lat 49..60, lon -110..-101; skip |cross| < 1e-3 m; tolerance 1e-6
```

  `test_config.py` asserts three things:
  - `config_sha256(PipelineConfig())` is stable: it equals itself on a re-import and
    differs when one field changes;
  - `EXPERIMENTAL` contains every threshold field;
  - `config_json` has sorted keys.

- [ ] **Step 3: Run and see them fail.** Run `py -3.12 -m pytest pipeline -q`. Expected:
  import errors.

- [ ] **Step 4: Implement `geodesy.py`, `config.py` and `errors.py`.**
  - Port M1's `ellipsoid.ts`, `distance.ts`, `segment.ts` and `polyline.ts` expression by
    expression: the same operation order and the same 2 km subdivision count rule. This is
    so that the 1e-6 m cross-language agreement holds.
  - Cite the TS file in each docstring. Range checks match core: non-finite input raises
    `ValueError`, and coordinates outside `CANADA_ENVELOPE` raise `ValueError`.

- [ ] **Step 5: Generate the golden file.**
  - `make_geodesy_golden.py` (seed 20261024) draws 2,000 distance pairs and 500 projection
    triples. Coordinates are spread over lat 41.5–83.5 and lon −141 to −52, with segment
    lengths from 0 to 2 km plus 50 pairs of 2–10 km.
  - Expected distances come from `geographiclib.geodesic.Geodesic.WGS84`. Replace it with a
    GRS80 `Geodesic(6378137, 1/298.257222101)`.
  - It writes canonical JSON. Commit the output.

- [ ] **Step 6: Add the TS side.** `packages/core/test/geodesy-golden.test.ts` reads
  `../../../fixtures/geodesy-golden.json` and checks:
  - every `distanceM` is within 1e-3 m of `geodesicM` and within 1e-6 m of `pythonM`;
  - every `projectOntoSegment` gives `t` within 1e-9 and cross-track and along distance
    within 1e-6 m of the Python values.

- [ ] **Step 7: M1 carry-overs.**
  - `validateInterval` reports `NON_FINITE` for a consecutive pair whose span `s₂ − s₁` or
    `mp₂ − mp₁` is not finite. Add a test with anchors at ±1e308: expect `NON_FINITE`, not
    an `Infinity` interval.
  - Set `engines.node` to `>=22.13`.
  - Fix the RESEARCH.md figures.

- [ ] **Step 8: CI.** Add a job `pipeline`:
  1. `actions/checkout` (the same SHA as `verify`);
  2. `actions/setup-python`, pinned to the full commit SHA of its latest release ≥ 2 weeks
     old, with the tag in a comment, `python-version: "3.12"`, `cache: pip`;
  3. `pip install -e "pipeline[dev]"`;
  4. `ruff check pipeline`, then `ruff format --check pipeline`, then
     `mypy --strict pipeline/src pipeline/tests`;
  5. `pytest pipeline`.

  The `verify` job is unchanged; the golden test runs inside `npm run coverage`.

- [ ] **Step 9: Verify.** Run these:
  - `py -3.12 -m pytest pipeline` (pass, coverage ≥ 95 %);
  - `npm run lint`, `npm run format:check`, `npm run typecheck` and `npm run coverage`
    (all pass, with the new golden test).

- [ ] **Step 10: Commit.** `build(pipeline): scaffold Python pipeline with geodesy shared-golden-tested against core`

---

### Task 2: Acquire, provenance and the `GEOACCURA` check

**Files:**
- Create: `pipeline/src/cantre_pipeline/acquire.py` and `pipeline/src/cantre_pipeline/provinces.py`.
- Create: `pipeline/sources/sk.json`. This is metadata about the source, not data, and it is
  committed.
- Modify: `docs/DATA.md`, adding an "SK SHP package (pipeline source)" section and a
  "`GEOACCURA`" section.
- Test: `pipeline/tests/test_acquire.py`.

**Interfaces:**
- `PROVINCES: dict[str, str]` holds `{"sk": "https://ftp.maps.canada.ca/pub/nrcan_rncan/vector/geobase_nrwn_rfn/sk/nrwn_rfn_sk_shp_en.zip"}`.
  M5 adds the others with the same URL pattern.
- `SourceRecord` is a frozen dataclass. Its fields:
  - `province`, `url`;
  - `publisher="Natural Resources Canada"`;
  - `catalogueUrl="https://open.canada.ca/data/en/dataset/ac26807e-a1e8-49fa-87bf-451175a859b8"`;
  - `licenceName="Open Government Licence - Canada"`;
  - `licenceUrl="https://open.canada.ca/en/open-government-licence-canada"`;
  - `httpLastModified`, `contentLength`, `sha256`, `retrievedUtc` (ISO 8601 with `Z`);
  - `packageVersion` (parsed from the member names, for example `"2.0"`);
  - `crsWkt` (the TRACK `.prj` text, verbatim);
  - `metadataMember`;
  - `members: list[{name, size, sha256}]`, sorted by name.
- `acquire(province: str, *, cache_dir: Path, sources_dir: Path, record: bool = False,
  opener=urllib.request.urlopen) -> tuple[SourceRecord, Path]` returns the record and the
  extracted directory, `cache_dir/<sha256>/`.
- `load_source(sources_dir, province) -> SourceRecord`.

- [ ] **Step 1: Write the failing tests.** They use a local `http.server` on a temporary
  port, serving a zip built in `tmp_path` that contains three tiny members and a `.prj`.

```python
def test_record_mode_writes_canonical_source_file(tmp_path, served_zip) -> None:
    rec, extracted = acquire("sk", cache_dir=tmp_path / "c", sources_dir=tmp_path / "s",
                             record=True, opener=served_zip.opener)
    text = (tmp_path / "s" / "sk.json").read_text(encoding="utf-8")
    assert json.loads(text)["sha256"] == served_zip.sha256 and text.endswith("\n")
    assert [m["name"] for m in json.loads(text)["members"]] == sorted(served_zip.members)
    assert (extracted / "NRWN_SK_2_0_TRACK.prj").exists()

def test_verify_mode_rejects_changed_bytes(tmp_path, served_zip) -> None:
    write_source(tmp_path / "s", served_zip.record_with(sha256="0" * 64))
    with pytest.raises(PipelineError) as e:
        acquire("sk", cache_dir=tmp_path / "c", sources_dir=tmp_path / "s", opener=served_zip.opener)
    assert e.value.code == "HASH_MISMATCH"

def test_cached_bytes_are_reverified_without_network(tmp_path, served_zip) -> None: ...
def test_unknown_province_raises() -> None: ...
def test_zip_member_path_traversal_is_rejected(tmp_path) -> None: ...  # "../x" member -> PipelineError
```

- [ ] **Step 2: Run and see them fail.** Run `py -3.12 -m pytest pipeline/tests/test_acquire.py`.

- [ ] **Step 3: Implement `acquire.py`.**
  - Stream the download to `cache_dir/<sha256>.zip` through a temporary file, then rename
    it into place.
  - Verify the hash against `sources/<pr>.json` unless `record=True`.
  - Extract with a check on each member name: no absolute paths and no `..`.
  - In verify mode, the cached zip is re-hashed before use.
  - `retrievedUtc` is written only in record mode. It is the real time of retrieval and
    is never invented.

- [ ] **Step 4: Run and see them pass.**

- [ ] **Step 5: Record SK for real.** Run `py -3.12 -m cantre_pipeline acquire --province sk --record`
  (the CLI stub for `acquire` lands here and Task 9 extends it). Confirm that
  `sources/sk.json` has SHA-256 `f25a91d2…a796a`, or, if NRCan has republished, a new hash
  with the change noted in RESEARCH.md. Commit `sources/sk.json`.

- [ ] **Step 6: Verify the meaning of `GEOACCURA`.**
  - Look in the NRWN documentation directory on NRCan's FTP (next to
    `geobase_nrwn_rfn/`) for the NRWN 2.0 data product specification or feature catalogue.
    Record its URL, title, version and SHA-256 in DATA.md.
  - Quote the definition of the accuracy attribute (one quote, under 15 words) and give its
    unit and statistic (the metadata mentions CMAS, a 90 % circular error).
  - If no specification document can be found, record the package XML's wording as the
    evidence. Label it in DATA.md "verified from package metadata only; data product
    specification not located", and list it as an open item in the PR.
  - Either way, DATA.md states the SK values (`10` on TRACK and JUNCTION, `-1` = unknown
    elsewhere) and that v1 shows the value as the source's stated accuracy, never as a
    confidence interval (spec §6e).

- [ ] **Step 7: Commit.** `feat(pipeline): acquire NRWN packages with hash-verified provenance; document GEOACCURA`

---

### Task 3: Read, validate and audit

**Files:**
- Create:
  - `pipeline/src/cantre_pipeline/schema_nrwn.py`, `reader.py`, `model.py`, `audit.py` and
    `validate.py`;
  - `pipeline/tests/fixtures/builder.py`, a synthetic shapefile writer built on pyshp.
- Test: `pipeline/tests/test_reader.py` and `pipeline/tests/test_validate.py`.

**Interfaces:**
- `REQUIRED_FIELDS: dict[str, frozenset[str]]` lists the fields each layer must have (TRACK,
  CROSSING, STATION, MARKERPOST, STRUCTURE_0, STRUCTURE_1, JUNCTION). It holds only the
  fields this pipeline reads, which are those in the SK table above plus `NID`. A missing
  one raises `PipelineError("SCHEMA_DRIFT")`.
- `EXPECTED_SHAPE_TYPES` is TRACK `{3, 13}`, STRUCTURE_1 `{3, 13}` and the point layers
  `{1, 11}`.
- `read_layer(dir: Path, province: str, layer: str) -> list[RawFeature]`, where
  `RawFeature(index: int, attrs: dict[str, str], parts: list[list[tuple[float, float]]])`.
  Attributes are stripped strings, and parts are (lon, lat) as stored.
- `audit.py`:
  - `AuditReason`, a `Literal` over the closed set below;
  - `AuditRecord(layer, nid, reason, severity: Literal["rejected","info"], detail: str)`;
  - `write_audit_jsonl(path, records)`, which sorts by `(layer, nid, reason, detail)`.
- The reasons, by area:
  - geometry: `NULL_GEOMETRY`, `MULTIPART_GEOMETRY`, `COORD_OUT_OF_RANGE`,
    `DEGENERATE_SEGMENT`, `VERTEX_DEDUPED`;
  - identity: `DUPLICATE_NID`, `DUPLICATE_SEGID`, `UNKNOWN_DOMAIN_VALUE`;
  - anchors: `NOT_POSTED`, `UNIT_NOT_MILE`, `MILEAGE_SENTINEL`, `POSTED_SENTINEL`,
    `TRACK_NOT_FOUND`, `TRACK_NOT_CHAINED`, `SUBDIVISION_MISMATCH`, `RESIDUAL_TOO_LARGE`,
    `AMBIGUOUS_TRACK`, `ANCHOR_CONFLICT`, `ANCHOR_MERGED`, `ANCHOR_COLLAPSED`,
    `ANCHOR_OUTLIER`;
  - topology: `JUNCTION_OFF_NETWORK`, `CHAIN_CYCLE`;
  - scope: `NOT_CHAINED_CLASS`, `NOT_OPERATIONAL`, `SECOND_SUBDIVISION_IGNORED`.
- `model.py` has frozen dataclasses:
  - `Segment(key, nid, segid, track_class, status, sub_nid, sub_name, operator_mk,
    operator_name, owner, use_type, track_name, geo_accuracy_m: int | None,
    pts: tuple[LatLon, ...], start_node: NodeKey, end_node: NodeKey)`;
  - `PointFeature(layer, nid, track_nid, sub_nid, mp_value: float | None, mp_qualifier,
    mp_unit, pt: LatLon, node: NodeKey, attrs: Mapping[str, str])`;
  - `LineFeature`, the same for STRUCTURE_1 but with `pts`;
  - `Network(province, segments, crossings, stations, markerposts, structures_pt,
    structures_ln, junctions, audit)`.
  - `NodeKey = tuple[int, int]` is `(round(lon/snap), round(lat/snap))`, taken from the
    **unquantised** endpoint.
- `parse_mileage(value: str) -> float | None` returns `None` for `""`, `"None"`,
  `"-1"`/`"-1.00"`, any negative value and anything non-numeric.
- `load_network(raw_dir: Path, province: str, cfg: PipelineConfig) -> Network`.
- `fixtures/builder.py` provides `NrwnFixture(tmp_path)` with these methods:
  - `.track(segid, pts, *, nid=None, cls="Main", status="Operational", sub=("S1","Alpha"), op="CN")`;
  - `.crossing(nid, pt, track_nid, *, mp=None, qualifier="Posted", crossing_id="None", sub=("S1","Alpha"))`;
  - `.station(...)`, `.markerpost(...)`, `.bridge(...)` and `.junction(nid, pt, kind)`;
  - `.write() -> Path`. It writes every layer, with all `REQUIRED_FIELDS` and NRWN-like
    defaults, plus the `.prj` text from the real package.

- [ ] **Step 1: Write the failing tests.**

```python
def test_missing_required_field_is_schema_drift(tmp_path) -> None: ...      # drop OPERATORMK
def test_wrong_crs_is_rejected(tmp_path) -> None: ...                       # .prj says WGS 84 -> CRS_MISMATCH
def test_parse_mileage_sentinels() -> None:
    assert [parse_mileage(v) for v in ["12.34", "0.00", "-1.00", "", "None", "x", "-0.5"]] == \
           [12.34, 0.0, None, None, None, None, None]
def test_duplicate_segid_is_suffixed_and_audited(tmp_path) -> None:
    net = load_network(fixture_with_two("SEG1"), "sk", PipelineConfig())
    assert [s.key for s in net.segments] == ["SEG1", "SEG1~1"]
    assert any(a.reason == "DUPLICATE_SEGID" for a in net.audit)
def test_duplicate_nid_kept_with_info_audit(tmp_path) -> None: ...
def test_quantisation_dedupes_vertices_and_rejects_degenerate(tmp_path) -> None:
    # two vertices 0.04 m apart collapse -> VERTEX_DEDUPED; a segment left with 1 vertex -> DEGENERATE_SEGMENT
def test_coordinates_outside_canada_are_rejected_not_clamped(tmp_path) -> None: ...
def test_null_and_multipart_geometry_are_audited(tmp_path) -> None: ...
def test_every_input_record_is_accounted_for(tmp_path) -> None:
    # count(kept) + count(rejected audit lines) == count(records), per layer
def test_reads_real_layer_shapes_when_raw_dir_set() -> None: ...  # skip unless CANTRE_RAW_DIR; TRACK count 7084
```

- [ ] **Step 2: Run and see them fail.**

- [ ] **Step 3: Implement it.**
  - `reader.py` uses `shapefile.Reader` with `encoding="latin-1"`, because NRWN DBF files are
    Latin-1. Name in the docstring how that was checked.
  - `validate.py` maps records to the dataclasses:
    - quantise coordinates: `round(v*1e6)/1e6`;
    - dedupe consecutive identical quantised vertices;
    - compute node keys from the unquantised endpoints;
    - audit every rejection.
  - An unexpected domain value is passed through and audited `UNKNOWN_DOMAIN_VALUE` (info).
    This applies to `TRACKCLASS`, `STATUS`, `STRUCTYPE` and `TRAJUNCTYP`.

- [ ] **Step 4: Run and see them pass.** Also run `ruff check`, `ruff format --check` and `mypy --strict`.

- [ ] **Step 5: Commit.** `feat(pipeline): read and validate NRWN layers with a closed audit reason set`

---

### Task 4: Build chains

**Files:**
- Create: `pipeline/src/cantre_pipeline/chains.py`.
- Test: `pipeline/tests/test_chains.py`.

**Interfaces:**
- Consumes `Network` and `Segment` (Task 3) and `cumulative_lengths_m` (Task 1).
- Produces:
  - `Chain(id, sub_nid, sub_name, operators: tuple[str, ...], pts: tuple[LatLon, ...],
    s_m: tuple[float, ...], segment_keys: tuple[str, ...], segment_ranges: Mapping[str,
    tuple[int, int]], cycle: bool)`. `segment_ranges[key] = (i0, i1)` is the vertex range
    of that segment in the chain, with `i1` inclusive.
  - `ChainSet(chains, unchained: tuple[Segment, ...], node_junctions: Mapping[NodeKey,
    str], audit)`.
  - `build_chains(net: Network, cfg: PipelineConfig) -> ChainSet`.

**The chain rule**, from spec §5.3 and Decision 2:
1. Eligible segments are Main and Operational. The rest go to `unchained` with
   `NOT_CHAINED_CLASS` or `NOT_OPERATIONAL` (info).
2. Group the eligible segments by `sub_nid`. Within a group, a node's degree is the number
   of segment ends at that `NodeKey`.
3. Nodes with degree ≠ 2 are breaks. Walk every maximal path between breaks, and remove the
   segments as they are visited.
4. Each remaining component has only degree-2 nodes, so it is a cycle. Start it at its
   smallest `NodeKey`, walk it in the direction of the smaller neighbouring `NodeKey`, and
   flag `cycle=True` with a `CHAIN_CYCLE` audit line.
5. Orient each open chain so it starts at its smaller end `NodeKey` (compared as tuples).
   Reverse segment vertex lists as needed, and drop the duplicate vertex at each join.
6. `s_m` is the cumulative length over the quantised `pts`. A gap is never bridged:
   segments that don't share a `NodeKey` are never joined.
7. Every junction `NodeKey` is mapped to its `TRAJUNCTYP`. A junction whose key is on no
   segment endpoint of any class gets `JUNCTION_OFF_NETWORK`.

- [ ] **Step 1: Write the failing tests.** They use `NrwnFixture`, and
  `chains_of(net)` returns a sorted list of `(segment_keys, round(s_m[-1], 3))`.

```python
def test_three_segments_make_one_chain_with_continuous_s(tmp_path) -> None: ...
def test_gap_of_one_metre_is_never_bridged(tmp_path) -> None:               # -> 2 chains
def test_branch_node_splits_into_three_chains(tmp_path) -> None: ...
def test_parallel_double_track_with_crossovers_gives_separate_chains(tmp_path) -> None: ...
def test_subdivision_change_ends_the_chain(tmp_path) -> None: ...
def test_siding_attached_mid_chain_does_not_break_it(tmp_path) -> None: ...
def test_discontinued_main_is_unchained_and_audited(tmp_path) -> None: ...
def test_balloon_loop_terminates_and_is_flagged_cycle(tmp_path) -> None:
    cs = build_chains(loop_fixture(tmp_path), PipelineConfig())
    assert len(cs.chains) == 1 and cs.chains[0].cycle and cs.chains[0].pts[0] == cs.chains[0].pts[-1]
def test_diamond_node_keeps_both_lines_continuous_and_is_labelled(tmp_path) -> None:
    # two subdivisions crossing at a shared vertex: each sub's chain stays one chain; node_junctions[node] == "Diamond"
@given(order=st.permutations(range(5)), flips=st.lists(st.booleans(), min_size=5, max_size=5))
def test_property_order_and_direction_do_not_change_chains(order, flips) -> None:
    # same ids, same pts, same s_m (exact equality) for any record order / vertex reversal
```

- [ ] **Step 2: Run and see them fail.** Then **Step 3: implement**, **Step 4: run and see
  them pass**, including the hypothesis test at `max_examples=200`.

- [ ] **Step 5: Commit.** `feat(pipeline): build deterministic per-subdivision main-track chains`

---

### Task 5: Qualify anchors

**Files:**
- Create: `pipeline/src/cantre_pipeline/anchors.py`.
- Test: `pipeline/tests/test_anchors.py`.

**Interfaces:**
- Consumes `Network`, `ChainSet` and `project_onto_range`.
- Produces:
  - `QualifiedAnchor(id: str, chain_id: str, s_m: float, mp: float, source: AnchorSource,
    member_nids: tuple[str, ...], residual_m: float)`, where
    `AnchorSource = Literal["crossing","station","structure","markerpost"]`. These are the
    roadmap names.
  - `qualify_anchors(net, chains, cfg) -> tuple[list[QualifiedAnchor], list[AuditRecord]]`.

**Rules, checked in this order.** The first rule a record fails gives its single audit
reason.
1. `mp_qualifier == "Posted"`, else `NOT_POSTED`.
2. `mp_unit == "Mile"`, else `UNIT_NOT_MILE`.
3. A parsed value exists, else `POSTED_SENTINEL` if it was Posted, otherwise
   `MILEAGE_SENTINEL`.
4. `track_nid` names at least one segment, else `TRACK_NOT_FOUND`.
5. At least one of those segments is in a chain, else `TRACK_NOT_CHAINED`.
6. The record's `sub_nid` equals that chain's `sub_nid`, else `SUBDIVISION_MISMATCH`.
7. Project the point onto each candidate segment's `segment_ranges` span only, never the
   whole chain. Keep the smallest residual. If two candidates on **different** chains fall
   within 1 m of each other, the result is `AMBIGUOUS_TRACK`.
8. The residual must be at most `anchor_max_residual_m`, else `RESIDUAL_TOO_LARGE`.

Then merge, per chain:
- Records sharing a `CROSSINGID` other than `"None"` whose values agree within
  `mp_equal_tol_mi` become one anchor. Its `id` is the smallest NID, `s_m` is the mean,
  every NID goes in `member_nids`, and each merge gets an `ANCHOR_MERGED` (info) line.
- If the group's values disagree, every member gets `ANCHOR_CONFLICT`.
- Records on other chains stay separate.

Station, structure and markerpost records go through the same rules. Their `source` names
their layer.

- [ ] **Step 1: Write the failing tests.**

```python
def test_posted_crossing_on_main_becomes_anchor_at_projected_s(tmp_path) -> None: ...
def test_posted_minus_one_is_rejected_as_posted_sentinel(tmp_path) -> None:
    anchors, audit = qualify(fixture(crossing_mp=-1.0, qualifier="Posted"))
    assert anchors == [] and [a.reason for a in audit] == ["POSTED_SENTINEL"]
def test_unknown_qualifier_marker_post_is_not_an_anchor(tmp_path) -> None: ...   # NOT_POSTED
def test_crossing_on_siding_is_track_not_chained(tmp_path) -> None: ...
def test_crossing_with_other_subdivision_is_mismatch(tmp_path) -> None: ...
def test_residual_over_25m_rejected_and_25m_accepted(tmp_path) -> None: ...      # boundary 24.9 / 25.1
def test_same_crossingid_same_chain_agreeing_values_merge(tmp_path) -> None: ...
def test_same_crossingid_disagreeing_values_all_conflict(tmp_path) -> None: ...
def test_same_crossingid_on_two_chains_stays_two_anchors(tmp_path) -> None: ...  # double track
def test_projection_uses_the_referenced_segment_span_only(tmp_path) -> None:
    # chain doubles back near itself; anchor's own segment is the far leg -> s from that leg
```

- [ ] **Step 2–4: Fail, implement, pass.**

- [ ] **Step 5: Commit.** `feat(pipeline): qualify posted anchors and merge duplicate crossings`

---

### Task 6: Calibrated intervals and discontinuities

**Files:**
- Create: `pipeline/src/cantre_pipeline/intervals.py`.
- Test: `pipeline/tests/test_intervals.py`.

**Interfaces:**
- Consumes `Chain` and `QualifiedAnchor`.
- Produces:
  - `Interval(id: str, chain_id: str, anchor_ids: tuple[str, ...])`, sorted by `s`, with at
    least 2 anchors and strictly monotonic `mp` (the roadmap contract);
  - `build_intervals(chain, anchors, cfg) -> tuple[list[Interval], list[QualifiedAnchor],
    list[AuditRecord]]`, which returns the intervals, the anchors kept after collapsing and
    outlier removal, and the audit;
  - `interpolate_mp(anchors: Sequence[QualifiedAnchor], s_m: float) -> float | None`. This
    is core's `interpolateMilepost` formula. It returns `None` outside the outer anchors and
    never extrapolates.

**Algorithm.** The spec fixes the tests but not their order, so this pins it:

```text
A = anchors on this chain sorted by (s_m, id)
1. collapse: merge runs where |Δs| ≤ anchor_collapse_span_m and |Δmp| ≤ mp_equal_tol_mi
   → one anchor at mean s (smallest id kept, member_nids unioned, ANCHOR_COLLAPSED)
2. pair_ok(i, j): Δs = s_j − s_i > 0, Δmp = mp_j − mp_i ≠ 0 beyond mp_equal_tol_mi,
   and (Δs < slope_min_span_m or | |Δmp|·1609.344/Δs − 1 | ≤ slope_tolerance)
3. outliers: repeat until stable — for interior k, if not pair_ok(k−1,k) and
   not pair_ok(k,k+1) and pair_ok(k−1,k+1) and sign(Δmp) of (k−1,k+1) agrees with
   the neighbouring pairs → drop k (ANCHOR_OUTLIER, detail has both slopes)
4. split: walk consecutive pairs; the current interval has a direction sign set by its
   first pair. Close the interval before pair (i,i+1) when not pair_ok(i,i+1) or its
   sign differs. Intervals with < 2 anchors are not emitted (the anchor stays in the
   tile as an isolated anchor and is counted in the report).
```

- [ ] **Step 1: Write the failing tests.**

```python
def test_increasing_mileage_gives_one_interval() -> None: ...
def test_decreasing_mileage_gives_one_interval_with_decreasing_mp() -> None: ...
def test_reset_to_zero_splits_and_never_interpolates_across() -> None:
    ivs, kept, _ = build_intervals(chain, anchors_mp([10.0, 11.0, 12.0, 0.0, 1.0]), cfg)
    assert [len(i.anchor_ids) for i in ivs] == [3, 2]
    assert interpolate_mp(kept_for(ivs[0]), s_between(12.0, 0.0)) is None
def test_single_outlier_is_dropped_not_split() -> None: ...    # 10, 11, 47, 13, 14 -> one interval of 4
def test_slope_test_skipped_below_800m_span() -> None: ...      # 0.01 mi over 30.1 m passes
def test_slope_outside_15_percent_splits_on_long_span() -> None: ...
def test_close_equal_postings_collapse_to_mean_s() -> None: ...
def test_equal_mp_far_apart_is_a_split() -> None: ...
def test_interpolate_mp_reproduces_anchors_and_never_extrapolates() -> None: ...
def test_property_emitted_intervals_satisfy_core_contract(data) -> None:
    # hypothesis: random anchors -> every interval sorted, strictly monotonic, len >= 2
```

- [ ] **Step 2–4: Fail, implement, pass.**

- [ ] **Step 5: Commit.** `feat(pipeline): split chains into calibrated intervals at discontinuities`

---

### Task 7: Extract assets

**Files:**
- Create: `pipeline/src/cantre_pipeline/assets.py`.
- Test: `pipeline/tests/test_assets.py`.

**Interfaces:**
- `Asset(id: str, kind: AssetKind, layer: str, name: str | None, pts: tuple[LatLon, ...],
  posted: PostedMileage | None, positions: tuple[ChainPosition, ...], attrs: Mapping[str,
  str])`. Its parts:
  - `AssetKind = Literal["crossing","bridge","moveableBridge","tunnel","culvert",
    "station","diamond"]`;
  - `PostedMileage(mp, sub_nid)`, present only when the record passes anchor rules 1–3;
  - `ChainPosition(chain_id, s_start_m, s_end_m, residual_m, derived_mp_start:
    float | None, derived_mp_end: float | None)`.
- `extract_assets(net, chains, intervals, anchors, cfg) -> list[Asset]`.

**Rules:**
- **Kinds:**
  - every CROSSING is a `crossing`;
  - STATION is a `station`;
  - STRUCTYPE `Bridge` is `bridge`, `Tunnel` is `tunnel`, `Culvert` is `culvert`, and any
    value containing `Moveable` or `Movable` is `moveableBridge`;
  - JUNCTION `Diamond` is `diamond`;
  - other junction types are not assets.
- **Positions:**
  - assets that have a `TRACKNID` project onto that track's chain span, using the anchor
    projection rule 7, up to `anchor_max_residual_m`;
  - a line asset gets `s_start`/`s_end` from its first and last vertex;
  - a diamond's node is shared, so it gets one position on **every** chain that has that
    `NodeKey` as a vertex, with residual 0.
- **Derived mileposts:** derived MP comes from `interpolate_mp` on the interval that
  contains `s`, or `None` if no interval does.
- **Attributes kept:**
  - crossings: `LEVELCROSS`, `CROSSINTYP`, `WARNINGSYS`, `ROADCLASS`, `CROSSTYPNM`,
    `ROUTENUMBE`, `CROSACCES`, `TCID` (with `-1` written as absent);
  - stations: `STNENNAME`, `STNTYPE`, `STNUSR1ENA`;
  - structures: `STRUCTYPE`, `STRUENNAME`;
  - "None" and "-1" are dropped from `attrs` rather than stored.
- Culverts are kept as `culvert` and never mapped to `bridge`.

- [ ] **Step 1: Write the failing tests.**

```python
def test_crossing_keeps_posted_and_derived_mileage_separately(tmp_path) -> None:
    a = only(extract(fixture_with_posted_crossing(mp=12.30)))
    assert a.posted == PostedMileage(12.30, "S1") and a.positions[0].derived_mp_start is not None
def test_unposted_crossing_has_derived_only(tmp_path) -> None: ...
def test_bridge_line_gets_start_and_end_positions(tmp_path) -> None: ...
def test_diamond_gets_a_position_on_each_crossing_chain(tmp_path) -> None: ...
def test_culvert_is_not_a_bridge(tmp_path) -> None: ...
def test_asset_outside_any_interval_has_null_derived_mp(tmp_path) -> None: ...
def test_sentinel_attributes_are_omitted(tmp_path) -> None: ...
```

- [ ] **Step 2–4: Fail, implement, pass.**

- [ ] **Step 5: Commit.** `feat(pipeline): extract crossings, structures, stations and diamonds with chain positions`

---

### Task 8: Tiles, manifest and JSON Schemas

**Files:**
- Create:
  - `pipeline/src/cantre_pipeline/encode.py`, `tiles.py` and `manifest.py`;
  - `pipeline/schema/tile.schema.json` and `pipeline/schema/manifest.schema.json`
    (draft 2020-12).
- Test: `pipeline/tests/test_encode.py`, `pipeline/tests/test_tiles.py` and
  `pipeline/tests/test_manifest.py`.

**Interfaces:**
- `encode.py`:
  - `to_e6(v: float) -> int`;
  - `delta_encode(xs: Sequence[int]) -> list[int]`, where the first value is absolute and
    the rest are differences;
  - `delta_decode(...)`;
  - `canonical_json(obj) -> bytes`;
  - `gzip_size(data: bytes) -> int` (`mtime=0`, level 9).
- `tile_key(lat, lon, cfg) -> str` and
  `tile_bounds(key, cfg) -> Bounds(south, west, north, east)`.
- `buffered_bounds(b: Bounds, buffer_m) -> Bounds` uses `metresPerDegree` at
  `max(|south|, |north|)` (Decision 5).
- `build_tiles(province, chains, unchained, anchors, intervals, assets, cfg,
  dataset_version) -> dict[str, dict]`, returning tile JSON objects by key.
- `build_manifest(sources, tiles_bytes: Mapping[str, bytes], totals, cfg) -> dict`.
- `DATASET_VERSION = f"nrwn-2.0+cantre.{__version__}"`.

**Tile JSON** (`schema: "cantre.tile/1"`). Every array is sorted as noted, and every
coordinate array is a delta-encoded integer microdegree array.

```text
{ schema, datasetVersion, key, bounds{south,west,north,east}, bufferM, attribution,
  chains:    [{ id, subdivisionNid, subdivisionName, operators[], cycle,
                vertexStart, latE6[], lonE6[], sMm[] }]                      by id, vertexStart
  segments:  [{ key, nid, trackClass, status, subdivisionNid, subdivisionName,
                operator, owner, useType, trackName, chainId|null, latE6[], lonE6[] }]  by key
  anchors:   [{ id, chainId, sMm, mp, source, memberNids[] }]                by chainId, sMm, id
  intervals: [{ id, chainId, anchorIds[] }]                                  by id
  assets:    [{ id, kind, layer, name|null, latE6[], lonE6[], posted{mp,subdivisionNid}|null,
                positions[{chainId,sStartMm,sEndMm,residualMm,derivedMpStart,derivedMpEnd}],
                attrs{} }]                                                   by id }
```

**What goes into a tile:**
- A chain **piece** is each maximal run of chain edges whose bounding boxes overlap the
  buffered tile bounds. `vertexStart` is the index of the run's first vertex in the full
  chain, and `sMm` holds the full-chain values, so pieces from different tiles reassemble
  exactly.
- A segment goes into every tile its bounding box overlaps.
- An interval, together with **all** its anchors, goes into every tile containing a piece
  whose `s` range overlaps the interval's `s` range.
- An isolated anchor goes in where its `s` falls inside a piece.
- An asset goes into every tile whose buffered bounds contain any of its points.

**Manifest** (`schema: "cantre.manifest/1"`) holds:
- `datasetVersion`, `pipelineVersion`, `config` (the canonical object) and `configSha256`;
- `attribution`;
- `sources[]`, the full `SourceRecord`s;
- `provinces{ sk: { chainKm, calibratedKm, anchors, isolatedAnchors, assetsByKind{},
  tiles } }`;
- `tiles[]`: `{ key, path: "tiles/<key>.json", sha256, bytes, gzipBytes, bounds,
  provinces[] }`, sorted by key.

- [ ] **Step 1: Write the failing tests.**

```python
def test_delta_round_trip_and_precision() -> None:
    xs = [to_e6(v) for v in [52.1234567, 52.1234571, 51.0]]
    assert delta_decode(delta_encode(xs)) == xs and abs(xs[0] / 1e6 - 52.1234567) <= 5e-7
def test_tile_key_is_floor_based_for_negative_longitudes() -> None:
    assert tile_key(52.30, -106.70, PipelineConfig()) == "209_-214"
def test_buffer_is_at_least_2km_on_every_edge() -> None: ...   # geodesic check at both lat edges
def test_chain_crossing_tile_edge_reassembles_exactly(tmp_path) -> None:
    # decode both tiles' pieces, overlap on vertexStart: identical latE6/lonE6/sMm values
def test_interval_with_all_anchors_in_each_overlapping_tile(tmp_path) -> None: ...
def test_asset_within_buffer_appears_in_both_tiles(tmp_path) -> None: ...
def test_tiles_and_manifest_validate_against_json_schema(tmp_path) -> None: ...
def test_manifest_hashes_match_written_bytes(tmp_path) -> None: ...
def test_canonical_json_is_stable_across_hash_seeds() -> None: ...  # subprocess with PYTHONHASHSEED=1 and =2
```

- [ ] **Step 2–4: Fail, implement, pass.**

- [ ] **Step 5: Commit.** `feat(pipeline): write regional tiles and manifest with JSON Schemas`

---

### Task 9: Reports, CLI, determinism, real-SK smoke run, contract test and docs

**Files:**
- Create:
  - `pipeline/src/cantre_pipeline/report.py` and `cli.py`;
  - `pipeline/src/cantre_pipeline/__main__.py`;
  - `pipeline/tests/golden/synthetic/`, the committed output of the synthetic build;
  - `packages/core/test/pipeline-contract.test.ts`.
- Test: `pipeline/tests/test_report.py`, `pipeline/tests/test_cli.py` and
  `pipeline/tests/test_determinism.py`.
- Modify:
  - `.github/workflows/ci.yml`;
  - `pipeline/README.md`, `docs/RESEARCH.md` and `docs/superpowers/plans/2026-10-23-cantre-roadmap.md`
    (M2 row and the tile-schema contract line);
  - `README.md`.

**Interfaces:**
- `coverage_rows(chains, intervals, anchors, audit) -> list[CoverageRow]`.
  `CoverageRow(subdivision_nid, subdivision_name, operators, chain_km, calibrated_km,
  calibrated_pct, anchors_by_source: dict[AnchorSource, int], rejected_by_reason:
  dict[str, int])`, where `calibrated_km = Σ (s_last − s_first)` over intervals.
- The reports go to `reports/coverage-<pr>.json` and `reports/coverage-<pr>.md`. The
  Markdown version is a table with a totals row and a header that states the dataset
  version and source SHA-256. It also says "internal coverage, not surveyed accuracy".
- The CLI, `python -m cantre_pipeline`, has two commands:
  - `acquire --province PR [--record]`;
  - `build --province PR --out DIR [--raw DIR] [--check-budget]`.
- `build` writes this output tree:
  - `DIR/manifest.json` and `DIR/tiles/*.json`;
  - `DIR/audit/<pr>.jsonl`;
  - `DIR/reports/coverage-<pr>.{json,md}`.

  It exits non-zero when `--check-budget` finds a tile over
  `tile_budget_gzip_bytes`.
- `build_synthetic(out: Path)` builds the fixed `NrwnFixture` scenario set. It is used both
  by the golden test and by the `make_golden` script in `pipeline/scripts/`. The scenario
  set covers:
  - gap, branch, double track and loop;
  - a subdivision change;
  - reset and outlier;
  - merged and conflicting crossings;
  - sentinels;
  - a diamond, a bridge and a culvert;
  - a chain crossing a tile edge.

- [ ] **Step 1: Write the failing tests.**

```python
def test_every_audit_reason_in_report_matches_audit_file(tmp_path) -> None: ...
def test_calibrated_km_never_exceeds_chain_km(tmp_path) -> None: ...
def test_synthetic_build_matches_committed_golden(tmp_path) -> None:
    build_synthetic(tmp_path)
    assert tree_sha256(tmp_path) == tree_sha256(GOLDEN_DIR)
def test_build_is_byte_identical_across_runs_and_hash_seeds(tmp_path) -> None:
    # two subprocess builds with PYTHONHASHSEED=0 and 12345 -> identical tree hashes
def test_cli_build_exit_code_on_budget_breach(tmp_path) -> None: ...
```

  `packages/core/test/pipeline-contract.test.ts` reads every tile in
  `pipeline/tests/golden/synthetic/tiles/`. For each tile it checks:
  - recomputed lengths: each chain piece is decoded, `cumulativeLengthsM` is applied, and
    the result is offset by `sMm[0]/1000`. It must match `sMm/1000` within 1 mm.
  - every interval's anchors, as `Anchor { id, s: sMm/1000, mp, source }`, give
    `validateInterval(...) → []`;
  - every non-null `derivedMpStart` equals `interpolateMilepost(sStartMm/1000, interval)`
    within 1e-9 mi;
  - no anchor `mp` is negative and no decoded coordinate is outside `CANADA_ENVELOPE`.

- [ ] **Step 2: Run and see them fail.**

- [ ] **Step 3: Implement `report.py` and `cli.py`, then generate the golden output** with
  `py -3.12 pipeline/scripts/make_golden.py` and commit it.

- [ ] **Step 4: Run and see them pass.** Run the full Python and Node suites.

- [ ] **Step 5: Real SK run.**
  1. Run `acquire --province sk`, then `build --province sk --out build/sk
     --check-budget`, twice into different directories, and compare the tree hashes.
  2. Record in RESEARCH.md:
     - the dataset version and source SHA-256;
     - run time, tile count, total and maximum gzip size;
     - chain km, calibrated km and percentage;
     - anchors by source, rejections by reason;
     - the cycle count, and the subdivisions with 0 % calibration.

  These are measured values from the command output. Quote them, don't round them into
  claims.

- [ ] **Step 6: CI.** In the `pipeline` job, after `pytest`:
  1. restore `.cache/raw` with `actions/cache` (SHA-pinned), keyed on `hashFiles('pipeline/sources/*.json')`;
  2. run `python -m cantre_pipeline acquire --province sk` (verify mode: hash checked);
  3. build twice into `build/a` and `build/b` with different `PYTHONHASHSEED`, then run
     `diff -r build/a build/b`;
  4. run `--check-budget`;
  5. upload `build/a` with `actions/upload-artifact` (SHA-pinned, 14-day retention). The
     repo is private, and the artifact is not a deployment.

- [ ] **Step 7: Docs.**
  - `pipeline/README.md`: how to run the pipeline, the output tree, the config table with
    each threshold labelled experimental, the audit reasons and the determinism guarantee.
    It also covers the datum note and the Z-ignored note.
  - Roadmap: M2 → "Built (PR pending)"; the tile and manifest contract line points to
    `pipeline/schema/`.
  - RESEARCH.md: the M2 entry, and the six "Decisions beyond the spec" in the decision
    register.
  - README: link to the pipeline.

- [ ] **Step 8: Commit.** `feat(pipeline): coverage report, CLI, determinism checks and SK smoke run in CI`

---

## Out of scope for M2 (owned later)

- `@cantre/data-client` TypeScript types that mirror the schemas: M4.
- Matching on tiles: M3.
- Other provinces, offline downloads, the evaluation and the datum study: M5.
- Unknown-qualified marker posts as an experimental anchor class: M5 evaluation only.
- Hosting the tiles anywhere: owner-gated (spec §12).
