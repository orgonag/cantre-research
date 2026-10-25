import { axialDifferenceDeg } from '../bearing.js';
import type { NetworkView } from '../network/types.js';
import { compareCandidates } from './candidates.js';
import type { Candidate, Fix } from './candidates.js';
import type { MatchConfig } from './config.js';
import type { MatchReason, MatchStatus } from './reasons.js';

/**
 * The user's route choice (ruling R8). A chain lock names a pipeline chain id; a subdivision
 * lock names a subdivision NID. A lock is never switched silently: while it is set the policy
 * either honours it or reports LOCK_CONFLICT (Decision 7, AGENTS.md "no silent switching").
 */
export type Lock =
  | { readonly kind: 'chain'; readonly chainId: string }
  | { readonly kind: 'subdivision'; readonly subdivisionNid: string };

/** The previous match carried into the next fix: its chain and when contradiction began. */
export type PreviousMatch = {
  /** Chain id (`Candidate.chainId`) of the previously chosen track. */
  readonly chainId: string;
  /** `Fix.timestampMs` of the first fix that contradicted it, or null when none has. */
  readonly sinceContradictionMs: number | null;
};

/** Everything the selection policy reads. All candidates are within the search radius. */
export type SelectionInput = {
  readonly net: NetworkView;
  readonly fix: Fix;
  /** Every candidate within the search radius, any order (the policy sorts internally). */
  readonly candidates: readonly Candidate[];
  readonly coverage: 'outside' | 'partial' | 'covered';
  /**
   * Diamonds near ANY candidate within the radius, from `diamondsNear` (ruling R7). Only its
   * length is used: a diamond in the search radius blocks automatic selection (spec §6).
   */
  readonly diamonds: readonly unknown[];
  readonly lock: Lock | null;
  readonly previous: PreviousMatch | null;
  readonly cfg: MatchConfig;
};

/** The policy's decision. `chosen` is set only for MATCHED (including a continuity hold). */
export type Selection = {
  readonly status: Exclude<MatchStatus, 'NO_PERMISSION' | 'NO_FIX' | 'STALE'>;
  readonly chosen: Candidate | null;
  /** The surviving candidate set I, sorted: the choices or range (ruling R10). */
  readonly group: readonly Candidate[];
  /** 'user' when a lock decided, 'auto' when evidence did, null when nothing was matched. */
  readonly selectionOrigin: 'auto' | 'user' | null;
  /** Distinct reason codes in step order. */
  readonly reasons: readonly MatchReason[];
  /** Start of the continuity contradiction (ms) while holding; null in every other outcome. */
  readonly contradictionStartMs: number | null;
};

/** Group key: candidates of one subdivision and operator are one "route" (spec §6). */
function groupKey(c: Candidate): string {
  return JSON.stringify([c.subdivisionNid, c.operator]);
}

/** True when `c` is inside the lock (R4: a chain lock survives a chain split via chainBaseId). */
function inLock(c: Candidate, lock: Lock): boolean {
  return lock.kind === 'chain'
    ? c.chainBaseId === lock.chainId
    : c.subdivisionNid === lock.subdivisionNid;
}

/** Builds a Selection with no match (no chosen candidate, no origin, no hold). */
function unmatched(
  status: Selection['status'],
  group: readonly Candidate[],
  reasons: readonly MatchReason[],
): Selection {
  return {
    status,
    chosen: null,
    group,
    selectionOrigin: null,
    reasons,
    contradictionStartMs: null,
  };
}

/**
 * Heading filter (Decision 2, spec §6). Applies only when speed > `headingMinSpeedMps` and a
 * heading is given (a slow or stationary GPS heading is noise). Keeps candidates whose track
 * bearing is within `headingToleranceDeg` of the heading on the AXIS (a train may run either
 * way, so a bearing and its reverse agree). If that would keep nothing the filter is NOT applied
 * (the heading contradicts every nearby track, so it is distrusted, not obeyed).
 * Units: degrees, metres per second. Limits: removes only candidates; never adds one.
 */
