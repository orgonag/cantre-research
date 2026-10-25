import { getLang, t } from '../i18n/index.js';
import { downloadBytes, errorMessageKey, formatMegabytes } from '../logic/offline.js';
import type { ManifestResult, OfflineState } from '../logic/offline.js';

/**
 * The first-run screen (decision D1): what leaves the device, the research disclaimer (D7), and
 * one button that downloads the national data. Nothing is requested until the button is pressed,
 * except the small manifest that gives the size for the button (the same file for everyone).
 */
export function FirstRun(props: {
  /** The manifest, or null while it is being fetched. */
  readonly manifest: ManifestResult | null;
  readonly state: OfflineState;
  readonly onDownload: () => void;
  readonly onRetryManifest: () => void;
}) {
  const { manifest, state, onDownload, onRetryManifest } = props;
  const lang = getLang();
  const busy = state.kind === 'downloading' || state.kind === 'verifying';

  return (
    <section class="first-run" aria-labelledby="screen-heading">
      <h2 id="screen-heading" tabIndex={-1}>
        {t('firstRun.heading')}
      </h2>
      <p>{t('firstRun.privacy')}</p>
      <p class="muted">{t('disclaimer.full')}</p>

      {manifest === null && <p role="status">{t('firstRun.checking')}</p>}
      {manifest?.kind === 'error' && (
        <div role="alert">
          <p>{t(errorMessageKey(manifest.code))}</p>
          <button type="button" onClick={onRetryManifest}>
            {t('firstRun.retry')}
          </button>
        </div>
      )}
      {manifest?.kind === 'manifest' && (
        <>
          <p class="muted">{t('firstRun.snapshot', { date: manifest.manifest.snapshotDate })}</p>
          <button type="button" class="primary" disabled={busy} onClick={onDownload}>
            {t('firstRun.download', {
              size: formatMegabytes(downloadBytes(manifest.manifest), lang),
            })}
          </button>
        </>
      )}

      <DownloadStatus state={state} onRetry={onDownload} />
    </section>
  );
}

/**
 * Progress, phase text and the error with its retry, for a download in this session.
 *
 * The phase text ("Downloading", "Checking and saving") sits in a polite live region and changes
 * only when the phase changes. The numbers change in the progress bar and a plain text line that
 * screen readers are not told about on every chunk (the state only changes when the whole
 * percent changes). An error is announced once, with a retry button.
 */
export function DownloadStatus(props: {
  readonly state: OfflineState;
  readonly onRetry: () => void;
}) {
  const { state, onRetry } = props;
  const lang = getLang();
  return (
    <div class="download-status">
      <p role="status" class="visually-hidden">
        {state.kind === 'downloading' && t('offline.status.downloading')}
        {state.kind === 'verifying' && t('offline.status.verifying')}
        {state.kind === 'ready' && t('offline.status.ready')}
      </p>
      {state.kind === 'downloading' && (
        <p>
          <progress
            aria-label={t('firstRun.progressLabel')}
            value={state.receivedBytes}
            max={state.totalBytes}
          />{' '}
          <span class="muted">
            {t('firstRun.progress', {
              received: formatMegabytes(state.receivedBytes, lang),
              total: formatMegabytes(state.totalBytes, lang),
            })}
          </span>
        </p>
      )}
      {state.kind === 'verifying' && <p>{t('firstRun.verifying')}</p>}
      {state.kind === 'error' && (
        <div role="alert">
          <p>{t(errorMessageKey(state.code))}</p>
          <button type="button" onClick={onRetry}>
            {t('firstRun.retry')}
          </button>
        </div>
      )}
    </div>
  );
}
