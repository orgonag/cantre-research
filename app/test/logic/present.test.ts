import { beforeEach, describe, expect, it } from 'vitest';
import { milesToKilometres } from '@cantre/core';
import type { Anchor, Candidate, NetworkAsset, NetworkView, Result } from '@cantre/core';
import { setLang, t } from '../../src/i18n/index.js';
import { chain } from './netfixture.js';
import {
  ANNOUNCE_MIN_INTERVAL_MS,
  announce,
  assetSource,
  directionTracker,
  direction,
  present,
  presentAssets,
} from '../../src/logic/present.js';
import type { PresentMeta } from '../../src/logic/present.js';
import type { Settings } from '../../src/logic/settings.js';

const MI: Settings = { units: 'mi', lang: 'en', basemap: false };
const KM: Settings = { units: 'km', lang: 'en', basemap: false };
const META: PresentMeta = { snapshotDate: '2026-10-25' };

const net = (assets: readonly NetworkAsset[] = []): NetworkView => ({
  datasetVersion: 'v1',
  coverage: [],
  chains: [],
  segments: [],
  intervals: [],
  diamonds: [],
  assets,
});

const anchor = (id: string, s: number, mp: number, tier: Anchor['tier'] = 'posted'): Anchor => ({
  id,
  s,
  mp,
  source: 'crossing',
  tier,
});

const cand = (over: Partial<Candidate> = {}): Candidate => ({
  chainId: 'C1',
  chainBaseId: 'C1',
  segmentKey: null,
  subdivisionNid: 'sub-1',
  subdivisionName: 'Kingston Sub',
  operator: 'CN',
  trackClass: 'Main',
  residualM: 3.1,
  s: 5000,
  bearingDeg: 90,
  ...over,
});

const blank: Result = {
  status: 'NO_FIX',
  candidates: [],
  rangeGroup: [],
  chosen: null,
  s: null,
  milepost: null,
  mpRange: null,
  mpBandMi: null,
  tier: null,
  anchorIds: [],
  selectionOrigin: null,
  lock: null,
  reasons: [],
  accuracyM: null,
  fixAgeMs: null,
  datasetVersion: 'v1',
  historical: null,
};

const matched = (mp: number, over: Partial<Result> = {}, c: Candidate = cand()): Result => ({
  ...blank,
  status: 'MATCHED',
  candidates: [c],
  chosen: c,
  s: c.s,
  milepost: {
    kind: 'calibrated',
    mp,
    lower: anchor('a1', 4000, mp - 0.31),
    upper: anchor('a2', 6000, mp + 0.09),
    intervalLengthM: 2000,
  },
  mpBandMi: 0.012,
  tier: 'posted',
  anchorIds: ['a1', 'a2'],
  selectionOrigin: 'auto',
  accuracyM: 6,
  fixAgeMs: 2000,
  ...over,
});

beforeEach(() => {
  setLang('en');
});

