# @cantre/data-client

Downloads, verifies, caches and loads the national CANTRE snapshot in the browser. It has no
third-party dependencies; it uses `fetch`, Cache Storage, Web Crypto (`crypto.subtle`) and
`DecompressionStream` from the browser, and `@cantre/core` for the decoder.

Research code. The data are mostly 2016 vintage, not surveyed, and carry no safety guarantee.

## What it does

| Export | Does |
|---|---|
| `fetchManifest(baseUrl)` | GET `<baseUrl>/manifest.json`, checks it is a national `cantre.manifest/1` |
| `downloadSnapshot(baseUrl, manifest, onProgress?)` | refuses a `snapshotFormat` it cannot decode, GETs the snapshot and the asset-details file, checks each size and SHA-256, decodes both, then stores both under `cantre-data-<datasetVersion>` and deletes older versions |
| `installedSnapshot()` | `{ datasetVersion, snapshotDate, bytes }` of what is stored, or `null` (reads no data file) |
| `loadNetwork()` | re-checks the stored hashes, gunzips, calls `networkFromSnapshot`; returns `{ net, details, datasetVersion, snapshotDate, attribution, gunzipMs, decodeMs }` |
| `removeSnapshot()` | deletes every stored version |
| `DataClientError` | codes `MANIFEST_INVALID`, `FETCH_FAILED`, `HASH_MISMATCH`, `NOT_INSTALLED`, `UNSUPPORTED_FORMAT` |

Each function takes an optional last argument `{ fetch, caches }` to replace the browser's, for
tests.

## Guarantees

- **Privacy.** Only three files are ever requested: the manifest, the snapshot and the
  asset-details file, at `baseUrl` plus the manifest's plain relative paths. No query string, no
  cookies, no referrer, and no coordinates or user data anywhere. Everyone downloads the same
  files, so the host learns nothing about where anyone is. Nothing about a fix is stored.
- **Integrity.** A body that is shorter or longer than the manifest's `gzipBytes`, or whose stream
  errors, is rejected before hashing. A body whose SHA-256 is not the manifest's is rejected
  before storing. Neither is ever decoded.
- **Only data this app can read is installed.** A manifest whose `snapshotFormat` is not the
  layout this decoder reads is refused with `UNSUPPORTED_FORMAT` before any request. Files that
  pass their hash are decoded in full before they are stored; a snapshot that does not decode
  (`INVALID_SNAPSHOT`) is never stored and the previous version stays. Cost: a download decodes
  the snapshot twice (once to check, once in `loadNetwork`), a median of 0.71 s more per new build in
  Node 22 on a desktop for the national snapshot; no phone has been measured.
- **Old data stays.** A new version is stored completely, with the manifest entry last, before
  any other version is deleted. A failed download or a refused write leaves the previous version
  in use. Limit: re-installing the version already installed overwrites it in place, so a
  failure part-way through leaves that version not installed (it is then reported as
  `NOT_INSTALLED`, never decoded half-written).
- **Hash is of the bytes as served.** The SHA-256 in the manifest is of the gzip file. A host that
  adds `Content-Encoding: gzip` to a `.gz` file makes the browser unzip it before the client sees
  it, and the hash check then fails; serve the files as plain `application/gzip` downloads.

Layout of the files: [snapshot.md](../../pipeline/schema/snapshot.md).
