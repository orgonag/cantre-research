import { DataClientError, errorText } from './errors.js';
import { parseManifest } from './manifest.js';
import type { Manifest } from './manifest.js';

/**
 * The installed snapshot, kept in the browser's Cache Storage.
 *
 * One cache per dataset version, named `cantre-data-<datasetVersion>`, holds three entries under
 * fixed keys: the two data files exactly as downloaded (gzip) and the manifest they were checked
 * against. The manifest is written LAST, so an entry set without a manifest is a half-written
 * install and is ignored (and never decoded). Only the data files and their manifest are kept:
 * no fix, trace or user data ever goes in this cache.
 *
 * Replacement rule: a new version is written completely before any other version is deleted, so
 * a failed install leaves the previous one in place. Limit: re-installing the SAME version
 * overwrites in place (there is only one cache of that name), so a failure part-way through
 * leaves that version without a manifest, that is, not installed.
 */

/** The slice of the `Cache` interface used here (the real `Cache` satisfies it). */
export type CacheLike = {
  put(key: string, response: Response): Promise<void>;
  match(key: string): Promise<Response | undefined>;
  delete(key: string): Promise<boolean>;
};

/** The slice of `CacheStorage` used here (the real `caches` satisfies it). */
export type CacheStorageLike = {
  open(name: string): Promise<CacheLike>;
  keys(): Promise<string[]>;
  delete(name: string): Promise<boolean>;
};

/** Every cache this package owns starts with this. Caches with other names are never touched. */
export const CACHE_PREFIX = 'cantre-data-';

/** Cache entry keys. They are only keys: nothing is ever fetched from them. */
const KEYS = {
  manifest: 'https://cantre.invalid/data/manifest.json',
  snapshot: 'https://cantre.invalid/data/snapshot.bin.gz',
  assetDetails: 'https://cantre.invalid/data/asset-details.json.gz',
} as const;

/** The cache name for a dataset version. */
export function cacheName(datasetVersion: string): string {
  return `${CACHE_PREFIX}${datasetVersion}`;
}

/**
 * What is installed: the manifest the files were verified against, and the two stored files
 * (responses whose bodies are not read until {@link readFiles}).
 */
export type Installed = {
  readonly manifest: Manifest;
  readonly snapshot: Response;
  readonly assetDetails: Response;
};

/** The gzip bytes of an install. */
export type InstalledFiles = {
  readonly snapshotGz: Uint8Array;
  readonly assetDetailsGz: Uint8Array;
};

function asResponse(bytes: Uint8Array, type: string): Response {
  return new Response(bytes, {
    headers: { 'content-type': type, 'content-length': String(bytes.length) },
  });
}

/** The manifest as stored: the same shape `parseManifest` reads, so it round-trips. */
function manifestBytes(m: Manifest): Uint8Array {
  const provinces = Object.fromEntries(
    Object.entries(m.packageVersions).map(([code, packageVersion]) => [code, { packageVersion }]),
  );
  return new TextEncoder().encode(JSON.stringify({ ...m, packageVersions: undefined, provinces }));
}

/** True when `a` is a better install than `b`: later snapshot date, then later dataset version. */
function newer(a: Manifest, b: Manifest): boolean {
  if (a.snapshotDate !== b.snapshotDate) {
    return a.snapshotDate > b.snapshotDate;
  }
  return a.datasetVersion > b.datasetVersion;
}

/**
 * The best complete install, or null. A cache counts only if its manifest parses and all three
 * entries exist. If several are complete (a crash between storing a new version and deleting the
 * old), the one with the later `snapshotDate`, then the later `datasetVersion`, wins.
 */
export async function findInstalled(
  storage: CacheStorageLike,
  excluded: ReadonlySet<string> = new Set(),
): Promise<Installed | null> {
  let best: Installed | null = null;
  for (const name of await storage.keys()) {
    if (!name.startsWith(CACHE_PREFIX) || excluded.has(name)) {
      continue;
    }
    const cache = await storage.open(name);
    const [manifestRes, snapshotRes, detailsRes] = await Promise.all([
      cache.match(KEYS.manifest),
      cache.match(KEYS.snapshot),
      cache.match(KEYS.assetDetails),
    ]);
    if (manifestRes === undefined || snapshotRes === undefined || detailsRes === undefined) {
      continue;
    }
    let manifest: Manifest;
    try {
      manifest = parseManifest(await manifestRes.json());
    } catch {
      continue;
    }
    if (excluded.has(cacheName(manifest.datasetVersion))) continue;
    if (best === null || newer(manifest, best.manifest)) {
      best = { manifest, snapshot: snapshotRes, assetDetails: detailsRes };
    }
  }
  return best;
}

/** Reads the two stored files of an install. */
export async function readFiles(installed: Installed): Promise<InstalledFiles> {
  try {
    return {
      snapshotGz: new Uint8Array(await installed.snapshot.arrayBuffer()),
      assetDetailsGz: new Uint8Array(await installed.assetDetails.arrayBuffer()),
    };
  } catch (error) {
    throw new DataClientError('FETCH_FAILED', `cached data could not be read: ${errorText(error)}`);
  }
}

/**
 * Stores a verified download, then deletes every other version. Order: data files, manifest
 * (last), then the old caches. If storing fails (for example the browser's storage quota), the
 * new cache is removed when it did not exist before and the error is `FETCH_FAILED`; older
 * versions are not touched.
 */
export async function install(
  storage: CacheStorageLike,
  manifest: Manifest,
  files: InstalledFiles,
): Promise<void> {
  const name = cacheName(manifest.datasetVersion);
  const existed = (await storage.keys()).includes(name);
  try {
    const cache = await storage.open(name);
    if (existed) {
      await cache.delete(KEYS.manifest); // mark the in-place overwrite as incomplete
    }
    await cache.put(KEYS.snapshot, asResponse(files.snapshotGz, 'application/gzip'));
    await cache.put(KEYS.assetDetails, asResponse(files.assetDetailsGz, 'application/gzip'));
    await cache.put(KEYS.manifest, asResponse(manifestBytes(manifest), 'application/json'));
  } catch (e) {
    if (!existed) {
      try {
        await storage.delete(name);
      } catch {
        // Best effort: the storing error below is the one worth reporting.
      }
    }
    throw new DataClientError(
      'FETCH_FAILED',
      `could not store the data in this browser: ${errorText(e)}`,
    );
  }
  for (const other of await storage.keys()) {
    if (other.startsWith(CACHE_PREFIX) && other !== name) {
      await storage.delete(other);
    }
  }
}

/** Deletes every installed version ("Remove data"). Other caches are left alone. */
export async function removeAll(storage: CacheStorageLike): Promise<void> {
  for (const name of await storage.keys()) {
    if (name.startsWith(CACHE_PREFIX)) {
      await storage.delete(name);
    }
  }
}
