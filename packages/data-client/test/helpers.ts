/**
 * Test doubles for the data client: a fake `fetch` that serves in-memory files (and can fail,
 * truncate or tamper on demand), a fake `CacheStorage`, and the committed golden bundles.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { networkFromSnapshot } from '@cantre/core';
import type { CacheLike, CacheStorageLike } from '../src/index.js';

export const BASE = 'https://data.example.test/cantre/';

const GOLDEN = new URL('../../../pipeline/tests/golden/synthetic/', import.meta.url);
const read = (rel: string): Uint8Array => new Uint8Array(readFileSync(new URL(rel, GOLDEN)));

/** One published build: the manifest object and the bytes of the two data files. */
export type Bundle = {
  manifest: Record<string, unknown> & {
    datasetVersion: string;
    snapshot: { path: string; sha256: string; bytes: number; gzipBytes: number };
    assetDetails: { path: string; sha256: string; bytes: number; gzipBytes: number };
  };
  snapshot: Uint8Array;
  assetDetails: Uint8Array;
};

/** Version A: the two-fake-province national build (SK plus a border-east AB chain). */
export function bundleA(): Bundle {
  return {
    manifest: JSON.parse(
      new TextDecoder().decode(read('national/manifest.json')),
    ) as Bundle['manifest'],
    snapshot: read('national/snapshot.bin.gz'),
    assetDetails: read('national/asset-details.json.gz'),
  };
}

/**
 * Version B: the single-network golden snapshot under its own dataset version, with a manifest
 * written to match (sizes and hashes computed here, not copied).
 */
export function bundleB(): Bundle {
  const a = bundleA();
  const snapshot = read('snapshot.bin.gz');
  const raw = new Uint8Array(gunzipSync(snapshot));
  const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
  return {
    manifest: {
      ...a.manifest,
      datasetVersion: networkFromSnapshot(raw).datasetVersion,
      snapshotDate: '2026-12-31',
      snapshot: {
        path: 'snapshot.bin.gz',
        sha256: sha(snapshot),
        bytes: raw.length,
        gzipBytes: snapshot.length,
      },
    },
    snapshot,
    assetDetails: a.assetDetails,
  };
}

/** What the fake server does with one file. */
export type Served = {
  body: Uint8Array;
  status?: number;
  /** End the stream cleanly after this many bytes (a short download). */
  truncateTo?: number;
  /** Error the stream after this many bytes (a dropped connection). */
  errorAfter?: number;
  /** Append this many extra bytes (a long download). */
  extra?: number;
};

export type FakeFetch = typeof fetch & {
  readonly requests: { url: string; init: RequestInit | undefined }[];
};

/** A fake `fetch` over `files`, keyed by absolute URL. Anything else is a 404. */
export function fakeFetch(files: Record<string, Served>): FakeFetch {
  const requests: { url: string; init: RequestInit | undefined }[] = [];
  const fn = (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    requests.push({ url, init });
    const f = files[url];
    if (f === undefined) {
      return Promise.resolve(new Response('not found', { status: 404 }));
    }
    if (f.status !== undefined && f.status !== 200) {
      return Promise.resolve(new Response('error', { status: f.status }));
    }
    const full =
      f.extra === undefined ? f.body : Uint8Array.from([...f.body, ...new Uint8Array(f.extra)]);
    const send = f.truncateTo ?? f.errorAfter ?? full.length;
    let at = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (at >= send) {
          if (f.errorAfter === undefined) {
            controller.close();
          } else {
            controller.error(new Error('connection reset'));
          }
          return;
        }
        const next = Math.min(at + 700, send);
        controller.enqueue(full.slice(at, next));
        at = next;
      },
    });
    return Promise.resolve(new Response(stream, { status: 200 }));
  };
  return Object.assign(fn, { requests });
}

/** Serves a bundle (manifest, snapshot, details) at `BASE`, with per-file overrides. */
export function serve(
  bundle: Bundle,
  over: {
    snapshot?: Partial<Served>;
    assetDetails?: Partial<Served>;
    manifest?: Partial<Served>;
  } = {},
): Record<string, Served> {
  return {
    [`${BASE}manifest.json`]: {
      body: new TextEncoder().encode(JSON.stringify(bundle.manifest)),
      ...over.manifest,
    },
    [`${BASE}${bundle.manifest.snapshot.path}`]: { body: bundle.snapshot, ...over.snapshot },
    [`${BASE}${bundle.manifest.assetDetails.path}`]: {
      body: bundle.assetDetails,
      ...over.assetDetails,
    },
  };
}

/** An in-memory `CacheStorage`. `failPutAfter` makes the n-th and later `put` calls reject. */
export class FakeCacheStorage implements CacheStorageLike {
  readonly stores = new Map<string, Map<string, { bytes: Uint8Array; type: string }>>();
  puts = 0;
  failPutAfter = Number.POSITIVE_INFINITY;
  /** Makes `delete` of a whole cache reject. */
  deleteFails = false;

  open(name: string): Promise<CacheLike> {
    const store = this.stores.get(name) ?? new Map<string, { bytes: Uint8Array; type: string }>();
    this.stores.set(name, store);
    return Promise.resolve({
      put: (key: string, response: Response): Promise<void> => {
        this.puts += 1;
        if (this.puts > this.failPutAfter) {
          return Promise.reject(new Error('QuotaExceededError'));
        }
        return response.arrayBuffer().then((buf) => {
          store.set(key, {
            bytes: new Uint8Array(buf),
            type: response.headers.get('content-type') ?? '',
          });
        });
      },
      match: (key: string): Promise<Response | undefined> => {
        const hit = store.get(key);
        return Promise.resolve(
          hit === undefined
            ? undefined
            : new Response(hit.bytes.slice(), { headers: { 'content-type': hit.type } }),
        );
      },
      delete: (key: string): Promise<boolean> => {
        return Promise.resolve(store.delete(key));
      },
    });
  }

  /** Copies every cache of `other` in, as if a second install had landed in this storage. */
  adopt(other: FakeCacheStorage): void {
    for (const [name, store] of other.stores) {
      this.stores.set(name, store);
    }
  }

  keys(): Promise<string[]> {
    return Promise.resolve([...this.stores.keys()]);
  }

  delete(name: string): Promise<boolean> {
    if (this.deleteFails) {
      return Promise.reject(new Error('delete failed'));
    }
    return Promise.resolve(this.stores.delete(name));
  }
}

/** Flips every bit of the 9th byte from the end, in place: same length, different content. */
export function flipByte(bytes: Uint8Array): void {
  const i = bytes.length - 9;
  bytes[i] = (bytes[i] ?? 0) ^ 0xff;
}
