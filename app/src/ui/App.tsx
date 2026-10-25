import { useEffect, useRef, useState } from 'preact/hooks';
import type { Fix, Lock, NetworkView } from '@cantre/core';
import { DataClientError, loadNetwork } from '@cantre/data-client';
import type { AssetDetails } from '@cantre/data-client';
import { DATA_CLIENT_CODES, t } from '../i18n/index.js';
import type { MessageKey } from '../i18n/index.js';
import { watchFixes } from '../logic/geolocation.js';
import type { GeoLike } from '../logic/geolocation.js';
import { lockFlagIn } from '../logic/lockFlag.js';
import { directionTracker, present, presentAssets } from '../logic/present.js';
import type { AssetRow, CardModel } from '../logic/present.js';
import { createSession } from '../logic/session.js';
import type { Session } from '../logic/session.js';
import { saveSettings } from '../logic/settings.js';
import type { Settings } from '../logic/settings.js';
import { onResume } from '../logic/visibility.js';
import type { Pin } from '../logic/find.js';
import { AssetList } from './AssetList.js';
import { FindLocation } from './FindLocation.js';
import { LiveRegion } from './LiveRegion.js';
import { MapPanel } from './MapView.js';
import type { YouFix } from './MapView.js';
import { RouteChooser } from './RouteChooser.js';
import { StatusCard } from './StatusCard.js';

/** The card is recomputed from the clock this often (ms). */
const TICK_MS = 1000;

type Loaded = {
  readonly session: Session;
  readonly net: NetworkView;
  readonly details: AssetDetails;
  readonly snapshotDate: string;
};

type Phase =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly data: Loaded }
  | { readonly kind: 'unavailable'; readonly code: string };

type View = {
  readonly model: CardModel;
  readonly rows: readonly AssetRow[];
  readonly conflict: boolean;
  readonly nowMs: number;
  /** The last accepted fix for the "you" marker; null when none, or when it is historical. */
  readonly fix: YouFix | null;
};

/** True when `code` is one of the data-client codes the catalogue has a message for. */
function isDataClientCode(code: string): code is (typeof DATA_CLIENT_CODES)[number] {
  return (DATA_CLIENT_CODES as readonly string[]).includes(code);
}

/**
 * The fix for the "you" marker: the session's last accepted fix, hidden once it is historical
 * (STALE), so an old fix is never drawn as the current position.
 */
function youFixOf(fix: Fix | null, status: string): YouFix | null {
  return fix === null || status === 'STALE'
    ? null
    : { lat: fix.lat, lon: fix.lon, accuracyM: fix.accuracyM };
}

/**
 * The app layout. It loads the installed network (Task 7 adds the download and first-run
 * screens; until then a plain "no data installed" state is shown), starts the matcher session
 * and the geolocation watch, and re-renders the status card once a second from
 * `session.result(Date.now())`. The app is the only place the clock is read.
 *
 * Errors that happen outside rendering (a rejected promise, an uncaught event handler error)
 * are turned into a render-time throw, so the error boundary around the app shows them too.
 */
