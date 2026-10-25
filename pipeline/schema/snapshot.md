# The national snapshot, `snapshot.bin.gz` (format version 1)

This file is the contract between the pipeline (Python, `pipeline/src/cantre_pipeline/snapshot.py`)
and the app's decoder (TypeScript). A decoder must be writable from this page alone. If the page
and the code disagree, the page is wrong and must be fixed in the same change.

A snapshot holds the whole national rail network of one build: whole chains with their geometry
and along-chain distances, the segments that belong to no chain, the milepost anchors and
intervals, and the assets. It is downloaded once and loaded whole. It does not replace the tiles
(`cantre.tile/1`) for the pipeline's own purposes; it is what the app reads.

Research use only. The data are mostly 2016 vintage, are not surveyed, and carry no safety
guarantee.

## 1. Files and names

| File | Content |
|---|---|
| `snapshot.bin.gz` | gzip of the binary described below |
| `asset-details.json.gz` | gzip of one canonical JSON object, section 8 |
| `manifest.json` | `cantre.manifest/1`, which names both files, section 9 |

Compression is plain gzip (RFC 1952), level 9, with a zero modification time and no file name,
so the same input always gives the same bytes. A decoder just decompresses; in a browser that is
`DecompressionStream('gzip')`.

## 2. Conventions

* All integers in the framing are **little-endian**. `u8` is one byte, `u32` four bytes.
* "JSON" is UTF-8, written canonically (keys sorted by code point, separators `,` and `:`, no
  spaces, non-ASCII characters left as UTF-8, one trailing line feed). Read it with any JSON
  parser; do not rely on the canonical form.
* Units, everywhere:
  * latitude and longitude are **integer microdegrees**, `degrees = value / 1_000_000`
    (`latE6`, `lonE6`), NAD83(CSRS) as published, treated as WGS84 for display;
  * along-chain distance `s` is **integer millimetres** from the chain's first vertex
    (`sMm`), `metres = sMm / 1000`;
  * mileposts (`mp`, `derivedMpStart`, `derivedMpEnd`) are **miles**, JSON numbers exactly as in
    the tiles (two decimals as published, or a computed float). They are never rounded here;
  * residuals (`residualMm`) are integer millimetres; `geoAccuracyM` is whole metres or `null`.
* Strings are compared by code point when this page says "sorted".
* Chain, anchor, interval and asset ids are opaque strings.

## 3. Layout

After gunzip, the bytes are, in order:

| # | Field | Size | Meaning |
|---|---|---|---|
| 1 | magic | 4 | the ASCII bytes `CNTS` |
| 2 | format version | `u8` | `1`. Refuse any other value. |
| 3 | meta length `M` | `u32` | byte length of the next field |
| 4 | meta | `M` | JSON object, section 4 |
| 5 | records length `R` | `u32` | byte length of the next field |
| 6 | records | `R` | JSON object, section 5 |
| 7 | geometry | to the end | varint stream, sections 6 and 7 |

There is no length for the geometry: it runs to the end of the decompressed data. A decoder must
check that it reads exactly the vertices the records announce and that **no bytes are left over**.
Offsets are `meta` at 9, `records` at `9 + M + 4`, `geometry` at `9 + M + 4 + R`.

Sizes must fit a `u32` (under 4 GiB); the pipeline refuses to write a larger section.

## 4. Meta

```
{
  "datasetVersion": "nrwn-national-3f9a1c2e+cantre.0.1.0",
  "snapshotDate": "2026-10-25",
  "attribution": "Contains information licensed under the Open Government Licence – Canada.",
  "packageVersions": { "ab": "2.0", "nl": "1.0", ... },
  "coverage": [[southE6, westE6, northE6, eastE6], ...]
}
```

* `datasetVersion`: the one version of this build. It equals the manifest's `datasetVersion` and
  is the string the matcher compares. The app should treat a snapshot whose version differs from
  the manifest's as corrupt.
* `snapshotDate`: `YYYY-MM-DD`, the vintage label shown to the user (the latest source retrieval
  date, or the date given to the build). It is not the build time.
* `attribution`: the OGL-Canada sentence to display.
* `packageVersions`: the NRWN package version of each province, by lower-case province code
  (`"2.0"` for most, `"1.0"` for NL, NT and YT). Provinces with no package (NU, PE) are absent.
* `coverage`: the tile cells the build covers, each `[south, west, north, east]` in integer
  microdegrees. A cell is **unbuffered** (the tile grid's own rectangle: 250 000 microdegrees of
  latitude by 500 000 of longitude). The list is sorted by `(south, west, north, east)` with no
  duplicates. A fix outside every cell is outside the data's coverage. A cell exists when its
  tile holds any chain piece, segment or asset (a tile also exists where only a 2 km margin of a
  neighbouring feature reaches it), so coverage says "data may be here", not "rail is here".

