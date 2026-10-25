import {
  MATCH_CONFIG,
  assetsAlong,
  metresToMiles,
  milesToKilometres,
  milesToMetres,
} from '@cantre/core';
import type { AnchorTier, Candidate, Lock, NetworkAsset, NetworkView, Result } from '@cantre/core';
import type { AssetDetails } from '@cantre/data-client';
import { getLang, t } from '../i18n/index.js';
import type { Settings } from './settings.js';

/**
 * Turns the matcher's `Result` into the text the status card shows (spec §2, §7).
 *
 * The UI renders a {@link CardModel} and nothing else, so what the card may say is decided in
 * one place and tested here. Honesty rules (AGENTS.md; spec §2, §6), each pinned by a test:
 * - No probability or confidence anywhere. The band is `Result.mpBandMi`, labelled "from GPS
 *   accuracy only"; it leaves out the cross-track residual and the survey accuracy of the anchors.
 * - A current milepost appears only for `MATCHED`; a range only for `MATCHED_SUBDIVISION`.
 * - `STALE` shows the last milepost only from `Result.historical`, prefixed "Last known" and
 *   suffixed "(historical)". The current `Result.milepost` is null on STALE and is never faked.
 * - A calibrated milepost of 0 is "MP 0.00". A null milepost is never rendered as 0.
 * - Mileposts are the published marker numbers, in miles, and are never converted. Distances
 *   (the band, asset distances) follow the units setting: miles, or kilometres by
 *   `milesToKilometres`, always labelled. Metres stay metres, labelled "m".
 */

/** Optional facts the `Result` does not carry. `snapshotDate` is the dataset's dated name. */
export type PresentMeta = { readonly snapshotDate?: string | null };

/** One route the user may pick. `lock` is null for a track that is not part of a chain. */
export type Choice = {
  readonly key: string;
  readonly operator: string;
  readonly subdivision: string;
  readonly trackClass: string;
  readonly residualText: string;
  /** The lock to request when chosen: the route's base chain id (every piece of the route). */
  readonly lock: Lock | null;
};

export type CardModel = {
  readonly headline: string;
  readonly subdivision: string | null;
  readonly operator: string | null;
  readonly trackClass: string | null;
  readonly mpText: string | null;
  /** Only on MATCHED_SUBDIVISION: the range, or "no single MP". */
  readonly rangeText: string | null;
  readonly bandText: string | null;
  /** Set in kilometre mode: reminds that mileposts stay in miles. */
  readonly mpNote: string | null;
  readonly accuracyText: string | null;
  readonly residualText: string | null;
  readonly fixAgeText: string | null;
  readonly anchorsText: string | null;
  readonly tierBadge: AnchorTier | null;
  readonly tierText: string | null;
  readonly vintageText: string;
  readonly reasons: readonly string[];
  readonly alsoFitText: string | null;
  readonly historical: boolean;
  readonly lockText: string | null;
  readonly choices: readonly Choice[];
};

/** Digits after the decimal point for mileposts and distances (0.01 mi is about 16 m). */
const DIGITS = 2;

/**
 * A number with fixed decimals in the active language's separator, without thousands grouping.
 * "-0.00" is written "0.00": a value that rounds to zero is zero, not negative.
 */
export function fmt(value: number, digits: number): string {
  const text = new Intl.NumberFormat(getLang() === 'fr' ? 'fr-CA' : 'en-CA', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: false,
  }).format(value);
  return text.replace(/^[-−](0[.,]?0*)$/, '$1');
}

/** Short tier name used inside sentences. */
const tierShort = (tier: AnchorTier): string => t(`tier.short.${tier}`);

/** Distance in miles to the displayed unit: number and its label. Metres never enter here. */
function milesIn(miles: number, units: Settings['units']): { value: number; unit: string } {
  return units === 'km'
    ? { value: milesToKilometres(miles), unit: t('unit.km') }
    : { value: miles, unit: t('unit.mi') };
}

