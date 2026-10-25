import { describe, expect, it } from 'vitest';
import { CoreInputError } from '@cantre/core';
import { DataClientError, parseManifest } from '@cantre/data-client';
import type { LoadedNetwork, Manifest } from '@cantre/data-client';
import {
  DATA_BASE_URL,
  IDLE,
  dataClientDeps,
  downloadBytes,
  errorMessageKey,
  formatMegabytes,
  offlineReducer,
  readManifest,
  runDownload,
  updateAvailable,
} from '../../src/logic/offline.js';
import type { OfflineDeps, OfflineEvent, OfflineState } from '../../src/logic/offline.js';
import { BASE, envOf, fakeServer, goldenBundle, memoryCaches } from './dataFakes.js';

const manifestOf = (over: Record<string, unknown> = {}): Manifest =>
  parseManifest({ ...goldenBundle().manifest, ...over });

describe('size of the download', () => {
  it('adds the two gzip sizes of the manifest', () => {
    const m = manifestOf();
    expect(downloadBytes(m)).toBe(m.snapshot.gzipBytes + m.assetDetails.gzipBytes);
  });

  it('shows megabytes (1 MB = 1,000,000 bytes) to one decimal, rounded UP', () => {
    expect(formatMegabytes(3_400_000, 'en')).toBe('3.4');
    expect(formatMegabytes(3_400_001, 'en')).toBe('3.5'); // never understates
    expect(formatMegabytes(3_399_999, 'en')).toBe('3.4');
    expect(formatMegabytes(12_000_000, 'en')).toBe('12.0');
  });

  it('never shows 0.0 MB for a real download, and uses the French decimal comma', () => {
    expect(formatMegabytes(1, 'en')).toBe('0.1');
    expect(formatMegabytes(0, 'en')).toBe('0.0');
    expect(formatMegabytes(3_400_001, 'fr')).toBe('3,5');
  });
});

describe('the download state machine', () => {
  const run = (events: readonly OfflineEvent[], from: OfflineState = IDLE): OfflineState =>
    events.reduce(offlineReducer, from);

  it('goes idle, downloading, verifying, ready', () => {
    expect(IDLE).toEqual({ kind: 'idle' });
    const downloading = run([{ type: 'start', totalBytes: 1000 }]);
    expect(downloading).toEqual({ kind: 'downloading', receivedBytes: 0, totalBytes: 1000 });
    expect(run([{ type: 'progress', receivedBytes: 500, totalBytes: 1000 }], downloading)).toEqual({
      kind: 'downloading',
      receivedBytes: 500,
      totalBytes: 1000,
    });
    const verifying = run([{ type: 'verifying' }], downloading);
    expect(verifying).toEqual({ kind: 'verifying' });
    expect(
      run([{ type: 'done', datasetVersion: 'v1', snapshotDate: '2026-10-25' }], verifying),
    ).toEqual({ kind: 'ready', datasetVersion: 'v1', snapshotDate: '2026-10-25' });
  });

  it('moves to verifying when the last byte arrives', () => {
    const s = run([
      { type: 'start', totalBytes: 1000 },
      { type: 'progress', receivedBytes: 1000, totalBytes: 1000 },
    ]);
    expect(s).toEqual({ kind: 'verifying' });
  });

  it('keeps the same state object when the whole-percent progress has not changed', () => {
    const a = run([
      { type: 'start', totalBytes: 10_000 },
      { type: 'progress', receivedBytes: 150, totalBytes: 10_000 },
    ]);
    const b = offlineReducer(a, { type: 'progress', receivedBytes: 190, totalBytes: 10_000 });
    expect(b).toBe(a);
    const c = offlineReducer(a, { type: 'progress', receivedBytes: 250, totalBytes: 10_000 });
    expect(c).not.toBe(a);
  });

  it('ends in error with a code, and a retry starts again', () => {
    const failed = run([
      { type: 'start', totalBytes: 1000 },
      { type: 'fail', code: 'HASH_MISMATCH' },
    ]);
    expect(failed).toEqual({ kind: 'error', code: 'HASH_MISMATCH' });
    expect(run([{ type: 'start', totalBytes: 1000 }], failed).kind).toBe('downloading');
  });

  it('ignores events that do not fit the current state', () => {
    expect(offlineReducer(IDLE, { type: 'progress', receivedBytes: 1, totalBytes: 2 })).toBe(IDLE);
    expect(offlineReducer(IDLE, { type: 'verifying' })).toBe(IDLE);
    expect(offlineReducer(IDLE, { type: 'done', datasetVersion: 'v', snapshotDate: 'd' })).toBe(
      IDLE,
    );
    expect(offlineReducer(IDLE, { type: 'fail', code: 'FETCH_FAILED' })).toBe(IDLE);
    const busy = run([{ type: 'start', totalBytes: 10 }]);
    expect(offlineReducer(busy, { type: 'start', totalBytes: 10 })).toBe(busy);
    const ready: OfflineState = { kind: 'ready', datasetVersion: 'v', snapshotDate: 'd' };
    expect(offlineReducer(ready, { type: 'fail', code: 'FETCH_FAILED' })).toBe(ready);
    expect(run([{ type: 'start', totalBytes: 10 }], ready).kind).toBe('downloading');
  });

  it('can be reset to idle', () => {
    expect(offlineReducer({ kind: 'error', code: 'FETCH_FAILED' }, { type: 'reset' })).toBe(IDLE);
    const busy = run([{ type: 'start', totalBytes: 10 }]);
    expect(offlineReducer(busy, { type: 'reset' })).toBe(busy); // not while a download runs
  });
});

