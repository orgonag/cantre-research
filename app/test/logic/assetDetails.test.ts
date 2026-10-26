import { afterEach, describe, expect, it } from 'vitest';
import type { NetworkAsset } from '@cantre/core';
import { featureFields, featureLocations } from '../../src/logic/assetDetails.js';
import { setLang } from '../../src/i18n/index.js';
import { chain, net, ORIGIN } from './netfixture.js';
const a = chain('a', 'wilkie', 'Wilkie', 0, 1000);
const b = chain('b', 'other', 'Other', 0, 1000);
const network = net({ chains: [a, { ...a, id: 'a#2' }, b] });
const asset: NetworkAsset = {
  id: 'crossing',
  kind: 'crossing',
  name: null,
  at: ORIGIN,
  posted: { mp: 4.44, subdivisionNid: 'wilkie', tier: 'posted' },
  positions: [{ chainId: 'a', sM: 500, residualM: 2, derivedMp: 4.441 }],
};
afterEach(() => {
  setLang('en');
});
describe('readable feature facts', () => {
  it('uses plain labels without changing public source values or inventing missing fields', () => {
    const fields = featureFields([
      ['CROSACCES', 'Private'],
      ['WARNINGSYS', 'Unknown'],
      ['TCID', '00123'],
      ['ROADCLASS', 'None'],
      ['STNENNAME', ''],
      ['TCID', '-1'],
      ['FUTURE', 'value'],
    ]);
    expect(fields).toEqual([
      { key: 'CROSACCES', label: 'Access', value: 'Private' },
      { key: 'WARNINGSYS', label: 'Warning system', value: 'Unknown' },
      { key: 'TCID', label: 'Transport Canada ID', value: '00123' },
    ]);
    setLang('fr');
    expect(featureFields([['CROSACCES', 'Private']])[0]?.label).toBe('Accès');
  });
  it('resolves subdivision names and keeps published and calculated mileposts separate', () => {
    expect(featureLocations(asset, network)).toEqual([
      {
        key: 'wilkie',
        subdivision: 'Wilkie',
        mileposts: [
          { value: 4.44, label: 'Published milepost' },
          { value: 4.441, label: 'Calculated milepost' },
        ],
      },
    ]);
  });
  it('keeps different routes and multiple calculated mileposts distinct', () => {
    const locations = featureLocations(
      {
        ...asset,
        positions: [
          ...asset.positions,
          ...asset.positions,
          { chainId: 'b', sM: 100, residualM: 1, derivedMp: 20 },
          { chainId: 'b', sM: 200, residualM: 1, derivedMp: 21 },
        ],
      },
      network,
    );
    expect(locations).toHaveLength(2);
    expect(locations[0]?.mileposts).toHaveLength(2);
    expect(locations[1]).toEqual({
      key: 'other',
      subdivision: 'Other',
      mileposts: [
        { value: 20, label: 'Calculated milepost' },
        { value: 21, label: 'Calculated milepost' },
      ],
    });
  });
  it('does not guess a subdivision or mileage when associations are missing', () => {
    expect(featureLocations({ ...asset, posted: null, positions: [] }, network)).toEqual([]);
    expect(
      featureLocations(
        {
          ...asset,
          posted: null,
          positions: [{ chainId: 'absent', sM: 0, residualM: 0, derivedMp: null }],
        },
        network,
      ),
    ).toEqual([{ key: 'absent', subdivision: 'Not recorded', mileposts: [] }]);
    expect(featureLocations(asset, net())[0]?.subdivision).toBe('Not recorded');
  });
  it('labels TC and unverified mileage without upgrading the evidence', () => {
    for (const [tier, label] of [
      ['tc', 'Transport Canada milepost'],
      ['unverified', 'Unverified source milepost'],
    ] as const)
      expect(
        featureLocations(
          { ...asset, posted: { mp: 0, subdivisionNid: 'wilkie', tier } },
          network,
        )[0]?.mileposts[0],
      ).toEqual({ value: 0, label });
  });
});
