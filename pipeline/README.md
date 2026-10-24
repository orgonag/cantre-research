# cantre-pipeline

Deterministic Python pipeline that turns the NRCan National Railway Network (NRWN) and the
Transport Canada Grade Crossings Inventory into chains, anchors, calibrated intervals and tiles
for CANTRE. Milestone M2 runs Saskatchewan only.

## Geodesy

`cantre_pipeline.geodesy` is a line-for-line port of `@cantre/core` (GRS80, tangent plane at the
segment mid-latitude, segments over 2 km subdivided for distance only, clamped projection).
`fixtures/geodesy-golden.json` is checked by both pytest and Vitest: the two languages agree
within 1e-6 m and both are within 1 mm of GeographicLib on segments of 2 km or less.

Shapefile coordinates are (x = longitude, y = latitude) in NAD83(CSRS98) with no datum
transformation. Z values are read and ignored.

## Development

```
py -3.12 -m venv .venv
.venv/Scripts/python -m pip install -e "pipeline[dev]"   # Linux/macOS: .venv/bin/python
.venv/Scripts/python -m pytest pipeline
.venv/Scripts/python -m ruff check pipeline
.venv/Scripts/python -m ruff format --check pipeline
.venv/Scripts/python -m mypy --strict pipeline/src pipeline/tests
```

Regenerate the golden file with `python pipeline/scripts/make_geodesy_golden.py`.
