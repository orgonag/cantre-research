import { fromLocalM } from '@cantre/core';
import type { LatLon, NetworkView } from '@cantre/core';
import type {
  GeoJSONSourceSpecification,
  LayerSpecification,
  StyleSpecification,
} from 'maplibre-gl';
import { t } from '../i18n/index.js';
import type { Pin } from './find.js';
import { assetCompanies, companiesOf, companyPaint } from './companies.js';

/**
 * What the map draws, built from the in-memory network (spec §7, §11).
 *
 * Display data is a COPY. The calculation geometry (`NetworkView`) is never altered and is never
 * simplified for drawing: MapLibre simplifies its own copy of these lines for display, while the
 * matcher keeps the full vertices (AGENTS.md: calculation geometry stays separate from display).
 * This module has no maplibre runtime import (types only), so it adds nothing to the app shell.
 *
 * Privacy (ruling P15): with the basemap off the map uses {@link offlineStyle}, an inline style
 * with only inline GeoJSON sources, no `glyphs`, no `sprite` and no symbol or text layer, so the
 * map has nothing to fetch. With the basemap on (after the D2 notice) it loads
 * {@link BASEMAP_STYLE_URL}, the one extra host.
 */

/** GeoJSON coordinate order: [longitude, latitude], degrees. */
type Coord = [number, number];

type Geometry =
  | { type: 'Point'; coordinates: Coord }
  | { type: 'LineString'; coordinates: Coord[] }
  | { type: 'Polygon'; coordinates: Coord[][] };

type Feature<P> = { type: 'Feature'; properties: P; geometry: Geometry };
export type Collection<P> = { type: 'FeatureCollection'; features: Feature<P>[] };

type CompanyProps = {
  companyIds: string[];
  companyLight: string;
  companyDark: string;
  shared: boolean;
};
export type TrackProps = CompanyProps & { kind: 'chain' | 'other' };
export type AssetProps = CompanyProps & { id: string; kind: string };
type NoProps = Record<string, never>;

export type DisplayData = {
  /** Chains (`kind: 'chain'`) and unchained segments (`kind: 'other'`: sidings, yards, spurs). */
  readonly tracks: Collection<TrackProps>;
  readonly assets: Collection<AssetProps>;
};

const line = (pts: readonly LatLon[]): Coord[] => pts.map((p) => [p.lon, p.lat]);

const companyProps = (companies: ReturnType<typeof companiesOf>): CompanyProps => {
  const colour = companyPaint(companies);
  return {
    companyIds: companies.map((c) => c.id),
    companyLight: colour.light,
    companyDark: colour.dark,
    shared: companies.length > 1,
  };
};

export function assetMapProperties(
  asset: NetworkView['assets'][number],
  net: NetworkView,
): AssetProps {
  return { id: asset.id, kind: asset.kind, ...companyProps([...assetCompanies(asset, net)]) };
}

/**
 * Builds the GeoJSON for a network: one line per chain piece and per unchained segment (pieces of
 * a split chain stay separate, so a gap is never drawn as track), and one point per asset
 * (`NetworkAsset.at`). A line needs two points; a one-point piece is skipped.
 */
function build(net: NetworkView): DisplayData {
  const tracks: Collection<TrackProps> = { type: 'FeatureCollection', features: [] };
  for (const c of net.chains) {
    if (c.pts.length >= 2) {
      tracks.features.push({
        type: 'Feature',
        properties: { kind: 'chain', ...companyProps(companiesOf(c.operators)) },
        geometry: { type: 'LineString', coordinates: line(c.pts) },
      });
    }
  }
  for (const s of net.segments) {
    if (s.pts.length >= 2) {
      tracks.features.push({
        type: 'Feature',
        properties: { kind: 'other', ...companyProps(companiesOf([s.operator])) },
        geometry: { type: 'LineString', coordinates: line(s.pts) },
      });
    }
  }
  const assets: Collection<AssetProps> = {
    type: 'FeatureCollection',
    features: net.assets.map((a) => ({
      type: 'Feature',
      properties: assetMapProperties(a, net),
      geometry: { type: 'Point', coordinates: [a.at.lon, a.at.lat] },
    })),
  };
  return { tracks, assets };
}