describe('present: MATCHED', () => {
  it('shows the MP with a band that says it comes from GPS accuracy only', () => {
    const m = present(matched(112.43), net(), MI, META);
    expect(m.headline).toBe(t('status.MATCHED'));
    expect(m.mpText).toBe('MP 112.43');
    expect(m.bandText).toBe('± 0.01 mi from GPS accuracy only');
    expect(m.rangeText).toBeNull();
    expect(m.subdivision).toBe('Kingston Sub');
    expect(m.operator).toBe('CN');
    expect(m.trackClass).toBe('Main');
    expect(m.residualText).toBe('off-track 3.1 m');
    expect(m.accuracyText).toBe('GPS accuracy ± 6 m');
    expect(m.fixAgeText).toBe('fix 2 s ago');
    expect(m.anchorsText).toBe('anchors MP 112.12 to 112.52, posted');
    expect(m.tierBadge).toBe('posted');
    expect(m.historical).toBe(false);
    expect(JSON.stringify(m)).not.toMatch(/confiden|probab/i);
  });

  it('never states a confidence: the band is not called a confidence anywhere in EN or FR', () => {
    for (const lang of ['en', 'fr'] as const) {
      setLang(lang);
      const m = present(matched(112.43), net(), MI, META);
      expect(`${m.bandText ?? ''}${m.accuracyText ?? ''}`).not.toMatch(/confiden|probab/i);
    }
  });

  it('shows a fix stamped slightly in the future as 0 s old, never a negative age', () => {
    expect(present(matched(1, { fixAgeMs: -1500 }), net(), MI, META).fixAgeText).toBe(
      'fix 0 s ago',
    );
    expect(present(matched(1, { fixAgeMs: -1 }), net(), MI, META).fixAgeText).toBe('fix 0 s ago');
    expect(present(matched(1, { fixAgeMs: 0 }), net(), MI, META).fixAgeText).toBe('fix 0 s ago');
  });

  it('shows a calibrated milepost of 0 as "MP 0.00", never blank', () => {
    const m = present(matched(0), net(), MI, META);
    expect(m.mpText).toBe('MP 0.00');
  });

  it('shows no MP when the milepost is uncalibrated, and the reason instead', () => {
    const r = matched(1, {
      milepost: { kind: 'uncalibrated', reason: 'BEFORE_FIRST_ANCHOR' },
      mpBandMi: null,
      tier: null,
      anchorIds: [],
      reasons: ['CHAIN_UNCALIBRATED'],
    });
    const m = present(r, net(), MI, META);
    expect(m.mpText).toBeNull();
    expect(m.bandText).toBeNull();
    expect(m.anchorsText).toBeNull();
    expect(m.tierBadge).toBeNull();
    expect(m.reasons).toEqual([t('reason.CHAIN_UNCALIBRATED')]);
  });

  it('sets the unverified badge and labels the anchors line', () => {
    const m = present(matched(10, { tier: 'unverified' }), net(), MI, META);
    expect(m.tierBadge).toBe('unverified');
    expect(m.tierText).toBe(t('tier.unverified'));
    expect(m.tierText).toMatch(/unverified/i);
  });

  it('converts the band to kilometres with milesToKilometres, labels it, and keeps the MP in miles', () => {
    const m = present(matched(112.43), net(), KM, META);
    expect(m.bandText).toBe(`± ${milesToKilometres(0.012).toFixed(2)} km from GPS accuracy only`);
    expect(m.bandText).not.toMatch(/\bmi\b/);
    // The milepost is a published marker number in miles; it is not converted into kilometres.
    expect(m.mpText).toBe('MP 112.43');
    expect(m.mpNote).toBe(t('card.mpMiles'));
    expect(present(matched(112.43), net(), MI, META).mpNote).toBeNull();
  });

  it('says "less than" instead of a zero band', () => {
    const m = present(matched(5, { mpBandMi: 0.001 }), net(), MI, META);
    expect(m.bandText).toBe('under 0.01 mi, from GPS accuracy only');
  });

  it('notes other routes that also fit beside a match', () => {
    const other = cand({ chainId: 'C2', chainBaseId: 'C2', operator: 'CP' });
    const r = matched(5, { candidates: [cand(), other] });
    expect(present(r, net(), MI, META).alsoFitText).toBe(t('card.alsoFit', { count: 1 }));
    expect(present(matched(5), net(), MI, META).alsoFitText).toBeNull();
  });

  it('shows the lock and a locked-by-user reason', () => {
    const r = matched(5, {
      lock: { kind: 'chain', chainId: 'C1' },
      selectionOrigin: 'user',
      reasons: ['LOCKED_BY_USER'],
    });
    const m = present(r, net(), MI, META);
    expect(m.lockText).toBe('Locked: Kingston Sub');
    expect(m.reasons).toContain(t('reason.LOCKED_BY_USER'));
  });

  it('shows the dataset vintage, falling back to the dataset version', () => {
    expect(present(matched(5), net(), MI, META).vintageText).toBe('Data: 2026-10-25');
    expect(present(matched(5), net(), MI).vintageText).toBe('Data: v1');
    const r = { ...matched(5), datasetVersion: '' };
    expect(present(r, { ...net(), datasetVersion: '' }, MI).vintageText).toBe(t('data.unknown'));
  });

  it('formats fix age in seconds, minutes and hours', () => {
    const at = (ms: number): string | null =>
      present(matched(5, { fixAgeMs: ms }), net(), MI, META).fixAgeText;
    expect(at(400)).toBe('fix 0 s ago');
    expect(at(59_999)).toBe('fix 59 s ago');
    expect(at(80_000)).toBe('fix 1 min 20 s ago');
    expect(at(3_900_000)).toBe('fix 1 h 5 min ago');
  });
});

describe('present: unchained and keyless tracks', () => {
  const seg = (over: Partial<Candidate> = {}): Candidate =>
    cand({ chainId: null, chainBaseId: null, segmentKey: 'seg-1', s: null, ...over });

  it('does not count the matched unchained track as another route', () => {
    const own = seg();
    const r = matched(1, { candidates: [own], s: null }, own);
    expect(present(r, net(), MI).alsoFitText).toBeNull();
    const keyless = seg({ segmentKey: null });
    const r2 = matched(1, { candidates: [keyless], s: null }, keyless);
    expect(present(r2, net(), MI).alsoFitText).toBeNull();
    const withOther = matched(1, { candidates: [own, cand()], s: null }, own);
    expect(present(withOther, net(), MI).alsoFitText).toBe(t('card.alsoFit', { count: 1 }));
  });

  it('keeps different keyless tracks as separate choices', () => {
    const r: Result = {
      ...blank,
      status: 'AMBIGUOUS_ROUTE',
      candidates: [
        seg({ segmentKey: null, subdivisionNid: 'a', subdivisionName: 'A', residualM: 2 }),
        seg({ segmentKey: null, subdivisionNid: 'b', subdivisionName: 'B', residualM: 3 }),
      ],
    };
    expect(present(r, net(), MI).choices.map((c) => c.subdivision)).toEqual(['A', 'B']);
  });
});

