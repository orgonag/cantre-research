import { CoreInputError, locateMilepost, milepostAtPoint } from '@cantre/core';
import type { LatLon, LocatedMilepost, NetworkView } from '@cantre/core';
import { getLang, t } from '../i18n/index.js';
import type { Lang, MessageKey } from '../i18n/index.js';
import { fmt } from './present.js';
import { companiesOf, companyLabel } from './companies.js';

/**
 * Find-a-location and tap-to-milepost: the two ways to use the network without a GPS fix
 * (spec §7). Both are desk uses: a milepost typed in, or a point tapped on the map. Neither is a
 * fix, neither reaches the matcher, and neither is stored. The results are calculated from the
 * dataset's reference points; they are not surveyed positions.
 */

/**
 * One entry of the subdivision picker. `label` is what the picker and the result show: NRWN
 * repeats subdivision names across provinces (several "Cartier", many "Unknown"), so the name
 * alone could send a user to the wrong place with a valid-looking answer. The label is always
 * unique within the network.
 */
export type SubdivisionOption = {
  readonly nid: string;
  readonly name: string;
  readonly label: string;
};

/** Code-point order, so the picker order is the same on every device and locale. */
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** What is known about one subdivision, gathered from the network. */
type Facts = {
  name: string;
  operators: Set<string>;
  /** Calibrated milepost range over its intervals, miles; null when it has none. */
  mpMin: number | null;
  mpMax: number | null;
  /** Sum of vertex latitudes and longitudes (degrees) and the vertex count, for a centroid. */
  latSum: number;
  lonSum: number;
  count: number;
};

/**
 * Gathers per-subdivision facts. Chains and unchained segments both count, so a subdivision with
 * only sidings is listed (it will simply have no milepost range). The centroid is the plain mean
 * of the vertices, in degrees: a coarse "where", good to a few km, used only to tell repeated
 * names apart (not a position anyone should navigate to). Chain geometry is read, never changed.
 */
function factsOf(net: NetworkView): Map<string, Facts> {
  const facts = new Map<string, Facts>();
  const get = (nid: string, name: string): Facts => {
    let f = facts.get(nid);
    if (f === undefined) {
      f = { name, operators: new Set(), mpMin: null, mpMax: null, latSum: 0, lonSum: 0, count: 0 };
      facts.set(nid, f);
    }
    return f;
  };
  const addPoints = (f: Facts, pts: readonly LatLon[]): void => {
    for (const p of pts) {
      f.latSum += p.lat;
      f.lonSum += p.lon;
      f.count += 1;
    }
  };
  const nidOfChain = new Map<string, string>();
  for (const c of net.chains) {
    const f = get(c.subdivisionNid, c.subdivisionName);
    for (const op of c.operators) {
      f.operators.add(op);
    }
    addPoints(f, c.pts);
    nidOfChain.set(c.chainBaseId, c.subdivisionNid);
  }
  for (const s of net.segments) {
    const f = get(s.subdivisionNid, s.subdivisionName);
    if (s.operator !== '') {
      f.operators.add(s.operator);
    }
    addPoints(f, s.pts);
  }
  for (const iv of net.intervals) {
    const f = facts.get(nidOfChain.get(iv.chainId) ?? '');
    if (f === undefined) {
      continue;
    }
    for (const a of iv.anchors) {
      f.mpMin = f.mpMin === null ? a.mp : Math.min(f.mpMin, a.mp);
      f.mpMax = f.mpMax === null ? a.mp : Math.max(f.mpMax, a.mp);
    }
  }
  return facts;
}

/**
 * Builds the unique labels. Every label has the operator(s) when known: "Cartier (CN)".
 * A name that more than one subdivision uses also gets its calibrated milepost range and a
 * coarse place ("MP 0.00 to 99.10, near 46.5, -80.9"). If two labels are still equal, the NID
 * is added, which is unique by construction, so uniqueness always holds.
 */
