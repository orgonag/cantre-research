import { afterEach, describe, expect, it } from 'vitest';
import type { NetworkAsset } from '@cantre/core';
import {
  activeCompany,
  assetCompanies,
  companiesOf,
  companyIndex,
  companyLabel,
  companyOf,
  companyPaint,
  SHARED_COLOURS,
} from '../../src/logic/companies.js';
import { displayDataOf } from '../../src/logic/mapdata.js';
import { presentTap } from '../../src/logic/find.js';
import { setLang } from '../../src/i18n/index.js';
import { chain, net, ORIGIN } from './netfixture.js';

afterEach(() => {
  setLang('en');
});
const cn = chain('cn', 'cn-sub', 'CN line', 0, 1000);
const cp = { ...chain('cp', 'cp-sub', 'CP line', 0, 1000, 5), operators: ['CPR'] };
const asset = (id: string, chainIds: string[]): NetworkAsset => ({
  id,
  kind: 'crossing',
  name: null,
  at: ORIGIN,
  posted: null,
  positions: chainIds.map((chainId) => ({ chainId, sM: 0, residualM: 0, derivedMp: null })),
});

describe('reported railway companies', () => {
  it('unifies audited marks and names while preserving historical and conflicting identities', () => {
    expect(companyOf('Canadian National')).toEqual(companyOf(' CN '));
    expect(companyOf('Canadian Pacific')).toEqual(companyOf('CPR'));
    expect(companyOf('Canadian Pacific').name).not.toContain('CPKC');
    expect(companyOf('West Coast Railway Association').id).not.toBe('CN');
    const conflict = ['SRCL', 'Southern Rails Cooperative Ltd.', 'Wheatland Railway Inc.'];
    expect(new Set(conflict.map((name) => companyOf(name).id)).size).toBe(3);
    expect(companyOf('New Independent Railway')).toEqual(companyOf('New Independent Railway'));
    expect(companyOf('New Independent Railway').name).toBe('New Independent Railway');
  });

  it('keeps unknown explicit and provides names as well as stable company colours', () => {
    for (const missing of ['', 'Unknown', 'None', '-1'])
      expect(companyOf(missing).id).toBe('unknown');
    expect(companyLabel(companyOf(''))).toBe('Not recorded / unknown');
    expect(companyLabel(companyOf('CN'))).toContain('Canadian National');
    setLang('fr');
    expect(companyLabel(companyOf(''))).toBe('Non consigné / inconnu');
    expect(companyOf('CN').light).not.toBe(companyOf('CPR').light);
    expect(companyOf('CN').dark).not.toBe(companyOf('CPR').dark);
  });

  it('does not turn multiple reported operators into a single company', () => {
    expect(companiesOf(['Canadian National', 'CN']).map((c) => c.id)).toEqual(['CN']);
    const several = companiesOf(['CPR', 'CN', 'Unknown']);
    expect(several.map((c) => c.id)).toEqual(['CN', 'CPR', 'unknown']);
    expect(companyPaint(several)).toEqual(SHARED_COLOURS);
    expect(companyPaint([]).light).toBe(companyOf('').light);
    expect(companiesOf([])[0]?.id).toBe('unknown');
  });

  it('uses explicit asset associations, including both routes at a diamond, never proximity', () => {
    const known = asset('known', ['cn']);
    const shared = asset('shared', ['cn', 'cp']);
    const missing = asset('missing', []);
    const broken = asset('broken', ['absent']);
    const posted = {
      ...asset('posted', []),
      posted: { subdivisionNid: 'cp-sub', mp: 1, tier: 'tc' as const },
    };
    const unknownPosted = {
      ...posted,
      id: 'unknown-posted',
      posted: { ...posted.posted, subdivisionNid: 'absent' },
    };
    const network = net({
      chains: [cn, cp],
      assets: [known, shared, missing, broken, posted, unknownPosted],
    });
    const before = JSON.stringify(network);
    expect(assetCompanies(known, network).map((c) => c.id)).toEqual(['CN']);
    expect(assetCompanies(shared, network).map((c) => c.id)).toEqual(['CN', 'CPR']);
    for (const a of [missing, broken, unknownPosted, asset('not-loaded', ['cn'])])
      expect(assetCompanies(a, network).map((c) => c.id)).toEqual(['unknown']);
    expect(assetCompanies(posted, network).map((c) => c.id)).toEqual(['CPR']);
    expect(companyIndex(network)).toBe(companyIndex(network));
    expect(JSON.stringify(network)).toBe(before);
    expect(activeCompany(network, 'CPR')).toBe('CPR');
    expect(activeCompany(network, 'removed-from-dataset')).toBe('');
    expect(activeCompany(network, undefined)).toBe('');
  });

  it('includes unchained segments and all operators of an associated subdivision', () => {
    const posted = {
      ...asset('posted', []),
      posted: { subdivisionNid: 'cn-sub', mp: 1, tier: 'posted' as const },
    };
    const network = net({
      chains: [cn],
      segments: [
        {
          key: 'yard',
          chainId: null,
          trackClass: 'Yard',
          status: 'Operational',
          subdivisionNid: 'cn-sub',
          subdivisionName: 'CN line',
          operator: 'Canadian Pacific',
          geoAccuracyM: null,
          pts: cn.pts,
        },
      ],
      assets: [posted],
    });
    expect(assetCompanies(posted, network).map((c) => c.id)).toEqual(['CN', 'CPR']);
    expect(
      companyIndex(network)
        .choices.map((c) => c.id)
        .sort(),
    ).toEqual(['CN', 'CPR']);
    const display = displayDataOf(network);
    expect(display.tracks.features[0]?.properties.companyLight).toBe(companyOf('CN').light);
    expect(display.tracks.features[1]?.properties.companyLight).toBe(companyOf('CPR').light);
    expect(display.assets.features[0]?.properties).toMatchObject({
      shared: true,
      companyIds: ['CN', 'CPR'],
    });
  });

  it('filters map-tap explanations without changing the calculation network or GPS inputs', () => {
    const network = net({ chains: [cn, cp] });
    const before = JSON.stringify(network);
    expect(presentTap(network, ORIGIN).rows).toHaveLength(2);
    const filtered = presentTap(network, ORIGIN, 'CPR').rows;
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.company).toBe('CPR · Canadian Pacific');
    expect(filtered[0]?.subdivision).toBe('CP line');
    expect(presentTap(network, ORIGIN, 'unknown').rows).toEqual([]);
    expect(JSON.stringify(network)).toBe(before);
  });
});