describe('route chooser button name (WCAG 2.5.3)', () => {
  it('starts the accessible name with the visible label in EN and FR', () => {
    for (const lang of ['en', 'fr'] as const) {
      setLang(lang);
      const name = t('route.chooseAria', { subdivision: 'X', operator: 'Y' });
      expect(name.startsWith(t('route.choose'))).toBe(true);
    }
  });
});

describe('present: MATCHED_SUBDIVISION', () => {
  const pair = [cand({ chainId: 'C1' }), cand({ chainId: 'C2', chainBaseId: 'C2' })];
  const sub = (over: Partial<Result> = {}): Result => ({
    ...blank,
    status: 'MATCHED_SUBDIVISION',
    candidates: pair,
    rangeGroup: pair,
    mpRange: { lowerMp: 112.4, upperMp: 112.46 },
    mpBandMi: 0.05,
    tier: 'tc',
    anchorIds: ['a', 'b', 'c'],
    reasons: ['MULTIPLE_TRACKS'],
    accuracyM: 8,
    fixAgeMs: 1000,
    ...over,
  });

  it('shows a range, never a single MP', () => {
    const m = present(sub(), net(), MI, META);
    expect(m.mpText).toBeNull();
    expect(m.rangeText).toBe('MP 112.40 to 112.46');
    expect(m.bandText).toBe('± 0.05 mi from GPS accuracy only');
    expect(m.subdivision).toBe('Kingston Sub');
    expect(m.tierBadge).toBe('tc');
    expect(m.anchorsText).toBe('3 anchors, lowest tier Transport Canada');
    expect(m.residualText).toBeNull();
  });

  it('says there is no single MP when the tracks give no range', () => {
    const m = present(sub({ mpRange: null, mpBandMi: null, tier: null, anchorIds: [] }), net(), MI);
    expect(m.mpText).toBeNull();
    expect(m.rangeText).toBe(t('card.noSingleMp'));
    expect(m.bandText).toBeNull();
  });

  it('keeps the range in miles and converts only the band in kilometre mode', () => {
    const m = present(sub(), net(), KM, META);
    expect(m.rangeText).toBe('MP 112.40 to 112.46');
    expect(m.bandText).toBe(`± ${milesToKilometres(0.05).toFixed(2)} km from GPS accuracy only`);
  });

  it('leaves the subdivision empty when the parallel tracks are in different subdivisions', () => {
    const tracks = [cand(), cand({ chainId: 'C2', subdivisionNid: 'sub-2', subdivisionName: 'B' })];
    const r = sub({ candidates: tracks, rangeGroup: tracks });
    expect(present(r, net(), MI).subdivision).toBeNull();
  });

  it('labels the range from its own railway and reports a different railway as another route', () => {
    // Core kept CN's double track by CONTINUITY; a CPKC line also fits by position alone.
    const cpkc = cand({
      chainId: 'P1',
      chainBaseId: 'P1',
      subdivisionNid: 'sub-cp',
      subdivisionName: 'Belleville Sub',
      operator: 'CPKC',
      residualM: 6.4,
    });
    const r = sub({ candidates: [...pair, cpkc], rangeGroup: pair, reasons: ['CONTINUITY'] });
    for (const lang of ['en', 'fr'] as const) {
      setLang(lang);
      const m = present(r, net(), MI, META);
      expect(m.operator).toBe('CN'); // never "CN, CPKC"
      expect(m.subdivision).toBe('Kingston Sub');
      expect(m.trackClass).toBe('Main');
      expect(m.rangeText).toBe(
        lang === 'en'
          ? 'MP 112.40 to 112.46'
          : t('card.range', { lower: '112,40', upper: '112,46' }),
      );
      expect(m.alsoFitText).toBe(t('card.alsoFit', { count: 1 }));
    }
  });

  it('shows no other-routes notice when every candidate is in the range group', () => {
    expect(present(sub(), net(), MI, META).alsoFitText).toBeNull();
  });

  it('falls back to the candidates for a result that carries no range group', () => {
    const m = present(sub({ rangeGroup: [] }), net(), MI, META);
    expect(m.subdivision).toBe('Kingston Sub');
    expect(m.alsoFitText).toBeNull();
  });
});

