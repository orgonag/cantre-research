import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeEach, describe, expect, it } from 'vitest';
import { networkFromSnapshot } from '@cantre/core';
import { setLang } from '../../src/i18n/index.js';
import {
  findBySubdivision,
  parseMilepost,
  pinText,
  presentTap,
  subdivisionsOf,
} from '../../src/logic/find.js';
import { ORIGIN, chain, interval, net } from './netfixture.js';

beforeEach(() => {
  setLang('en');
});

// Two subdivisions; "Alpha" is double track (two chains, both calibrated 10..12 over 2000 m).
const alpha1 = chain('a1', 'sub-a', 'Alpha Sub', 0, 2000);
const alpha2 = chain('a2', 'sub-a', 'Alpha Sub', 0, 2000, 30);
const beta = chain('b1', 'sub-b', 'Beta Sub', 5000, 7000);
const sample = net({
  chains: [beta, alpha1, alpha2],
  intervals: [
    interval('iv-a1', 'a1', [
      [0, 10],
      [2000, 12],
    ]),
    interval('iv-a2', 'a2', [
      [0, 10],
      [2000, 12],
    ]),
    interval('iv-b1', 'b1', [
      [5000, 40],
      [7000, 42],
    ]),
  ],
});

describe('subdivisionsOf', () => {
  it('lists each subdivision once, sorted by name', () => {
    expect(subdivisionsOf(sample)).toEqual([
      { nid: 'sub-a', name: 'Alpha Sub', label: 'Alpha Sub (CN)' },
      { nid: 'sub-b', name: 'Beta Sub', label: 'Beta Sub (CN)' },
    ]);
  });

  it('includes subdivisions that only have unchained segments, and breaks name ties by nid', () => {
    const withSiding = net({
      chains: [chain('z', 'sub-2', 'Same Name', 0, 100)],
      segments: [
        {
          key: 'k1',
          chainId: null,
          trackClass: 'Siding',
          status: 'Operational',
          subdivisionNid: 'sub-1',
          subdivisionName: 'Same Name',
          operator: 'CN',
          geoAccuracyM: null,
          pts: [ORIGIN, ORIGIN],
        },
      ],
    });
    expect(subdivisionsOf(withSiding).map((s) => s.nid)).toEqual(['sub-1', 'sub-2']);
  });

  it('is empty for an empty network', () => {
    expect(subdivisionsOf(net())).toEqual([]);
  });
});

describe('subdivision labels (repeated names must be told apart)', () => {
  // Two subdivisions called "Cartier": one calibrated 10..12 near the origin, one 40..42 far away.
  const farChain = chain('far', 'sub-far', 'Cartier', 0, 2000);
  const nearChain = chain('near', 'sub-near', 'Cartier', 0, 2000);
  const moved = {
    ...farChain,
    pts: farChain.pts.map((p) => ({ lat: p.lat + 3, lon: p.lon })),
  };
  const twins = net({
    chains: [nearChain, moved],
    intervals: [
      interval('i1', 'near', [
        [0, 10],
        [2000, 12],
      ]),
      interval('i2', 'far', [
        [0, 40],
        [2000, 42],
      ]),
    ],
  });

  it('adds the milepost range and a coarse place for a repeated name, only for those', () => {
    const labels = subdivisionsOf(twins).map((o) => o.label);
    expect(labels).toEqual([
      // Same name: ordered by NID (sub-far, then sub-near).
      'Cartier (CN), MP 40.00 to 42.00, near 53.0, -100.0',
      'Cartier (CN), MP 10.00 to 12.00, near 50.0, -100.0',
    ]);
    // A unique name gets the operator only.
    expect(subdivisionsOf(sample)[0]?.label).toBe('Alpha Sub (CN)');
  });

  it('adds the NID as a last resort when everything else is equal', () => {
    const same = net({
      chains: [chain('x1', 'sub-1', 'Dup', 0, 2000), chain('x2', 'sub-2', 'Dup', 0, 2000)],
    });
    const labels = subdivisionsOf(same).map((o) => o.label);
    expect(new Set(labels).size).toBe(2);
    expect(labels[0]).toContain('ID sub-1');
    expect(labels[1]).toContain('ID sub-2');
  });

  it('lists several operators, and a segment-only subdivision by its operator', () => {
    const multi = net({
      chains: [{ ...alpha1, operators: ['CN', 'CPKC'] }],
      segments: [
        {
          key: 'k',
          chainId: null,
          trackClass: 'Siding',
          status: 'Operational',
          subdivisionNid: 'sub-s',
          subdivisionName: 'Yard',
          operator: '',
          geoAccuracyM: null,
          pts: [ORIGIN, ORIGIN],
        },
      ],
    });
    expect(subdivisionsOf(multi).map((o) => o.label)).toEqual(['Alpha Sub (CN, CPKC)', 'Yard']);
  });

  it('follows the language: labels are rebuilt when the language changes, and back', () => {
    setLang('en');
    const en = subdivisionsOf(twins).map((o) => o.label);
    expect(en[0]).toContain('MP 40.00 to 42.00');
    setLang('fr');
    const fr = subdivisionsOf(twins).map((o) => o.label);
    expect(fr[0]).toContain('PM 40,00 à 42,00');
    expect(fr[0]).not.toContain('MP 40');
    expect(subdivisionsOf(twins).map((o) => o.label)).toEqual(fr); // cached per language
    setLang('en');
    expect(subdivisionsOf(twins).map((o) => o.label)).toEqual(en);
  });

  it('shows the label, not just the name, in a result line', () => {
    const r = findBySubdivision(twins, 'sub-far', 41);
    if (r.kind !== 'pins' || r.pins[0] === undefined) {
      throw new Error('expected a pin');
    }
    expect(pinText(r.pins[0], 41)).toContain('Cartier (CN), MP 40.00 to 42.00, near 53.0');
  });

  it('gives every option a unique label on the golden snapshots', () => {
    const dir = new URL('../../../pipeline/tests/golden/synthetic/', import.meta.url);
    for (const file of ['snapshot.bin.gz', 'national/snapshot.bin.gz']) {
      const golden = networkFromSnapshot(gunzipSync(readFileSync(new URL(file, dir))));
      const options = subdivisionsOf(golden);
      expect(options.length, file).toBeGreaterThan(0);
      expect(new Set(options.map((o) => o.label)).size, file).toBe(options.length);
    }
  });
});