const cache = new WeakMap<NetworkView, DisplayData>();

/**
 * The display GeoJSON of a network, built once per network object (the national network has tens
 * of thousands of lines) and reused. The result shares nothing with the network, which is never
 * mutated.
 */
export function displayDataOf(net: NetworkView): DisplayData {
  let data = cache.get(net);
  if (data === undefined) {
    data = build(net);
    cache.set(net, data);
  }
  return data;
}

/** Vertices of the accuracy ring: 64 gives a radius error of 0.12 % (1 - cos(pi / 64)). */
const RING_STEPS = 64;

/**
 * The "you" marker and its accuracy circle from the last accepted fix (nothing is stored).
 * The ring is a circle of radius `accuracyM` metres in the local tangent plane at the fix
 * (`fromLocalM`), as a closed polygon; its radius error is under 0.2 % at these sizes. A zero or
 * non-finite accuracy draws no ring (the marker alone). Units: degrees in and out; metres radius.
 * The circle is the device's reported horizontal accuracy, not a bound on where the train is.
 */
export function youData(fix: (LatLon & { readonly accuracyM: number }) | null): {
  readonly point: Collection<NoProps>;
  readonly accuracy: Collection<NoProps>;
} {
  const point: Collection<NoProps> = { type: 'FeatureCollection', features: [] };
  const accuracy: Collection<NoProps> = { type: 'FeatureCollection', features: [] };
  if (fix === null) {
    return { point, accuracy };
  }
  point.features.push({
    type: 'Feature',
    properties: {},
    geometry: { type: 'Point', coordinates: [fix.lon, fix.lat] },
  });
  if (Number.isFinite(fix.accuracyM) && fix.accuracyM > 0) {
    const ring: Coord[] = [];
    for (let i = 0; i < RING_STEPS; i += 1) {
      const angle = (2 * Math.PI * i) / RING_STEPS; // radians
      const p = fromLocalM(
        fix,
        { x: fix.accuracyM * Math.cos(angle), y: fix.accuracyM * Math.sin(angle) },
        fix.lat,
      );
      ring.push([p.lon, p.lat]);
    }
    ring.push([...(ring[0] as Coord)]); // close the ring
    accuracy.features.push({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [ring] },
    });
  }
  return { point, accuracy };
}

/** The found locations of find-a-location, as points. */
export function pinsData(pins: readonly Pick<Pin, 'at'>[]): Collection<NoProps> {
  return {
    type: 'FeatureCollection',
    features: pins.map((p) => ({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: [p.at.lon, p.at.lat] },
    })),
  };
}

// ---------------------------------------------------------------------------------------------
// Style

/** The only basemap host (ruling P15, decision D2). Loaded only after the user accepts the notice. */
export const BASEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

/** Source ids of the layers the app adds on top of whatever style is loaded. */
export const SOURCE = {
  tracks: 'cantre-tracks',
  assets: 'cantre-assets',
  accuracy: 'cantre-accuracy',
  you: 'cantre-you',
  pins: 'cantre-pins',
} as const;

/** An empty inline GeoJSON source. Data is set later with `setData`; there is no URL to fetch. */
const emptySource = (): GeoJSONSourceSpecification => ({
  type: 'geojson',
  data: { type: 'FeatureCollection', features: [] },
});

/** The app's own sources, all inline and empty. */
export function cantreSources(): Record<string, GeoJSONSourceSpecification> {
  return Object.fromEntries(Object.values(SOURCE).map((id) => [id, emptySource()]));
}

/**
 * Colours for light and dark. Each is chosen to stand out on the plain background and on the
 * light basemap; the halo (casing) keeps the line readable on either.
 */
