import type { AnchorTier } from '../anchors.js';
import type { MilepostResult } from '../interpolate.js';
import type { NetworkView } from '../network/types.js';
import type { Candidate, Fix } from './candidates.js';
import { lowerTier, milepostFor } from './milepost.js';
import type { CandidateMilepost } from './milepost.js';
import type { MatchReason, MatchStatus } from './reasons.js';
import type { Lock, Selection } from './select.js';

/**
 * What the matcher tells the app about the latest fix (spec §6 "Matching state machine").
 *
 * Units: `s` metres along the chosen chain; `milepost` / `mpRange` / `mpBandMi` miles;
 * `accuracyM` metres (the fix's own reported accuracy, never changed by a user choice);
 * `fixAgeMs` milliseconds.
 *
 * Honesty invariants (AGENTS.md; spec §2), asserted by property tests:
 * - `milepost` is non-null only when `status` is `MATCHED`; `mpRange` only when it is
 *   `MATCHED_SUBDIVISION`. A null milepost is never zero: a calibrated 0 is `{kind:'calibrated',
 *   mp: 0}`, an unknown one is null.
 * - `chosen` and `s` are non-null only for `MATCHED`.
 * - `candidates` is the indistinguishable set I (ruling R10): the choices the route chooser shows
 *   for AMBIGUOUS_ROUTE and LOCK_CONFLICT, the parallel tracks for MATCHED_SUBDIVISION; empty for
 *   NO_COVERAGE, OFF_NETWORK, NO_FIX, NO_PERMISSION and STALE.
 * - `mpBandMi` is the GPS-propagated band only (ruling R11 for ranges: max band; `tier` the lowest
 *   tier; `anchorIds` the sorted union). It is not a confidence interval and omits the cross-track
 *   residual and the survey accuracy of the anchors.
 * - `historical` is set only on `STALE`: the last full result, kept as history, never as current.
 * - `accuracyM` is null only before any accepted fix.
 */
export type Result = {
  readonly status: MatchStatus;
  readonly candidates: readonly Candidate[];
  readonly chosen: Candidate | null;
  readonly s: number | null;
  readonly milepost: MilepostResult | null;
  readonly mpRange: { readonly lowerMp: number; readonly upperMp: number } | null;
  readonly mpBandMi: number | null;
  readonly tier: AnchorTier | null;
  readonly anchorIds: readonly string[];
  readonly selectionOrigin: 'auto' | 'user' | null;
  readonly lock: Lock | null;
  readonly reasons: readonly MatchReason[];
  readonly accuracyM: number | null;
  readonly fixAgeMs: number | null;
  readonly datasetVersion: string;
  readonly historical: Result | null;
};

/** Distinct values in first-seen order (reason codes must not repeat). */
function distinct<T>(items: readonly T[]): readonly T[] {
  return Object.freeze([...new Set(items)]);
}

/** A result with no match: every value field null or empty. Callers override what they carry. */
function empty(
  datasetVersion: string,
  status: MatchStatus,
  lock: Lock | null,
  reasons: readonly MatchReason[],
): Result {
  return {
    status,
    candidates: Object.freeze([]),
    chosen: null,
    s: null,
    milepost: null,
    mpRange: null,
    mpBandMi: null,
    tier: null,
    anchorIds: Object.freeze([]),
    selectionOrigin: null,
    lock,
    reasons: distinct(reasons),
    accuracyM: null,
    fixAgeMs: null,
    datasetVersion,
    historical: null,
  };
}

/**
 * Result for denied location permission: `NO_PERMISSION` with `PERMISSION_DENIED`. No position
 * is known, so everything is null (spec §6). Time never changes it.
 */
export function noPermissionResult(net: NetworkView, lock: Lock | null): Result {
  return Object.freeze(empty(net.datasetVersion, 'NO_PERMISSION', lock, ['PERMISSION_DENIED']));
}

/**
 * Result for "permitted but no usable fix": `NO_FIX` with `NO_FIX_YET` or, after a device error
 * before any fix, `LOCATION_UNAVAILABLE`. Time never changes it.
 */
export function noFixResult(
  net: NetworkView,
  lock: Lock | null,
  reason: 'NO_FIX_YET' | 'LOCATION_UNAVAILABLE',
): Result {
  return Object.freeze(empty(net.datasetVersion, 'NO_FIX', lock, [reason]));
}

/**
 * The same result carrying a different lock. Used when a lock/unlock event arrives while no fix
 * can be re-evaluated, so `Result.lock` always shows the current lock in every status.
 */
export function withLock(result: Result, lock: Lock | null): Result {
  return Object.freeze({ ...result, lock });
}

