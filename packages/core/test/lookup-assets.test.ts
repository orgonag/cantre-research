import { describe, expect, it } from 'vitest';
import { assetsAlong } from '../src/index.js';
import { network, ORIGIN, pointAsset, straightChain } from './helpers/network.js';

/** Tests for `assetsAlong`: assets within a range of a position along one chain. */
const chain = straightChain('c', ORIGIN, 0, 1000);

describe('assetsAlong', () => {
  const net = network({
    chains: [chain],
    assets: [
      pointAsset('a100', 'c', 100),
      pointAsset('a250', 'c', 250),
      pointAsset('a400', 'c', 400),
      pointAsset('a405', 'c', 405),
      pointAsset('other', 'd', 300),
    ],
  });

  it('gives a signed distance, asset position minus s, sorted by distance', () => {
    const found = assetsAlong(net, 'c', 300, 120);
    expect(found.map((f) => [f.asset.id, f.deltaM])).toEqual([
      ['a250', -50],
      ['a400', 100],
      ['a405', 105],
    ]);
  });

  it('limits to the range, inclusive, and ignores other chains', () => {
    expect(assetsAlong(net, 'c', 300, 50).map((f) => f.asset.id)).toEqual(['a250']);
    expect(assetsAlong(net, 'c', 300, 49.999).map((f) => f.asset.id)).toEqual([]);
    expect(assetsAlong(net, 'c', 300, 0)).toEqual([]);
    expect(assetsAlong(net, 'c', 250, 0).map((f) => f.asset.id)).toEqual(['a250']);
    expect(assetsAlong(net, 'd', 300, 10).map((f) => f.asset.id)).toEqual(['other']);
    expect(assetsAlong(net, 'nothing', 300, 1e9)).toEqual([]);
  });

  it('returns nothing for a negative range', () => {
    expect(assetsAlong(net, 'c', 250, -1)).toEqual([]);
  });

  it('breaks distance ties by id', () => {
    const tied = network({
      assets: [pointAsset('b', 'c', 110), pointAsset('a', 'c', 90), pointAsset('c', 'c', 110)],
    });
    expect(assetsAlong(tied, 'c', 100, 20).map((f) => [f.asset.id, f.deltaM])).toEqual([
      ['a', -10],
      ['b', 10],
      ['c', 10],
    ]);
  });

  it('works on a split chain: positions carry the base id and absolute s', () => {
    const pieces = network({
      chains: [
        straightChain('c', ORIGIN, 0, 500),
        straightChain('c#2', ORIGIN, 2000, 2500, { chainBaseId: 'c' }),
      ],
      assets: [pointAsset('near', 'c', 450), pointAsset('far', 'c', 2100)],
    });
    expect(assetsAlong(pieces, 'c', 2000, 200).map((f) => [f.asset.id, f.deltaM])).toEqual([
      ['far', 100],
    ]);
    expect(assetsAlong(pieces, 'c', 500, 100).map((f) => f.asset.id)).toEqual(['near']);
  });

  it('lists an asset once, at its nearest position on the chain', () => {
    const two = network({
      assets: [
        {
          ...pointAsset('twice', 'c', 100),
          positions: [
            { chainId: 'c', sM: 100, residualM: 0, derivedMp: null },
            { chainId: 'c', sM: 180, residualM: 0, derivedMp: null },
            { chainId: 'e', sM: 150, residualM: 0, derivedMp: null },
          ],
        },
      ],
    });
    const found = assetsAlong(two, 'c', 170, 500);
    expect(found).toHaveLength(1);
    expect(found[0]?.deltaM).toBe(10);
  });

  it('rejects a non-finite position or range', () => {
    expect(() => assetsAlong(net, 'c', Number.NaN, 10)).toThrow(
      expect.objectContaining({ code: 'NON_FINITE' }),
    );
    expect(() => assetsAlong(net, 'c', 10, Number.POSITIVE_INFINITY)).toThrow(
      expect.objectContaining({ code: 'NON_FINITE' }),
    );
  });
});

describe('assetsAlong ties between positions', () => {
  it('takes the position behind when two positions are equally near', () => {
    for (const order of [
      [90, 110],
      [110, 90],
    ]) {
      const net = network({
        assets: [
          {
            ...pointAsset('x', 'c', 0),
            positions: order.map((sM) => ({ chainId: 'c', sM, residualM: 0, derivedMp: null })),
          },
        ],
      });
      expect(assetsAlong(net, 'c', 100, 20)[0]?.deltaM).toBe(-10);
    }
  });
});