const PALETTE = {
  light: { bg: '#f2f1ec', halo: '#ffffff', track: '#0b4f9e', other: '#6b6b6b', asset: '#b03a00' },
  dark: { bg: '#1a1a1a', halo: '#000000', track: '#8ab8f5', other: '#b0b0b0', asset: '#ffb37a' },
} as const;

/**
 * The app's layers. Tracks are lines, assets are circles, the fix is a circle with an accuracy
 * fill, found locations are rings. There is NO symbol layer and no text: drawing text needs a
 * glyph server (a request outside the privacy allowlist, ruling P15), so assets are identified
 * in the list and in the tap result, not by labels on the map.
 */
export function cantreLayers(dark: boolean): LayerSpecification[] {
  const c = dark ? PALETTE.dark : PALETTE.light;
  const colour = ['get', dark ? 'companyDark' : 'companyLight'] as const;
  return [
    {
      id: 'tracks-halo',
      type: 'line',
      source: SOURCE.tracks,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': c.halo, 'line-width': 5, 'line-opacity': 0.75 },
    },
    {
      id: 'tracks-other',
      type: 'line',
      source: SOURCE.tracks,
      filter: ['==', ['get', 'kind'], 'other'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': [...colour], 'line-width': 2, 'line-dasharray': [2, 1.5] },
    },
    {
      id: 'tracks-chain',
      type: 'line',
      source: SOURCE.tracks,
      filter: ['all', ['==', ['get', 'kind'], 'chain'], ['!', ['get', 'shared']]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': [...colour], 'line-width': 3 },
    },
    {
      id: 'tracks-shared',
      type: 'line',
      source: SOURCE.tracks,
      filter: ['all', ['==', ['get', 'kind'], 'chain'], ['get', 'shared']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': [...colour], 'line-width': 3, 'line-dasharray': [3, 1.5] },
    },
    {
      id: 'assets',
      type: 'circle',
      source: SOURCE.assets,
      minzoom: 9,
      paint: {
        'circle-radius': 5,
        'circle-color': [...colour],
        'circle-stroke-color': c.halo,
        'circle-stroke-width': 2,
      },
    },
    {
      id: 'accuracy-fill',
      type: 'fill',
      source: SOURCE.accuracy,
      paint: { 'fill-color': c.track, 'fill-opacity': 0.15 },
    },
    {
      id: 'accuracy-line',
      type: 'line',
      source: SOURCE.accuracy,
      paint: { 'line-color': c.track, 'line-width': 1.5, 'line-dasharray': [3, 2] },
    },
    {
      id: 'you',
      type: 'circle',
      source: SOURCE.you,
      paint: {
        'circle-radius': 8,
        'circle-color': c.track,
        'circle-stroke-color': c.halo,
        'circle-stroke-width': 3,
      },
    },
    {
      id: 'pins',
      type: 'circle',
      source: SOURCE.pins,
      paint: {
        'circle-radius': 9,
        'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-color': c.asset,
        'circle-stroke-width': 4,
      },
    },
  ];
}

/**
 * The style used while the basemap is off (ruling P15): a plain background plus the app's own
 * inline sources and layers. No `glyphs`, no `sprite`, no URL, no symbol or text layer.
 */
export function offlineStyle(dark: boolean): StyleSpecification {
  return {
    version: 8,
    sources: cantreSources(),
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': (dark ? PALETTE.dark : PALETTE.light).bg },
      },
      ...cantreLayers(dark),
    ],
  };
}

/**
 * The attribution lines for the map corner (spec §11): the OGL-Canada sentence always, and the
 * OpenStreetMap / OpenFreeMap credit only while the basemap is on.
 */
export function attributionOf(basemap: boolean): readonly string[] {
  return basemap
    ? [t('map.attribution.ogl'), t('map.attribution.osm')]
    : [t('map.attribution.ogl')];
}
