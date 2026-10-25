import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MATCH_CONFIG, findCandidates } from '@cantre/core';
import {
  CACHE_PREFIX,
  DataClientError,
  cacheName,
  downloadSnapshot,
  fetchManifest,
  installedSnapshot,
  loadNetwork,
  parseManifest,
  removeSnapshot,
} from '../src/index.js';
import type { ClientEnv, DownloadProgress, Manifest } from '../src/index.js';
import { BASE, FakeCacheStorage, bundleA, bundleB, fakeFetch, flipByte, serve } from './helpers.js';
import type { Bundle } from './helpers.js';

/**
 * Tests for the data client, with a fake `fetch` and a fake `CacheStorage` over the committed
 * golden bundles (pipeline/tests/golden/synthetic/). Review Focus 4: a snapshot that fails its
 * hash or is half-downloaded is rejected, never decoded, and the older install stays in use.
 */
afterEach(() => {
  vi.restoreAllMocks();
});

const failure = async (p: Promise<unknown>): Promise<{ code: string; message: string }> => {
  try {
    await p;
  } catch (e) {
    const err = e as { code: string; message: string };
    return { code: err.code, message: err.message };
  }
  throw new Error('expected a rejection');
};

/** Fetches the manifest of `bundle` the way the app does, then downloads and stores it. */
async function installBundle(bundle: Bundle, caches: FakeCacheStorage): Promise<Manifest> {
  const env: Partial<ClientEnv> = { fetch: fakeFetch(serve(bundle)), caches };
  const manifest = await fetchManifest(BASE, env);
  await downloadSnapshot(BASE, manifest, undefined, env);
  return manifest;
}