/** "± 0.01 mi from GPS accuracy only" (or "under 0.01 mi, ..." when it rounds to zero). */
function bandTextOf(bandMi: number, units: Settings['units']): string {
  const { value, unit } = milesIn(bandMi, units);
  // Below half a hundredth the rounded figure would read "0.00", which would claim a precision
  // the GPS does not give, so say "under 0.01" instead.
  if (value < 0.005) {
    return t('card.bandTiny', { value: fmt(10 ** -DIGITS, DIGITS), unit });
  }
  return t('card.band', { value: fmt(value, DIGITS), unit });
}

/** "fix 2 s ago", "fix 1 min 20 s ago", "fix 1 h 5 min ago". Input milliseconds. */
function fixAgeTextOf(ageMs: number): string {
  const totalS = Math.floor(ageMs / 1000);
  const h = Math.floor(totalS / 3600);
  const min = Math.floor((totalS % 3600) / 60);
  const s = totalS % 60;
  let age: string;
  if (h > 0) {
    age = t('age.hm', { h, m: min });
  } else if (min > 0) {
    age = t('age.ms', { m: min, s });
  } else {
    age = t('age.s', { s });
  }
  return t('card.fixAge', { age });
}

/** The single value shared by all, or the distinct values joined; null when there are none. */
function sharedOrJoined(values: readonly string[]): string | null {
  const distinct = [...new Set(values)];
  return distinct.length === 0 ? null : distinct.join(', ');
}

/** Whether a candidate is the one a lock names (same rule as the matcher's `inLock`). */
function inLock(c: Candidate, lock: Lock): boolean {
  return lock.kind === 'chain'
    ? c.chainId === lock.chainId || c.chainBaseId === lock.chainId
    : c.subdivisionNid === lock.subdivisionNid;
}

/** "Locked: <subdivision>". Falls back to the lock's own id when no candidate names it. */
function lockTextOf(result: Result): string | null {
  const lock = result.lock;
  if (lock === null) {
    return null;
  }
  const known = [...result.candidates, ...(result.chosen === null ? [] : [result.chosen])].find(
    (c) => inLock(c, lock),
  );
  const fallback = lock.kind === 'chain' ? lock.chainId : lock.subdivisionNid;
  return t('lock.locked', { name: known?.subdivisionName ?? fallback });
}

/**
 * The routes to choose from: one per base chain (the nearest pass wins), plus any unchained track
 * (shown but not lockable). Locking uses the base chain id, which the matcher's lock accepts for
 * every piece of the route, so crossing a gap inside one route is not a silent switch.
 */
/**
 * Identity of the route a candidate belongs to: its base chain id, or for an unchained track its
 * segment key. A segment without a key falls back to its own attributes and residual, so
 * different tracks never collapse into one entry and the matched track always has the same key
 * wherever it appears.
 */
function routeKey(c: Candidate): string {
  if (c.chainBaseId !== null) {
    return c.chainBaseId;
  }
  const own =
    c.segmentKey ?? `${c.subdivisionNid}/${c.operator}/${c.trackClass}/${String(c.residualM)}`;
  return `segment:${own}`;
}

function choicesOf(candidates: readonly Candidate[]): readonly Choice[] {
  const byKey = new Map<string, Choice>();
  const nearest = new Map<string, number>(); // metres, the best residual seen per route
  for (const c of candidates) {
    const base = c.chainBaseId ?? c.chainId;
    const key = routeKey(c);
    const seen = nearest.get(key);
    if (seen !== undefined && seen <= c.residualM) {
      continue;
    }
    byKey.set(key, {
      key,
      operator: c.operator,
      subdivision: c.subdivisionName,
      trackClass: c.trackClass,
      residualText: residualTextOf(c.residualM),
      lock: base === null ? null : { kind: 'chain', chainId: base },
    });
    nearest.set(key, c.residualM);
  }
  return [...byKey.values()];
}

/** "off-track 3.1 m": the cross-track distance, metres. A residual, not an accuracy. */
function residualTextOf(residualM: number): string {
  return t('card.residual', { value: fmt(residualM, 1) });
}

