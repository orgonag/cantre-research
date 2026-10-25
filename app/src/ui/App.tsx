import { useEffect, useState } from 'preact/hooks';
import type { Result } from '@cantre/core';
import { t } from '../i18n/index.js';
import type { Session } from '../logic/session.js';
import { onResume } from '../logic/visibility.js';

/**
 * The app layout. Task 4 mounts it empty; the status card, map and screens come later.
 *
 * Errors that happen outside rendering (a rejected promise, an uncaught event handler error)
 * are turned into a render-time throw, so the error boundary around the app shows them too.
 */
export function App(props: {
  readonly session: Session | null;
  readonly lockClearedOnReload: boolean;
}) {
  const { session, lockClearedOnReload } = props;
  const [asyncError, setAsyncError] = useState<unknown>(null);
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    const onFailure = (event: ErrorEvent | PromiseRejectionEvent): void => {
      setAsyncError('reason' in event ? event.reason : event.error);
    };
    window.addEventListener('error', onFailure);
    window.addEventListener('unhandledrejection', onFailure);
    return () => {
      window.removeEventListener('error', onFailure);
      window.removeEventListener('unhandledrejection', onFailure);
    };
  }, []);

  // When the page becomes visible again, recompute from the clock, so a long-backgrounded page
  // shows STALE (historical) and never an old fix as current (Review Focus 3).
  useEffect(
    () =>
      onResume(document, () => {
        setResult(session === null ? null : session.result(Date.now()));
      }),
    [session],
  );

  if (asyncError !== null) {
    throw asyncError instanceof Error ? asyncError : new Error('unexpected failure');
  }

  return (
    <div class="layout">
      <header>
        <h1>{t('app.title')}</h1>
        <p class="tagline">{t('app.tagline')}</p>
      </header>
      <main aria-labelledby="status-heading">
        <h2 id="status-heading" class="visually-hidden">
          {t('app.statusHeading')}
        </h2>
        {lockClearedOnReload && <p class="notice">{t('lock.clearedOnReload')}</p>}
        {result === null && <p>{t('app.noDataYet')}</p>}
      </main>
      <footer>{t('app.footer')}</footer>
    </div>
  );
}