## 5. Records

An object with five arrays, in these key names. Every record is a **positional array**; the
position of each field is fixed, and a decoder maps them by position.

| Key | Record | Order |
|---|---|---|
| `chains` | `[id, subdivisionNid, subdivisionName, operators, cycle, trackClasses]` | by `id` |
| `segments` | `[key, trackClass, status, subdivisionNid, subdivisionName, operator, geoAccuracyM]` | by `key` |
| `anchors` | `[chainId, id, sMm, mp, source, tier]` | by `(chainId, sMm, id)` |
| `intervals` | `[id, chainId, anchorIds]` | by `id` |
| `assets` | `[id, kind, name, posted, positions, latE6, lonE6]` | by `id` |

Field types:

* `chains`
  * `id` string; `subdivisionNid`, `subdivisionName` strings;
  * `operators` array of strings (sorted);
  * `cycle` boolean: the chain is a closed loop (its last vertex equals its first);
  * `trackClasses` array of strings, sorted, unique: the track classes of the segments that make
    up the chain (for example `["Main"]`, `["Main", "Siding"]`).
* `segments`: only segments that belong to **no** chain (sidings, yards, spurs). Segments that
  make up a chain are not listed; they show up in the chain's `trackClasses`.
  * `geoAccuracyM` is a non-negative integer (metres, as the source states it) or `null`.
* `anchors`
  * `chainId` is the **chain id** the anchor lies on; `id` is unique **within a chain** only,
    so the key of an anchor is the pair `(chainId, id)`;
  * `sMm` integer millimetres along the chain; `mp` miles;
  * `source` one of `crossing`, `station`, `structure`, `markerpost`;
  * `tier` one of `posted`, `tc`, `unverified` (where the value comes from).
* `intervals`
  * `anchorIds` is an array of anchor ids on `chainId`, in the pipeline's order, at least two.
    Resolve each against `(chainId, anchorId)`. Mileposts run along the interval monotonically.