/** The reasons as text, in the matcher's order. */
const reasonTexts = (result: Result): readonly string[] =>
  result.reasons.map((r) => t(`reason.${r}`));

/** "MP 112.43", or null when the milepost is not calibrated (a null is never a zero). */
function mpTextOf(result: Result): string | null {
  const mp = result.milepost;
  return mp?.kind === 'calibrated' ? t('card.mp', { value: fmt(mp.mp, DIGITS) }) : null;
}

/** "MP 112.40 to 112.46", or null without a range. */
function rangeTextOf(range: Result['mpRange']): string | null {
  return range === null
    ? null
    : t('card.range', { lower: fmt(range.lowerMp, DIGITS), upper: fmt(range.upperMp, DIGITS) });
}

/** The anchors line for a MATCHED milepost, or for a range, or null. */
function anchorsTextOf(result: Result): string | null {
  const mp = result.milepost;
  if (result.status === 'MATCHED' && mp?.kind === 'calibrated' && result.tier !== null) {
    return t('card.anchors', {
      lower: fmt(mp.lower.mp, DIGITS),
      upper: fmt(mp.upper.mp, DIGITS),
      tier: tierShort(result.tier),
    });
  }
  if (result.status === 'MATCHED_SUBDIVISION' && result.mpRange !== null && result.tier !== null) {
    return t('card.anchorsMany', { count: result.anchorIds.length, tier: tierShort(result.tier) });
  }
  return null;
}

/** Text and badge for the tier, shown only when a milepost or range is shown. */
function tierOf(
  tier: AnchorTier | null,
  shown: boolean,
): Pick<CardModel, 'tierBadge' | 'tierText'> {
  return shown && tier !== null
    ? { tierBadge: tier, tierText: t(`tier.${tier}`) }
    : { tierBadge: null, tierText: null };
}

/** Distinct routes among the candidates, other than the matched one. */
function alsoFitCount(result: Result): number {
  const own = result.chosen === null ? null : routeKey(result.chosen);
  const others = new Set(result.candidates.map(routeKey).filter((key) => key !== own));
  return others.size;
}

/**
 * Builds the card from a result.
 *
 * Pure: the same inputs give the same model. `net` is accepted for the dataset version fallback;
 * `meta.snapshotDate` is the dataset's dated name shown as the vintage (D8).
 */