describe('error messages', () => {
  it('has a catalogue message for the data-client codes, INVALID_SNAPSHOT and a fallback', () => {
    expect(errorMessageKey('HASH_MISMATCH')).toBe('error.HASH_MISMATCH');
    expect(errorMessageKey('INVALID_SNAPSHOT')).toBe('error.INVALID_SNAPSHOT');
    expect(errorMessageKey('SOMETHING_ELSE')).toBe('error.UNEXPECTED');
  });
});

describe('updateAvailable', () => {
  const installed = {
    datasetVersion: 'v1',
    snapshotDate: '2026-10-25',
    bytes: 10,
    packageVersions: {},
  };
  it('is true only when the manifest names a different dataset version', () => {
    expect(updateAvailable(installed, manifestOf({ datasetVersion: 'v1' }))).toBe(false);
    expect(updateAvailable(installed, manifestOf({ datasetVersion: 'v2' }))).toBe(true);
    expect(updateAvailable(null, manifestOf())).toBe(false); // nothing installed: first run, not an update
  });
});

/** Fake deps; each can be overridden. `log` records calls in order. */
function fakeDeps(over: Partial<OfflineDeps> = {}): { deps: OfflineDeps; log: string[] } {
  const log: string[] = [];
  const loaded = { datasetVersion: 'v2', snapshotDate: '2026-12-01' } as unknown as LoadedNetwork;
  const deps: OfflineDeps = {
    baseUrl: DATA_BASE_URL,
    fetchManifest: () => {
      log.push('manifest');
      return Promise.resolve(manifestOf());
    },
    downloadSnapshot: (_base, _manifest, onProgress) => {
      log.push('download');
      onProgress?.({ file: 'snapshot', receivedBytes: 10, totalBytes: 100 });
      onProgress?.({ file: 'assetDetails', receivedBytes: 100, totalBytes: 100 });
      return Promise.resolve();
    },
    loadNetwork: () => {
      log.push('load');
      return Promise.resolve(loaded);
    },
    installedSnapshot: () => Promise.resolve(null),
    removeSnapshot: () => {
      log.push('remove');
      return Promise.resolve();
    },
    ...over,
  };
  return { deps, log };
}

/** Runs the download and returns the loaded network, every state reached and the last one. */
async function drive(deps: OfflineDeps, manifest: Manifest) {
  const states: OfflineState[] = [];
  let state: OfflineState = IDLE;
  const loaded = await runDownload(deps, manifest, (event) => {
    state = offlineReducer(state, event);
    states.push(state);
  });
  return { loaded, states, last: state };
}

describe('runDownload', () => {
  it('downloads, then verifies by loading, then is ready, in that order', async () => {
    const { deps, log } = fakeDeps();
    const { loaded, states, last } = await drive(deps, manifestOf());
    expect(log).toEqual(['download', 'load']);
    expect(states.map((s) => s.kind)).toEqual([
      'downloading', // start
      'downloading', // 10%
      'verifying', // all bytes in
      'verifying', // loading (verify event)
      'ready',
    ]);
    expect(last).toEqual({ kind: 'ready', datasetVersion: 'v2', snapshotDate: '2026-12-01' });
    expect(loaded?.datasetVersion).toBe('v2');
  });

  it('reports a failed download as error(code), loads nothing and removes nothing', async () => {
    const { deps, log } = fakeDeps({
      downloadSnapshot: () => Promise.reject(new DataClientError('FETCH_FAILED')),
    });
    const { loaded, last } = await drive(deps, manifestOf());
    expect(last).toEqual({ kind: 'error', code: 'FETCH_FAILED' });
    expect(loaded).toBeNull();
    expect(log).toEqual([]);
  });

  it('HASH_MISMATCH is an error, the old version stays loaded and installed (Review Focus 4)', async () => {
    const { deps, log } = fakeDeps({
      downloadSnapshot: () => Promise.reject(new DataClientError('HASH_MISMATCH')),
    });
    const { loaded, last } = await drive(deps, manifestOf());
    expect(last).toEqual({ kind: 'error', code: 'HASH_MISMATCH' });
    expect(loaded).toBeNull(); // the caller keeps its current network and session
    expect(log).not.toContain('load'); // never decoded
    expect(log).not.toContain('remove'); // never deleted
  });

  it('names an undecodable snapshot INVALID_SNAPSHOT and anything else UNEXPECTED', async () => {
    const bad = fakeDeps({
      loadNetwork: () => Promise.reject(new CoreInputError('INVALID_SNAPSHOT', 'byte 0: bad')),
    });
    expect((await drive(bad.deps, manifestOf())).last).toEqual({
      kind: 'error',
      code: 'INVALID_SNAPSHOT',
    });
    const odd = fakeDeps({ downloadSnapshot: () => Promise.reject(new Error('boom')) });
    expect((await drive(odd.deps, manifestOf())).last).toEqual({
      kind: 'error',
      code: 'UNEXPECTED',
    });
  });
});

