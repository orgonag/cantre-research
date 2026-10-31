import { beforeEach, describe, expect, it } from 'vitest';
import { distanceM } from '@cantre/core';
import { setLang } from '../../src/i18n/index.js';
import {
  BASEMAP_STYLE_URL,
  attributionOf,
  cantreLayers,
  displayDataOf,
  offlineStyle,
  pinsData,
  youData,
} from '../../src/logic/mapdata.js';
import { findBySubdivision } from '../../src/logic/find.js';
import { ORIGIN, chain, interval, net } from './netfixture.js';

beforeEach(() => {
  setLang('en');
});

const c1 = chain('c1', 'sub-a', 'Alpha Sub', 0, 2000);
const single: typeof c1 = { ...c1, id: 'one', chainBaseId: 'one', pts: [ORIGIN] };
const sample = net({
  chains: [c1, single],
  segments: [
    {
      key: 'sid1',
      chainId: null,
      trackClass: 'Siding',
      status: 'Operational',
      subdivisionNid: 'sub-a',
      subdivisionName: 'Alpha Sub',
      operator: 'CN',
      geoAccuracyM: null,
      pts: [ORIGIN, { lat: 50.001, lon: -100 }],
    },
  ],
  assets: [
    {
      id: 'as1',
      kind: 'crossing',
      name: null,
      posted: null,
      positions: [],
      at: { lat: 50.0005, lon: -99.99 },
    },
  ],
});

describe('displayDataOf', () => {
  it('draws chains and unchained segments as lines in [lon, lat] order, skipping one-point lines', () => {
    const { tracks } = displayDataOf(sample);
    expect(tracks.features).toHaveLength(2);
    const first = tracks.features[0];
    expect(first?.properties).toMatchObject({ kind: 'chain', companyIds: ['CN'], shared: false });
    expect(first?.geometry).toEqual({
      type: 'LineString',
      coordinates: c1.pts.map((p) => [p.lon, p.lat]),
    });
    expect(tracks.features[1]?.properties).toMatchObject({ kind: 'other', companyIds: ['CN'] });
  });

  it('draws assets as points with their id and kind', () => {
    const { assets } = displayDataOf(sample);
    expect(assets.features).toHaveLength(1);
    expect(assets.features[0]?.properties).toMatchObject({
      id: 'as1',
      kind: 'crossing',
      companyIds: ['unknown'],
    });
    expect(assets.features[0]?.geometry).toEqual({ type: 'Point', coordinates: [-99.99, 50.0005] });
  });

  it('is built once per network and leaves the calculation geometry untouched', () => {
    const before = JSON.stringify(sample);
    const sM = Array.from(c1.sM);
    const a = displayDataOf(sample);
    const b = displayDataOf(sample);
    expect(b).toBe(a);
    expect(JSON.stringify(sample)).toBe(before);
    expect(Array.from(c1.sM)).toEqual(sM);
    // The drawn coordinates are copies: editing them cannot change the network.
    const drawn = a.tracks.features[0]?.geometry;
    if (drawn?.type !== 'LineString') {
      throw new Error('expected a line');
    }
    drawn.coordinates[0]?.splice(0, 2, 0, 0);
    expect(c1.pts[0]).toEqual({ lat: ORIGIN.lat, lon: ORIGIN.lon });
    // Restore for other tests sharing the cache.
    drawn.coordinates[0]?.splice(0, 2, ORIGIN.lon, ORIGIN.lat);
  });

  it('gives empty collections for an empty network', () => {
    const d = displayDataOf(net());
    expect(d.tracks.features).toEqual([]);
    expect(d.assets.features).toEqual([]);
  });
});

describe('youData', () => {
  it('draws the last accepted fix as a point and its accuracy as a ring of that radius', () => {
    const { point, accuracy } = youData({ lat: 50, lon: -100, accuracyM: 80 });
    expect(point.features[0]?.geometry).toEqual({ type: 'Point', coordinates: [-100, 50] });
    const ring = accuracy.features[0]?.geometry;
    if (ring?.type !== 'Polygon') {
      throw new Error('expected a polygon');
    }
    const coords = ring.coordinates[0] ?? [];
    expect(coords[0]).toEqual(coords[coords.length - 1]); // closed
    for (const c of coords) {
      const d = distanceM({ lat: 50, lon: -100 }, { lat: c[1], lon: c[0] });
      expect(Math.abs(d - 80)).toBeLessThan(0.8); // within 1 % of the radius
    }
  });

  it('draws no ring when the accuracy is zero or not a usable number', () => {
    expect(youData({ lat: 50, lon: -100, accuracyM: 0 }).accuracy.features).toEqual([]);
    expect(youData({ lat: 50, lon: -100, accuracyM: Number.NaN }).accuracy.features).toEqual([]);
  });

  it('draws nothing when there is no fix', () => {
    const d = youData(null);
    expect(d.point.features).toEqual([]);
    expect(d.accuracy.features).toEqual([]);
  });
});

describe('pinsData', () => {
  it('draws one point per found pin', () => {
    const withMp = net({
      chains: [c1],
      intervals: [
        interval('iv', 'c1', [
          [0, 10],
          [2000, 12],
        ]),
      ],
    });
    const r = findBySubdivision(withMp, 'sub-a', 11);
    if (r.kind !== 'pins') {
      throw new Error('expected pins');
    }
    const fc = pinsData(r.pins);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0]?.geometry.type).toBe('Point');
    expect(pinsData([]).features).toEqual([]);
  });
});

describe('offlineStyle (basemap off: no request may leave the device, ruling P15)', () => {
  const style = offlineStyle(false);

  it('has no glyphs, no sprite and no symbol layer', () => {
    expect(style.glyphs).toBeUndefined();
    expect(style.sprite).toBeUndefined();
    for (const layer of style.layers) {
      expect(layer.type).not.toBe('symbol');
    }
    expect(JSON.stringify(style)).not.toMatch(/text-|icon-|glyph|sprite/);
  });

  it('has only inline GeoJSON sources and no URL anywhere', () => {
    for (const source of Object.values(style.sources)) {
      expect(source.type).toBe('geojson');
    }
    expect(JSON.stringify(style)).not.toMatch(/https?:|\/\//);
  });

  it('only draws layers whose source exists, and has a dark variant', () => {
    for (const layer of style.layers) {
      if ('source' in layer) {
        expect(Object.keys(style.sources)).toContain(layer.source);
      }
    }
    expect(offlineStyle(true).layers[0]).not.toEqual(style.layers[0]);
    for (const layer of cantreLayers(true)) {
      expect(layer.type).not.toBe('symbol');
    }
  });
});

describe('attribution', () => {
  it('always has the OGL-Canada sentence, and OSM only when the basemap is on', () => {
    const off = attributionOf(false);
    expect(off).toEqual([
      'Contains information licensed under the Open Government Licence – Canada',
    ]);
    const on = attributionOf(true);
    expect(on[0]).toBe(off[0]);
    expect(on).toHaveLength(2);
    expect(on[1]).toContain('OpenStreetMap');
    expect(on[1]).toContain('OpenFreeMap');
  });

  it('points the basemap at OpenFreeMap over https, the only extra host', () => {
    expect(new URL(BASEMAP_STYLE_URL).protocol).toBe('https:');
    expect(new URL(BASEMAP_STYLE_URL).hostname).toBe('tiles.openfreemap.org');
  });
});
