# cantre-pipeline

Deterministic Python pipeline that turns the NRCan National Railway Network (NRWN) and the
Transport Canada Grade Crossings Inventory into chains, anchors, calibrated intervals, assets,
regional tiles, a manifest, an audit log and a per-subdivision coverage report for CANTRE.
Milestone M2 runs Saskatchewan only (`--province sk`); M5 runs the rest.

**Research use only.** Every threshold below is experimental, chosen by inspecting Saskatchewan
data and not validated against ground truth. The coverage report measures internal coverage, not
surveyed accuracy.

## Run it

```
py -3.12 -m venv .venv
.venv/Scripts/python -m pip install -e "pipeline[dev]"   # Linux/macOS: .venv/bin/python
```

```
python -m cantre_pipeline acquire --source sk          # download (once), verify the SHA-256
python -m cantre_pipeline acquire --source tc-gci
python -m cantre_pipeline build --province sk --out build/sk --check-budget
```

- `acquire --source ID` takes a province code or `tc-gci`. It checks the cached bytes against
  `pipeline/sources/<id>.json` and fails with `HASH_MISMATCH` on any difference. `--record`
  measures a source and rewrites its record instead (a deliberate, reviewed act).
- `build --province PR --out DIR [--raw DIR] [--check-budget]` acquires both sources in verify
  mode, so a changed cached copy stops the build before anything is written. It exits 0 on
  success, 2 on a `PipelineError` and 3 when `--check-budget` finds a tile over the budget (the
  output is still written for inspection).
- Raw bytes are cached in `.cache/raw/` (override with `--raw` or `CANTRE_RAW_DIR`); build output
  goes where you say. Both are git-ignored. **Windows deep checkouts need a short
  `CANTRE_RAW_DIR`** (for example `C:\cv-raw`): the extracted NRWN files sit under a 64-character
  hash directory and a long repository path can pass `MAX_PATH` (260), which `acquire` reports as
  `INCOMPLETE_EXTRACTION`.

### Output tree

```
DIR/manifest.json            versions, config and its SHA-256, sources, totals, per-tile SHA-256
DIR/tiles/<key>.json         regional tiles, key = "<floor(lat/0.25)>_<floor(lon/0.5)>"
DIR/audit/<pr>.jsonl         every stage's audit lines (one canonical JSON object per line)
DIR/reports/coverage-<pr>.json   per-subdivision coverage, machine readable
DIR/reports/coverage-<pr>.md     the same as a table, with the dataset version and source hashes
```

Tile and manifest formats are the JSON Schemas in [`schema/`](schema/) (`cantre.tile/1`,
`cantre.manifest/1`). `latE6`, `lonE6` and a chain piece's `sMm` are delta-encoded integers
(first value absolute, then differences); anchor `sMm` and asset `sStartMm`/`sEndMm` are absolute.
`s` is millimetres along the chain; `mp` is miles as published.

A line asset (bridge, tunnel) has `sStartMm <= sEndMm`: **its direction is not preserved**, and
neither is the stored vertex direction of a segment or line asset (vertices are written in a
canonical direction so reversing a record cannot change a byte).

### Pipeline stages

`acquire` -> `reader` -> `validate` -> `chains` -> `anchors` -> `intervals` -> `assets` ->
`tiles` -> `manifest` + `report`, orchestrated by `build.py`. Each stage is a pure function over
typed dataclasses; only `acquire`, the CLI and the writers touch the disk or network.

## Determinism

The same raw bytes and the same configuration give **byte-identical** output, whatever the input
record order, the vertex direction of a record or `PYTHONHASHSEED`. JSON is canonical (sorted
keys, `separators=(",", ":")`, UTF-8, LF, one trailing newline), gzip size is measured at level 9
with `mtime=0`, chain ids are content hashes and no wall-clock time is written. Tests: the
synthetic build under `tests/golden/synthetic/` (regenerate with
`python pipeline/scripts/make_golden.py`; it contains no NRWN data) is compared by tree hash
against fresh builds made with two hash seeds and with shuffled and reversed input. CI builds
Saskatchewan twice with different seeds and runs `diff -r`. A Vitest contract test
(`packages/core/test/pipeline-contract.test.ts`) runs `@cantre/core` on the golden tiles.

## Geodesy

`cantre_pipeline.geodesy` is a line-for-line port of `@cantre/core` (GRS80, tangent plane at the
segment mid-latitude, segments over 2 km subdivided for distance only, clamped projection).
`fixtures/geodesy-golden.json` is checked by both pytest and Vitest: the two languages agree
within 1e-6 m and both are within 1 mm of GeographicLib on segments of 2 km or less.