function labelsOf(facts: ReadonlyMap<string, Facts>): Map<string, string> {
  const nameCount = new Map<string, number>();
  for (const f of facts.values()) {
    nameCount.set(f.name, (nameCount.get(f.name) ?? 0) + 1);
  }
  const labels = new Map<string, string>();
  for (const [nid, f] of facts) {
    const ops = [...f.operators].sort(byText).join(', ');
    let label = ops === '' ? f.name : t('find.option', { name: f.name, operators: ops });
    if ((nameCount.get(f.name) ?? 0) > 1) {
      const parts: string[] = [];
      if (f.mpMin !== null && f.mpMax !== null) {
        parts.push(t('find.optionMp', { from: fmt(f.mpMin, 2), to: fmt(f.mpMax, 2) }));
      }
      if (f.count > 0) {
        parts.push(
          t('find.optionNear', {
            lat: fmt(f.latSum / f.count, 1),
            lon: fmt(f.lonSum / f.count, 1),
          }),
        );
      }
      if (parts.length > 0) {
        label = `${label}, ${parts.join(', ')}`;
      }
    }
    labels.set(nid, label);
  }
  const labelCount = new Map<string, number>();
  for (const label of labels.values()) {
    labelCount.set(label, (labelCount.get(label) ?? 0) + 1);
  }
  for (const [nid, label] of labels) {
    if ((labelCount.get(label) ?? 0) > 1) {
      labels.set(nid, `${label}, ${t('find.optionId', { nid })}`);
    }
  }
  return labels;
}

/** Built options per network and per language, so a language switch rebuilds the labels. */
const optionsCache = new WeakMap<NetworkView, Map<Lang, readonly SubdivisionOption[]>>();

/**
 * The subdivisions in the loaded network, each once (by NID), sorted by name and then NID, with a
 * unique label each (see {@link labelsOf}). Built once per network and language: the label text
 * is in the active language, so a language switch builds (and then caches) the other set. Proper
 * names stay as published (spec §7).
 */
export function subdivisionsOf(net: NetworkView): readonly SubdivisionOption[] {
  const lang = getLang();
  const perLang = optionsCache.get(net) ?? new Map<Lang, readonly SubdivisionOption[]>();
  optionsCache.set(net, perLang);
  const cached = perLang.get(lang);
  if (cached !== undefined) {
    return cached;
  }
  const facts = factsOf(net);
  const labels = labelsOf(facts);
  const options = [...facts]
    .map(([nid, f]) => ({ nid, name: f.name, label: labels.get(nid) ?? f.name }))
    .sort((a, b) => byText(a.name, b.name) || byText(a.nid, b.nid));
  perLang.set(lang, options);
  return options;
}

/** One place a typed milepost lies: the core lookup result plus the subdivision's name and label. */
export type Pin = LocatedMilepost & {
  readonly subdivisionNid: string;
  readonly subdivisionName: string;
  /** The unique picker label, so the result names exactly the subdivision that was chosen. */
  readonly subdivisionLabel: string;
};

export type FindResult =
  | { readonly kind: 'pins'; readonly pins: readonly Pin[] }
  | { readonly kind: 'none'; readonly messageKey: Extract<MessageKey, 'find.noInterval'> };

/**
 * Where milepost `mp` (miles) lies in a subdivision: one pin per track that has it (double track
 * gives two), or `find.noInterval` when no calibrated interval holds it. Wraps
 * `locateMilepost`, which never extrapolates before the first or after the last reference point
 * and never bridges a gap, so "none" is the honest answer for a milepost in a gap. Throws
 * `CoreInputError` for a non-finite `mp` (callers parse with {@link parseMilepost} first).
 */