describe('present: AMBIGUOUS_ROUTE with fewer than two routes', () => {
  const one = [cand({ chainId: 'C1', chainBaseId: 'C1', residualM: 4.2 })];
  const two = [...one, cand({ chainId: 'C2', chainBaseId: 'C2', subdivisionNid: 'sub-2' })];
  const make = (candidates: Result['candidates'], reasons: Result['reasons']): Result => ({
    ...blank,
    status: 'AMBIGUOUS_ROUTE',
    candidates,
    reasons,
  });

  it('says the data is incomplete for one route with PARTIAL_COVERAGE (EN and FR)', () => {
    const r = make(one, ['PARTIAL_COVERAGE']);
    const m = present(r, net(), MI);
    expect(m.singleRoute).toBe('partial');
    expect(m.headline).toBe(t('status.AMBIGUOUS_PARTIAL'));
    expect(m.headline).not.toMatch(/more than one/i);
    expect(m.mpText).toBeNull();
    expect(m.choices).toHaveLength(1);
    setLang('fr');
    expect(present(r, net(), MI).headline).toBe(t('status.AMBIGUOUS_PARTIAL'));
    expect(t('status.AMBIGUOUS_PARTIAL')).not.toBe('status.AMBIGUOUS_PARTIAL');
  });

  it('says a crossing is nearby for one route with DIAMOND_NEARBY (EN and FR)', () => {
    const r = make(one, ['DIAMOND_NEARBY']);
    const m = present(r, net(), MI);
    expect(m.singleRoute).toBe('diamond');
    expect(m.headline).toBe('Route not certain: a crossing (diamond) is nearby');
    expect(m.headline).not.toMatch(/more than one/i);
    expect(m.reasons.join(' ')).toContain('crossing of two tracks');
    setLang('fr');
    expect(present(r, net(), MI).headline).toBe(t('status.AMBIGUOUS_DIAMOND'));
    expect(t('route.diamondHelp')).not.toBe('route.diamondHelp');
  });

  it('says only "Route not certain" for one route with any other reason, or none', () => {
    for (const reasons of [['HEADING_INCONSISTENT'], []] as const) {
      const m = present(make(one, [...reasons]), net(), MI);
      expect(m.singleRoute).toBe('other');
      expect(m.headline).toBe('Route not certain');
    }
    expect(present(make([], ['NO_CANDIDATE_IN_RADIUS']), net(), MI).singleRoute).toBe('other');
  });

  it('partial coverage wins over the diamond when both are reasons', () => {
    expect(present(make(one, ['DIAMOND_NEARBY', 'PARTIAL_COVERAGE']), net(), MI).singleRoute).toBe(
      'partial',
    );
  });

  it('keeps "More than one route fits" only for two or more routes, whatever the reasons', () => {
    for (const reasons of [
      ['MULTIPLE_ROUTES'],
      ['PARTIAL_COVERAGE'],
      ['DIAMOND_NEARBY'],
    ] as const) {
      const m = present(make(two, [...reasons]), net(), MI);
      expect(m.singleRoute).toBeNull();
      expect(m.headline).toBe(t('status.AMBIGUOUS_ROUTE'));
    }
  });
});

