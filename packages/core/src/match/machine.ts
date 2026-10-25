import { CANADA_ENVELOPE } from '../coords.js';
import type { NetworkView } from '../network/types.js';
import { assertFinite } from '../units.js';
import { coverageOf, diamondsNear, findCandidates, searchRadiusM } from './candidates.js';
import type { Fix } from './candidates.js';
import { MATCH_CONFIG } from './config.js';
import type { MatchConfig } from './config.js';
import type { MatchReason } from './reasons.js';
import {
  noFixResult,
  noPermissionResult,
  resultFromSelection,
  staleResult,
  withLock,
} from './result.js';
import type { Result } from './result.js';
import { selectCandidate } from './select.js';
import type { Lock, PreviousMatch } from './select.js';

/**
 * An input to the matching state machine (spec §6). `fix` is a GPS fix; `permission` reports
 * the location permission; `locationError` a device error; `lock` / `unlock` the user's route
 * choice. Time enters only through `fix.timestampMs` and the `nowMs` given to `currentResult`.
 */
export type MatchEvent =
  | { readonly type: 'fix'; readonly fix: Fix }
  | { readonly type: 'permission'; readonly state: 'granted' | 'denied' }
  | { readonly type: 'locationError'; readonly code: 'UNAVAILABLE' | 'TIMEOUT' }
  | { readonly type: 'lock'; readonly lock: Lock }
  | { readonly type: 'unlock' };

/**
 * The matcher's whole memory. Read-only: the state and its stored result are frozen (shallowly;
 * the network view is shared, never copied or modified), and `reduce` returns a new state.
 *
 * - `permission`: `'denied'` after a denial event until a grant.
 * - `lastFix`: the last accepted fix, kept so a lock change can re-evaluate it; null before any
 *   fix and after a permission change.
 * - `lastFixTimestampMs`: timestamp (ms) of the last accepted fix; kept across a denial/grant so
 *   fix ordering still holds.
 * - `previous`: continuity carried from a MATCHED result (Decision 3); null otherwise.
 * - `result`: the stored full result as of the last event; `currentResult` adds the time view.
 * - `ignoredFixes`: how many fixes were ignored (invalid, out of order, or while denied).
 */
export type MatchState = {
  readonly net: NetworkView;
  readonly cfg: MatchConfig;
  readonly permission: 'granted' | 'denied';
  readonly lock: Lock | null;
  readonly lastFix: Fix | null;
  readonly lastFixTimestampMs: number | null;
  readonly previous: PreviousMatch | null;
  readonly result: Result;
  readonly ignoredFixes: number;
};

/**
 * The state before any event: permission assumed granted, no fix, no lock, status `NO_FIX`
 * (`NO_FIX_YET`). `cfg` defaults to the experimental {@link MATCH_CONFIG}. Source: spec §6.
 */
export function initialMatchState(net: NetworkView, cfg: MatchConfig = MATCH_CONFIG): MatchState {
  return Object.freeze({
    net,
    cfg,
    permission: 'granted',
    lock: null,
    lastFix: null,
    lastFixTimestampMs: null,
    previous: null,
    result: noFixResult(net, null, 'NO_FIX_YET'),
    ignoredFixes: 0,
  });
}

/**
 * True when a fix is usable. It is invalid when latitude, longitude,
 * timestamp or accuracy is non-finite, when a present heading or speed is non-finite, when the
 * position lies outside {@link CANADA_ENVELOPE} (the v1 scope, spec §6), or when accuracy is
 * negative. Units: degrees, milliseconds, metres. Limits: no plausibility check beyond this.
 */
function fixIsValid(fix: Fix): boolean {
  const finite = [fix.lat, fix.lon, fix.timestampMs, fix.accuracyM].every(Number.isFinite);
  const optionalFinite =
    (fix.headingDeg === undefined || Number.isFinite(fix.headingDeg)) &&
    (fix.speedMps === undefined || Number.isFinite(fix.speedMps));
  if (!finite || !optionalFinite || fix.accuracyM < 0) {
    return false;
  }
  return (
    fix.lat >= CANADA_ENVELOPE.minLat &&
    fix.lat <= CANADA_ENVELOPE.maxLat &&
    fix.lon >= CANADA_ENVELOPE.minLon &&
    fix.lon <= CANADA_ENVELOPE.maxLon
  );
}

