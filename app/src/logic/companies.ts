import type { NetworkAsset, NetworkView } from '@cantre/core';
import { t } from '../i18n/index.js';
import names from './company-names.json';

/** Display identities from the source operator fields, never ownership or a matcher input.
 * See docs/COMPANIES.md for the public-source alias audit and its conflicts. */
export type Company = { id: string; name: string; light: string; dark: string };
export const UNKNOWN_COMPANY = 'unknown';
export const SHARED_COLOURS = { light: '#58476b', dark: '#e2c3ff' };
const UNKNOWN_COLOURS = { light: '#59636d', dark: '#c1c8cf' };
const COLOURS = [
  ['#ad3e37', '#ff968e'],
  ['#076f59', '#71ddbc'],
  ['#925b10', '#f5c36c'],
  ['#7250a1', '#c5a5f1'],
  ['#9f3d75', '#f6a0d0'],
  ['#286d79', '#80d6e3'],
  ['#747016', '#d9d475'],
  ['#a45526', '#f3b18a'],
  ['#3a688a', '#9dcce9'],
] as const;
const FIXED: Readonly<Record<string, readonly [string, string]>> = {
  CN: ['#c03935', '#ff8f89'],
  CPR: ['#7250a1', '#c5a5f1'],
  BNSF: ['#a4590b', '#f9bd64'],
  VIA: ['#78730b', '#e3d667'],
};
const aliases = new Map<string, { id: string; name: string }>();
for (const [mark, variants] of Object.entries(names.names)) {
  const entry = { id: mark, name: variants[0] ? `${mark} · ${variants[0]}` : mark };
  for (const value of [mark, ...variants]) aliases.set(value.toLowerCase(), entry);
}
const missing = new Set(['', 'unknown', 'none', '-1']);

/** Stable swatches, including for future unrecognised names. Names remain the identity:
 * colours can repeat across the national catalogue, so never present colour alone. */
export function companyOf(raw: string): Company {
  const value = raw.trim();
  if (missing.has(value.toLowerCase()))
    return { id: UNKNOWN_COMPANY, name: '', ...UNKNOWN_COLOURS };
  const known = aliases.get(value.toLowerCase());
  const id = known?.id ?? `name:${value}`;
  let hash = 0;
  for (const char of id) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 65521;
  const [light, dark] = FIXED[id] ?? COLOURS[hash % COLOURS.length] ?? COLOURS[0];
  return { id, name: known?.name ?? value, light, dark };
}

export function companyLabel(company: Company): string {
  return company.id === UNKNOWN_COMPANY ? t('company.unknown') : company.name;
}

export function companiesOf(operators: readonly string[]): Company[] {
  const rows = operators.length ? operators.map(companyOf) : [companyOf('')];
  return [...new Map(rows.map((c) => [c.id, c])).values()].sort((a, b) =>
    a.id.localeCompare(b.id, 'en'),
  );
}

export function companyPaint(companies: readonly Company[]) {
  return companies.length > 1 ? SHARED_COLOURS : (companies[0] ?? companyOf(''));
}

export type CompanyIndex = {
  choices: readonly Company[];
  assets: ReadonlyMap<string, readonly Company[]>;
};
const cache = new WeakMap<NetworkView, CompanyIndex>();

/** Build once per dataset. Asset identities use explicit chain/subdivision links only;
 * neither a nearby line nor the phone's selected route supplies an operator. */
export function companyIndex(net: NetworkView): CompanyIndex {
  const cached = cache.get(net);
  if (cached) return cached;
  const all = new Map<string, Company>();
  const chains = new Map<string, readonly Company[]>();
  const subdivisions = new Map<string, Map<string, Company>>();
  const add = (nid: string, rows: readonly Company[]) => {
    const group = subdivisions.get(nid) ?? new Map<string, Company>();
    for (const c of rows) {
      all.set(c.id, c);
      group.set(c.id, c);
    }
    subdivisions.set(nid, group);
  };
  for (const c of net.chains) {
    const rows = companiesOf(c.operators);
    chains.set(c.chainBaseId, rows);
    add(c.subdivisionNid, rows);
  }
  for (const s of net.segments) add(s.subdivisionNid, companiesOf([s.operator]));
  const assets = new Map<string, readonly Company[]>();
  for (const asset of net.assets) {
    const found = new Map<string, Company>();
    const collect = (rows: Iterable<Company>) => {
      for (const c of rows) found.set(c.id, c);
    };
    for (const position of asset.positions)
      collect(chains.get(position.chainId) ?? companiesOf([]));
    // A posted reference identifies its subdivision, not a specific owner or track.
    if (asset.posted)
      collect(subdivisions.get(asset.posted.subdivisionNid)?.values() ?? companiesOf([]));
    if (!found.size) collect(companiesOf([]));
    const rows = [...found.values()].sort((a, b) => a.id.localeCompare(b.id, 'en'));
    for (const c of rows) all.set(c.id, c);
    assets.set(asset.id, rows);
  }
  const index = {
    choices: [...all.values()].sort((a, b) => a.name.localeCompare(b.name, 'en')),
    assets,
  };
  cache.set(net, index);
  return index;
}

export function assetCompanies(asset: NetworkAsset, net: NetworkView): readonly Company[] {
  return companyIndex(net).assets.get(asset.id) ?? companiesOf([]);
}

/** Unknown saved values cannot silently hide the whole map after a dataset change. */
export function activeCompany(net: NetworkView, saved: string | undefined): string {
  return companyIndex(net).choices.some((c) => c.id === saved) ? (saved ?? '') : '';
}