export function present(
  result: Result,
  net: NetworkView,
  settings: Settings,
  meta: PresentMeta = {},
): CardModel {
  const { status } = result;
  // The dated snapshot name when known; else the version of the data that produced the result.
  const version = result.datasetVersion === '' ? net.datasetVersion : result.datasetVersion;
  const vintage = meta.snapshotDate ?? version;
  const base = {
    headline: t(`status.${status}`),
    vintageText: vintage === '' ? t('data.unknown') : t('data.version', { date: vintage }),
    reasons: reasonTexts(result),
    lockText: lockTextOf(result),
    mpNote: settings.units === 'km' ? t('card.mpMiles') : null,
    accuracyText:
      result.accuracyM === null ? null : t('card.accuracy', { value: fmt(result.accuracyM, 0) }),
    fixAgeText: result.fixAgeMs === null ? null : fixAgeTextOf(result.fixAgeMs),
  };
  const none = {
    subdivision: null,
    operator: null,
    trackClass: null,
    mpText: null,
    rangeText: null,
    bandText: null,
    residualText: null,
    anchorsText: null,
    alsoFitText: null,
    historical: false,
    choices: [] as readonly Choice[],
    ...tierOf(null, false),
  } satisfies Omit<CardModel, keyof typeof base>;

  switch (status) {
    case 'MATCHED': {
      const chosen = result.chosen;
      const mpText = mpTextOf(result);
      const others = alsoFitCount(result);
      return {
        ...base,
        ...none,
        subdivision: chosen?.subdivisionName ?? null,
        operator: chosen?.operator ?? null,
        trackClass: chosen?.trackClass ?? null,
        mpText,
        bandText:
          mpText === null || result.mpBandMi === null
            ? null
            : bandTextOf(result.mpBandMi, settings.units),
        residualText: chosen === null ? null : residualTextOf(chosen.residualM),
        anchorsText: anchorsTextOf(result),
        alsoFitText: others > 0 ? t('card.alsoFit', { count: others }) : null,
        ...tierOf(result.tier, mpText !== null),
      };
    }
    case 'MATCHED_SUBDIVISION': {
      const cs = result.candidates;
      const subs = new Set(cs.map((c) => c.subdivisionNid));
      const ranged = rangeTextOf(result.mpRange);
      return {
        ...base,
        ...none,
        subdivision: subs.size === 1 ? (cs[0]?.subdivisionName ?? null) : null,
        operator: sharedOrJoined(cs.map((c) => c.operator)),
        trackClass: sharedOrJoined(cs.map((c) => c.trackClass)),
        rangeText: ranged ?? t('card.noSingleMp'),
        bandText:
          ranged === null || result.mpBandMi === null
            ? null
            : bandTextOf(result.mpBandMi, settings.units),
        anchorsText: anchorsTextOf(result),
        ...tierOf(result.tier, ranged !== null),
      };
    }
    case 'AMBIGUOUS_ROUTE':
    case 'LOCK_CONFLICT':
      return { ...base, ...none, choices: choicesOf(result.candidates) };
    case 'STALE': {
      const past = result.historical;
      const lastValue = past === null ? null : (mpTextOf(past) ?? rangeTextOf(past.mpRange));
      return {
        ...base,
        ...none,
        historical: true,
        mpText: lastValue === null ? null : t('card.lastKnown', { value: lastValue }),
        ...tierOf(past?.tier ?? null, lastValue !== null),
      };
    }
    case 'NO_PERMISSION':
    case 'NO_FIX':
    case 'NO_COVERAGE':
    case 'OFF_NETWORK':
      return { ...base, ...none };
  }
}

// ---------------------------------------------------------------------------------------------
// Direction of travel (D5)

/** Minimum change in along-chain position, metres, before a direction is claimed (D5). */
export const DIRECTION_MIN_STEP_M = 10;

/** Whether a result is a MATCHED, fresh one with a chain and a position. */
function chainPosition(r: Result | null): { chain: string; s: number } | null {
  if (
    r === null ||
    r.status !== 'MATCHED' ||
    r.fixAgeMs === null ||
    r.fixAgeMs > MATCH_CONFIG.staleAfterMs ||
    r.s === null ||
    r.chosen?.chainBaseId == null
  ) {
    return null;
  }
  return { chain: r.chosen.chainBaseId, s: r.s };
}

/**
 * Direction of travel along the chain between two results, in the chain's own `s` axis:
 * `'up'` when `s` grew (toward higher `s`), `'down'` when it shrank, null when unknown.
 *
 * Formula: Δs = s_cur - s_prev, metres. Known only when both results are `MATCHED`, fresh
 * (`fixAgeMs` <= `staleAfterMs`), on the same `chainBaseId`, and |Δs| >= `minStepM`
 * (default 10 m, D5). One fix has no direction; guessing one would mislabel half the list.
 * Limits: `s` is not the milepost; whether higher `s` means higher MP comes from the anchors
 * (see {@link presentAssets}). GPS jitter larger than the step can flip the sign, so
 * {@link directionTracker} raises the step to the fix accuracy.
 */
export function direction(
  prev: Result | null,
  cur: Result,
  minStepM: number = DIRECTION_MIN_STEP_M,
): 'up' | 'down' | null {
  const a = chainPosition(prev);
  const b = chainPosition(cur);
  if (a === null || b === null || a.chain !== b.chain) {
    return null;
  }
  const dS = b.s - a.s; // metres
  if (Math.abs(dS) < minStepM) {
    return null;
  }
  return dS > 0 ? 'up' : 'down';
}

