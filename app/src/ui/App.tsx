import { useEffect, useMemo, useReducer, useRef, useState } from 'preact/hooks';
import { CoreInputError } from '@cantre/core';
import type { Fix, Lock, NetworkAsset, NetworkView, Result } from '@cantre/core';
import { DataClientError, ensureNetwork } from '@cantre/data-client';
import type { AssetDetails, InstalledSnapshot } from '@cantre/data-client';
import { getLang, setLang, t } from '../i18n/index.js';
import { errorCode, isFatalUncaught } from '../logic/errorCode.js';
import { watchFixes } from '../logic/geolocation.js';
import type { GeoLike } from '../logic/geolocation.js';
import { lockFlagIn } from '../logic/lockFlag.js';
import {
  IDLE,
  DATA_BASE_URL,
  dataClientDeps,
  errorMessageKey,
  offlineReducer,
  readManifest,
  runDownload,
} from '../logic/offline.js';
import type { ManifestResult, OfflineDeps } from '../logic/offline.js';
import { directionTracker, present } from '../logic/present.js';
import type { CardModel } from '../logic/present.js';
import { mainlines } from '../logic/mainlines.js';
import { MainlineChooser } from './MainlineChooser.js';
import { createSession } from '../logic/session.js';
import type { Session } from '../logic/session.js';
import { updateSettings } from '../logic/settings.js';
import type { Settings as SettingsValue } from '../logic/settings.js';
import { onResume } from '../logic/visibility.js';
import type { Pin } from '../logic/find.js';
import { About } from './About.js';
import { VisibleAssets } from './VisibleAssets.js';
import { ASSET_KINDS, DEFAULT_ASSET_KINDS } from '../logic/visibleAssets.js';
import { FindLocation } from './FindLocation.js';
import { Sheet } from './Sheet.js';
import { WakeButton } from './WakeButton.js';
import { BasemapSwitch } from './BasemapSwitch.js';
import { LiveRegion } from './LiveRegion.js';
import { MapView } from './MapView.js';
import type { YouFix } from './MapView.js';
import { OfflineData } from './OfflineData.js';
import { RouteChooser } from './RouteChooser.js';
import { Settings } from './Settings.js';
import { StatusCard } from './StatusCard.js';

/** The card is recomputed from the clock this often (ms). */
const TICK_MS = 1000;
const EMPTY_NETWORK: NetworkView = {
  datasetVersion: '',
  coverage: [],
  chains: [],
  segments: [],
  intervals: [],
  diamonds: [],
  assets: [],
};

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
  /** The user removed the cached data; the HUD offers Retry. */
  | { readonly kind: 'firstRun' }
  /** Something is installed but cannot be used (damaged or unreadable): remove it and start again. */
  | { readonly kind: 'unavailable'; readonly code: string };

type Screen =
  | 'main'
  | 'menu'
  | 'route'
  | 'find'
  | 'assets'
  | 'details'
  | 'layers'
  | 'offline'
  | 'settings'
  | 'about';

type View = {
  readonly model: CardModel;
  readonly direction: 'up' | 'down' | null;
  readonly result: Result;
  readonly speedMps: number | null;
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
  return fix === null || ['STALE', 'NO_PERMISSION', 'NO_FIX'].includes(status)
    ? null
    : { lat: fix.lat, lon: fix.lon, accuracyM: fix.accuracyM };
}

/** True for the errors a failed load can show as a message (the rest go to the error boundary). */
function isShownLoadError(error: unknown): boolean {
  return error instanceof DataClientError || error instanceof CoreInputError;
}

