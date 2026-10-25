import { useEffect, useReducer, useRef, useState } from 'preact/hooks';
import { CoreInputError } from '@cantre/core';
import type { Fix, Lock, NetworkView } from '@cantre/core';
import { DataClientError } from '@cantre/data-client';
import type { AssetDetails, InstalledSnapshot } from '@cantre/data-client';
import { getLang, setLang, t } from '../i18n/index.js';
import { errorCode } from '../logic/errorCode.js';
import { watchFixes } from '../logic/geolocation.js';
import type { GeoLike } from '../logic/geolocation.js';
import { lockFlagIn } from '../logic/lockFlag.js';
import {
  IDLE,
  dataClientDeps,
  errorMessageKey,
  offlineReducer,
  readManifest,
  runDownload,
} from '../logic/offline.js';
import type { ManifestResult, OfflineDeps } from '../logic/offline.js';
import { directionTracker, present, presentAssets } from '../logic/present.js';
import type { AssetRow, CardModel } from '../logic/present.js';
import { createSession } from '../logic/session.js';
import type { Session } from '../logic/session.js';
import { updateSettings } from '../logic/settings.js';
import type { Settings as SettingsValue } from '../logic/settings.js';
import { onResume } from '../logic/visibility.js';
import type { Pin } from '../logic/find.js';
import { About } from './About.js';
import { AssetList } from './AssetList.js';
import { FindLocation } from './FindLocation.js';
import { FirstRun } from './FirstRun.js';
import { LiveRegion } from './LiveRegion.js';
import { MapPanel } from './MapView.js';
import type { YouFix } from './MapView.js';
import { OfflineData } from './OfflineData.js';
import { RouteChooser } from './RouteChooser.js';
import { Settings } from './Settings.js';
import { StatusCard } from './StatusCard.js';

/** The card is recomputed from the clock this often (ms). */
const TICK_MS = 1000;

/** The real data client, with the data folder next to the app (see `DATA_BASE_URL`). */
const DEFAULT_DEPS: OfflineDeps = dataClientDeps();

type Loaded = {
  readonly session: Session;
  readonly net: NetworkView;
  readonly details: AssetDetails;
  readonly snapshotDate: string;
};

type Phase =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly data: Loaded }
  /** Nothing is installed: the first-run screen offers the download. */
  | { readonly kind: 'firstRun' }
  /** Something is installed but cannot be used (damaged or unreadable): remove it and start again. */
  | { readonly kind: 'unavailable'; readonly code: string };

type Screen = 'main' | 'offline' | 'settings' | 'about';

type View = {
  readonly model: CardModel;
  readonly rows: readonly AssetRow[];
  readonly conflict: boolean;
  readonly nowMs: number;
  /** The last accepted fix for the "you" marker; null when none, or when it is historical. */
  readonly fix: YouFix | null;
};

/**
 * The fix for the "you" marker: the session's last accepted fix, hidden once it is historical
 * (STALE), so an old fix is never drawn as the current position.
 */
function youFixOf(fix: Fix | null, status: string): YouFix | null {
  return fix === null || status === 'STALE'
    ? null
    : { lat: fix.lat, lon: fix.lon, accuracyM: fix.accuracyM };
}

/** True for the errors a failed load can show as a message (the rest go to the error boundary). */
function isShownLoadError(error: unknown): boolean {
  return error instanceof DataClientError || error instanceof CoreInputError;
}

/**
 * The app layout. It loads the installed network, starts the matcher session and the
 * geolocation watch, and re-renders the status card once a second from
 * `session.result(Date.now())`. The app is the only place the clock is read.
 *
 * With no data installed it shows the first-run screen. Offline data, Settings and About are
 * screens reached from the menu; the matcher session and the geolocation watch keep running
 * underneath them.
 *
 * One settings object is held here and saved whole on every change (`updateSettings` merges into
 * the latest, never into a copy captured earlier). The active language is switched during render,
 * so every string on every screen follows the setting at once.
 *
 * Errors that happen outside rendering (a rejected promise, an uncaught event handler error)
 * are turned into a render-time throw, so the error boundary around the app shows them too.
 */