/** A frozen copy of `state` with some fields replaced. */
function next(state: MatchState, changes: Partial<MatchState>): MatchState {
  return Object.freeze({ ...state, ...changes });
}

/**
 * Runs the full pipeline on one fix (spec §6): candidates, coverage, diamonds near any candidate
 * (ruling R7), selection, then milepost. Returns the stored result and the continuity to carry.
 * Continuity is set only from a MATCHED result on a chain (Decision 3): any other status, and a
 * matched siding, clears it. Units: see {@link Fix}.
 */
function evaluate(
  state: MatchState,
  fix: Fix,
  lock: Lock | null,
  previous: PreviousMatch | null,
): { readonly result: Result; readonly previous: PreviousMatch | null } {
  const { net, cfg } = state;
  const radiusM = searchRadiusM(fix.accuracyM, cfg);
  const candidates = findCandidates(net, fix, cfg);
  const selection = selectCandidate({
    net,
    fix,
    candidates,
    coverage: coverageOf(net, fix, radiusM),
    diamonds: diamondsNear(net, candidates, radiusM),
    lock,
    previous,
    cfg,
  });
  const result = resultFromSelection(net, fix, selection, lock);
  const chosen = selection.chosen;
  const carried =
    selection.status === 'MATCHED' && chosen !== null && chosen.chainId !== null
      ? Object.freeze({
          chainId: chosen.chainId,
          sinceContradictionMs: selection.contradictionStartMs,
        })
      : null;
  return { result, previous: carried };
}

/**
 * The pure state transition (spec §6 "Matching state machine"). Never mutates `state`; returns
 * the new state and, for an ignored fix, the reason. `ignored` is null for every other event.
 *
 * - `fix`: ignored as `FIX_IGNORED_INVALID` when permission is denied or the fix is invalid
 *   (non-finite values, outside the Canada envelope, negative accuracy), and as
 *   `FIX_IGNORED_OUT_OF_ORDER` when its timestamp is not after the last accepted one. Ignored
 *   fixes change only `ignoredFixes`. An accepted fix more than `cfg.staleAfterMs` after the last
 *   accepted one drops continuity first (ruling R12: that is the STALE boundary, and a stale gap
 *   never carries a match across), then is evaluated and stored.
 * - `permission`: `denied` gives NO_PERMISSION and drops the last fix and continuity; `granted`
 *   after a denial gives NO_FIX (`NO_FIX_YET`); `granted` otherwise changes nothing. The last
 *   timestamp is kept so ordering still holds (ruling R13).
 * - `locationError`: before any fix gives NO_FIX (`LOCATION_UNAVAILABLE`); otherwise nothing
 *   changes (a stale result follows by time, not by error).
 * - `lock` / `unlock`: set / clear the lock (only `unlock` clears) and immediately re-evaluate the
 *   last accepted fix, if any, without counting it again or re-checking its order.
 * Limits: no timers; staleness is applied by {@link currentResult}. The reducer cannot see `nowMs`,
 * so a fix with a far-future timestamp is accepted here (currentResult marks it FIX_FROM_FUTURE) and
 * later real fixes are ignored as out of order until the clock passes it (ruling R20).
 */
export function reduce(
  state: MatchState,
  event: MatchEvent,
): { state: MatchState; ignored: MatchReason | null } {
  switch (event.type) {
    case 'fix':
      return reduceFix(state, event.fix);
    case 'permission':
      return { state: reducePermission(state, event.state), ignored: null };
    case 'locationError':
      if (state.lastFix === null && state.permission === 'granted') {
        return {
          state: next(state, {
            result: noFixResult(state.net, state.lock, 'LOCATION_UNAVAILABLE'),
          }),
          ignored: null,
        };
      }
      return { state, ignored: null };
    case 'lock':
      return { state: reduceLock(state, event.lock), ignored: null };
    case 'unlock':
      return { state: reduceLock(state, null), ignored: null };
  }
}