function applyHeading(
  fix: Fix,
  sorted: readonly Candidate[],
  cfg: MatchConfig,
): { kept: readonly Candidate[]; reasons: MatchReason[] } {
  const heading = fix.headingDeg;
  const speed = fix.speedMps;
  if (heading === undefined || speed === undefined || !(speed > cfg.headingMinSpeedMps)) {
    return { kept: sorted, reasons: [] };
  }
  const kept = sorted.filter(
    (c) => axialDifferenceDeg(c.bearingDeg, heading) <= cfg.headingToleranceDeg,
  );
  if (kept.length === 0) {
    return { kept: sorted, reasons: ['HEADING_INCONSISTENT'] };
  }
  return { kept, reasons: kept.length < sorted.length ? ['HEADING_USED'] : [] };
}

/**
 * Selection policy: decides the match status and the chosen candidate (spec §6 "Matching state
 * machine", M3 plan Task 5). Pure and deterministic: candidates are sorted internally with the
 * same comparator as `findCandidates`, so the input order never changes the result.
 *
 * Steps, the first that settles the status wins:
 * 1. coverage 'outside' -> NO_COVERAGE (OUTSIDE_LOADED_TILES).
 * 2. no candidates -> OFF_NETWORK (NO_CANDIDATE_IN_RADIUS).
 * 3. heading filter -> C' (HEADING_USED / HEADING_INCONSISTENT), see `applyHeading`.
 * 4. d_min = min residual in C'. I = { c in C' : residualM <= d_min + max(accuracyM,
 *    indistinguishableMinM) } (all metres). Spec §6; the 10 m floor is experimental.
 *    Candidates inside this band cannot be told apart by position alone: a small residual is
 *    not a confidence interval, and the margin does not improve GPS precision.
 * 5. lock (Decision 7, rulings R4/R8): L = candidates of C' inside the lock. Empty L, or the
 *    best of L outside I, is LOCK_CONFLICT (LOCK_NOT_SUPPORTED); the lock is kept, never
 *    switched. Otherwise I := I intersect L, origin 'user', LOCKED_BY_USER, and steps 6-8 are
 *    skipped (the user's choice replaces them). Several tracks left -> MATCHED_SUBDIVISION.
 * 6. a diamond near any candidate (ruling R7: computed over all candidates within the radius,
 *    because a diamond is registered on one chain only) -> AMBIGUOUS_ROUTE (DIAMOND_NEARBY).
 * 6b. continuity hold (Decision 3, ruling R9): the previous chain is in C' but not in I and
 *    the contradiction began less than `continuityMaxMs` ago -> MATCHED on the previous chain
 *    (CONTINUITY_HOLD). Not used when coverage is 'partial' (R9). A previous chain outside the
 *    radius is never held. The hold is bounded; after it the evidence wins.
 * 7. group I by (subdivisionNid, operator). More than one group: when the previous chain is in
 *    I keep its group (CONTINUITY), else AMBIGUOUS_ROUTE (MULTIPLE_ROUTES).
 * 8. coverage 'partial' with one group -> AMBIGUOUS_ROUTE (PARTIAL_COVERAGE): unloaded tiles
 *    might hold a closer track.
 * 9. one candidate -> MATCHED; several (parallel tracks) -> MATCHED_SUBDIVISION
 *    (MULTIPLE_TRACKS).
 *
 * `group` is I, sorted (ruling R10); `[]` for NO_COVERAGE and OFF_NETWORK. `selectionOrigin` is
 * null unless a match (or subdivision match) was made, so LOCK_CONFLICT has none.
 * Limits: the policy never claims certainty beyond residual evidence; it does not validate the
 * fix (the reducer does, Task 6).
 */