describe('present: AMBIGUOUS_ROUTE and LOCK_CONFLICT', () => {
  const two = [
    cand({ chainId: 'C1', chainBaseId: 'C1', residualM: 4.2 }),
    cand({
      chainId: 'C9#2',
      chainBaseId: 'C9',
      operator: 'CP',
      subdivisionNid: 'sub-9',
      subdivisionName: 'Belleville Sub',
      residualM: 6,
    }),
  ];

  it('offers choices with operator, subdivision and residual, and no MP', () => {
    const r: Result = {
      ...blank,
      status: 'AMBIGUOUS_ROUTE',
      candidates: two,
      reasons: ['MULTIPLE_ROUTES', 'DIAMOND_NEARBY'],
      accuracyM: 5,
      fixAgeMs: 500,
    };
    const m = present(r, net(), MI, META);
    expect(m.mpText).toBeNull();
    expect(m.rangeText).toBeNull();
    expect(m.bandText).toBeNull();
    expect(m.tierBadge).toBeNull();
    expect(m.choices).toHaveLength(2);
    expect(m.choices[0]).toMatchObject({
      operator: 'CN',
      subdivision: 'Kingston Sub',
      residualText: 'off-track 4.2 m',
      lock: { kind: 'chain', chainId: 'C1' },
    });
    // The route is locked by its base chain id, so a later piece of the same route is the same choice.
    expect(m.choices[1]?.lock).toEqual({ kind: 'chain', chainId: 'C9' });
    expect(m.reasons).toEqual([t('reason.MULTIPLE_ROUTES'), t('reason.DIAMOND_NEARBY')]);
  });

  it('lists one choice per route (nearest pass) and marks an unchained segment as not lockable', () => {
    const r: Result = {
      ...blank,
      status: 'AMBIGUOUS_ROUTE',
      candidates: [
        cand({ residualM: 9 }),
        cand({ residualM: 2, chainId: 'C1#2' }),
        cand({ chainId: null, chainBaseId: null, segmentKey: 'seg-1', s: null, residualM: 3 }),
      ],
    };
    const m = present(r, net(), MI);
    expect(m.choices).toHaveLength(2);
    expect(m.choices.find((c) => c.lock !== null)?.residualText).toBe('off-track 2.0 m');
    expect(m.choices.find((c) => c.lock === null)).toBeDefined();
  });

  it('keeps the lock text on LOCK_CONFLICT, has no MP, and keeps the choices for another pick', () => {
    const r: Result = {
      ...blank,
      status: 'LOCK_CONFLICT',
      candidates: two,
      lock: { kind: 'chain', chainId: 'C1' },
      reasons: ['LOCK_NOT_SUPPORTED'],
      accuracyM: 5,
      fixAgeMs: 500,
    };
    const m = present(r, net(), MI);
    expect(m.lockText).toBe('Locked: Kingston Sub');
    expect(m.mpText).toBeNull();
    expect(m.headline).toBe(t('status.LOCK_CONFLICT'));
    expect(m.choices).toHaveLength(2);
  });

  it('names a lock that no candidate carries by its id, never as a subdivision', () => {
    const r: Result = {
      ...blank,
      status: 'LOCK_CONFLICT',
      lock: { kind: 'subdivision', subdivisionNid: 'sub-77' },
      reasons: ['LOCK_NOT_SUPPORTED'],
    };
    expect(present(r, net(), MI).lockText).toBe('Locked: sub-77');
    const c: Result = { ...r, lock: { kind: 'chain', chainId: 'ZZ' } };
    expect(present(c, net(), MI).lockText).toBe('Locked: ZZ');
  });

  it('names a conflicting lock from the loaded network, not by its id', () => {
    const loaded: NetworkView = {
      ...net(),
      chains: [chain('ch-A', 'sub-9', 'Belleville Sub', 0, 1000)],
    };
    const r: Result = {
      ...blank,
      status: 'LOCK_CONFLICT',
      lock: { kind: 'chain', chainId: 'ch-A' },
      reasons: ['LOCK_NOT_SUPPORTED'],
    };
    expect(present(r, loaded, MI).lockText).toBe('Locked: Belleville Sub');
    const sub: Result = { ...r, lock: { kind: 'subdivision', subdivisionNid: 'sub-9' } };
    expect(present(sub, loaded, MI).lockText).toBe('Locked: Belleville Sub');
  });

  it('finds the subdivision name of a subdivision lock from the candidates', () => {
    const r: Result = {
      ...blank,
      status: 'LOCK_CONFLICT',
      candidates: two,
      lock: { kind: 'subdivision', subdivisionNid: 'sub-9' },
    };
    expect(present(r, net(), MI).lockText).toBe('Locked: Belleville Sub');
  });
});

describe('present: STALE (ruling P9)', () => {
  it('is historical, shows the last MP only as "Last known ... (historical)", and no current MP', () => {
    const past = matched(112.43, { fixAgeMs: 20_000 });
    const stale: Result = {
      ...blank,
      status: 'STALE',
      reasons: ['FIX_STALE'],
      accuracyM: 6,
      fixAgeMs: 20_000,
      historical: past,
    };
    const m = present(stale, net(), MI, META);
    expect(m.historical).toBe(true);
    expect(m.mpText).toBe('Last known MP 112.43 (historical)');
    expect(m.bandText).toBeNull();
    expect(m.rangeText).toBeNull();
    expect(m.residualText).toBeNull();
    expect(m.headline).toBe(t('status.STALE'));
    expect(m.reasons).toEqual([t('reason.FIX_STALE')]);
    expect(m.fixAgeText).toBe('fix 20 s ago');
  });

  it('shows no last-known MP when the history had none', () => {
    const stale: Result = {
      ...blank,
      status: 'STALE',
      reasons: ['FIX_STALE'],
      fixAgeMs: 99_000,
      historical: { ...blank, status: 'AMBIGUOUS_ROUTE' },
    };
    const m = present(stale, net(), MI);
    expect(m.historical).toBe(true);
    expect(m.mpText).toBeNull();
  });

  it('carries a historical range as last known too', () => {
    const stale: Result = {
      ...blank,
      status: 'STALE',
      reasons: ['FIX_STALE'],
      fixAgeMs: 30_000,
      historical: {
        ...blank,
        status: 'MATCHED_SUBDIVISION',
        mpRange: { lowerMp: 1, upperMp: 1.02 },
      },
    };
    expect(present(stale, net(), MI).mpText).toBe('Last known MP 1.00 to 1.02 (historical)');
  });

  it('says so when the fix came from the future', () => {
    const stale: Result = {
      ...blank,
      status: 'STALE',
      reasons: ['FIX_STALE', 'FIX_FROM_FUTURE'],
      fixAgeMs: 40_000,
      historical: null,
    };
    expect(present(stale, net(), MI).reasons).toContain(t('reason.FIX_FROM_FUTURE'));
  });
});