/**
 * Builds the full {@link Result} for an accepted fix from the selection policy's decision.
 *
 * Rules (rulings R10, R11; M3 plan Decision 9):
 * - MATCHED: milepost, band, tier and anchor ids come from {@link milepostFor} for the chosen
 *   candidate; its reasons (e.g. DISCONTINUITY_GAP, UNCHAINED_TRACK) are appended to the
 *   selection's. `s` is the chosen candidate's along-chain position (null for a siding).
 * - MATCHED_SUBDIVISION: milepost of every candidate in the group. If every one is a chain
 *   candidate with a calibrated milepost and (max - min) <= max(band), all in miles, the result is
 *   `mpRange {lowerMp, upperMp}` with band = max band, tier = lowest tier, anchorIds = sorted
 *   unique union. If all are calibrated but the spread is wider: `mpRange` null, TRACK_MP_DISAGREE.
 *   If any is uncalibrated, has no milepost, or is a siding: null, TRACK_UNCALIBRATED. Nothing is
 *   averaged or guessed across tracks.
 * - Every other status carries no milepost data; `candidates` is the group (possibly empty).
 * `accuracyM` is always the fix's own value. `fixAgeMs` is 0 at evaluation; `currentResult`
 * recomputes it from `nowMs`. Limits: `mpBandMi` excludes cross-track residual and survey accuracy.
 */
export function resultFromSelection(
  net: NetworkView,
  fix: Fix,
  selection: Selection,
  lock: Lock | null,
): Result {
  const base: Result = {
    ...empty(net.datasetVersion, selection.status, lock, selection.reasons),
    candidates: Object.freeze([...selection.group]),
    selectionOrigin: selection.selectionOrigin,
    accuracyM: fix.accuracyM,
    fixAgeMs: 0,
  };

  if (selection.status === 'MATCHED' && selection.chosen !== null) {
    const chosen = selection.chosen;
    const mp = milepostFor(net, chosen, fix.accuracyM);
    return Object.freeze({
      ...base,
      chosen,
      s: chosen.s,
      milepost: mp.milepost,
      mpBandMi: mp.mpBandMi,
      tier: mp.tier,
      anchorIds: Object.freeze([...mp.anchorIds]),
      reasons: distinct([...selection.reasons, ...mp.reasons]),
    });
  }

  if (selection.status === 'MATCHED_SUBDIVISION') {
    return Object.freeze({ ...base, ...subdivisionRange(net, fix, selection) });
  }

  return Object.freeze(base);
}

/** The mpRange part of a MATCHED_SUBDIVISION result (see {@link resultFromSelection}). */
function subdivisionRange(
  net: NetworkView,
  fix: Fix,
  selection: Selection,
): Pick<Result, 'mpRange' | 'mpBandMi' | 'tier' | 'anchorIds' | 'reasons'> {
  const mps: CandidateMilepost[] = selection.group.map((c) => milepostFor(net, c, fix.accuracyM));
  const none = (reason: MatchReason): ReturnType<typeof subdivisionRange> => ({
    mpRange: null,
    mpBandMi: null,
    tier: null,
    anchorIds: Object.freeze([]),
    reasons: distinct([...selection.reasons, reason]),
  });

  const mpValues: number[] = [];
  let tier: AnchorTier | null = null;
  let bandMi = 0; // miles; the widest GPS band over the group
  const anchorIds: string[] = [];
  for (const mp of mps) {
    const m = mp.milepost;
    if (m === null || m.kind !== 'calibrated' || mp.mpBandMi === null || mp.tier === null) {
      return none('TRACK_UNCALIBRATED');
    }
    mpValues.push(m.mp);
    bandMi = Math.max(bandMi, mp.mpBandMi);
    tier = tier === null ? mp.tier : lowerTier(tier, mp.tier);
    anchorIds.push(...mp.anchorIds);
  }
  const lowerMp = Math.min(...mpValues);
  const upperMp = Math.max(...mpValues);
  // The tracks agree when their mileposts differ by no more than the widest GPS band (miles).
  if (upperMp - lowerMp > bandMi) {
    return none('TRACK_MP_DISAGREE');
  }
  return {
    mpRange: Object.freeze({ lowerMp, upperMp }),
    mpBandMi: bandMi,
    tier,
    anchorIds: Object.freeze([...new Set(anchorIds)].sort()),
    reasons: distinct(selection.reasons),
  };
}

/**
 * The STALE view of a stored result (spec §6, Decision 10): the fix is older than
 * `staleAfterMs`, so nothing is current. Status STALE, reason FIX_STALE, every position field
 * null or empty, and the stored result is kept as `historical` (its `fixAgeMs` set to `ageMs`, the
 * true age of the fix it describes). `accuracyM` and `lock` stay (the fix's own accuracy and the
 * current lock). Units: `ageMs` milliseconds, `nowMs - lastFixTimestampMs`.
 */
export function staleResult(stored: Result, ageMs: number): Result {
  return Object.freeze({
    ...empty(stored.datasetVersion, 'STALE', stored.lock, ['FIX_STALE']),
    accuracyM: stored.accuracyM,
    fixAgeMs: ageMs,
    historical: Object.freeze({ ...stored, fixAgeMs: ageMs }),
  });
}
