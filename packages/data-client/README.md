# @cantre/data-client

Downloads, verifies, caches and loads the national CANTRE snapshot in the browser. It has no
third-party dependencies; it uses `fetch`, Cache Storage, Web Crypto (`crypto.subtle`) and
`DecompressionStream` from the browser, and `@cantre/core` for the decoder.

Research code. The data are mostly 2016 vintage, not surveyed, and carry no safety guarantee.

## What it does

| Export | Does |
|---|---|
| `fetchManifest(baseUrl)` | GET `<baseUrl>/manifest.json`, checks it is a national `cantre.manifest/1` |
| `downloadSnapshot(baseUrl, manifest, onProgress?)` | GET the snapshot and the asset-details file, checks each size and SHA-256, then stores both under `cantre-data-<datasetVersion>` and deletes older versions |
| `installedSnapshot()` | `{ datasetVersion, snapshotDate, bytes }` of what is stored, or `null` (reads no data file) |
| `loadNetwork()` | re-checks the stored hashes, gunzips, calls `networkFromSnapshot`; returns `{ net, details, datasetVersion, snapshotDate, attribution, gunzipMs, decodeMs }` |
| `removeSnapshot()` | deletes every stored version |
| `DataClientError` | codes `MANIFEST_INVALID`, `FETCH_FAILED`, `HASH_MISMATCH`, `NOT_INSTALLED` |

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
- **Old data stays.** A new version is stored completely, with the manifest entry last, before
  any other version is deleted. A failed download or a refused write leaves the previous version
  in use. Limit: re-installing the version already installed overwrites it in place, so a
  failure part-way through leaves that version not installed (it is then reported as
  `NOT_INSTALLED`, never decoded half-written).
- **Hash is of the bytes as served.** The SHA-256 in the manifest is of the gzip file. A host that
  adds `Content-Encoding: gzip` to a `.gz` file makes the browser unzip it before the client sees
  it, and the hash check then fails; serve the files as plain `application/gzip` downloads.

Layout of the files: [snapshot.md](../../pipeline/schema/snapshot.md).