/**
 * The map-first app. It automatically loads verified rail data alongside the
 * geolocation watch, and re-renders the status card once a second from
 * `session.result(Date.now())`. The app is the only place the clock is read.
 *
 * Without a usable cache it fetches the hosted snapshot. Data, Settings and About are
 * sheets reached from the menu; the matcher session and the geolocation watch keep running
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

  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => {
      setOnline(navigator.onLine);
    };
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
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
  const kinds = settings.assetKinds ?? DEFAULT_ASSET_KINDS;
  const [assets, setAssets] = useState<readonly NetworkAsset[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);
  const [following, setFollowing] = useState(true);
  const [recenter, setRecenter] = useState(0);
  const [attempt, setAttempt] = useState(0);
  // A tiny empty-network session validates and retains only the latest fix during loading.
  const liveSession = useRef(createSession(EMPTY_NETWORK, '', lockFlagIn()));
  const [pins, setPins] = useState<readonly Pin[]>([]);
  const sheetOpener = useRef<HTMLElement | null>(null);
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
      const value: unknown = 'reason' in event ? event.reason : event.error;
      if (!isFatalUncaught(value)) {
        // No value, so no code: a typed non-fatal note in the local console only (nothing is
        // sent anywhere), and the app keeps running.
        console.warn(`cantre: NON_FATAL_UNCAUGHT (${event.type} with no value)`);
        return;
      }
      setAsyncError(value);
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
    setPhase({ kind: 'loading' });
    (load ?? (() => ensureNetwork(DATA_BASE_URL)))()
      .then(async (loaded) => {
        const info = await deps.installedSnapshot().catch(() => null);
        if (cancelled) {
          return;
        }
        const session = liveSession.current;
        const { lastFix, permission } = session.state;
        session.replaceNetwork(loaded.net, loaded.datasetVersion);
        session.dispatch({ type: 'permission', state: permission });
        if (lastFix !== null && permission === 'granted')
          session.dispatch({ type: 'fix', fix: lastFix });
        setInstalled(info?.datasetVersion === loaded.datasetVersion ? info : null);
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
        if (isShownLoadError(error)) {
          setPhase({ kind: 'unavailable', code: errorCode(error) });
        } else {
          setAsyncError(error);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [load, deps, attempt]);

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

  const data = phase.kind === 'ready' ? phase.data : null;
  const availableKinds = useMemo(() => {
    const present = new Set(data?.net.assets.map((asset) => asset.kind));
    return ASSET_KINDS.filter((kind) => present.has(kind));
  }, [data]);

  // Start immediately, independently of data loading and sheets. One watch per app.
  useEffect(() => {
    const device = geo === undefined ? (navigator.geolocation as GeoLike | undefined) : geo;
    const stopWatch =
      device === undefined || device === null
        ? null
        : watchFixes(device, Date.now, (event) => {
            liveSession.current.dispatch(event);
          });
    if (stopWatch === null) {
      // No geolocation API in this browser: say so with the matcher's own reason.
      liveSession.current.dispatch({ type: 'locationError', code: 'UNAVAILABLE' });
    }
    return () => {
      stopWatch?.();
    };
  }, [geo]);

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
        direction:
          dir === null || result.milepost?.kind !== 'calibrated'
            ? null
            : (result.milepost.upper.mp - result.milepost.lower.mp) *
                  (result.milepost.upper.s - result.milepost.lower.s) >
                  0 ===
                (dir === 'up')
              ? 'up'
              : 'down',
        result,
        speedMps:
          youFixOf(session.state.lastFix, result.status) === null
            ? null
            : (session.state.lastFix?.speedMps ?? null),
        model: present(result, net, current, { snapshotDate }),
        conflict: result.status === 'LOCK_CONFLICT',
        nowMs,
        fix: youFixOf(session.state.lastFix, result.status),
      });
    };
    tickRef.current = tick;
    tick();
    const timer = setInterval(tick, TICK_MS);
    const stopResume = onResume(document, tick);
    return () => {
      tickRef.current = null;
      clearInterval(timer);
      stopResume();
    };
  }, [data]);
  useEffect(() => {
    tickRef.current?.();
  }, [settings]);

  if (asyncError !== null) {
    throw asyncError instanceof Error ? asyncError : new Error('unexpected failure');
  }

  const choose = (lock: Lock): void => {
    // The user's explicit choice locks the route. The matcher never switches on its own.
    data?.session.lock(lock);
    tickRef.current?.();
    if (screen === 'route') setScreen('main');
  };
  const unlock = (): void => {
    data?.session.unlock();
    tickRef.current?.();
  };
  const changeSettings = (change: Partial<SettingsValue>): void => {
    // Merge into the LATEST settings and save the whole object (not a copy from an old render).
    const next = updateSettings(settingsRef.current, change);
    settingsRef.current = next;
    setSettings(next);
  };
  const showOnMap = (found: readonly Pin[]): void => {
    setPins(found);
    setFollowing(false);
    setScreen('main');
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

  const menu = (target: Screen, label: string) => (
    <button
      type="button"
      onClick={() => {
        if (target === 'assets') setSelectedAsset(null);
        setScreen(target);
      }}
    >
      {label}
    </button>
  );
  const model = view?.model;
  const result = view?.result;
  const live = view?.fix !== null && view?.fix !== undefined;
  const mainlineSearch = useMemo(
    () => (data && view?.fix ? mainlines(data.net, view.fix, result?.lock ?? null) : null),
    [
      data?.net,
      view?.fix?.lat,
      view?.fix?.lon,
      view?.fix?.accuracyM,
      result?.lock?.kind,
      result?.lock && JSON.stringify(result.lock),
    ],
  );
  const nearest = mainlineSearch?.selected ?? null;
  const nearestMp = nearest?.milepost?.kind === 'calibrated' ? nearest.milepost.mp : null;
  const numeric = nearestMp;
  // Strict-matcher direction belongs only to the same chain, never a different projected mainline.
  const mainlineDirection =
    nearest && result?.chosen?.chainId && result.chosen.chainId === nearest.candidate.chainId
      ? view?.direction
      : null;
  const number = (n: number, digits = 0) =>
    new Intl.NumberFormat(settings.lang, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(n);
  // 1 international foot = 0.3048 m; 1 international mile = 1609.344 m.
  const speed = view?.speedMps;
  const speedText =
    speed === null || speed === undefined || speed < 0
      ? '—'
      : number(speed * (settings.units === 'mi' ? 3600 / 1609.344 : 3.6));
  const accuracyText = live
    ? number(view.fix.accuracyM / (settings.units === 'mi' ? 0.3048 : 1))
    : '—';

  const tappedAsset = data?.net.assets.find((asset) => asset.id === selectedAsset);
  const title =
    screen === 'settings'
      ? t('nav.settings')
      : screen === 'about'
        ? t('nav.about')
        : screen === 'offline'
          ? t('hud.data')
          : screen === 'route'
            ? t('hud.route')
            : screen === 'find'
              ? t('find.heading')
              : screen === 'assets'
                ? tappedAsset
                  ? (tappedAsset.name ?? t(`asset.kind.${tappedAsset.kind}`))
                  : t('hud.assets')
                : screen === 'details'
                  ? t('hud.details')
                  : screen === 'layers'
                    ? t('hud.layers')
                    : t('hud.menu');
  return (
    <main
      class="rail-app"
      onClickCapture={(event) => {
        // Safari does not focus buttons on pointer click. Remember the actual opener
        // so closing a modal restores focus consistently for mouse, touch and keyboard.
        if (screen === 'main' && event.target instanceof Element)
          sheetOpener.current = event.target.closest('button');
      }}
    >
      <h1 class="visually-hidden">{t('app.title')}</h1>
      <MapView
        net={data?.net ?? EMPTY_NETWORK}
        fix={view?.fix ?? null}
        pins={pins}
        basemap={settings.basemap}
        kinds={kinds}
        onAssets={setAssets}
        onAssetTap={(id) => {
          setSelectedAsset(id);
          setScreen('assets');
        }}
        following={following}
        onExplore={() => {
          setFollowing(false);
        }}
        recenter={recenter}
      />
      <section class="rail-hud" aria-label={t('app.statusHeading')}>
        <div class="hud-head">
          <button
            class="hud-icon"
            type="button"
            aria-label={t('hud.menu')}
            onClick={() => {
              setScreen('menu');
            }}
          >
            ☰
          </button>
          <button
            class="hud-route"
            type="button"
            onClick={() => {
              setScreen('route');
            }}
            disabled={data === null}
            aria-label={[
              t('hud.route'),
              result?.lock ? model?.lockText : nearest?.candidate.subdivisionName,
            ]
              .filter(Boolean)
              .join(': ')}
          >
            {nearest?.candidate.subdivisionName ??
              (result?.lock ? model?.lockText : null) ??
              t(phase.kind === 'loading' ? 'hud.loading' : 'hud.route')}
            {mainlineDirection && (
              <span
                class="hud-live"
                aria-label={
                  mainlineDirection === 'up' ? t('asset.side.higherMp') : t('asset.side.lowerMp')
                }
              >
                {mainlineDirection === 'up' ? ' ↗' : ' ↘'}
              </span>
            )}
            {result?.lock && <span class="hud-lock"> · {t('hud.locked')}</span>}
          </button>
          <WakeButton />
        </div>
        <button
          class="hud-reading"
          type="button"
          onClick={() => {
            setScreen('details');
          }}
          aria-label={t('hud.details')}
        >
          <span class="hud-mp">{numeric !== null ? number(numeric, 3) : '—'}</span>
          <span class="hud-caption">
            {t(
              nearest
                ? result?.lock
                  ? 'mainline.lockedCaption'
                  : 'hud.nearestMp'
                : 'hud.calculated',
            )}
          </span>
        </button>
        <div class="hud-stats">
          <div>
            <strong>{speedText}</strong>
            <span>{t(settings.units === 'mi' ? 'hud.mph' : 'hud.kmh')}</span>
          </div>
          <div>
            <strong>{accuracyText}</strong>
            <span>{t(settings.units === 'mi' ? 'hud.ftAccuracy' : 'hud.mAccuracy')}</span>
          </div>
          <div>
            <strong class={live ? 'hud-live' : 'hud-wait'}>●</strong>
            <span>
              {t(live ? 'hud.live' : result?.status === 'STALE' ? 'hud.stale' : 'hud.noFix')}
            </span>
          </div>
        </div>
        {nearest && (
          <p class="hud-exploring" role="status">
            {t('hud.trackDistance', {
              distance: number(
                nearest.candidate.residualM / (settings.units === 'mi' ? 1609.344 : 1000),
                2,
              ),
              unit: settings.units === 'mi' ? 'mi' : 'km',
            })}
            {nearestMp === null ? ` · ${t('hud.noTrackMp')}` : ''}
            {nearest.tier === 'unverified' ? ` · ${t('mainline.unverified')}` : ''}
            <br />
            {t(result?.lock ? 'hud.locked' : 'mainline.auto')}
          </p>
        )}
        {phase.kind === 'loading' ? (
          <p class="hud-notice" role="status">
            {t('hud.loading')}
          </p>
        ) : phase.kind === 'unavailable' || phase.kind === 'firstRun' ? (
          <div class="hud-notice" role="alert">
            <p>
              {phase.kind === 'unavailable' ? t(errorMessageKey(phase.code)) : t('app.noDataBody')}
            </p>
            <button
              type="button"
              onClick={() => {
                setAttempt((n) => n + 1);
              }}
            >
              {t('hud.retry')}
            </button>
          </div>
        ) : (
          numeric === null &&
          !nearest && (
            <button
              class="hud-notice"
              type="button"
              onClick={() => {
                setScreen(
                  result?.status === 'AMBIGUOUS_ROUTE' || result?.status === 'LOCK_CONFLICT'
                    ? 'route'
                    : 'details',
                );
              }}
            >
              {live ? t('mainline.none') : (model?.headline ?? t('hud.waiting'))}
            </button>
          )
        )}
        {!online && (
          <p class="hud-exploring" role="status">
            {t('hud.offline')}
          </p>
        )}
        {!following && <p class="hud-exploring">{t('hud.exploring')}</p>}
        {reloadNotice && (
          <button
            class="hud-notice"
            type="button"
            onClick={() => {
              setReloadNotice(false);
            }}
          >
            {t('lock.clearedOnReload')} · {t('lock.dismiss')}
          </button>
        )}
        {updateNotice && (
          <button
            class="hud-notice"
            type="button"
            onClick={() => {
              data?.session.dismissNotice();
              setUpdateNotice(false);
            }}
          >
            {t('lock.clearedByUpdate')} · {t('lock.dismiss')}
          </button>
        )}
      </section>
      <div class="hud-controls">
        <button
          class="hud-pill"
          type="button"
          onClick={() => {
            setScreen('layers');
          }}
        >
          {t('hud.layers')} ▴
        </button>
        <button
          class={`hud-pill hud-recenter ${following ? 'is-following' : ''}`}
          type="button"
          aria-label={t('hud.recenter')}
          aria-pressed={following}
          disabled={!live}
          onClick={() => {
            setFollowing(true);
            setRecenter((n) => n + 1);
          }}
        >
          ◎
        </button>
      </div>
      {!settings.basemap && (
        <button
          class="hud-basemap"
          type="button"
          onClick={() => {
            setScreen('layers');
          }}
        >
          {t('hud.background')}
        </button>
      )}
      {view && <LiveRegion model={view.model} nowMs={view.nowMs} />}
      {screen !== 'main' && (
        <Sheet
          opener={sheetOpener.current}
          title={title}
          onClose={() => {
            setScreen('main');
          }}
        >
          {screen === 'menu' && (
            <nav class="sheet-menu" aria-label={t('nav.label')}>
              {menu('find', t('find.heading'))}
              {menu('route', t('hud.route'))}
              {menu('assets', t('hud.assets'))}
              {menu('details', t('hud.details'))}
              {menu('settings', t('nav.settings'))}
              {menu('offline', t('hud.data'))}
              {menu('about', t('nav.about'))}
            </nav>
          )}
          {screen === 'route' && (
            <>
              <p>{model?.lockText}</p>
              <MainlineChooser
                choices={mainlineSearch?.choices ?? []}
                lock={result?.lock ?? null}
                units={settings.units}
                onChoose={choose}
                onAuto={() => {
                  unlock();
                  setScreen('main');
                }}
              />
            </>
          )}
          {screen === 'find' &&
            (data ? (
              <FindLocation net={data.net} onShowOnMap={showOnMap} />
            ) : (
              <p>{t('hud.loading')}</p>
            ))}
          {screen === 'assets' &&
            (view && data ? (
              <VisibleAssets
                net={data.net}
                assets={selectedAsset === null ? assets : tappedAsset ? [tappedAsset] : []}
                details={data.details}
                selected={selectedAsset}
              />
            ) : (
              <p>{t('hud.loading')}</p>
            ))}
          {screen === 'details' &&
            (model ? (
              <>
                {nearest && (
                  <p>
                    {t('hud.nearestMp')}: {nearest.candidate.subdivisionName} ·{' '}
                    {nearestMp === null ? t('hud.noTrackMp') : number(nearestMp, 3)}
                  </p>
                )}
                <StatusCard model={model} onUnlock={unlock} />
                {result?.status === 'NO_PERMISSION' && <p>{t('hud.permission')}</p>}
                <RouteChooser
                  choices={view.model.choices}
                  conflict={view.conflict}
                  singleRoute={view.model.singleRoute}
                  onChoose={choose}
                />
              </>
            ) : (
              <p>{t('hud.waiting')}</p>
            ))}
          {screen === 'layers' && (
            <>
              <fieldset>
                <legend>{t('hud.layers')}</legend>
                {availableKinds.map((kind) => (
                  <label class="layer-choice" key={kind}>
                    <input
                      type="checkbox"
                      checked={kinds.includes(kind)}
                      onChange={(e) => {
                        const checked = e.currentTarget.checked;
                        changeSettings({
                          assetKinds: checked ? [...kinds, kind] : kinds.filter((k) => k !== kind),
                        });
                      }}
                    />
                    {t(`asset.kind.${kind}`)}
                  </label>
                ))}
              </fieldset>
              <BasemapSwitch
                basemap={settings.basemap}
                onChange={(basemap) => {
                  changeSettings({ basemap });
                }}
              />
            </>
          )}
          {screen === 'settings' && <Settings settings={settings} onChange={changeSettings} />}
          {screen === 'about' && <About installed={installed} />}
          {screen === 'offline' && (
            <>
              <p>{t('hud.notice')}</p>
              {data && (
                <p>
                  {data.net.datasetVersion} · {data.snapshotDate}
                </p>
              )}
              {installed === null && data && <p>{t('hud.notSaved')}</p>}
              <OfflineData
                installed={installed}
                damagedCode={phase.kind === 'unavailable' ? phase.code : null}
                remote={manifest}
                state={offline}
                onUpdate={download}
                onCheck={checkManifest}
                onRemove={remove}
              />
            </>
          )}
        </Sheet>
      )}
    </main>
  );
}
