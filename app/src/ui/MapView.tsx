import { useEffect, useRef, useState } from 'preact/hooks';
import type { LatLon, NetworkView } from '@cantre/core';
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import { t } from '../i18n/index.js';
import { BasemapSwitch } from './BasemapSwitch.js';
import { presentTap } from '../logic/find.js';
import type { Pin, TapModel } from '../logic/find.js';
import {
  BASEMAP_STYLE_URL,
  SOURCE,
  attributionOf,
  cantreLayers,
  cantreSources,
  displayDataOf,
  offlineStyle,
  pinsData,
  youData,
} from '../logic/mapdata.js';

/** The last accepted GPS fix, for the "you" marker. Held by the session only; nothing is stored. */
export type YouFix = LatLon & { readonly accuracyM: number };

type SourceData = Parameters<GeoJSONSource['setData']>[0];

/** Opening view when there is no fix: all of Canada, degrees [lon, lat] and zoom level. */
const CANADA_CENTER: [number, number] = [-96, 56];
const CANADA_ZOOM = 3;
/** How long the basemap style may take before the map falls back to the plain background. */
const BASEMAP_TIMEOUT_MS = 10_000;
/** Zoom for a fix or a found location (about a 5 km view). */
const CLOSE_ZOOM = 12;

const prefersDark = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;

/**
 * The map (spec §7, §11). MapLibre GL JS is loaded with a dynamic `import()`, so it is a separate
 * chunk that costs nothing until the map is opened.
 *
 * Privacy (ruling P15, decision D2): with `basemap` false the map uses an inline style with no
 * glyphs, no sprite and no symbol layer, so it fetches nothing. With `basemap` true it loads the
 * OpenFreeMap style, the only extra host; the caller shows the consent notice first.
 * Tracks and assets are drawn from a copy of the network (`displayDataOf`), built once; the
 * calculation geometry is never changed. The "you" marker uses the last accepted fix only.
 * A tap calls `milepostAtPoint` and shows the result as "from map position, no GPS": it never
 * reaches the matcher and never makes a fix.
 */