describe('present: statuses with only a reason', () => {
  const cases: readonly [Result['status'], Result['reasons']][] = [
    ['NO_FIX', ['NO_FIX_YET']],
    ['NO_PERMISSION', ['PERMISSION_DENIED']],
    ['NO_COVERAGE', ['OUTSIDE_LOADED_TILES']],
    ['OFF_NETWORK', ['NO_CANDIDATE_IN_RADIUS']],
  ];
  for (const [status, reasons] of cases) {
    it(`${status} shows its status and reason text and no position`, () => {
      const m = present({ ...blank, status, reasons }, net(), MI, META);
      expect(m.headline).toBe(t(`status.${status}`));
      expect(m.reasons).toEqual(reasons.map((r) => t(`reason.${r}`)));
      expect(m.mpText).toBeNull();
      expect(m.rangeText).toBeNull();
      expect(m.bandText).toBeNull();
      expect(m.residualText).toBeNull();
      expect(m.anchorsText).toBeNull();
      expect(m.tierBadge).toBeNull();
      expect(m.accuracyText).toBeNull();
      expect(m.fixAgeText).toBeNull();
      expect(m.choices).toEqual([]);
      expect(m.lockText).toBeNull();
      expect(m.historical).toBe(false);
    });
  }

  it('has French text for every status and reason', () => {
    setLang('fr');
    for (const [status, reasons] of cases) {
      const m = present({ ...blank, status, reasons }, net(), MI, META);
      expect(m.headline).toBe(t(`status.${status}`));
      expect(m.reasons[0]).toBe(t(`reason.${reasons[0] ?? 'NO_FIX_YET'}`));
    }
  });
});

describe('direction (D5)', () => {
  const at = (s: number, over: Partial<Result> = {}, c: Partial<Candidate> = {}): Result =>
    matched(10, { fixAgeMs: 1000, ...over }, cand({ s, ...c }));

  it('is up when s grows by 10 m or more, down when it shrinks', () => {
    expect(direction(at(1000), at(1010))).toBe('up');
    expect(direction(at(1000), at(1500))).toBe('up');
    expect(direction(at(1000), at(990))).toBe('down');
  });

  it('is null under 10 m, without a previous result, or on a different chain', () => {
    expect(direction(at(1000), at(1009.9))).toBeNull();
    expect(direction(null, at(1500))).toBeNull();
    expect(
      direction(at(1000), at(1500, {}, { chainBaseId: 'OTHER', chainId: 'OTHER' })),
    ).toBeNull();
  });

  it('is null unless both are MATCHED and fresh', () => {
    expect(direction(at(1000), at(1500, { status: 'AMBIGUOUS_ROUTE' }))).toBeNull();
    expect(direction(at(1000, { status: 'STALE' }), at(1500))).toBeNull();
    expect(direction(at(1000), at(1500, { fixAgeMs: 15_001 }))).toBeNull();
    expect(direction(at(1000), at(1500, { fixAgeMs: null }))).toBeNull();
    expect(direction(at(1000, { fixAgeMs: 20_000 }), at(1500))).toBeNull();
  });

  it('is null when s or the chain is missing', () => {
    expect(direction(at(1000), at(1500, { s: null }))).toBeNull();
    expect(direction(at(1000), at(1500, { chosen: null }))).toBeNull();
    expect(direction(at(1000, { s: null }), at(1500))).toBeNull();
    expect(direction(at(1000, { chosen: null }), at(1500))).toBeNull();
    expect(direction(at(1000), at(1500, {}, { chainBaseId: null, chainId: null }))).toBeNull();
  });

  it('treats a calibrated chain at the same base id but another piece as the same chain', () => {
    expect(direction(at(1000, {}, { chainId: 'C1' }), at(1500, {}, { chainId: 'C1#2' }))).toBe(
      'up',
    );
  });

  it('accepts a larger minimum step', () => {
    expect(direction(at(1000), at(1015), 20)).toBeNull();
    expect(direction(at(1000), at(1020), 20)).toBe('up');
  });
});