* `assets`
  * `kind` one of `crossing`, `bridge`, `moveableBridge`, `tunnel`, `culvert`, `station`,
    `diamond`; `name` a string or `null`;
  * `posted` is `null` or `[mp, subdivisionNid, tier]` (`mp` miles, `tier` as for anchors; an
    asset's value may be `unverified`);
  * `positions` is an array of `[chainId, sStartMm, sEndMm, residualMm, derivedMpStart,
    derivedMpEnd]`: where the asset lies along each chain it was placed on. `sStartMm <= sEndMm`
    (a point asset has them equal); `residualMm >= 0` is the distance from the asset to the
    chain, in millimetres (a residual, not an accuracy); `derivedMpStart` and `derivedMpEnd` are
    miles or `null` when the position is not inside a calibrated interval. A line asset's
    direction is not preserved;
  * `latE6` and `lonE6` are the asset's vertices as arrays of integers, **delta encoded exactly
    like the tiles**: the first value is absolute, every later value is the difference from the
    previous one. A point asset has one vertex. They are in the pipeline's canonical direction.
    This is the one place where the snapshot keeps the tile's delta form (the arrays are short);
    the chain and segment geometry use section 6 instead.

The asset's layer and its source attributes are **not** here: they are in the asset-details file
(section 8), fetched together with the snapshot.

## 6. Geometry stream

The geometry is a sequence of **zigzag LEB128 varints**, section 7. Every value is an integer.

For each chain, **in the order of `records.chains`**:

```
n                         vertex count (n >= 1)
then n triples:           dLat, dLon, dS
```

Then, for each segment **in the order of `records.segments`**:

```
n                         vertex count (n >= 1)
then n pairs:             dLat, dLon
```

Every delta is taken from the **previous vertex of the same chain or segment**, and the first
vertex is taken from 0 (so its delta is the absolute value). Decoding is a running sum:

```
lat[i] = lat[i-1] + dLat[i]      (lat[-1] = 0)      microdegrees
lon[i] = lon[i-1] + dLon[i]      (lon[-1] = 0)      microdegrees
sMm[i] = sMm[i-1] + dS[i]        (sMm[-1] = 0)      millimetres
```

`dLat` and `dLon` may be negative. `dS` is never negative (a chain only moves forward; an equal
value is a repeated vertex and is kept). `sMm[0]` of a chain is 0.

Chains are **whole**: the pipeline merges the tiles' overlapping pieces before writing, so there
is no `vertexStart` and no split chain. A chain is never joined to a chain of another province:
NRWN clips each province at its border, and a train crossing a border changes chain.

A decoder should reject a snapshot whose decoded vertex is outside |latitude| 90 or |longitude|
180 degrees, whose `sMm` decreases, or whose count `n` runs past the end of the data.

## 7. Varints

A value `v` is written in two steps.

1. **Zigzag** (signed to unsigned): `z = 2v` if `v >= 0`, else `z = -2v - 1`. So 0, -1, 1, -2, 2
   become 0, 1, 2, 3, 4.
2. **LEB128**: write `z` seven bits at a time, least significant group first. Every byte but the
   last has bit 7 set.

To decode: read bytes until one has bit 7 clear, put each byte's low 7 bits at positions
`0, 7, 14, ...` to rebuild `z`, then `v = z / 2` if `z` is even, else `v = -(z + 1) / 2`.

**Limits.** A value must satisfy `-2^52 <= v <= 2^52 - 1`; then `z < 2^53` and the varint is at most
8 bytes. That is the range a JavaScript `Number` holds exactly, so a decoder written with `Number`
arithmetic is exact. **Do not use 32-bit bit operators** (`<<`, `|`, `>>`); they truncate. Use
multiplication and addition (`z += (b & 0x7f) * 2 ** shift`) and `Math.floor`. A varint longer than
8 bytes, or one that is cut off by the end of the data, is an error. Real values are far inside
the range: a microdegree delta is under 2^28 and a millimetre delta along a chain is under 2^34.

Worked values:

| v | bytes (hex) |
|---|---|
| 0 | `00` |
| -1 | `01` |
| 1 | `02` |
| -2 | `03` |
| 150 | `ac 02` |
| 52 100 000 | `c0 ee d7 31` |
| -105 900 000 | `bf 9f ff 64` |
| 2^31 | `80 80 80 80 10` |
| -2^31 | `ff ff ff ff 0f` |
| 2^52 - 1 | `fe ff ff ff ff ff ff 0f` |
| -2^52 | `ff ff ff ff ff ff ff 0f` |

A chain `(52.100000, -105.900000, 0 mm)` then `(52.100010, -105.899000, 700 mm)` is the stream of
values `2, 52100000, -105900000, 0, 10, 1000, 700`, in bytes:

```
04  c0 ee d7 31  bf 9f ff 64  00     n = 2; vertex 0: lat, lon, s
14  d0 0f  f8 0a                     vertex 1: dLat = 10, dLon = 1000, dS = 700
```

## 8. Asset details, `asset-details.json.gz`

gzip of one canonical JSON object keyed by asset id, sorted by id, with every asset of the
snapshot:

```
{ "<assetId>": { "layer": "CROSSING", "attrs": { "<NRWN field>": "<string>", ... } }, ... }
```

* `layer` is the NRWN layer the asset came from (`CROSSING`, `STATION`, `STRUCTURE_0`,
  `STRUCTURE_1`, `JUNCTION`);
* `attrs` maps source field names to the source's text, as published (stripped strings), for
  display.

It is downloaded with the snapshot (the app never fetches one asset at a time, because that would
reveal which asset the user is near). The ids are exactly the ids in `records.assets`.

## 9. The manifest's entry for these files

`manifest.json` (`cantre.manifest/1`, `manifest.schema.json`) carries, for a national build:

```
"snapshot":     { "path": "snapshot.bin.gz",        "sha256": "...", "bytes": N, "gzipBytes": N },
"assetDetails": { "path": "asset-details.json.gz",  "sha256": "...", "bytes": N, "gzipBytes": N },
"snapshotDate": "2026-10-25",
"tiles": []
```

* `sha256` is the SHA-256 (64 lower-case hex characters) of the **file at `path` exactly as
  served**, that is of the gzip bytes. Check it before decompressing; a mismatch or a short file
  means the download is damaged and must not be decoded.
* `gzipBytes` is the size of that file; `bytes` is the size after gunzip.
* `tiles` is empty: tiles are built and size-checked by the pipeline but not deployed.
* `path` is relative to the manifest's own URL.

## 10. Order, determinism and limits

* Records are in the orders of section 5; the geometry follows the `chains` then `segments`
  order, so a given set of tiles always gives the same bytes.
* The pipeline merges by id. An id that appears in two provinces must describe byte-equal data
  (it is then kept once, for example a Transport Canada crossing at a border) or the build fails.
* The geometry holds integers only; mileposts in the records are the tiles' own numbers and are
  not rounded. The M2 precision is kept: microdegrees (about 0.11 m) and millimetres.
* Nothing is interpolated, extended or bridged. A gap in a chain, a border, or the end of
  coverage is a gap. A small residual or a matching milepost says nothing about survey accuracy.
* Format version 1 has no extension points: a different layout must use a different version.