export function selectCandidate(input: SelectionInput): Selection {
  const { fix, coverage, diamonds, lock, previous, cfg } = input;

  // Step 1. Spec §6.
  if (coverage === 'outside') {
    return unmatched('NO_COVERAGE', [], ['OUTSIDE_LOADED_TILES']);
  }
  // Step 2. Spec §6.
  if (input.candidates.length === 0) {
    return unmatched('OFF_NETWORK', [], ['NO_CANDIDATE_IN_RADIUS']);
  }

  const sorted = [...input.candidates].sort(compareCandidates);
  const reasons: MatchReason[] = [];

  // Step 3. Decision 2.
  const heading = applyHeading(fix, sorted, cfg);
  reasons.push(...heading.reasons);
  const cPrime = heading.kept;

  // Step 4. Indistinguishable set; d_min in metres.
  const dMinM = Math.min(...cPrime.map((c) => c.residualM)); // cPrime is non-empty
  const cutM = dMinM + Math.max(fix.accuracyM, cfg.indistinguishableMinM);
  let inI = cPrime.filter((c) => c.residualM <= cutM);

  // Step 5. Decision 7.
  if (lock !== null) {
    const best = cPrime.find((c) => inLock(c, lock));
    if (best === undefined || best.residualM > cutM) {
      return unmatched('LOCK_CONFLICT', inI, [...reasons, 'LOCK_NOT_SUPPORTED']);
    }
    inI = inI.filter((c) => inLock(c, lock));
    const lockReasons: MatchReason[] = [...reasons, 'LOCKED_BY_USER'];
    if (inI.length === 1) {
      return {
        status: 'MATCHED',
        chosen: only(inI),
        group: inI,
        selectionOrigin: 'user',
        reasons: lockReasons,
        contradictionStartMs: null,
      };
    }
    return {
      status: 'MATCHED_SUBDIVISION',
      chosen: null,
      group: inI,
      selectionOrigin: 'user',
      reasons: [...lockReasons, 'MULTIPLE_TRACKS'],
      contradictionStartMs: null,
    };
  }

  // Step 6. Spec §6 + ruling R7.
  if (diamonds.length > 0) {
    return unmatched('AMBIGUOUS_ROUTE', inI, [...reasons, 'DIAMOND_NEARBY']);
  }

  // Step 6b. Decision 3 + ruling R9.
  if (previous !== null && coverage !== 'partial') {
    const held = cPrime.find((c) => c.chainId === previous.chainId);
    if (held !== undefined && !inI.includes(held)) {
      const startMs = previous.sinceContradictionMs ?? fix.timestampMs;
      if (fix.timestampMs - startMs < cfg.continuityMaxMs) {
        return {
          status: 'MATCHED',
          chosen: held,
          group: inI,
          selectionOrigin: 'auto',
          reasons: [...reasons, 'CONTINUITY_HOLD'],
          contradictionStartMs: startMs,
        };
      }
    }
  }

  // Step 7. Spec §6 + Decision 3.
  if (new Set(inI.map(groupKey)).size > 1) {
    const prev = previous === null ? undefined : inI.find((c) => c.chainId === previous.chainId);
    if (prev === undefined) {
      return unmatched('AMBIGUOUS_ROUTE', inI, [...reasons, 'MULTIPLE_ROUTES']);
    }
    const keep = groupKey(prev);
    inI = inI.filter((c) => groupKey(c) === keep);
    reasons.push('CONTINUITY');
  }

  // Step 8. Decision 5.
  if (coverage === 'partial') {
    return unmatched('AMBIGUOUS_ROUTE', inI, [...reasons, 'PARTIAL_COVERAGE']);
  }

  // Step 9.
  if (inI.length === 1) {
    return {
      status: 'MATCHED',
      chosen: only(inI),
      group: inI,
      selectionOrigin: 'auto',
      reasons,
      contradictionStartMs: null,
    };
  }
  return {
    status: 'MATCHED_SUBDIVISION',
    chosen: null,
    group: inI,
    selectionOrigin: 'auto',
    reasons: [...reasons, 'MULTIPLE_TRACKS'],
    contradictionStartMs: null,
  };
}

/** The last element of a list (callers pass a one-element list; avoids unchecked index access). */
function only(list: readonly Candidate[]): Candidate | null {
  return list.reduce<Candidate | null>((_, c) => c, null);
}
