import {
  downloadSnapshot,
  fetchManifest,
  installedSnapshot,
  loadNetwork,
  removeSnapshot,
} from '@cantre/data-client';
import type {
  ClientEnv,
  DownloadProgress,
  InstalledSnapshot,
  LoadedNetwork,
  Manifest,
} from '@cantre/data-client';
import type { Lang, MessageKey } from '../i18n/index.js';
import { errorCode } from './errorCode.js';

/**
 * Offline data: the one national download and its state machine (decision D1, D8).
 *
 * The app fetches only the manifest, the snapshot and the asset-details file, all from
 * {@link DATA_BASE_URL}. No request carries a position (spec §9). The data client owns the
 * verified copy in Cache Storage; the service worker never touches it.
 */

/**
 * Where the data lives, relative to the app's own address (ruling P11): the manifest is
 * `data/manifest.json`, and the files it names are found relative to the manifest. The one
 * constant that the test fixture (Task 8) and the deploy (Task 9) both serve to.
 */
export const DATA_BASE_URL = 'data/';

/**
 * The download size in bytes: the snapshot's and the asset-details file's gzip sizes, as served
 * (the bytes that cross the network, not the unzipped size).
 */
export function downloadBytes(manifest: Manifest): number {
  return manifest.snapshot.gzipBytes + manifest.assetDetails.gzipBytes;
}

/**
 * Megabytes for display, as text with one decimal. Rule: 1 MB = 1,000,000 bytes (the unit phones
 * and download dialogs use), and the value is rounded UP to the next 0.1 MB, so the button never
 * promises less than the real download. The French text uses a decimal comma. Limit: a size
 * under 0.1 MB shows as 0.1 (but 0 bytes shows 0.0).
 */
export function formatMegabytes(bytes: number, lang: Lang): string {
  const tenths = Math.ceil(bytes / 100_000);
  const text = `${String(Math.floor(tenths / 10))}.${String(tenths % 10)}`;
  return lang === 'fr' ? text.replace('.', ',') : text;
}

/**
 * True when the manifest names a different dataset version from the installed one (D8: "Update
 * data"). With nothing installed there is nothing to update: that is the first-run download.
 * The dataset version identifies the build, so equal versions are never offered again.
 */
export function updateAvailable(installed: InstalledSnapshot | null, remote: Manifest): boolean {
  return installed !== null && installed.datasetVersion !== remote.datasetVersion;
}

/** Codes the app has a message for: the data client's, an undecodable snapshot, and a fallback. */
const SHOWN_CODES = [
  'MANIFEST_INVALID',
  'FETCH_FAILED',
  'HASH_MISMATCH',
  'NOT_INSTALLED',
  'INVALID_SNAPSHOT',
] as const;

/** The catalogue key for an error code; an unknown code reads as the generic message. */
export function errorMessageKey(code: string): MessageKey {
  return (SHOWN_CODES as readonly string[]).includes(code)
    ? (`error.${code}` as MessageKey)
    : 'error.UNEXPECTED';
}

/**
 * Where a download stands. `error` carries a code, never a message, so the text is catalogued.
 * `verifying` covers hashing the files, storing them and decoding the snapshot.
 */
export type OfflineState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'downloading'; readonly receivedBytes: number; readonly totalBytes: number }
  | { readonly kind: 'verifying' }
  | { readonly kind: 'ready'; readonly datasetVersion: string; readonly snapshotDate: string }
  | { readonly kind: 'error'; readonly code: string };

export type OfflineEvent =
  | { readonly type: 'start'; readonly totalBytes: number }
  | { readonly type: 'progress'; readonly receivedBytes: number; readonly totalBytes: number }
  | { readonly type: 'verifying' }
  | { readonly type: 'done'; readonly datasetVersion: string; readonly snapshotDate: string }
  | { readonly type: 'fail'; readonly code: string }
  | { readonly type: 'reset' };

export const IDLE: OfflineState = Object.freeze({ kind: 'idle' });

const percent = (received: number, total: number): number =>
  total <= 0 ? 0 : Math.floor((received / total) * 100);

/**
 * `idle -> downloading(progress) -> verifying -> ready | error(code)`, and from `error` (or
 * `ready`, for a later update) `start` begins again, which is the retry.
 *
 * An event that does not fit the state is ignored (the same state object comes back), so a late
 * progress event after a failure cannot revive the download. Progress that stays within the same
 * whole percent returns the same state object, so the screen is not redrawn for every chunk.
 * The last byte moves the state to `verifying`.
 */