describe('directionTracker', () => {
  const at = (s: number, over: Partial<Result> = {}, c: Partial<Candidate> = {}): Result =>
    matched(10, { fixAgeMs: 1000, accuracyM: 5, ...over }, cand({ s, ...c }));

  it('stays unknown until a fresh step of 10 m on one chain, then holds it', () => {
    const tr = directionTracker();
    expect(tr.update(at(1000))).toBeNull();
    expect(tr.update(at(1004))).toBeNull();
    expect(tr.update(at(1020))).toBe('up');
    expect(tr.update(at(1022))).toBe('up'); // small step keeps the known direction
    expect(tr.update(at(1000))).toBe('down');
  });

  it('needs a step larger than the fix accuracy, so jitter does not flip the arrows', () => {
    const tr = directionTracker();
    tr.update(at(1000, { accuracyM: 30 }));
    expect(tr.update(at(1015, { accuracyM: 30 }))).toBeNull();
    expect(tr.update(at(1040, { accuracyM: 30 }))).toBe('up');
  });

  it('forgets the direction when the match is lost or the chain changes', () => {
    const tr = directionTracker();
    tr.update(at(1000));
    expect(tr.update(at(1100))).toBe('up');
    expect(tr.update({ ...blank, status: 'AMBIGUOUS_ROUTE' })).toBeNull();
    expect(tr.update(at(1200))).toBeNull();
    expect(tr.update(at(1300))).toBe('up');
    expect(tr.update(at(1400, {}, { chainBaseId: 'X', chainId: 'X' }))).toBeNull();
  });
});

describe('announce (live region)', () => {
  const model = (status: Result['status'], mp: number | null) =>
    present(mp === null ? { ...blank, status } : matched(mp), net(), MI, META);

  it('announces the first model at once', () => {
    const text = announce(model('MATCHED', 112.43), null, 1000, null);
    expect(text).toContain(t('status.MATCHED'));
    expect(text).toContain('MP 112.43');
  });

  it('does not announce again inside 10 s even if the MP changed', () => {
    const m = model('MATCHED', 112.44);
    const last = announce(model('MATCHED', 112.43), null, 0, null);
    expect(announce(m, 0, ANNOUNCE_MIN_INTERVAL_MS - 1, last)).toBeNull();
  });

  it('announces a change after 10 s, and not an unchanged text', () => {
    const first = announce(model('MATCHED', 112.43), null, 0, null);
    expect(announce(model('MATCHED', 112.43), 0, 60_000, first)).toBeNull();
    const next = announce(model('MATCHED', 112.44), 0, ANNOUNCE_MIN_INTERVAL_MS, first);
    expect(next).toContain('MP 112.44');
  });

  it('announces a status change after 10 s', () => {
    const first = announce(model('MATCHED', 112.43), null, 0, null);
    const next = announce(model('OFF_NETWORK', null), 0, 10_000, first);
    expect(next).toContain(t('status.OFF_NETWORK'));
  });

  it('announces a historical last-known value labelled as historical', () => {
    const stale: Result = {
      ...blank,
      status: 'STALE',
      reasons: ['FIX_STALE'],
      fixAgeMs: 20_000,
      historical: matched(112.43),
    };
    const text = announce(present(stale, net(), MI, META), 0, 20_000, null);
    expect(text).toContain('Last known MP 112.43 (historical)');
  });
});