export function App(props: {
  readonly settings: Settings;
  readonly lockClearedOnReload: boolean;
  /** Test seam: how the network is loaded. Defaults to the data client's `loadNetwork`. */
  readonly load?: typeof loadNetwork;
  /** Test seam: the device geolocation. Defaults to `navigator.geolocation`. */
  readonly geo?: GeoLike | null;
}) {
  const { settings, lockClearedOnReload, load, geo } = props;
  const [asyncError, setAsyncError] = useState<unknown>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [view, setView] = useState<View | null>(null);
  const tracker = useRef(directionTracker());
  const [mapOpen, setMapOpen] = useState(false);
  const [basemap, setBasemap] = useState(settings.basemap);
  const [pins, setPins] = useState<readonly Pin[]>([]);

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

  // Load the installed network. A typed data-client error becomes a message; anything else goes
  // to the error boundary.
  useEffect(() => {
    let cancelled = false;
    (load ?? loadNetwork)()
      .then((loaded) => {
        if (cancelled) {
          return;
        }
        const session = createSession(loaded.net, loaded.datasetVersion, lockFlagIn());
        setPhase({
          kind: 'ready',
          data: {
            session,
            net: loaded.net,
            details: loaded.details,
            snapshotDate: loaded.snapshotDate,
          },
        });
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        if (error instanceof DataClientError && isDataClientCode(error.code)) {
          setPhase({ kind: 'unavailable', code: error.code });
        } else {
          setAsyncError(error);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const data = phase.kind === 'ready' ? phase.data : null;

  // Recompute the card from the clock: once a second, and when the page becomes visible again,
  // so a long-backgrounded page shows STALE (historical), never an old fix as current.
  useEffect(() => {
    if (data === null) {
      return undefined;
    }
    const { session, net, snapshotDate } = data;
    const tick = (): void => {
      const nowMs = Date.now();
      const result = session.result(nowMs);
      const dir = tracker.current.update(result);
      setView({
        model: present(result, net, settings, { snapshotDate }),
        rows: presentAssets(result, net, settings, dir),
        conflict: result.status === 'LOCK_CONFLICT',
        nowMs,
        fix: youFixOf(session.state.lastFix, result.status),
      });
    };
    const device = geo === undefined ? (navigator.geolocation as GeoLike | undefined) : geo;
    const stopWatch =
      device === undefined || device === null
        ? null
        : watchFixes(device, Date.now, (event) => {
            session.dispatch(event);
          });
    if (stopWatch === null) {
      // No geolocation API in this browser: say so with the matcher's own reason.
      session.dispatch({ type: 'locationError', code: 'UNAVAILABLE' });
    }
    tick();
    const timer = setInterval(tick, TICK_MS);
    const stopResume = onResume(document, tick);
    return () => {
      clearInterval(timer);
      stopResume();
      stopWatch?.();
    };
  }, [data, settings, geo]);

  if (asyncError !== null) {
    throw asyncError instanceof Error ? asyncError : new Error('unexpected failure');
  }

  const choose = (lock: Lock): void => {
    // The user's explicit choice locks the route. The matcher never switches on its own.
    data?.session.lock(lock);
  };
  const unlock = (): void => {
    data?.session.unlock();
  };
  const changeBasemap = (on: boolean): void => {
    // Consent (D2) is stored as a setting; the notice was shown before this is called with true.
    setBasemap(on);
    saveSettings({ ...settings, basemap: on });
  };
  const showOnMap = (found: readonly Pin[]): void => {
    setPins(found);
    setMapOpen(true);
  };

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
        {phase.kind === 'loading' && <p>{t('app.loadingData')}</p>}
        {phase.kind === 'unavailable' && (
          <section role="alert">
            <p>{t(`error.${phase.code}` as MessageKey)}</p>
            <p>{t('app.noDataBody')}</p>
          </section>
        )}
        {phase.kind === 'ready' && view === null && <p>{t('app.loadingData')}</p>}
        {phase.kind === 'ready' && view !== null && (
          <>
            <StatusCard model={view.model} onUnlock={unlock} />
            <RouteChooser choices={view.model.choices} conflict={view.conflict} onChoose={choose} />
            <AssetList rows={view.rows} details={phase.data.details} />
            <LiveRegion model={view.model} nowMs={view.nowMs} />
          </>
        )}
        {phase.kind === 'ready' && (
          <>
            <FindLocation net={phase.data.net} onShowOnMap={showOnMap} />
            <MapPanel
              net={phase.data.net}
              fix={view?.fix ?? null}
              pins={pins}
              basemap={basemap}
              open={mapOpen}
              onOpenChange={setMapOpen}
              onBasemapChange={changeBasemap}
            />
          </>
        )}
      </main>
      <footer>{t('app.footer')}</footer>
    </div>
  );
}