describe('readManifest', () => {
  it('returns the manifest, or the error code', async () => {
    const ok = await readManifest(fakeDeps().deps);
    expect(ok.kind).toBe('manifest');
    const bad = await readManifest(
      fakeDeps({ fetchManifest: () => Promise.reject(new DataClientError('MANIFEST_INVALID')) })
        .deps,
    );
    expect(bad).toEqual({ kind: 'error', code: 'MANIFEST_INVALID' });
  });
});

describe('with the real data client (golden national bundle)', () => {
  const served = (g: ReturnType<typeof goldenBundle>, manifest: unknown) =>
    fakeServer(manifest, {
      [g.manifest.snapshot.path]: g.snapshot,
      [g.manifest.assetDetails.path]: g.assetDetails,
    });

  it('first run: manifest at data/manifest.json, one download, then loaded', async () => {
    expect(DATA_BASE_URL).toBe('data/');
    const g = goldenBundle();
    const server = served(g, g.manifest);
    const deps = dataClientDeps(envOf(server.fetch, memoryCaches()), BASE);
    const read = await readManifest(deps);
    expect(read.kind).toBe('manifest');
    if (read.kind !== 'manifest') {
      return;
    }
    const { loaded, last } = await drive(deps, read.manifest);
    expect(last.kind).toBe('ready');
    expect(loaded?.datasetVersion).toBe(g.manifest.datasetVersion);
    expect(server.urls).toEqual([
      `${BASE}manifest.json`,
      `${BASE}${g.manifest.snapshot.path}`,
      `${BASE}${g.manifest.assetDetails.path}`,
    ]);
  });

  it('a tampered update fails with HASH_MISMATCH and the installed version still loads', async () => {
    const g = goldenBundle();
    const caches = memoryCaches();
    const first = await drive(
      dataClientDeps(envOf(served(g, g.manifest).fetch, caches), BASE),
      parseManifest(g.manifest),
    );
    expect(first.last.kind).toBe('ready');

    // A newer build whose snapshot file arrives altered (one byte changed).
    const next = { ...g.manifest, datasetVersion: 'newer', snapshotDate: '2027-01-01' };
    const tampered = g.snapshot.slice();
    tampered[tampered.length - 9] = (tampered[tampered.length - 9] ?? 0) ^ 0xff;
    const bad = fakeServer(next, {
      [g.manifest.snapshot.path]: tampered,
      [g.manifest.assetDetails.path]: g.assetDetails,
    });
    const deps = dataClientDeps(envOf(bad.fetch, caches), BASE);
    const second = await drive(deps, parseManifest(next));
    expect(second.last).toEqual({ kind: 'error', code: 'HASH_MISMATCH' });
    expect(second.loaded).toBeNull();
    expect((await deps.installedSnapshot())?.datasetVersion).toBe(g.manifest.datasetVersion);
    expect((await deps.loadNetwork()).datasetVersion).toBe(g.manifest.datasetVersion);

    // The same version offered again downloads nothing: an intact install is never rewritten.
    const again = fakeServer(g.manifest, {});
    const third = await drive(
      dataClientDeps(envOf(again.fetch, caches), BASE),
      parseManifest(g.manifest),
    );
    expect(third.last.kind).toBe('ready');
    expect(again.urls).toEqual([]);
  });

  it('removeSnapshot returns to nothing installed', async () => {
    const g = goldenBundle();
    const deps = dataClientDeps(envOf(served(g, g.manifest).fetch, memoryCaches()), BASE);
    await drive(deps, parseManifest(g.manifest));
    expect(await deps.installedSnapshot()).not.toBeNull();
    await deps.removeSnapshot();
    expect(await deps.installedSnapshot()).toBeNull();
  });
});
