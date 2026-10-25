import { readFileSync } from 'node:fs';
import type { CacheStorageLike, ClientEnv } from '@cantre/data-client';

/**
 * Test-only: an in-memory Cache Storage and a fake `fetch`, over the committed national golden
 * bundle, so the app's offline logic can run against the real data client.
 */
const GOLDEN = new URL('../../../pipeline/tests/golden/synthetic/national/', import.meta.url);

export type Bundle = {
  readonly manifest: Record<string, unknown> & {
    datasetVersion: string;
    snapshotDate: string;
    snapshot: { path: string };
    assetDetails: { path: string };
  };
  readonly snapshot: Uint8Array;
  readonly assetDetails: Uint8Array;
};

const bytes = (file: string): Uint8Array => new Uint8Array(readFileSync(new URL(file, GOLDEN)));

/** The golden national build: its manifest object and the two data files. */
export function goldenBundle(): Bundle {
  return {
    manifest: JSON.parse(new TextDecoder().decode(bytes('manifest.json'))) as Bundle['manifest'],
    snapshot: bytes('snapshot.bin.gz'),
    assetDetails: bytes('asset-details.json.gz'),
  };
}

export const BASE = 'https://app.example.test/data/';

/** A fetch that serves `files` (path under BASE to bytes) and records every URL asked for. */
export function fakeServer(
  manifest: unknown,
  files: Readonly<Record<string, Uint8Array>>,
): { fetch: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const fn = (input: Parameters<typeof fetch>[0]): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    urls.push(url);
    const path = url.slice(BASE.length);
    if (path === 'manifest.json') {
      return Promise.resolve(new Response(JSON.stringify(manifest)));
    }
    const body = files[path];
    return Promise.resolve(
      body === undefined ? new Response('no', { status: 404 }) : new Response(body.slice()),
    );
  };
  return { fetch: fn, urls };
}

/** An in-memory Cache Storage (names to key to bytes). */
export function memoryCaches(): CacheStorageLike {
  const stores = new Map<string, Map<string, { bytes: Uint8Array; type: string }>>();
  return {
    open: (name) => {
      const store = stores.get(name) ?? new Map<string, { bytes: Uint8Array; type: string }>();
      stores.set(name, store);
      return Promise.resolve({
        put: async (key, response) => {
          store.set(key, {
            bytes: new Uint8Array(await response.arrayBuffer()),
            type: response.headers.get('content-type') ?? '',
          });
        },
        match: (key) => {
          const hit = store.get(key);
          return Promise.resolve(
            hit === undefined
              ? undefined
              : new Response(hit.bytes.slice(), { headers: { 'content-type': hit.type } }),
          );
        },
        delete: (key) => Promise.resolve(store.delete(key)),
      });
    },
    keys: () => Promise.resolve([...stores.keys()]),
    delete: (name) => Promise.resolve(stores.delete(name)),
  };
}

export const envOf = (f: typeof fetch, caches: CacheStorageLike): Partial<ClientEnv> => ({
  fetch: f,
  caches,
});