export function App(props: {
  readonly settings: SettingsValue;
  readonly lockClearedOnReload: boolean;
  /** Test seam: how the network is loaded at start-up. Defaults to the data client. */
  readonly load?: OfflineDeps['loadNetwork'];
  /** Test seam: the device geolocation. Defaults to `navigator.geolocation`. */
  readonly geo?: GeoLike | null;
  /** Test seam: the data client. Defaults to the real one. */
  readonly offline?: OfflineDeps;
}) {
  const { lockClearedOnReload, load, geo } = props;
  const deps = props.offline ?? DEFAULT_DEPS;

  const [settings, setSettings] = useState(props.settings);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  // Switch the language before anything below renders, so all text follows it immediately.
  if (getLang() !== settings.lang) {
    setLang(settings.lang);
  }
  useEffect(() => {
    document.documentElement.lang = settings.lang;
  }, [settings.lang]);

  const [asyncError, setAsyncError] = useState<unknown>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const [view, setView] = useState<View | null>(null);
  const tracker = useRef(directionTracker());
  const tickRef = useRef<(() => void) | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [pins, setPins] = useState<readonly Pin[]>([]);
  const [screen, setScreen] = useState<Screen>('main');
  const [offline, dispatchOffline] = useReducer(offlineReducer, IDLE);
  const [manifest, setManifest] = useState<ManifestResult | null>(null);
  const [installed, setInstalled] = useState<InstalledSnapshot | null>(null);
  const [reloadNotice, setReloadNotice] = useState(lockClearedOnReload);
  const [updateNotice, setUpdateNotice] = useState(false);

  /** Runs async work from an event handler; an unexpected failure goes to the error boundary. */
  const guard = (work: Promise<unknown>): void => {
    work.catch((error: unknown) => {
      setAsyncError(error);
    });
  };

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

  // Load the installed network. Nothing installed is the first-run screen; another typed failure
  // (a damaged copy) becomes a message with a way out; anything else goes to the error boundary.
  useEffect(() => {
    let cancelled = false;
    (load ?? deps.loadNetwork)()
      .then(async (loaded) => {
        const info = await deps.installedSnapshot();
        if (cancelled) {
          return;
        }
        const session = createSession(loaded.net, loaded.datasetVersion, lockFlagIn());
        setInstalled(info);
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
        if (error instanceof DataClientError && error.code === 'NOT_INSTALLED') {
          setPhase({ kind: 'firstRun' });
        } else if (isShownLoadError(error)) {
          setPhase({ kind: 'unavailable', code: errorCode(error) });
        } else {
          setAsyncError(error);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [load, deps]);

  // The manifest: needed for the first-run button's size, and for the Offline data screen's
  // "Update data". It is the same small file for everyone; it carries no position.
  const checkManifest = (): void => {
    setManifest(null);
    guard(
      readManifest(deps).then((result) => {
        setManifest(result);
      }),
    );
  };
  useEffect(() => {
    if (phase.kind === 'firstRun' || screen === 'offline') {
      checkManifest();
    }
    // `checkManifest` only reads `deps`; it is re-run when the screen or first-run state changes.
  }, [phase.kind === 'firstRun', screen === 'offline']);

  // Leaving a screen forgets a finished or failed download, so an old error does not linger.
  useEffect(() => {
    dispatchOffline({ type: 'reset' });
  }, [screen]);

  // Move focus to the new screen's heading, but not on the first render.
  const firstScreen = useRef(true);
  useEffect(() => {
    if (firstScreen.current) {
      firstScreen.current = false;
      return;
    }
    document.getElementById(screen === 'main' ? 'status-heading' : 'screen-heading')?.focus();
  }, [screen]);

  const data = phase.kind === 'ready' ? phase.data : null;

  // Recompute the card from the clock: once a second, and when the page becomes visible again,
  // so a long-backgrounded page shows STALE (historical), never an old fix as current. A change
  // of settings re-ticks at once (below) without restarting the geolocation watch.
  useEffect(() => {
    if (data === null) {
      return undefined;
    }
    const { session, net, snapshotDate } = data;
    const tick = (): void => {
      const nowMs = Date.now();
      const result = session.result(nowMs);
      const dir = tracker.current.update(result);
      const current = settingsRef.current;
      setView({
        model: present(result, net, current, { snapshotDate }),
        rows: presentAssets(result, net, current, dir),
        conflict: result.status === 'LOCK_CONFLICT',
        nowMs,
        fix: youFixOf(session.state.lastFix, result.status),
      });
    };
    tickRef.current = tick;
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
      tickRef.current = null;
      clearInterval(timer);
      stopResume();
      stopWatch?.();
    };
  }, [data, geo]);
  useEffect(() => {
    tickRef.current?.();
  }, [settings]);

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
  const changeSettings = (change: Partial<SettingsValue>): void => {
    // Merge into the LATEST settings and save the whole object (not a copy from an old render).
    const next = updateSettings(settingsRef.current, change);
    settingsRef.current = next;
    setSettings(next);
  };
  const showOnMap = (found: readonly Pin[]): void => {
    setPins(found);
    setMapOpen(true);
  };

  // First run or update: download, verify, then use the new network. A failure leaves the
  // current network and session untouched (Review Focus 4). An update to a new dataset version
  // keeps the session but clears any route lock, and says so (Review Focus 5, D6).
  const download = (): void => {
    if (manifest?.kind !== 'manifest') {
      return;
    }
    guard(
      runDownload(deps, manifest.manifest, dispatchOffline).then(async (loaded) => {
        if (loaded === null) {
          return;
        }
        setInstalled(await deps.installedSnapshot());
        const current = phaseRef.current;
        if (current.kind === 'ready') {
          const { session } = current.data;
          session.replaceNetwork(loaded.net, loaded.datasetVersion);
          setUpdateNotice(session.state.lockClearedByUpdate);
          setPhase({
            kind: 'ready',
            data: {
              session,
              net: loaded.net,
              details: loaded.details,
              snapshotDate: loaded.snapshotDate,
            },
          });
        } else {
          setPhase({
            kind: 'ready',
            data: {
              session: createSession(loaded.net, loaded.datasetVersion, lockFlagIn()),
              net: loaded.net,
              details: loaded.details,
              snapshotDate: loaded.snapshotDate,
            },
          });
        }
      }),
    );
  };

  // Remove data: delete the cached snapshot and return to first run.
  const remove = (): void => {
    guard(
      (async () => {
        const current = phaseRef.current;
        if (current.kind === 'ready') {
          current.data.session.unlock(); // also clears the "a lock was set" flag
        }
        await deps.removeSnapshot();
        setInstalled(null);
        setView(null);
        setPins([]);
        setUpdateNotice(false);
        setManifest(null);
        setPhase({ kind: 'firstRun' });
        setScreen('main');
      })(),
    );
  };

  const go = (target: Screen): void => {
    setScreen(screen === target ? 'main' : target);
  };
  const headingId =
    screen === 'main' && phase.kind !== 'firstRun' ? 'status-heading' : 'screen-heading';
  const menu = (target: Screen, label: string) => (
    <button
      type="button"
      class="nav__button"
      aria-current={screen === target ? 'page' : undefined}
      onClick={() => {
        go(target);
      }}
    >
      {label}
    </button>
  );

  return (
    <div class="layout">
      <header>
        <h1>{t('app.title')}</h1>
        <p class="tagline">{t('app.tagline')}</p>
        <nav class="nav" aria-label={t('nav.label')}>
          {phase.kind === 'ready' || phase.kind === 'unavailable'
            ? menu('offline', t('nav.offline'))
            : null}
          {menu('settings', t('nav.settings'))}
          {menu('about', t('nav.about'))}
        </nav>
      </header>
      <main aria-labelledby={headingId}>
        {reloadNotice && (
          <p class="notice" role="status">
            {t('lock.clearedOnReload')}{' '}
            <button
              type="button"
              onClick={() => {
                setReloadNotice(false);
              }}
            >
              {t('lock.dismiss')}
            </button>
          </p>
        )}
        {updateNotice && (
          <p class="notice" role="status">
            {t('lock.clearedByUpdate')}{' '}
            <button
              type="button"
              onClick={() => {
                data?.session.dismissNotice();
                setUpdateNotice(false);
              }}
            >
              {t('lock.dismiss')}
            </button>
          </p>
        )}
        {screen !== 'main' && (
          <p>
            <button
              type="button"
              onClick={() => {
                setScreen('main');
              }}
            >
              {t('nav.back')}
            </button>
          </p>
        )}
        {screen === 'settings' && <Settings settings={settings} onChange={changeSettings} />}
        {screen === 'about' && <About installed={installed} />}
        {screen === 'offline' && (
          <OfflineData
            installed={installed}
            damagedCode={phase.kind === 'unavailable' ? phase.code : null}
            remote={manifest}
            state={offline}
            onUpdate={download}
            onCheck={checkManifest}
            onRemove={remove}
          />
        )}
        {screen === 'main' && (
          <>
            {headingId === 'status-heading' && (
              <h2 id="status-heading" class="visually-hidden" tabIndex={-1}>
                {t('app.statusHeading')}
              </h2>
            )}
            {phase.kind === 'loading' && <p>{t('app.loadingData')}</p>}
            {phase.kind === 'firstRun' && (
              <FirstRun
                manifest={manifest}
                state={offline}
                onDownload={download}
                onRetryManifest={checkManifest}
              />
            )}
            {phase.kind === 'unavailable' && (
              <section role="alert">
                <p>{t(errorMessageKey(phase.code))}</p>
                <p>{t('app.noDataBody')}</p>
                <button type="button" onClick={remove}>
                  {t('offline.remove')}
                </button>
              </section>
            )}
            {phase.kind === 'ready' && view === null && <p>{t('app.loadingData')}</p>}
            {phase.kind === 'ready' && view !== null && (
              <>
                <StatusCard model={view.model} onUnlock={unlock} />
                <RouteChooser
                  choices={view.model.choices}
                  conflict={view.conflict}
                  partialSingleRoute={view.model.partialSingleRoute}
                  onChoose={choose}
                />
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
                  basemap={settings.basemap}
                  open={mapOpen}
                  onOpenChange={setMapOpen}
                  onBasemapChange={(basemap) => {
                    changeSettings({ basemap });
                  }}
                />
              </>
            )}
          </>
        )}
      </main>
      <footer>{t('app.footer')}</footer>
    </div>
  );
}