describe('parseManifest and fetchManifest', () => {
  it('reads the national manifest, with or without a trailing slash on the base', async () => {
    const a = bundleA();
    for (const base of [BASE, BASE.slice(0, -1)]) {
      const f = fakeFetch(serve(a));
      const m = await fetchManifest(base, { fetch: f });
      expect(m.datasetVersion).toBe(a.manifest.datasetVersion);
      expect(m.snapshot.path).toBe('snapshot.bin.gz');
      expect(m.snapshotDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(m.packageVersions.ab).toBeTypeOf('string');
      expect(f.requests.map((r) => r.url)).toEqual([`${BASE}manifest.json`]);
    }
  });

  it('asks for no cookies and no referrer', async () => {
    const f = fakeFetch(serve(bundleA()));
    await fetchManifest(BASE, { fetch: f });
    expect(f.requests[0]?.init).toMatchObject({
      method: 'GET',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  });

  it('rejects a manifest that is not a usable national manifest', () => {
    const good = bundleA().manifest;
    const bad = (over: Record<string, unknown>): void => {
      expect(() => parseManifest({ ...good, ...over })).toThrow(
        expect.objectContaining({ code: 'MANIFEST_INVALID' }),
      );
    };
    bad({ schema: 'cantre.manifest/2' });
    bad({ datasetVersion: '' });
    bad({ attribution: 3 });
    bad({ snapshotDate: 'yesterday' });
    bad({ snapshotDate: undefined });
    bad({ snapshot: undefined });
    bad({ assetDetails: 'x' });
    bad({ snapshot: { ...good.snapshot, sha256: 'ABC' } });
    bad({ snapshot: { ...good.snapshot, bytes: -1 } });
    bad({ snapshot: { ...good.snapshot, gzipBytes: 0 } });
    bad({ snapshot: { ...good.snapshot, path: 'https://evil.example/x.gz' } });
    bad({ snapshot: { ...good.snapshot, path: '../x.gz' } });
    bad({ snapshot: { ...good.snapshot, path: '/x.gz' } });
    bad({ snapshot: { ...good.snapshot, path: 'x.gz?lat=52' } });
    bad({ snapshot: { ...good.snapshot, path: 'a/./x.gz' } });
    bad({ provinces: { ab: {} } });
    bad({ provinces: 4 });
    expect(() => parseManifest(null)).toThrow(
      expect.objectContaining({ code: 'MANIFEST_INVALID' }),
    );
    expect(() => parseManifest([])).toThrow(expect.objectContaining({ code: 'MANIFEST_INVALID' }));
    expect(parseManifest({ ...good, provinces: undefined }).packageVersions).toEqual({});
    expect(
      parseManifest({ ...good, snapshot: { ...good.snapshot, path: 'v1/s.bin.gz' } }).snapshot.path,
    ).toBe('v1/s.bin.gz');
  });

  it('turns a bad body or a bad answer into a typed error', async () => {
    const a = bundleA();
    const body = (text: string) =>
      fakeFetch({ [`${BASE}manifest.json`]: { body: new TextEncoder().encode(text) } });
    expect((await failure(fetchManifest(BASE, { fetch: body('not json') }))).code).toBe(
      'MANIFEST_INVALID',
    );
    expect((await failure(fetchManifest(BASE, { fetch: body('{}') }))).code).toBe(
      'MANIFEST_INVALID',
    );
    expect((await failure(fetchManifest(BASE, { fetch: fakeFetch({}) }))).code).toBe(
      'FETCH_FAILED',
    );
    const down = fakeFetch(serve(a, { manifest: { status: 503 } }));
    expect((await failure(fetchManifest(BASE, { fetch: down }))).code).toBe('FETCH_FAILED');
    const offline = (() =>
      Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch;
    expect((await failure(fetchManifest(BASE, { fetch: offline }))).code).toBe('FETCH_FAILED');
  });

  it('rejects a base address that is not a URL', async () => {
    const f = fakeFetch({});
    expect((await failure(fetchManifest('::not a url::', { fetch: f }))).code).toBe('FETCH_FAILED');
    expect(f.requests).toEqual([]);
  });
});

describe('downloadSnapshot', () => {
  it('verifies, stores under cantre-data-<version>, and reports progress', async () => {
    const a = bundleA();
    const caches = new FakeCacheStorage();
    const f = fakeFetch(serve(a));
    const env: Partial<ClientEnv> = { fetch: f, caches };
    const manifest = await fetchManifest(BASE, env);
    const seen: DownloadProgress[] = [];
    await downloadSnapshot(BASE, manifest, (p) => seen.push(p), env);

    expect([...caches.stores.keys()]).toEqual([cacheName(a.manifest.datasetVersion)]);
    expect(await installedSnapshot(env)).toEqual({
      datasetVersion: a.manifest.datasetVersion,
      snapshotDate: a.manifest.snapshotDate,
      bytes: a.manifest.snapshot.gzipBytes + a.manifest.assetDetails.gzipBytes,
    });
    const total = a.manifest.snapshot.gzipBytes + a.manifest.assetDetails.gzipBytes;
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.every((p) => p.totalBytes === total)).toBe(true);
    expect(seen.map((p) => p.receivedBytes)).toEqual(
      [...seen.map((p) => p.receivedBytes)].sort((x, y) => x - y),
    );
    expect(seen.at(-1)?.receivedBytes).toBe(total);
    expect(seen[0]?.file).toBe('snapshot');
    expect(seen.at(-1)?.file).toBe('assetDetails');
  });

  it('makes only the three expected requests, with no query and nothing about the user', async () => {
    const a = bundleA();
    const f = fakeFetch(serve(a));
    const env: Partial<ClientEnv> = { fetch: f, caches: new FakeCacheStorage() };
    await downloadSnapshot(BASE, await fetchManifest(BASE, env), undefined, env);
    await loadNetwork(env);
    expect(f.requests.map((r) => r.url)).toEqual([
      `${BASE}manifest.json`,
      `${BASE}snapshot.bin.gz`,
      `${BASE}asset-details.json.gz`,
    ]);
    for (const r of f.requests) {
      expect(new URL(r.url).search).toBe('');
      expect(new URL(r.url).hash).toBe('');
      expect(r.init).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer' });
    }
  });

  it('refuses a file whose hash is wrong: nothing is stored, nothing is installed', async () => {
    const a = bundleA();
    const tampered = Uint8Array.from(a.snapshot);
    flipByte(tampered); // same length, different bytes
    const caches = new FakeCacheStorage();
    const f = fakeFetch(serve(a, { snapshot: { body: tampered } }));
    const env: Partial<ClientEnv> = { fetch: f, caches };
    const manifest = await fetchManifest(BASE, env);
    const err = await failure(downloadSnapshot(BASE, manifest, undefined, env));
    expect(err.code).toBe('HASH_MISMATCH');
    expect(caches.stores.size).toBe(0);
    expect(caches.puts).toBe(0);
    expect(await installedSnapshot(env)).toBeNull();
    // the details file was not even fetched after the snapshot failed
    expect(f.requests.map((r) => r.url)).toEqual([
      `${BASE}manifest.json`,
      `${BASE}snapshot.bin.gz`,
    ]);
  });

  it('refuses a bad asset-details file too, before storing the snapshot', async () => {
    const a = bundleA();
    const tampered = Uint8Array.from(a.assetDetails);
    flipByte(tampered);
    const caches = new FakeCacheStorage();
    const env: Partial<ClientEnv> = {
      fetch: fakeFetch(serve(a, { assetDetails: { body: tampered } })),
      caches,
    };
    const manifest = await fetchManifest(BASE, env);
    expect((await failure(downloadSnapshot(BASE, manifest, undefined, env))).code).toBe(
      'HASH_MISMATCH',
    );
    expect(caches.puts).toBe(0);
  });

  it('keeps the old version when the new download fails (404, 500, offline)', async () => {
    const caches = new FakeCacheStorage();
    const old = await installBundle(bundleA(), caches);
    const b = bundleB();
    for (const files of [
      serve(b, { snapshot: { status: 500 } }),
      serve(b, { assetDetails: { status: 404 } }),
    ]) {
      const env: Partial<ClientEnv> = { fetch: fakeFetch(files), caches };
      const err = await failure(downloadSnapshot(BASE, parseManifest(b.manifest), undefined, env));
      expect(err.code).toBe('FETCH_FAILED');
      expect((await installedSnapshot(env))?.datasetVersion).toBe(old.datasetVersion);
    }
    const offline: Partial<ClientEnv> = {
      fetch: () => Promise.reject(new TypeError('offline')),
      caches,
    };
    expect(
      (await failure(downloadSnapshot(BASE, parseManifest(b.manifest), undefined, offline))).code,
    ).toBe('FETCH_FAILED');
    expect([...caches.stores.keys()]).toEqual([cacheName(old.datasetVersion)]);
    expect((await loadNetwork({ caches })).datasetVersion).toBe(old.datasetVersion);
  });

  it('rejects a half-downloaded snapshot before hashing, and keeps the old one', async () => {
    const caches = new FakeCacheStorage();
    const old = await installBundle(bundleA(), caches);
    const b = bundleB();
    const digest = vi.spyOn(crypto.subtle, 'digest');
    for (const snapshot of [
      { truncateTo: Math.floor(b.snapshot.length / 2) }, // stream ends early, cleanly
      { truncateTo: b.snapshot.length - 1 },
      { errorAfter: 2000 }, // connection reset part-way
      { truncateTo: 0 },
    ]) {
      const env: Partial<ClientEnv> = { fetch: fakeFetch(serve(b, { snapshot })), caches };
      const err = await failure(downloadSnapshot(BASE, parseManifest(b.manifest), undefined, env));
      expect(err.code).toBe('FETCH_FAILED');
      expect((await installedSnapshot(env))?.datasetVersion).toBe(old.datasetVersion);
    }
    expect(digest).not.toHaveBeenCalled();
    expect([...caches.stores.keys()]).toEqual([cacheName(old.datasetVersion)]);
    expect((await loadNetwork({ caches })).datasetVersion).toBe(old.datasetVersion);
  });

  it('rejects a body longer than the manifest says', async () => {
    const b = bundleB();
    const caches = new FakeCacheStorage();
    const env: Partial<ClientEnv> = {
      fetch: fakeFetch(serve(b, { snapshot: { extra: 10 } })),
      caches,
    };
    expect(
      (await failure(downloadSnapshot(BASE, parseManifest(b.manifest), undefined, env))).code,
    ).toBe('FETCH_FAILED');
    expect(caches.stores.size).toBe(0);
  });

  it('reads a response with no stream body in one piece', async () => {
    const b = bundleB();
    const files = serve(b);
    const noStream = ((input: Parameters<typeof fetch>[0]) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const served = files[url];
      const res = new Response(served?.body as Uint8Array<ArrayBuffer>);
      Object.defineProperty(res, 'body', { value: null });
      return Promise.resolve(res);
    }) as typeof fetch;
    const caches = new FakeCacheStorage();
    await downloadSnapshot(BASE, parseManifest(b.manifest), undefined, { fetch: noStream, caches });
    expect((await installedSnapshot({ caches }))?.datasetVersion).toBe(b.manifest.datasetVersion);
  });

  it('replaces the old version only after the new one is stored', async () => {
    const caches = new FakeCacheStorage();
    const a = await installBundle(bundleA(), caches);
    const other = await caches.open('some-other-app-cache');
    await other.put('k', new Response('keep me'));
    const order: string[] = [];
    const del = caches.delete.bind(caches);
    caches.delete = (name: string) => {
      order.push(`delete ${name}; stored: ${[...caches.stores.keys()].join(',')}`);
      return del(name);
    };
    const b = await installBundle(bundleB(), caches);
    expect(order).toEqual([
      `delete ${cacheName(a.datasetVersion)}; stored: ${[
        cacheName(a.datasetVersion),
        'some-other-app-cache',
        cacheName(b.datasetVersion),
      ].join(',')}`,
    ]);
    expect([...caches.stores.keys()].sort()).toEqual(
      ['some-other-app-cache', cacheName(b.datasetVersion)].sort(),
    );
    expect((await installedSnapshot({ caches }))?.datasetVersion).toBe(b.datasetVersion);
    expect(CACHE_PREFIX).toBe('cantre-data-');
  });

  it('keeps the old version, and removes the new cache, when the browser refuses to store', async () => {
    const caches = new FakeCacheStorage();
    const a = await installBundle(bundleA(), caches);
    caches.failPutAfter = caches.puts + 1; // the snapshot fits, the next put fails
    const b = bundleB();
    const env: Partial<ClientEnv> = { fetch: fakeFetch(serve(b)), caches };
    const err = await failure(downloadSnapshot(BASE, parseManifest(b.manifest), undefined, env));
    expect(err.code).toBe('FETCH_FAILED');
    expect(err.message).toContain('store');
    expect([...caches.stores.keys()]).toEqual([cacheName(a.datasetVersion)]);
    expect((await installedSnapshot({ caches }))?.datasetVersion).toBe(a.datasetVersion);
  });

  it('re-installing the same version overwrites it, and a failure then leaves nothing half-installed', async () => {
    const caches = new FakeCacheStorage();
    const a = bundleA();
    await installBundle(a, caches);
    await installBundle(a, caches); // fine
    expect([...caches.stores.keys()]).toHaveLength(1);
    caches.failPutAfter = caches.puts + 1;
    const env: Partial<ClientEnv> = { fetch: fakeFetch(serve(a)), caches };
    expect(
      (await failure(downloadSnapshot(BASE, parseManifest(a.manifest), undefined, env))).code,
    ).toBe('FETCH_FAILED');
    expect(await installedSnapshot({ caches })).toBeNull(); // no manifest: not installed, never decoded
    expect((await failure(loadNetwork({ caches }))).code).toBe('NOT_INSTALLED');
  });

  it('needs Cache Storage and says so', async () => {
    const a = bundleA();
    const env: Partial<ClientEnv> = { fetch: fakeFetch(serve(a)), caches: undefined };
    expect(
      (await failure(downloadSnapshot(BASE, parseManifest(a.manifest), undefined, env))).code,
    ).toBe('FETCH_FAILED');
    expect((await failure(loadNetwork(env))).code).toBe('FETCH_FAILED');
    expect(await installedSnapshot(env)).toBeNull();
    await removeSnapshot(env); // nothing to do, no error
  });

  it('says so when SHA-256 is not available', async () => {
    const b = bundleB();
    vi.stubGlobal('crypto', {});
    try {
      const env: Partial<ClientEnv> = {
        fetch: fakeFetch(serve(b)),
        caches: new FakeCacheStorage(),
      };
      const err = await failure(downloadSnapshot(BASE, parseManifest(b.manifest), undefined, env));
      expect(err.code).toBe('FETCH_FAILED');
      expect(err.message).toContain('SHA-256');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('installedSnapshot and removeSnapshot', () => {
  it('is null when nothing is installed, or only a half-written cache exists', async () => {
    const caches = new FakeCacheStorage();
    expect(await installedSnapshot({ caches })).toBeNull();
    const half = await caches.open(cacheName('half'));
    await half.put('https://cantre.invalid/data/snapshot.bin.gz', new Response('x'));
    expect(await installedSnapshot({ caches })).toBeNull();
    const junk = await caches.open(cacheName('junk'));
    for (const key of ['manifest.json', 'snapshot.bin.gz', 'asset-details.json.gz']) {
      await junk.put(`https://cantre.invalid/data/${key}`, new Response('not json'));
    }
    expect(await installedSnapshot({ caches })).toBeNull();
  });

  it('prefers the later snapshot date when two complete versions are present', async () => {
    const caches = new FakeCacheStorage();
    const a = bundleA(); // 2026-01-02
    const b = bundleB(); // 2026-12-31, the later one
    await installBundle(b, caches);
    // put A beside B by hand, as after a crash between "store new" and "delete old"
    const stash = new FakeCacheStorage();
    await installBundle(a, stash);
    caches.adopt(stash);
    expect(caches.stores.size).toBe(2);
    expect((await installedSnapshot({ caches }))?.datasetVersion).toBe(b.manifest.datasetVersion);
    // same date, later version string wins
    const sameDay = new FakeCacheStorage();
    const m1 = { ...a.manifest, datasetVersion: 'v-1' };
    const m2 = { ...a.manifest, datasetVersion: 'v-2' };
    await installBundle({ ...a, manifest: m1 }, sameDay);
    const other = new FakeCacheStorage();
    await installBundle({ ...a, manifest: m2 }, other);
    sameDay.adopt(other);
    expect((await installedSnapshot({ caches: sameDay }))?.datasetVersion).toBe('v-2');
  });

  it('removes every cantre cache and nothing else', async () => {
    const caches = new FakeCacheStorage();
    await installBundle(bundleA(), caches);
    await (await caches.open('someone-elses')).put('k', new Response('x'));
    await removeSnapshot({ caches });
    expect([...caches.stores.keys()]).toEqual(['someone-elses']);
    expect(await installedSnapshot({ caches })).toBeNull();
  });
});

describe('loadNetwork', () => {
  it('decodes the installed national snapshot into a NetworkView and the asset details', async () => {
    const caches = new FakeCacheStorage();
    const a = bundleA();
    await installBundle(a, caches);
    const loaded = await loadNetwork({ caches });
    expect(loaded.datasetVersion).toBe(a.manifest.datasetVersion);
    expect(loaded.net.datasetVersion).toBe(a.manifest.datasetVersion);
    expect(loaded.snapshotDate).toBe(a.manifest.snapshotDate);
    expect(loaded.attribution).toContain('Open Government Licence');
    expect(loaded.net.chains.length).toBeGreaterThan(10);
    expect(loaded.decodeMs).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(loaded.decodeMs)).toBe(true);
    expect(loaded.gunzipMs).toBeGreaterThanOrEqual(0);
    // every asset has its source attributes, with no network request
    expect(loaded.net.assets.length).toBeGreaterThan(0);
    for (const asset of loaded.net.assets) {
      const d = loaded.details[asset.id];
      expect(d?.layer).toBeTypeOf('string');
      expect(typeof d?.attrs).toBe('object');
    }
  });

  it('gives candidates on both chains at a province border, with no bridging (Review Focus 1)', async () => {
    const caches = new FakeCacheStorage();
    await installBundle(bundleA(), caches);
    const { net } = await loadNetwork({ caches });
    const sk = net.chains.find((c) => c.subdivisionNid === 'S1');
    const ab = net.chains.find((c) => c.subdivisionNid === 'S20');
    expect(sk).toBeDefined();
    expect(ab).toBeDefined();
    expect(sk?.id).not.toBe(ab?.id);
    // the chains end and start at the same point: the border
    const border = sk?.pts.at(-1);
    expect(border).toEqual(ab?.pts[0]);
    const found = findCandidates(
      net,
      { lat: border?.lat ?? 0, lon: border?.lon ?? 0, timestampMs: 0, accuracyM: 5 },
      MATCH_CONFIG,
    );
    const ids = found.map((c) => c.chainId);
    expect(ids).toContain(sk?.id);
    expect(ids).toContain(ab?.id);
    // not joined: each chain keeps its own subdivision and its own length
    expect(sk?.sM.at(-1)).not.toBe(ab?.sM.at(-1));
  });

  it('says NOT_INSTALLED when nothing is installed', async () => {
    expect((await failure(loadNetwork({ caches: new FakeCacheStorage() }))).code).toBe(
      'NOT_INSTALLED',
    );
  });

  it('refuses stored bytes that no longer match the manifest, and never decodes them', async () => {
    const caches = new FakeCacheStorage();
    const a = await installBundle(bundleA(), caches);
    const store = caches.stores.get(cacheName(a.datasetVersion));
    const snap = store?.get('https://cantre.invalid/data/snapshot.bin.gz');
    if (snap === undefined) {
      throw new Error('snapshot not stored');
    }
    flipByte(snap.bytes);
    expect((await failure(loadNetwork({ caches }))).code).toBe('HASH_MISMATCH');
    flipByte(snap.bytes); // restored
    const det = store?.get('https://cantre.invalid/data/asset-details.json.gz');
    if (det === undefined) {
      throw new Error('details not stored');
    }
    flipByte(det.bytes);
    expect((await failure(loadNetwork({ caches }))).code).toBe('HASH_MISMATCH');
  });

  it('turns bytes that hash right but do not decode into INVALID_SNAPSHOT', async () => {
    const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
    const a = bundleA();
    const install = async (snapshot: Uint8Array, details: Uint8Array, datasetVersion: string) => {
      const caches = new FakeCacheStorage();
      const manifest = {
        ...a.manifest,
        datasetVersion,
        snapshot: { ...a.manifest.snapshot, sha256: sha(snapshot), gzipBytes: snapshot.length },
        assetDetails: {
          ...a.manifest.assetDetails,
          sha256: sha(details),
          gzipBytes: details.length,
        },
      };
      const bundle: Bundle = { manifest, snapshot, assetDetails: details };
      await installBundle(bundle, caches);
      return caches;
    };
    const text = (s: string): Uint8Array => new Uint8Array(gzipSync(new TextEncoder().encode(s)));
    // a gzip file whose content is not a snapshot
    const notSnapshot = await install(text('hello'), a.assetDetails, a.manifest.datasetVersion);
    expect((await failure(loadNetwork({ caches: notSnapshot }))).code).toBe('INVALID_SNAPSHOT');
    // not gzip at all
    const notGzip = await install(
      new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
      a.assetDetails,
      a.manifest.datasetVersion,
    );
    expect((await failure(loadNetwork({ caches: notGzip }))).code).toBe('INVALID_SNAPSHOT');
    // a good snapshot of a different build than the manifest names
    const wrongVersion = await install(a.snapshot, a.assetDetails, 'some-other-build');
    const err = await failure(loadNetwork({ caches: wrongVersion }));
    expect(err.code).toBe('INVALID_SNAPSHOT');
    expect(err.message).toContain('some-other-build');
    // details that are not JSON, not an object, or the wrong shape
    for (const body of [
      'not json',
      '[]',
      '{"X":{"layer":3,"attrs":{}}}',
      '{"X":{"layer":"A","attrs":{"k":1}}}',
      '{"X":null}',
      '{"X":{"layer":"A","attrs":[]}}',
    ]) {
      const bad = await install(a.snapshot, text(body), a.manifest.datasetVersion);
      expect((await failure(loadNetwork({ caches: bad }))).code).toBe('INVALID_SNAPSHOT');
    }
  });

  it('uses the global fetch and caches when no environment is given', async () => {
    const a = bundleA();
    const caches = new FakeCacheStorage();
    vi.stubGlobal('fetch', fakeFetch(serve(a)));
    vi.stubGlobal('caches', caches);
    try {
      const manifest = await fetchManifest(BASE);
      await downloadSnapshot(BASE, manifest);
      expect((await installedSnapshot())?.datasetVersion).toBe(a.manifest.datasetVersion);
      expect((await loadNetwork()).net.chains.length).toBeGreaterThan(0);
      await removeSnapshot();
      expect(await installedSnapshot()).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('resolves a relative base address against the page address', async () => {
    const a = bundleA();
    const f = fakeFetch(serve(a));
    vi.stubGlobal('location', { href: 'https://data.example.test/cantre/app/index.html' });
    try {
      await fetchManifest('../', { fetch: f });
      expect(f.requests[0]?.url).toBe(`${BASE}manifest.json`);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('exposes DataClientError with its code', () => {
    const e = new DataClientError('HASH_MISMATCH');
    expect(e.message).toBe('HASH_MISMATCH');
    expect(e.name).toBe('DataClientError');
    expect(new DataClientError('FETCH_FAILED', 'detail').message).toBe('detail');
  });
});

describe('error reporting', () => {
  it('reports a value that is not an Error, and survives a failed clean-up', async () => {
    const strange = (() => Promise.reject('boom')) as unknown as typeof fetch; // eslint-disable-line @typescript-eslint/prefer-promise-reject-errors
    const err = await failure(fetchManifest(BASE, { fetch: strange }));
    expect(err).toEqual({ code: 'FETCH_FAILED', message: 'request failed: boom' });

    // storing fails AND removing the half-made cache fails: still one typed error
    const caches = new FakeCacheStorage();
    caches.failPutAfter = 0;
    caches.deleteFails = true;
    const b = bundleB();
    const env: Partial<ClientEnv> = { fetch: fakeFetch(serve(b)), caches };
    expect(
      (await failure(downloadSnapshot(BASE, parseManifest(b.manifest), undefined, env))).code,
    ).toBe('FETCH_FAILED');
  });

  it('turns an asset-details file that is not gzip into INVALID_SNAPSHOT', async () => {
    const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
    const a = bundleA();
    const details = new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9, 9, 9]);
    const manifest = {
      ...a.manifest,
      assetDetails: { ...a.manifest.assetDetails, sha256: sha(details), gzipBytes: details.length },
    };
    const caches = new FakeCacheStorage();
    await installBundle({ ...a, manifest, assetDetails: details }, caches);
    expect((await failure(loadNetwork({ caches }))).code).toBe('INVALID_SNAPSHOT');
  });
});
