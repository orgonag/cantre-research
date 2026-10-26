import { describe, expect, it } from 'vitest';
import type { NetworkAsset } from '@cantre/core';
import { ASSET_KINDS, visibleAssets } from '../../src/logic/visibleAssets.js';

const bounds = { west: -110, east: -100, south: 50, north: 55 };
const asset = (i: number): NetworkAsset => ({
  id: String(i),
  name: null,
  kind: i % 2 ? 'bridge' : 'crossing',
  posted: null,
  positions: [],
  at: { lat: 52, lon: -106 + i / 10000 },
});
describe('visible map assets', () => {
  it('caps the same distance-ordered collection at 100 without modifying the network', () => {
    const input = Array.from({ length: 150 }, (_, i) => asset(149 - i));
    const output = visibleAssets(input, ASSET_KINDS, { lat: 52, lon: -106 }, bounds);
    expect(output).toHaveLength(100);
    expect(output[0]?.id).toBe('0');
    expect(output[99]?.id).toBe('99');
    expect(input[0]?.id).toBe('149');
  });
  it('filters disabled kinds and offscreen features before applying the limit', () => {
    const outside = { ...asset(0), at: { lat: 60, lon: -106 } };
    expect(
      visibleAssets([outside, asset(1), asset(2)], ['bridge'], { lat: 52, lon: -106 }, bounds).map(
        (a) => a.id,
      ),
    ).toEqual(['1']);
  });
  it('changes the ordering with the exploration center', () => {
    expect(
      visibleAssets([asset(0), asset(100)], ASSET_KINDS, asset(100).at, bounds).map((a) => a.id),
    ).toEqual(['100', '0']);
  });
});