describe('presentAssets', () => {
  const asset = (
    id: string,
    sM: number,
    over: Partial<NetworkAsset> = {},
    derivedMp: number | null = null,
  ): NetworkAsset => ({
    id,
    kind: 'crossing',
    name: `Crossing ${id}`,
    posted: null,
    positions: [{ chainId: 'C1', sM, residualM: 1, derivedMp }],
    at: { lat: 52, lon: -106 },
    ...over,
  });
  const here = matched(112.43, {}, cand({ s: 5000 }));

  it('lists nearby assets nearest first with neutral wording until a direction is known', () => {
    const n = net([asset('b', 5800), asset('a', 4500), asset('far', 40_000)]);
    const rows = presentAssets(here, n, MI, null);
    expect(rows.map((r) => r.id)).toEqual(['a', 'b']);
    expect(rows[0]?.sideText).toBe('toward lower MP');
    expect(rows[1]?.sideText).toBe('toward higher MP');
    expect(rows[0]?.distanceText).toBe('0.31 mi');
    expect(rows[0]?.name).toBe('Crossing a');
  });

  it('flips the wording when anchors show MP falls as s grows', () => {
    const down: Result = {
      ...here,
      milepost: {
        kind: 'calibrated',
        mp: 50,
        lower: anchor('a1', 4000, 50.5),
        upper: anchor('a2', 6000, 49.5),
        intervalLengthM: 2000,
      },
    };
    const rows = presentAssets(down, net([asset('a', 4500), asset('b', 5800)]), MI, null);
    expect(rows[0]?.sideText).toBe('toward higher MP');
    expect(rows[1]?.sideText).toBe('toward lower MP');
  });

  it('does not claim an MP direction when the milepost is not calibrated', () => {
    const unc: Result = {
      ...here,
      milepost: { kind: 'uncalibrated', reason: 'AFTER_LAST_ANCHOR' },
    };
    const rows = presentAssets(unc, net([asset('a', 4500)]), MI, null);
    expect(rows[0]?.sideText).toBe(t('asset.side.unknownBack'));
    expect(rows[0]?.sideText).not.toMatch(/MP/);
    const fwd = presentAssets(unc, net([asset('b', 5500)]), MI, null);
    expect(fwd[0]?.sideText).toBe(t('asset.side.unknownForward'));
  });

  it('uses ahead and behind once the direction is known', () => {
    const n = net([asset('a', 4500), asset('b', 5800)]);
    const up = presentAssets(here, n, MI, 'up');
    expect(up.find((r) => r.id === 'b')?.sideText).toBe('ahead');
    expect(up.find((r) => r.id === 'a')?.sideText).toBe('behind');
    const down = presentAssets(here, n, MI, 'down');
    expect(down.find((r) => r.id === 'b')?.sideText).toBe('behind');
    expect(down.find((r) => r.id === 'a')?.sideText).toBe('ahead');
  });

  it('labels posted and derived mileage differently and flags an unverified or other-subdivision post', () => {
    const n = net([
      asset('p', 5100, { posted: { mp: 112.74, subdivisionNid: 'sub-1', tier: 'posted' } }, 112.7),
      asset('d', 5200, {}, 112.9),
      asset('u', 5300, { posted: { mp: 3, subdivisionNid: 'sub-1', tier: 'unverified' } }),
      asset('o', 5400, { posted: { mp: 8, subdivisionNid: 'other', tier: 'tc' } }),
      asset('none', 5500),
    ]);
    const rows = presentAssets(here, n, MI, null);
    const by = (id: string) => rows.find((r) => r.id === id);
    expect(by('p')?.postedText).toBe('posted MP 112.74');
    expect(by('p')?.derivedText).toBe('calculated MP 112.70');
    expect(by('d')?.postedText).toBeNull();
    expect(by('d')?.derivedText).toBe('calculated MP 112.90');
    expect(by('u')?.postedText).toBe('posted MP 3.00 (unverified)');
    expect(by('o')?.postedText).toBe('posted MP 8.00 (other subdivision)');
    expect(by('none')?.postedText).toBeNull();
    expect(by('none')?.derivedText).toBeNull();
    expect(by('none')?.noMileageText).toBe(t('asset.noMileage'));
  });

  it('shows a posted MP of 0 as "posted MP 0.00"', () => {
    const n = net([
      asset('z', 5100, { posted: { mp: 0, subdivisionNid: 'sub-1', tier: 'posted' } }),
    ]);
    expect(presentAssets(here, n, MI, null)[0]?.postedText).toBe('posted MP 0.00');
  });

  it('uses kilometres, labelled, via milesToKilometres', () => {
    const rows = presentAssets(here, net([asset('a', 4500)]), KM, null);
    const km = milesToKilometres(500 / 1609.344).toFixed(2);
    expect(rows[0]?.distanceText).toBe(`${km} km`);
  });

  it('falls back to a kind label when the asset has no name', () => {
    const rows = presentAssets(
      here,
      net([asset('a', 4500, { name: null, kind: 'bridge' })]),
      MI,
      null,
    );
    expect(rows[0]?.name).toBe(t('asset.kind.bridge'));
    expect(rows[0]?.kindText).toBe(t('asset.kind.bridge'));
  });

  it('lists nothing unless the match is a MATCHED track with a position', () => {
    const n = net([asset('a', 4500)]);
    expect(presentAssets({ ...here, status: 'AMBIGUOUS_ROUTE' }, n, MI, null)).toEqual([]);
    expect(presentAssets({ ...here, s: null }, n, MI, null)).toEqual([]);
    expect(presentAssets({ ...here, chosen: null }, n, MI, null)).toEqual([]);
    const seg = matched(
      1,
      {},
      cand({ chainId: null, chainBaseId: null, segmentKey: 'x', s: null }),
    );
    expect(presentAssets(seg, n, MI, null)).toEqual([]);
  });

  it('caps the list', () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      asset(`a${String(i).padStart(2, '0')}`, 5000 + i),
    );
    expect(presentAssets(here, net(many), MI, null).length).toBeLessThanOrEqual(20);
  });
});

describe('assetSource', () => {
  it('returns the layer and attributes from memory', () => {
    const src = assetSource({ a1: { layer: 'CROSSING', attrs: { B: '2', A: '1' } } }, 'a1');
    expect(src).toEqual({
      kind: 'found',
      layer: 'CROSSING',
      attrs: [
        ['A', '1'],
        ['B', '2'],
      ],
    });
  });

  it('returns a typed "missing" result, not a crash, for an unknown id or no details', () => {
    expect(assetSource({}, 'zz')).toEqual({ kind: 'missing' });
    expect(assetSource(null, 'zz')).toEqual({ kind: 'missing' });
  });
});