**Datum note.** Shapefile coordinates are (x = longitude, y = latitude) in NAD83(CSRS98) and are
used as-is, with no datum transformation, as if they were WGS 84 (spec section 3): a bias of
roughly 1 to 2 m that the v1 evaluation measures rather than corrects.
**Z values are read and ignored.** All distances and `s` are computed from coordinates quantised
to integer microdegrees.

## Configuration

One frozen `PipelineConfig` (`config.py`). The manifest records every value and the SHA-256 of
the canonical JSON. **Every threshold is experimental**; only the two format constants are not
judgements.

| Field | Default | Meaning |
|---|---|---|
| `snap_deg` | 1e-7 deg | topology snap tolerance for segment endpoints (about 1 cm) |
| `coord_scale` | 1,000,000 | integer units per degree in tiles (format constant) |
| `s_scale` | 1000 | integer units per metre of `s` in tiles (format constant) |
| `anchor_max_residual_m` | 25 m | largest point-to-chain distance for a point to anchor |
| `slope_tolerance` | 0.15 | allowed relative deviation of an interval's miles-per-mile slope |
| `slope_min_span_m` | 800 m | slope is tested only when anchors are at least this far apart |
| `anchor_collapse_span_m` | 30 m | equal-mileage anchors this close along `s` are merged |
| `mp_equal_tol_mi` | 0.005 mi | mileposts within this are equal (NRWN resolution is 0.01 mi) |
| `tc_max_disagreement_mi` | 0.05 mi | largest NRWN vs Transport Canada mileage disagreement |
| `unverified_max_deviation_mi` | 0.05 mi | largest deviation of an unverified anchor from its interval |
| `tile_lat_deg` / `tile_lon_deg` | 0.25 / 0.5 deg | tile height / width |
| `tile_buffer_m` | 2000 m | margin around a tile that still lists edges and assets |
| `tile_budget_gzip_bytes` | 500,000 | per-tile size budget after gzip (`--check-budget`) |

## Audit reasons

Nothing is dropped silently. Every rejected record gets exactly one `rejected` line; kept
records and informational notes get `info` lines. The closed set of 34 reasons
(`audit.AuditReason`):

| Group | Reasons |
|---|---|
| Geometry | `NULL_GEOMETRY`, `MULTIPART_GEOMETRY`, `COORD_OUT_OF_RANGE`, `DEGENERATE_SEGMENT` (rejected); `VERTEX_DEDUPED` (info) |
| Identity | `DUPLICATE_NID`, `DUPLICATE_SEGID`, `UNKNOWN_DOMAIN_VALUE` (info; the last is rejected for an unknown structure type) |
| Anchor value | `NOT_POSTED`, `UNIT_NOT_MILE`, `MILEAGE_SENTINEL`, `POSTED_SENTINEL` (rejected) |
| Anchor location | `TRACK_NOT_FOUND`, `TRACK_NOT_CHAINED`, `SUBDIVISION_MISMATCH`, `RESIDUAL_TOO_LARGE`, `AMBIGUOUS_TRACK` (rejected) |
| Anchor merge and rules | `ANCHOR_CONFLICT`, `ANCHOR_OUTLIER`, `SOURCE_DISAGREEMENT`, `UNVERIFIED_DEVIATION` (rejected); `ANCHOR_MERGED`, `ANCHOR_COLLAPSED` (info) |
| Transport Canada join | `TC_NO_ROW`, `TC_SPUR_CROSSING`, `TC_SUBDIVISION_MISMATCH`, `TC_BAD_MILE` (rejected when they decide a crossing's fate), `TC_DUPLICATE_NUMBER` (info) |
| Topology | `JUNCTION_OFF_NETWORK`, `CHAIN_CYCLE` (info) |
| Scope | `NOT_CHAINED_CLASS`, `NOT_OPERATIONAL`, `SECOND_SUBDIVISION_IGNORED` (info) |
| Assets | `ASSET_UNPOSITIONED` (info: the asset is kept but has no chain position; the cause is in the detail) |

Audit lines are sorted by `(layer, nid, reason, detail)` so the file does not depend on input
order. The coverage report's `auditByReason` reproduces these counts exactly.

## Development

```
.venv/Scripts/python -m pytest pipeline
.venv/Scripts/python -m ruff check pipeline
.venv/Scripts/python -m ruff format --check pipeline
.venv/Scripts/python -m mypy --strict pipeline/src pipeline/tests
```

Regenerate the geodesy golden file with `python pipeline/scripts/make_geodesy_golden.py` and the
synthetic build golden with `python pipeline/scripts/make_golden.py`.
