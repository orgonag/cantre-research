import { CoreInputError, locateMilepost, milepostAtPoint } from '@cantre/core';
import type { LatLon, LocatedMilepost, NetworkView } from '@cantre/core';
import { t } from '../i18n/index.js';
import type { MessageKey } from '../i18n/index.js';
import { fmt } from './present.js';

/**
 * Find-a-location and tap-to-milepost: the two ways to use the network without a GPS fix
 * (spec §7). Both are desk uses: a milepost typed in, or a point tapped on the map. Neither is a
 * fix, neither reaches the matcher, and neither is stored. The results are calculated from the
 * dataset's reference points; they are not surveyed positions.
 */

/** One entry of the subdivision picker. */
export type SubdivisionOption = { readonly nid: string; readonly name: string };

/** Code-point order, so the picker order is the same on every device and locale. */
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The subdivisions in the loaded network, each once (by NID), sorted by name and then NID.
 * Chains and unchained segments both count, so a subdivision with only sidings is listed (it
 * will simply have no milepost range). Proper names stay as published (spec §7).
 */
export function subdivisionsOf(net: NetworkView): readonly SubdivisionOption[] {
  const byNid = new Map<string, string>();
  for (const c of net.chains) {
    byNid.set(c.subdivisionNid, c.subdivisionName);
  }
  for (const s of net.segments) {
    if (!byNid.has(s.subdivisionNid)) {
      byNid.set(s.subdivisionNid, s.subdivisionName);
    }
  }
  return [...byNid]
    .map(([nid, name]) => ({ nid, name }))
    .sort((a, b) => byText(a.name, b.name) || byText(a.nid, b.nid));
}

/** One place a typed milepost lies: the core lookup result plus the subdivision's name. */
export type Pin = LocatedMilepost & {
  readonly subdivisionNid: string;
  readonly subdivisionName: string;
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
  const name =
    net.chains.find((c) => c.subdivisionNid === subdivisionNid)?.subdivisionName ?? subdivisionNid;
  return {
    kind: 'pins',
    pins: found.map((f) => ({ ...f, subdivisionNid, subdivisionName: name })),
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
    subdivision: pin.subdivisionName,
    mp: t('card.mp', { value: fmt(mp, 2) }),
    lat: fmt(pin.at.lat, LATLON_DIGITS),
    lon: fmt(pin.at.lon, LATLON_DIGITS),
  });
}

/** One track near a tapped point. */
export type TapRow = {
  readonly subdivision: string;
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
export function presentTap(net: NetworkView, p: LatLon): TapModel {
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
  const rows = hits.map(({ candidate, milepost }): TapRow => {
    const mp = milepost.milepost;
    const calibrated = mp?.kind === 'calibrated';
    const reason = milepost.reasons[0] ?? 'CHAIN_UNCALIBRATED';
    return {
      subdivision: candidate.subdivisionName,
      trackClass: candidate.trackClass,
      mpText: calibrated ? t('card.mp', { value: fmt(mp.mp, 2) }) : null,
      noMpText: calibrated ? null : t(`reason.${reason}`),
      tierNote: calibrated && milepost.tier === 'unverified' ? t('tier.unverified') : null,
      offsetText: t('map.tap.offset', { value: fmt(candidate.residualM, 0) }),
    };
  });
  return { label, rows, outside: false };
}