export function offlineReducer(state: OfflineState, event: OfflineEvent): OfflineState {
  const busy = state.kind === 'downloading' || state.kind === 'verifying';
  switch (event.type) {
    case 'start':
      return busy ? state : { kind: 'downloading', receivedBytes: 0, totalBytes: event.totalBytes };
    case 'progress': {
      if (state.kind !== 'downloading') {
        return state;
      }
      if (event.receivedBytes >= event.totalBytes) {
        return { kind: 'verifying' };
      }
      if (
        percent(event.receivedBytes, event.totalBytes) ===
        percent(state.receivedBytes, state.totalBytes)
      ) {
        return state;
      }
      return {
        kind: 'downloading',
        receivedBytes: event.receivedBytes,
        totalBytes: event.totalBytes,
      };
    }
    case 'verifying':
      return busy ? { kind: 'verifying' } : state;
    case 'done':
      return state.kind === 'verifying'
        ? { kind: 'ready', datasetVersion: event.datasetVersion, snapshotDate: event.snapshotDate }
        : state;
    case 'fail':
      return busy ? { kind: 'error', code: event.code } : state;
    case 'reset':
      return busy ? state : IDLE;
  }
}

/** The data-client calls the app uses, as one object so tests can replace them. */
export type OfflineDeps = {
  readonly baseUrl: string;
  fetchManifest(baseUrl: string): Promise<Manifest>;
  downloadSnapshot(
    baseUrl: string,
    manifest: Manifest,
    onProgress?: (p: DownloadProgress) => void,
  ): Promise<void>;
  loadNetwork(): Promise<LoadedNetwork>;
  installedSnapshot(): Promise<InstalledSnapshot | null>;
  removeSnapshot(): Promise<void>;
};

/** The real data client, optionally with a different environment (tests) or base address. */
export function dataClientDeps(
  env?: Partial<ClientEnv>,
  baseUrl: string = DATA_BASE_URL,
): OfflineDeps {
  return {
    baseUrl,
    fetchManifest: (base) => fetchManifest(base, env),
    downloadSnapshot: (base, manifest, onProgress) =>
      downloadSnapshot(base, manifest, onProgress, env),
    loadNetwork: () => loadNetwork(env),
    installedSnapshot: () => installedSnapshot(env),
    removeSnapshot: () => removeSnapshot(env),
  };
}

export type ManifestResult =
  | { readonly kind: 'manifest'; readonly manifest: Manifest }
  | { readonly kind: 'error'; readonly code: string };

/** Fetches the manifest. A failure is a code to show with a retry, not an exception. */
export async function readManifest(deps: OfflineDeps): Promise<ManifestResult> {
  try {
    return { kind: 'manifest', manifest: await deps.fetchManifest(deps.baseUrl) };
  } catch (error) {
    return { kind: 'error', code: errorCode(error) };
  }
}

/**
 * Downloads and installs the build named by `manifest`, then loads it. Every step is reported as
 * an event for {@link offlineReducer}. Returns the loaded network, or null after reporting
 * `fail`.
 *
 * Safety (Review Focus 4): the data client checks each file's size and SHA-256 BEFORE storing,
 * and deletes the previous version only after the new one is fully stored. So `HASH_MISMATCH`,
 * a short or interrupted download, or a full disk leaves the old version installed, and this
 * function returns null, so the caller keeps the network it already has. A tampered file is
 * never decoded. The same intact version is not downloaded again (data client). Limit: if the
 * files hash correctly but cannot be decoded (`INVALID_SNAPSHOT`), they are already installed;
 * the network in memory is unchanged but the next start-up will report the problem.
 */
export async function runDownload(
  deps: OfflineDeps,
  manifest: Manifest,
  report: (event: OfflineEvent) => void,
): Promise<LoadedNetwork | null> {
  report({ type: 'start', totalBytes: downloadBytes(manifest) });
  try {
    await deps.downloadSnapshot(deps.baseUrl, manifest, (p) => {
      report({ type: 'progress', receivedBytes: p.receivedBytes, totalBytes: p.totalBytes });
    });
    report({ type: 'verifying' });
    const loaded = await deps.loadNetwork();
    report({
      type: 'done',
      datasetVersion: loaded.datasetVersion,
      snapshotDate: loaded.snapshotDate,
    });
    return loaded;
  } catch (error) {
    report({ type: 'fail', code: errorCode(error) });
    return null;
  }
}
