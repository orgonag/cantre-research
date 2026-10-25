import { CoreInputError, networkFromSnapshot } from '@cantre/core';
import type { NetworkView } from '@cantre/core';
import { DataClientError, errorText } from './errors.js';
import { parseManifest } from './manifest.js';
import type { FileRef, Manifest } from './manifest.js';
import { findInstalled, install, readFiles, removeAll } from './store.js';
import type { CacheStorageLike } from './store.js';

/**
 * Downloads, verifies, caches and loads the national snapshot (M4 decision D1).
 *
 * Privacy: the client makes exactly three kinds of request, all GET, with no cookies, no
 * referrer and no query string: the manifest, the snapshot and the asset-details file, at
 * `baseUrl` + the manifest's file paths. The URLs contain nothing about the user or where they
 * are; the same files go to everyone. No fix, position or trace is read, sent or stored here.
 *
 * Integrity: a file is checked against the manifest's size and SHA-256 BEFORE it is stored and
 * before it is decoded. A short, long, interrupted or tampered download is rejected and the
 * previously installed version stays in use.
 */

/** The browser (or test) services the client uses. Defaults to the globals at call time. */
export type ClientEnv = {
  readonly fetch: typeof fetch;
  readonly caches: CacheStorageLike | undefined;
};

/** Download progress: bytes received so far over both files, and the total to receive. */
export type DownloadProgress = {
  readonly file: 'snapshot' | 'assetDetails';
  readonly receivedBytes: number;
  readonly totalBytes: number;
};

/** Source attributes of every asset, by asset id, for display when an asset is tapped. */
export type AssetDetails = Readonly<
  Record<string, { readonly layer: string; readonly attrs: Readonly<Record<string, string>> }>
>;

/** What `installedSnapshot` reports. `bytes` is the gzip size stored on the device (both files). */
export type InstalledSnapshot = {
  readonly datasetVersion: string;
  readonly snapshotDate: string;
  readonly bytes: number;
};

/** The loaded data. Times are milliseconds. */
export type LoadedNetwork = {
  readonly net: NetworkView;
  readonly details: AssetDetails;
  readonly datasetVersion: string;
  readonly snapshotDate: string;
  readonly attribution: string;
  /** Time to gunzip the snapshot. */
  readonly gunzipMs: number;
  /** Time spent in `networkFromSnapshot`. */
  readonly decodeMs: number;
};

const REQUEST_INIT: RequestInit = {
  method: 'GET',
  cache: 'no-cache', // revalidate, so a rebuilt file is seen
  credentials: 'omit',
  referrerPolicy: 'no-referrer',
};

function envOf(env: Partial<ClientEnv> | undefined): ClientEnv {
  const g = globalThis as { caches?: CacheStorageLike };
  return {
    fetch: env?.fetch ?? globalThis.fetch.bind(globalThis),
    caches: env !== undefined && 'caches' in env ? env.caches : g.caches,
  };
}

function storageOf(env: ClientEnv): CacheStorageLike {
  if (env.caches === undefined) {
    throw new DataClientError('FETCH_FAILED', 'this browser has no Cache Storage');
  }
  return env.caches;
}

/** `baseUrl` + `path`, as one URL. `baseUrl` may lack a trailing slash. */
function urlFor(baseUrl: string, path: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const page = (globalThis as { location?: { href?: string } }).location?.href;
  try {
    return new URL(path, new URL(base, page)).href;
  } catch {
    throw new DataClientError('FETCH_FAILED', 'the data address is not a valid URL');
  }
}

async function get(env: ClientEnv, url: string): Promise<Response> {
  let res: Response;
  try {
    res = await env.fetch(url, REQUEST_INIT);
  } catch (e) {
    throw new DataClientError('FETCH_FAILED', `request failed: ${errorText(e)}`);
  }
  if (!res.ok) {
    throw new DataClientError('FETCH_FAILED', `the server answered ${String(res.status)}`);
  }
  return res;
}

/**
 * Fetches and validates the manifest at `<baseUrl>/manifest.json`.
 * Throws `FETCH_FAILED` (no answer, or not a success status) or `MANIFEST_INVALID`.
 */
export async function fetchManifest(baseUrl: string, env?: Partial<ClientEnv>): Promise<Manifest> {
  const res = await get(envOf(env), urlFor(baseUrl, 'manifest.json'));
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new DataClientError('MANIFEST_INVALID', 'manifest: not valid JSON');
  }
  return parseManifest(json);
}