export function findBySubdivision(
  net: NetworkView,
  subdivisionNid: string,
  mp: number,
): FindResult {
  const found = locateMilepost(net, subdivisionNid, mp);
  if (found.length === 0) {
    return { kind: 'none', messageKey: 'find.noInterval' };
  }
  const option = subdivisionsOf(net).find((o) => o.nid === subdivisionNid);
  const name = option?.name ?? subdivisionNid;
  const label = option?.label ?? name;
  return {
    kind: 'pins',
    pins: found.map((f) => ({
      ...f,
      subdivisionNid,
      subdivisionName: name,
      subdivisionLabel: label,
    })),
  };
}

/**
 * Reads a typed milepost: an optional minus sign, digits, and at most one decimal separator
 * (a point or a comma). Returns miles, or null for anything else. `Number()` is not used on the
 * raw text because it reads "" as 0 and accepts "1e3" and "Infinity".
 */
export function parseMilepost(text: string): number | null {
  const clean = text.trim().replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(clean)) {
    return null;
  }
  return Number(clean);
}

/** Digits after the point for latitude and longitude: 5 is about 1 m, far finer than the data. */
const LATLON_DIGITS = 5;

/**
 * The text form of a pin, so the result is usable without a map: subdivision, milepost,
 * latitude and longitude in degrees. The milepost is the one typed (miles, as published).
 */
export function pinText(pin: Pin, mp: number): string {
  return t('find.pin', {
    subdivision: pin.subdivisionLabel,
    mp: t('card.mp', { value: fmt(mp, 2) }),
    lat: fmt(pin.at.lat, LATLON_DIGITS),
    lon: fmt(pin.at.lon, LATLON_DIGITS),
  });
}

/** One track near a tapped point. */
export type TapRow = {
  readonly subdivision: string;
  readonly company: string;
  readonly trackClass: string;
  /** "MP 11.00" when the track is calibrated there; otherwise null. */
  readonly mpText: string | null;
  /** Why there is no milepost (catalogued), set only when `mpText` is null. */
  readonly noMpText: string | null;
  /** Set when the milepost comes from unverified reference points. */
  readonly tierNote: string | null;
  /** Distance from the tapped point to the track, metres, labelled. */
  readonly offsetText: string;
};

export type TapModel = {
  /** Always "From map position, no GPS": a tapped point is not a fix. */
  readonly label: string;
  readonly rows: readonly TapRow[];
  /** True when the point is outside Canada (no lookup is possible). */
  readonly outside: boolean;
};

/**
 * The milepost under a tapped point, for desk use. Wraps `milepostAtPoint` (nominal accuracy 0,
 * so the search reach is the minimum radius). The result never feeds the matcher and never makes
 * a fix. Tracks with no milepost are listed with their reason rather than hidden. A point
 * outside Canada gives `outside` instead of throwing.
 */
export function presentTap(net: NetworkView, p: LatLon, company = ''): TapModel {
  const label = t('map.tap.label');
  let hits: ReturnType<typeof milepostAtPoint>;
  try {
    hits = milepostAtPoint(net, p);
  } catch (error) {
    if (error instanceof CoreInputError) {
      return { label, rows: [], outside: true };
    }
    throw error;
  }
  const rows = hits
    .filter(
      ({ candidate }) =>
        !company || companiesOf(candidate.operator.split('+')).some((c) => c.id === company),
    )
    .map(({ candidate, milepost }): TapRow => {
      const mp = milepost.milepost;
      const calibrated = mp?.kind === 'calibrated';
      const reason = milepost.reasons[0] ?? 'CHAIN_UNCALIBRATED';
      return {
        subdivision: candidate.subdivisionName,
        company: companiesOf(candidate.operator.split('+')).map(companyLabel).join(' / '),
        trackClass: candidate.trackClass,
        mpText: calibrated ? t('card.mp', { value: fmt(mp.mp, 2) }) : null,
        noMpText: calibrated ? null : t(`reason.${reason}`),
        tierNote: calibrated && milepost.tier === 'unverified' ? t('tier.unverified') : null,
        offsetText: t('map.tap.offset', { value: fmt(candidate.residualM, 0) }),
      };
    });
  return { label, rows, outside: false };
}
