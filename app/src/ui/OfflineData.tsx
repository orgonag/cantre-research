import { useState } from 'preact/hooks';
import type { InstalledSnapshot } from '@cantre/data-client';
import { getLang, t } from '../i18n/index.js';
import {
  downloadBytes,
  errorMessageKey,
  formatMegabytes,
  updateAvailable,
} from '../logic/offline.js';
import type { ManifestResult, OfflineState } from '../logic/offline.js';
import { DownloadStatus } from './FirstRun.js';

/**
 * Offline data (decision D8): the installed snapshot's date, dataset version and size; "Update
 * data" with its download size when the manifest names a different dataset version; and "Remove
 * data", which asks first because the data has to be downloaded again.
 *
 * An update that fails (for example a hash mismatch) shows its error and a retry, and the
 * installed data stays in use: this screen never removes anything on its own.
 */
export function OfflineData(props: {
  readonly installed: InstalledSnapshot | null;
  /** The manifest from the server, or null while it is being fetched. */
  readonly remote: ManifestResult | null;
  readonly state: OfflineState;
  readonly onUpdate: () => void;
  readonly onCheck: () => void;
  readonly onRemove: () => void;
}) {
  const { installed, remote, state, onUpdate, onCheck, onRemove } = props;
  const lang = getLang();
  const [confirming, setConfirming] = useState(false);
  const busy = state.kind === 'downloading' || state.kind === 'verifying';
  const newer = remote?.kind === 'manifest' && updateAvailable(installed, remote.manifest);

  return (
    <section class="offline" aria-labelledby="screen-heading">
      <h2 id="screen-heading" tabIndex={-1}>
        {t('offline.heading')}
      </h2>
      {installed === null ? (
        <p>{t('offline.none')}</p>
      ) : (
        <>
          <h3>{t('offline.installed')}</h3>
          <dl class="facts">
            <div>
              <dt>{t('offline.date')}</dt>
              <dd>{installed.snapshotDate}</dd>
            </div>
            <div>
              <dt>{t('offline.version')}</dt>
              <dd class="mono">{installed.datasetVersion}</dd>
            </div>
            <div>
              <dt>{t('offline.size')}</dt>
              <dd>{t('offline.mb', { size: formatMegabytes(installed.bytes, lang) })}</dd>
            </div>
          </dl>
        </>
      )}

      <div class="update">
        {remote === null && <p role="status">{t('offline.checking')}</p>}
        {remote?.kind === 'error' && (
          <div role="alert">
            <p>{t(errorMessageKey(remote.code))}</p>
            <button type="button" onClick={onCheck}>
              {t('offline.check')}
            </button>
          </div>
        )}
        {remote?.kind === 'manifest' && !newer && state.kind !== 'ready' && (
          <p role="status">{t('offline.upToDate')}</p>
        )}
        {remote?.kind === 'manifest' && newer && (
          <>
            <p>{t('offline.newer', { date: remote.manifest.snapshotDate })}</p>
            <button type="button" class="primary" disabled={busy} onClick={onUpdate}>
              {t('offline.update', {
                size: formatMegabytes(downloadBytes(remote.manifest), lang),
              })}
            </button>
            <p class="muted">{t('offline.updateNote')}</p>
          </>
        )}
        <DownloadStatus state={state} onRetry={onUpdate} />
      </div>

      {installed !== null && (
        <div class="remove">
          {confirming ? (
            <div class="notice" role="alertdialog" aria-labelledby="remove-confirm">
              <p id="remove-confirm">{t('offline.removeConfirm')}</p>
              <button
                type="button"
                onClick={() => {
                  setConfirming(false);
                  onRemove();
                }}
              >
                {t('offline.removeYes')}
              </button>{' '}
              <button
                type="button"
                onClick={() => {
                  setConfirming(false);
                }}
              >
                {t('offline.removeNo')}
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setConfirming(true);
              }}
            >
              {t('offline.remove')}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