/**
 * Reads a response body to the end, counting bytes, and rejects it unless it is exactly
 * `ref.gzipBytes` long. A stream that errors, ends early or runs long throws `FETCH_FAILED`
 * here, before anything is hashed or stored.
 */
async function readBody(
  res: Response,
  ref: FileRef,
  onChunk: (n: number) => void,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let received = 0;
  const take = (chunk: Uint8Array): void => {
    received += chunk.length;
    if (received > ref.gzipBytes) {
      throw new DataClientError('FETCH_FAILED', `${ref.path} is longer than the manifest says`);
    }
    chunks.push(chunk);
    onChunk(chunk.length);
  };
  try {
    if (res.body === null) {
      take(new Uint8Array(await res.arrayBuffer()));
    } else {
      const reader = res.body.getReader();
      for (;;) {
        const chunk = (await reader.read()) as ReadResult;
        if (chunk.done) {
          break;
        }
        try {
          take(chunk.value);
        } catch (e) {
          await reader.cancel(); // stop the download; the error below is what the caller sees
          throw e;
        }
      }
    }
  } catch (e) {
    if (e instanceof DataClientError) {
      throw e;
    }
    throw new DataClientError(
      'FETCH_FAILED',
      `download of ${ref.path} was interrupted: ${errorText(e)}`,
    );
  }
  if (received !== ref.gzipBytes) {
    throw new DataClientError(
      'FETCH_FAILED',
      `${ref.path} is incomplete: ${String(received)} of ${String(ref.gzipBytes)} bytes`,
    );
  }
  const out = new Uint8Array(received);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** One `reader.read()` result: a chunk, or the end. */
type ReadResult = { done: true; value?: undefined } | { done: false; value: Uint8Array };

/** Lower-case hex SHA-256 of `bytes` (Web Crypto; needs a secure context). */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = (globalThis as { crypto?: { subtle?: Subtle } }).crypto?.subtle;
  if (subtle === undefined) {
    throw new DataClientError('FETCH_FAILED', 'SHA-256 is not available here (needs HTTPS)');
  }
  const digest = await subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Throws `HASH_MISMATCH` unless the SHA-256 of `bytes` is the manifest's. */
async function verify(bytes: Uint8Array, ref: FileRef): Promise<void> {
  if ((await sha256Hex(bytes)) !== ref.sha256) {
    throw new DataClientError('HASH_MISMATCH', `${ref.path} does not match the manifest`);
  }
}

/**
 * Downloads the snapshot and the asset-details file named by `manifest`, verifies both, and only
 * then stores them in Cache Storage (`cantre-data-<datasetVersion>`). Older versions are deleted
 * after the new one is fully stored, so a failure at any point leaves the previous install in
 * use. The snapshot is fetched and checked first, so a bad snapshot costs no second download.
 *
 * `onProgress` gets the running total of gzip bytes received over both files.
 * Errors: `FETCH_FAILED` (request failure, non-2xx status, interrupted, short or long body, no
 * Cache Storage or SHA-256, or the browser refused to store), `HASH_MISMATCH`.
 * Limit: re-installing the version already installed overwrites it in place (see store.ts).
 */
export async function downloadSnapshot(
  baseUrl: string,
  manifest: Manifest,
  onProgress?: (p: DownloadProgress) => void,
  env?: Partial<ClientEnv>,
): Promise<void> {
  const e = envOf(env);
  const storage = storageOf(e);
  const totalBytes = manifest.snapshot.gzipBytes + manifest.assetDetails.gzipBytes;
  let receivedBytes = 0;
  const fetchOne = async (file: 'snapshot' | 'assetDetails'): Promise<Uint8Array> => {
    const ref = manifest[file];
    const res = await get(e, urlFor(baseUrl, ref.path));
    const bytes = await readBody(res, ref, (n) => {
      receivedBytes += n;
      onProgress?.({ file, receivedBytes, totalBytes });
    });
    await verify(bytes, ref);
    return bytes;
  };
  const snapshotGz = await fetchOne('snapshot');
  const assetDetailsGz = await fetchOne('assetDetails');
  await install(storage, manifest, { snapshotGz, assetDetailsGz });
}

/** What is installed (dataset version, date, stored size), or null. Reads no data file. */
export async function installedSnapshot(
  env?: Partial<ClientEnv>,
): Promise<InstalledSnapshot | null> {
  const e = envOf(env);
  if (e.caches === undefined) {
    return null;
  }
  const found = await findInstalled(e.caches);
  if (found === null) {
    return null;
  }
  const { manifest } = found;
  return {
    datasetVersion: manifest.datasetVersion,
    snapshotDate: manifest.snapshotDate,
    bytes: manifest.snapshot.gzipBytes + manifest.assetDetails.gzipBytes,
  };
}

/** Deletes every installed version ("Remove data"). */
export async function removeSnapshot(env?: Partial<ClientEnv>): Promise<void> {
  const e = envOf(env);
  if (e.caches !== undefined) {
    await removeAll(e.caches);
  }
}

/** Gunzips with the browser's (or Node's) `DecompressionStream`. */
async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  try {
    const stream = new Blob([bytes as Uint8Array<ArrayBuffer>])
      .stream()
      .pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch (e) {
    throw new CoreInputError(
      'INVALID_SNAPSHOT',
      `byte 0: the data is not valid gzip (${errorText(e)})`,
    );
  }
}

/** Parses and checks the asset-details JSON: `{ id: { layer: string, attrs: {string: string} } }`. */
function parseDetails(json: unknown): AssetDetails {
  const bad = (what: string): never => {
    throw new CoreInputError('INVALID_SNAPSHOT', `byte 0: asset-details: ${what}`);
  };
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return bad('not an object');
  }
  for (const [id, d] of Object.entries(json)) {
    const entry = d as { layer?: unknown; attrs?: unknown } | null;
    if (typeof entry !== 'object' || entry === null || typeof entry.layer !== 'string') {
      return bad(`${id}: no layer`);
    }
    const attrs = entry.attrs;
    if (
      typeof attrs !== 'object' ||
      attrs === null ||
      Array.isArray(attrs) ||
      Object.values(attrs).some((v) => typeof v !== 'string')
    ) {
      return bad(`${id}: attrs is not a map of strings`);
    }
  }
  return json as AssetDetails;
}