/** The fix branch of {@link reduce}. */
function reduceFix(
  state: MatchState,
  fix: Fix,
): { state: MatchState; ignored: MatchReason | null } {
  const ignore = (reason: MatchReason): { state: MatchState; ignored: MatchReason } => ({
    state: next(state, { ignoredFixes: state.ignoredFixes + 1 }),
    ignored: reason,
  });
  if (state.permission === 'denied' || !fixIsValid(fix)) {
    return ignore('FIX_IGNORED_INVALID');
  }
  const lastMs = state.lastFixTimestampMs;
  if (lastMs !== null && fix.timestampMs <= lastMs) {
    return ignore('FIX_IGNORED_OUT_OF_ORDER');
  }
  // Ruling R12: a gap longer than staleAfterMs ends continuity (milliseconds).
  const gapEnds = lastMs !== null && fix.timestampMs - lastMs > state.cfg.staleAfterMs;
  const stored: Fix = Object.freeze({ ...fix });
  const evaluated = evaluate(state, stored, state.lock, gapEnds ? null : state.previous);
  return {
    state: next(state, {
      lastFix: stored,
      lastFixTimestampMs: fix.timestampMs,
      previous: evaluated.previous,
      result: evaluated.result,
    }),
    ignored: null,
  };
}

/** The permission branch of {@link reduce} (ruling R13). */
function reducePermission(state: MatchState, permission: 'granted' | 'denied'): MatchState {
  if (permission === 'denied') {
    return next(state, {
      permission: 'denied',
      lastFix: null,
      previous: null,
      result: noPermissionResult(state.net, state.lock),
    });
  }
  if (state.permission === 'granted') {
    return state;
  }
  return next(state, {
    permission: 'granted',
    lastFix: null,
    previous: null,
    result: noFixResult(state.net, state.lock, 'NO_FIX_YET'),
  });
}

/** The lock/unlock branch of {@link reduce}. */
function reduceLock(state: MatchState, lock: Lock | null): MatchState {
  if (state.lastFix === null) {
    return next(state, { lock, result: withLock(state.result, lock) });
  }
  const evaluated = evaluate(state, state.lastFix, lock, state.previous);
  return next(state, { lock, previous: evaluated.previous, result: evaluated.result });
}

/**
 * The result to show at time `nowMs` (milliseconds on the same clock as the fix timestamps).
 * Spec §6, M3 plan Decision 10.
 *
 * - NO_PERMISSION and NO_FIX ignore time (`fixAgeMs` null).
 * - Otherwise, if `nowMs - lastFixTimestampMs > cfg.staleAfterMs` the result is STALE: reason
 *   `FIX_STALE`, no chosen/milepost/range/candidates, the stored result as `historical`.
 * - If `nowMs - lastFixTimestampMs < -cfg.futureFixToleranceMs` (ruling R20) the fix is from the
 *   future: STALE with `FIX_STALE` and `FIX_FROM_FUTURE`, same shape as above. Limit: the pure
 *   reducer cannot see `nowMs`, so it accepted that fix, and later real fixes stay ignored as out
 *   of order until the clock passes the bad timestamp; the caller may start a new state instead.
 * - Otherwise the stored result with `fixAgeMs = nowMs - lastFixTimestampMs` (negative only if
 *   the caller's clock runs behind the fix clock within the tolerance; not clamped, so skew shows).
 * Throws `CoreInputError` (`NON_FINITE`) when `nowMs` is not finite. Pure: no clock is read.
 */
export function currentResult(state: MatchState, nowMs: number): Result {
  assertFinite(nowMs, 'nowMs');
  const stored = state.result;
  const lastMs = state.lastFixTimestampMs;
  if (state.lastFix === null || lastMs === null) {
    return stored; // NO_PERMISSION or NO_FIX: time does not matter
  }
  const ageMs = nowMs - lastMs;
  if (ageMs < -state.cfg.futureFixToleranceMs) {
    return staleResult(stored, ageMs, true); // ruling R20: the fix is from the future
  }
  if (ageMs > state.cfg.staleAfterMs) {
    return staleResult(stored, ageMs);
  }
  return Object.freeze({ ...stored, fixAgeMs: ageMs });
}