export function MapView(props: {
  readonly net: NetworkView;
  readonly fix: YouFix | null;
  readonly pins: readonly Pin[];
  readonly basemap: boolean;
}) {
  const { net, fix, pins, basemap } = props;
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [tap, setTap] = useState<TapModel | null>(null);
  const [basemapFailed, setBasemapFailed] = useState(false);

  // Basemap watch. The app's own layers are added to the remote style only after it loads, so a
  // failed or slow style fetch would leave the map empty. While a basemap style is loading, an
  // error or a timeout switches to the offline style, so tracks always draw, and says so.
  const watch = useRef<{
    basemap: boolean;
    ready: boolean;
    timer: ReturnType<typeof setTimeout> | null;
  }>({ basemap: false, ready: false, timer: null });
  const stopTimer = (): void => {
    if (watch.current.timer !== null) {
      clearTimeout(watch.current.timer);
      watch.current.timer = null;
    }
  };
  const fallBack = (map: MapLibreMap): void => {
    if (!watch.current.basemap || watch.current.ready) {
      return;
    }
    watch.current.basemap = false;
    stopTimer();
    map.setStyle(offlineStyle(prefersDark()));
    setBasemapFailed(true);
  };
  const watchBasemap = (map: MapLibreMap): void => {
    stopTimer();
    watch.current.basemap = true;
    watch.current.ready = false;
    watch.current.timer = setTimeout(() => {
      fallBack(map);
    }, BASEMAP_TIMEOUT_MS);
  };

  // What the map should show now. The map reads this on every (re)load of its style.
  const latest = useRef({ net, fix, pins, basemap });
  latest.current = { net, fix, pins, basemap };

  const setSource = (map: MapLibreMap, id: string, data: SourceData): void => {
    // A source that is not loaded yet is skipped; `style.load` pushes everything again.
    void map.getSource<GeoJSONSource>(id)?.setData(data);
  };
  /** The network layers. These are large (national data), so they are pushed only when needed. */
  const pushNetwork = (map: MapLibreMap): void => {
    const display = displayDataOf(latest.current.net);
    setSource(map, SOURCE.tracks, display.tracks);
    setSource(map, SOURCE.assets, display.assets);
  };
  /** The small layers: the fix and its accuracy circle, and the found locations. */
  const pushMarkers = (map: MapLibreMap): void => {
    const you = youData(latest.current.fix);
    setSource(map, SOURCE.accuracy, you.accuracy);
    setSource(map, SOURCE.you, you.point);
    setSource(map, SOURCE.pins, pinsData(latest.current.pins));
  };
  const pushAll = (map: MapLibreMap): void => {
    pushNetwork(map);
    pushMarkers(map);
  };

  // Create the map once.
  useEffect(() => {
    const element = host.current;
    if (element === null) {
      return undefined;
    }
    const life = { cancelled: false };
    void (async () => {
      try {
        const [maplibre, worker] = await Promise.all([
          import('maplibre-gl'),
          import('maplibre-gl/dist/maplibre-gl.css'),
          import('maplibre-gl/dist/maplibre-gl-worker.mjs?url'),
        ]).then(([lib, , url]) => [lib, url] as const);
        if (life.cancelled) {
          return;
        }
        // maplibre-gl 6 finds its worker as a sibling file of the library, which a bundler
        // breaks, so the worker file is bundled as its own asset and its URL is given here.
        maplibre.setWorkerUrl(worker.default);
        const first = latest.current;
        const start = first.fix ?? first.pins[0]?.at ?? null;
        const map = new maplibre.Map({
          container: element,
          style: first.basemap ? BASEMAP_STYLE_URL : offlineStyle(prefersDark()),
          center: start === null ? CANADA_CENTER : [start.lon, start.lat],
          zoom: start === null ? CANADA_ZOOM : CLOSE_ZOOM,
          // The attribution is drawn by this component, so it can follow the basemap setting.
          attributionControl: false,
          // No device-location control: the map never asks for the position itself.
          dragRotate: false,
        });
        map.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-right');
        mapRef.current = map;
        if (first.basemap) {
          watchBasemap(map);
        }
        map.on('style.load', () => {
          watch.current.ready = true;
          stopTimer();
          pushAll(map);
        });
        // An error before the basemap style has loaded is a failed basemap. Later errors (one
        // tile that did not load) leave the map as it is.
        map.on('error', () => {
          fallBack(map);
        });
        map.on('click', (event) => {
          setTap(presentTap(latest.current.net, { lat: event.lngLat.lat, lon: event.lngLat.lng }));
        });
        setState('ready');
      } catch {
        if (!life.cancelled) {
          setState('failed');
        }
      }
    })();
    return () => {
      life.cancelled = true;
      stopTimer();
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // `pushAll` reads refs only; the map is created once per mount.
  }, []);

  // Switch the basemap on or off after creation. The app's own sources and layers are put back
  // on top of the new style, and their data is pushed again on `style.load`.
  const applied = useRef(basemap);
  useEffect(() => {
    const map = mapRef.current;
    if (map === null || applied.current === basemap) {
      applied.current = basemap;
      return;
    }
    applied.current = basemap;
    const dark = prefersDark();
    setBasemapFailed(false);
    if (basemap) {
      watchBasemap(map);
      map.setStyle(BASEMAP_STYLE_URL, {
        transformStyle: (_previous, next) => ({
          ...next,
          sources: { ...next.sources, ...cantreSources() },
          layers: [...next.layers, ...cantreLayers(dark)],
        }),
      });
    } else {
      watch.current.basemap = false;
      stopTimer();
      map.setStyle(offlineStyle(dark));
    }
  }, [basemap, state]);

  // New network: redraw the tracks and assets (large; only when the network object changes).
  useEffect(() => {
    const map = mapRef.current;
    if (map !== null && map.isStyleLoaded()) {
      pushNetwork(map);
    }
  }, [net, state]);

  // A new fix or new pins: redraw the small layers. Keyed on the numbers, so a fresh object
  // with the same values does not redraw.
  useEffect(() => {
    const map = mapRef.current;
    if (map !== null && map.isStyleLoaded()) {
      pushMarkers(map);
    }
  }, [fix?.lat, fix?.lon, fix?.accuracyM, pins, state]);

  // Bring found locations into view.
  useEffect(() => {
    const map = mapRef.current;
    const first = pins[0];
    if (map === null || first === undefined) {
      return;
    }
    const lons = pins.map((p) => p.at.lon);
    const lats = pins.map((p) => p.at.lat);
    map.fitBounds(
      [
        [Math.min(...lons), Math.min(...lats)],
        [Math.max(...lons), Math.max(...lats)],
      ],
      { maxZoom: CLOSE_ZOOM + 2, padding: 48, duration: 0 },
    );
  }, [pins, state]);

  return (
    <div class="map">
      <div class="map__frame">
        <div ref={host} class="map__canvas" role="region" aria-label={t('map.label')} />
        {state === 'loading' && <p class="map__status">{t('map.loading')}</p>}
        {state === 'failed' && <p class="map__status">{t('map.loadFailed')}</p>}
        <p class="map__attribution">
          {attributionOf(basemap && !basemapFailed).map((line, i) => (
            <span key={line}>
              {i > 0 && ' | '}
              {line}
            </span>
          ))}
        </p>
      </div>
      {basemapFailed && (
        <p class="notice" role="status">
          {t('map.basemapFailed')}
        </p>
      )}
      <p class="muted">{t('map.note')}</p>
      <p class="muted">{t('map.keyboardAlternative')}</p>
      {fix !== null && <p class="muted">{t('map.you')}</p>}
      {tap !== null && (
        <div class="map__tap" role="status">
          <h4>{tap.label}</h4>
          {tap.outside && <p>{t('map.tap.outside')}</p>}
          {!tap.outside && tap.rows.length === 0 && <p>{t('map.tap.none')}</p>}
          <ul class="plain">
            {tap.rows.map((row, i) => (
              <li key={i}>
                <strong>
                  {t('map.tap.row', { subdivision: row.subdivision, trackClass: row.trackClass })}
                </strong>
                {': '}
                {row.mpText ?? row.noMpText}
                <span class="muted"> · {row.offsetText}</span>
                {row.tierNote !== null && (
                  <span class="badge badge--unverified">{row.tierNote}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * The map section: a show/hide button (the map and its chunk load only when opened) and the
 * basemap control ({@link BasemapSwitch}, which shows the D2 notice before turning it on). The
 * Settings screen offers the same switch.
 */
export function MapPanel(props: {
  readonly net: NetworkView;
  readonly fix: YouFix | null;
  readonly pins: readonly Pin[];
  readonly basemap: boolean;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onBasemapChange: (on: boolean) => void;
}) {
  const { net, fix, pins, basemap, open, onOpenChange, onBasemapChange } = props;
  return (
    <section class="map-panel" aria-labelledby="map-heading">
      <h3 id="map-heading">{t('map.heading')}</h3>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          onOpenChange(!open);
        }}
      >
        {t(open ? 'map.hide' : 'map.show')}
      </button>
      {open && (
        <>
          <BasemapSwitch basemap={basemap} onChange={onBasemapChange} />
          <MapView net={net} fix={fix} pins={pins} basemap={basemap} />
        </>
      )}
    </section>
  );
}