/**
 * Loads the installed snapshot: re-checks both stored files against the manifest's SHA-256
 * (a damaged cache entry is `HASH_MISMATCH` and is never decoded), gunzips the snapshot with
 * `DecompressionStream('gzip')`, calls `networkFromSnapshot`, and parses the asset details.
 * `decodeMs` is the time inside `networkFromSnapshot`; `gunzipMs` the unzip. Nothing is
 * downloaded.
 *
 * Errors: `NOT_INSTALLED`; `HASH_MISMATCH`; `CoreInputError('INVALID_SNAPSHOT')` for bytes that
 * hash correctly but do not decode, or a snapshot whose `datasetVersion` differs from the
 * manifest's (the manifest says which build the files belong to, so a difference is corruption).
 */
export async function loadNetwork(env?: Partial<ClientEnv>): Promise<LoadedNetwork> {
  const e = envOf(env);
  const storage = storageOf(e);
  const installed = await findInstalled(storage);
  if (installed === null) {
    throw new DataClientError('NOT_INSTALLED', 'no snapshot is installed');
  }
  const { manifest } = installed;
  const files = await readFiles(installed);
  await verify(files.snapshotGz, manifest.snapshot);
  await verify(files.assetDetailsGz, manifest.assetDetails);

  const g0 = performance.now();
  const bytes = await gunzip(files.snapshotGz);
  const gunzipMs = performance.now() - g0;
  const t0 = performance.now();
  const net = networkFromSnapshot(bytes);
  const decodeMs = performance.now() - t0;
  if (net.datasetVersion !== manifest.datasetVersion) {
    throw new CoreInputError(
      'INVALID_SNAPSHOT',
      `byte 0: snapshot datasetVersion '${net.datasetVersion}' differs from the manifest's '${manifest.datasetVersion}'`,
    );
  }
  let detailsJson: unknown;
  try {
    detailsJson = JSON.parse(
      new TextDecoder().decode(await gunzip(files.assetDetailsGz)),
    ) as unknown;
  } catch (err) {
    if (err instanceof CoreInputError) {
      throw err;
    }
    throw new CoreInputError('INVALID_SNAPSHOT', 'byte 0: asset-details: not valid JSON');
  }
  return {
    net,
    details: parseDetails(detailsJson),
    datasetVersion: manifest.datasetVersion,
    snapshotDate: manifest.snapshotDate,
    attribution: manifest.attribution,
    gunzipMs,
    decodeMs,
  };
}

/** The one `SubtleCrypto` method used (the DOM `SubtleCrypto` type is not in this package's libs). */
type Subtle = { digest(algorithm: string, data: Uint8Array<ArrayBuffer>): Promise<ArrayBuffer> };