/**
 * Keeps the last known direction between updates. It forgets the direction when the match is
 * lost or the chain changes, so a stale arrow is never shown.
 *
 * The step needed is the larger of 10 m and both fixes' reported accuracy (metres): a move
 * smaller than the GPS accuracy could be noise. This is stricter than D5's 10 m alone.
 */
export function directionTracker(): { update(cur: Result): 'up' | 'down' | null } {
  let ref: Result | null = null;
  let known: 'up' | 'down' | null = null;
  return {
    update(cur) {
      const pos = chainPosition(cur);
      if (pos === null) {
        ref = null;
        known = null;
        return null;
      }
      const refPos = chainPosition(ref);
      if (ref === null || refPos === null || refPos.chain !== pos.chain) {
        ref = cur;
        known = null;
        return null;
      }
      const step = Math.max(DIRECTION_MIN_STEP_M, cur.accuracyM ?? 0, ref.accuracyM ?? 0);
      const d = direction(ref, cur, step);
      if (d !== null) {
        known = d;
        ref = cur;
      }
      return known;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Live region

/** The live region speaks at most once per this many milliseconds (spec §7). */
export const ANNOUNCE_MIN_INTERVAL_MS = 10_000;

/** The sentence the live region would speak for a model: status, then the milepost if any. */
export function announcementOf(model: CardModel): string {
  const mp = model.mpText ?? model.rangeText;
  return mp === null ? model.headline : `${model.headline}. ${mp}`;
}

/**
 * The text to announce now, or null.
 *
 * Returns the model's sentence only when it differs from `lastText` (the status or milepost text
 * changed) and at least {@link ANNOUNCE_MIN_INTERVAL_MS} have passed since `lastAnnouncedMs`.
 * A change inside the window is not lost: the next call after the window still sees it as
 * different from `lastText`. Units: milliseconds (epoch or any steady clock, same for both).
 */
export function announce(
  model: CardModel,
  lastAnnouncedMs: number | null,
  nowMs: number,
  lastText: string | null = null,
): string | null {
  const text = announcementOf(model);
  if (text === lastText) {
    return null;
  }
  if (lastAnnouncedMs !== null && nowMs - lastAnnouncedMs < ANNOUNCE_MIN_INTERVAL_MS) {
    return null;
  }
  return text;
}

// ---------------------------------------------------------------------------------------------
// Nearby assets

/** How far along the chain, each way, the list looks: 2 mi. */
export const ASSET_RANGE_M = milesToMetres(2);
/** The most rows shown. */
export const ASSET_MAX_ROWS = 20;

export type AssetRow = {
  readonly id: string;
  readonly kindText: string;
  readonly name: string;
  /** Along-the-track distance, in the chosen unit, labelled. */
  readonly distanceText: string;
  readonly sideText: string;
  /** The asset's own posted milepost, labelled "posted". Null when it has none. */
  readonly postedText: string | null;
  /** The milepost the pipeline calculated at the asset's position, labelled "calculated". */
  readonly derivedText: string | null;
  /** Set when neither is available. */
  readonly noMileageText: string | null;
};

/** Sign of d(MP)/d(s) in the current interval: +1, -1, or 0 when unknown. */
function mpSlopeSign(result: Result): 1 | -1 | 0 {
  const mp = result.milepost;
  if (mp?.kind !== 'calibrated') {
    return 0;
  }
  const dMp = mp.upper.mp - mp.lower.mp; // miles
  const dS = mp.upper.s - mp.lower.s; // metres
  const slope = dMp * dS;
  return slope > 0 ? 1 : slope < 0 ? -1 : 0;
}

/** Where an asset lies relative to the user, as words (D5). */
function sideTextOf(deltaM: number, dir: 'up' | 'down' | null, slope: 1 | -1 | 0): string {
  if (deltaM === 0) {
    return t('asset.side.here');
  }
  if (dir !== null) {
    // Travelling toward higher s: assets at higher s are ahead.
    const ahead = deltaM > 0 === (dir === 'up');
    return t(ahead ? 'asset.side.ahead' : 'asset.side.behind');
  }
  if (slope === 0) {
    return t(deltaM > 0 ? 'asset.side.unknownForward' : 'asset.side.unknownBack');
  }
  const higherMp = deltaM > 0 === slope > 0;
  return t(higherMp ? 'asset.side.higherMp' : 'asset.side.lowerMp');
}

/** The asset's posted milepost with its tier and subdivision caveats. */
function postedTextOf(asset: NetworkAsset, subdivisionNid: string): string | null {
  const posted = asset.posted;
  if (posted === null) {
    return null;
  }
  const notes: string[] = [];
  if (posted.tier === 'unverified') {
    notes.push(t('asset.note.unverified'));
  }
  if (posted.subdivisionNid !== subdivisionNid) {
    notes.push(t('asset.note.otherSub'));
  }
  const value = fmt(posted.mp, DIGITS);
  return notes.length === 0
    ? t('asset.posted', { value })
    : t('asset.postedNote', { value, note: notes.join(', ') });
}

/**
 * Nearby assets on the matched chain, nearest first.
 *
 * Only for `MATCHED` with a chain and position; otherwise empty. Distance is along the track in
 * the chosen unit (miles, or kilometres via `milesToKilometres`), from `assetsAlong`. Wording:
 * "ahead"/"behind" only when `dir` is known; otherwise "toward higher MP"/"toward lower MP",
 * decided from the anchors' MP slope (higher `s` is not always higher MP), and a neutral
 * "on one side"/"on the other side" when the milepost is uncalibrated. Posted and derived
 * mileage are labelled "posted" and "calculated" and never merged.
 */
export function presentAssets(
  result: Result,
  net: NetworkView,
  settings: Settings,
  dir: 'up' | 'down' | null,
): readonly AssetRow[] {
  const pos = chainPosition(result);
  const chosen = result.chosen;
  if (pos === null || chosen === null || result.status !== 'MATCHED') {
    return [];
  }
  const slope = mpSlopeSign(result);
  return assetsAlong(net, pos.chain, pos.s, ASSET_RANGE_M)
    .slice(0, ASSET_MAX_ROWS)
    .map(({ asset, deltaM }) => {
      const here = asset.positions.find((p) => p.chainId === pos.chain && p.sM - pos.s === deltaM);
      const derived = here?.derivedMp ?? null;
      const posted = postedTextOf(asset, chosen.subdivisionNid);
      const derivedText =
        derived === null ? null : t('asset.derived', { value: fmt(derived, DIGITS) });
      const { value, unit } = milesIn(metresToMiles(Math.abs(deltaM)), settings.units);
      return {
        id: asset.id,
        kindText: t(`asset.kind.${asset.kind}`),
        name: asset.name ?? t(`asset.kind.${asset.kind}`),
        distanceText: t('asset.distance', { value: fmt(value, DIGITS), unit }),
        sideText: sideTextOf(deltaM, dir, slope),
        postedText: posted,
        derivedText,
        noMileageText: posted === null && derivedText === null ? t('asset.noMileage') : null,
      };
    });
}

/** The source attributes of an asset, from memory. */
export type AssetSource =
  | {
      readonly kind: 'found';
      readonly layer: string;
      readonly attrs: readonly (readonly [string, string])[];
    }
  | { readonly kind: 'missing' };

/**
 * Source attributes for an asset id. `details` may lack the id (Task 3: ids are not checked
 * against the snapshot) or be absent; that is the typed `missing` result, never a crash and
 * never a network request. Attributes are sorted by key (code-point order) so display is stable.
 */
export function assetSource(details: AssetDetails | null, id: string): AssetSource {
  const entry = details === null ? undefined : details[id];
  if (entry === undefined) {
    return { kind: 'missing' };
  }
  const attrs = Object.entries(entry.attrs).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return { kind: 'found', layer: entry.layer, attrs };
}