describe('findBySubdivision', () => {
  it('gives one pin for a milepost inside an interval, with its place', () => {
    const r = findBySubdivision(sample, 'sub-b', 41);
    if (r.kind !== 'pins') {
      throw new Error('expected pins');
    }
    expect(r.pins).toHaveLength(1);
    const pin = r.pins[0];
    expect(pin?.chainId).toBe('b1');
    expect(pin?.subdivisionName).toBe('Beta Sub');
    expect(pin?.sM).toBeCloseTo(6000, 6);
    expect(pin?.at.lat).toBeCloseTo(50, 3);
  });

  it('gives two pins on double track', () => {
    const r = findBySubdivision(sample, 'sub-a', 11);
    if (r.kind !== 'pins') {
      throw new Error('expected pins');
    }
    expect(r.pins.map((p) => p.chainId)).toEqual(['a1', 'a2']);
  });

  it('gives find.noInterval for a milepost in a gap, never an extrapolated pin', () => {
    expect(findBySubdivision(sample, 'sub-a', 12.5)).toEqual({
      kind: 'none',
      messageKey: 'find.noInterval',
    });
    expect(findBySubdivision(sample, 'sub-a', 9.99)).toEqual({
      kind: 'none',
      messageKey: 'find.noInterval',
    });
  });

  it('gives find.noInterval for an unknown subdivision', () => {
    expect(findBySubdivision(sample, 'sub-zzz', 11).kind).toBe('none');
  });
});

describe('parseMilepost', () => {
  it('reads plain decimals, with a point or a comma', () => {
    expect(parseMilepost('12')).toBe(12);
    expect(parseMilepost(' 12.5 ')).toBe(12.5);
    expect(parseMilepost('12,5')).toBe(12.5);
    expect(parseMilepost('0')).toBe(0);
    expect(parseMilepost('-3.25')).toBe(-3.25);
  });

  it('rejects empty, words, exponents and double separators (never reads them as 0)', () => {
    for (const bad of ['', '  ', 'abc', '1e3', '1.2.3', '12 mi', 'Infinity', 'NaN', '.', '-']) {
      expect(parseMilepost(bad), bad).toBeNull();
    }
  });
});

describe('pinText', () => {
  it('lists subdivision, MP and latitude/longitude', () => {
    const r = findBySubdivision(sample, 'sub-b', 41);
    if (r.kind !== 'pins' || r.pins[0] === undefined) {
      throw new Error('expected a pin');
    }
    const text = pinText(r.pins[0], 41);
    expect(text).toContain('Beta Sub');
    expect(text).toContain('MP 41.00');
    expect(text).toMatch(/latitude 50\.0\d{4}, longitude -99\.\d{5}/);
  });

  it('writes the numbers with French separators when French is active', () => {
    setLang('fr');
    const r = findBySubdivision(sample, 'sub-b', 41.5);
    if (r.kind !== 'pins' || r.pins[0] === undefined) {
      throw new Error('expected a pin');
    }
    expect(pinText(r.pins[0], 41.5)).toContain('41,50');
  });
});

describe('presentTap', () => {
  it('labels a tap "from map position, no GPS" and gives the milepost under it', () => {
    // The middle vertex of chain a1 is 1000 m along it: MP 11.
    const p = alpha1.pts[1];
    if (p === undefined) {
      throw new Error('no point');
    }
    const m = presentTap(sample, p);
    expect(m.label).toBe('From map position, no GPS');
    expect(m.outside).toBe(false);
    const row = m.rows.find((r) => r.mpText !== null);
    expect(row?.mpText).toBe('MP 11.00');
    expect(row?.subdivision).toBe('Alpha Sub');
  });

  it('gives a reason, not a milepost, for an uncalibrated track', () => {
    const bare = net({ chains: [alpha1] });
    const m = presentTap(bare, alpha1.pts[1] ?? ORIGIN);
    expect(m.rows[0]?.mpText).toBeNull();
    expect(m.rows[0]?.noMpText).toBeTruthy();
  });

  it('says nothing is near when no track is within reach', () => {
    const m = presentTap(sample, { lat: 50.5, lon: -100 });
    expect(m.rows).toEqual([]);
    expect(m.outside).toBe(false);
  });

  it('does not hide an unexpected failure as "outside Canada"', () => {
    const broken = {
      ...sample,
      get chains(): never {
        throw new Error('boom');
      },
    };
    expect(() => presentTap(broken, ORIGIN)).toThrow('boom');
  });

  it('flags a point outside Canada instead of throwing', () => {
    const m = presentTap(sample, { lat: 0, lon: 0 });
    expect(m.outside).toBe(true);
    expect(m.rows).toEqual([]);
  });
});
