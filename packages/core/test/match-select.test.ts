import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MATCH_CONFIG, fromLocalM } from '../src/index.js';
import {
  coverageOf,
  diamondsNear,
  findCandidates,
  searchRadiusM,
} from '../src/match/candidates.js';
import type { Candidate, Fix } from '../src/match/candidates.js';
import { selectCandidate } from '../src/match/select.js';
import type { Lock, PreviousMatch, Selection } from '../src/match/select.js';
import {
  ORIGIN,
  coverageAround,
  network,
  straightChain,
  siding,
  withDiamond,
} from './helpers/network.js';
import type { LineOptions } from './helpers/network.js';
import type { NetworkChain, NetworkSegment, NetworkView } from '../src/index.js';

/** A fix `eastM`/`northM` metres from the origin. */
function fixAt(eastM: number, northM: number, accuracyM = 5, extra: Partial<Fix> = {}): Fix {
  const p = fromLocalM(ORIGIN, { x: eastM, y: northM }, ORIGIN.lat);
  return { lat: p.lat, lon: p.lon, timestampMs: 100000, accuracyM, ...extra };
}

/** An east-running chain `northM` metres NORTH of the origin line (lateralM is right of travel). */
function eastChain(id: string, northM: number, opts: LineOptions = {}): NetworkChain {
  return straightChain(id, ORIGIN, 0, 2000, { bearingDeg: 90, lateralM: -northM, ...opts });
}

type Run = {
  chains?: NetworkChain[];
  segments?: NetworkSegment[];
  net?: NetworkView;
  fix?: Fix;
  lock?: Lock | null;
  previous?: PreviousMatch | null;
  coverage?: 'outside' | 'partial' | 'covered';
};

/** Wires the real M3 pieces (candidates, coverage, diamonds) into the policy, as the reducer will. */
function run(r: Run): Selection {
  const net =
    r.net ??
    network({
      coverage: [coverageAround(ORIGIN, 5000)],
      chains: r.chains ?? [],
      segments: r.segments ?? [],
    });
  const fix = r.fix ?? fixAt(500, 0);
  const candidates = findCandidates(net, fix, MATCH_CONFIG);
  const radiusM = searchRadiusM(fix.accuracyM, MATCH_CONFIG);
  return selectCandidate({
    net,
    fix,
    candidates,
    coverage: r.coverage ?? coverageOf(net, fix, radiusM),
    diamonds: diamondsNear(net, candidates, radiusM),
    lock: r.lock ?? null,
    previous: r.previous ?? null,
    cfg: MATCH_CONFIG,
  });
}

/** A hand-built candidate for cases that do not need real geometry. */
function cand(id: string, residualM: number, extra: Partial<Candidate> = {}): Candidate {
  return {
    chainId: id,
    chainBaseId: id,
    segmentKey: null,
    subdivisionNid: 'sub-1',
    subdivisionName: 'Test Sub',
    operator: 'CN',
    trackClass: 'Main',
    residualM,
    s: 0,
    bearingDeg: 90,
    ...extra,
  };
}

function direct(
  candidates: Candidate[],
  extra: Partial<Parameters<typeof selectCandidate>[0]> = {},
): Selection {
  return selectCandidate({
    net: network(),
    fix: fixAt(0, 0),
    candidates,
    coverage: 'covered',
    diamonds: [],
    lock: null,
    previous: null,
    cfg: MATCH_CONFIG,
    ...extra,
  });
}

describe('selectCandidate rules', () => {
  it('1. coverage outside is NO_COVERAGE with an empty group', () => {
    const s = direct([cand('a', 1)], { coverage: 'outside' });
    expect(s.status).toBe('NO_COVERAGE');
    expect(s.reasons).toEqual(['OUTSIDE_LOADED_TILES']);
    expect(s.group).toEqual([]);
    expect(s.chosen).toBeNull();
    expect(s.selectionOrigin).toBeNull();
    expect(s.contradictionStartMs).toBeNull();
  });

  it('2. no candidates is OFF_NETWORK', () => {
    const s = direct([]);
    expect(s.status).toBe('OFF_NETWORK');
    expect(s.reasons).toEqual(['NO_CANDIDATE_IN_RADIUS']);
    expect(s.group).toEqual([]);
  });

  it('3. heading 90 deg at 10 m/s drops a north-south candidate; at 2 m/s it does not', () => {
    const chains = [
      eastChain('ew', 3),
      straightChain('ns', ORIGIN, -1000, 1000, { bearingDeg: 0, lateralM: 500, sub: 'sub-2' }),
    ];
    // Fix at x = 503: the north-south line is 3 m away, the east-west line 3 m north.
    const fast = run({ chains, fix: fixAt(503, 0, 5, { headingDeg: 90, speedMps: 10 }) });
    expect(fast.status).toBe('MATCHED');
    expect(fast.chosen?.chainId).toBe('ew');
    expect(fast.reasons).toEqual(['HEADING_USED']);
    const slow = run({ chains, fix: fixAt(503, 0, 5, { headingDeg: 90, speedMps: 2 }) });
    expect(slow.status).toBe('AMBIGUOUS_ROUTE');
    expect(slow.reasons).not.toContain('HEADING_USED');
  });

  it('3. a heading without a speed (or a speed without a heading) is not used', () => {
    const cands = [cand('a', 3, { bearingDeg: 0 }), cand('b', 3, { bearingDeg: 90 })];
    const noSpeed = direct(cands, { fix: fixAt(0, 0, 5, { headingDeg: 90 }) });
    const noHeading = direct(cands, { fix: fixAt(0, 0, 5, { speedMps: 10 }) });
    expect(noSpeed.reasons).not.toContain('HEADING_USED');
    expect(noHeading.reasons).not.toContain('HEADING_USED');
  });

  it('3. a heading that keeps every candidate adds no reason', () => {
    const s = direct([cand('a', 3, { bearingDeg: 88 })], {
      fix: fixAt(0, 0, 5, { headingDeg: 90, speedMps: 10 }),
    });
    expect(s.status).toBe('MATCHED');
    expect(s.reasons).toEqual([]);
  });

  it('3. heading that matches no candidate is ignored with HEADING_INCONSISTENT', () => {
    const s = direct([cand('a', 3, { bearingDeg: 0 })], {
      fix: fixAt(0, 0, 5, { headingDeg: 90, speedMps: 10 }),
    });
    expect(s.status).toBe('MATCHED');
    expect(s.chosen?.chainId).toBe('a');
    expect(s.reasons).toEqual(['HEADING_INCONSISTENT']);
  });

  it('3. R22: the heading never promotes a candidate that position rejected (d_min unchanged)', () => {
    // a at 3 m runs north-south, b at 20 m runs east-west; heading 90 at 10 m/s. Position alone
    // gives I = {a} (20 > 3 + 10). The heading would remove every member of I, so it is not
    // applied: MATCHED a with HEADING_INCONSISTENT, never b.
    const s = direct([cand('a', 3, { bearingDeg: 0 }), cand('b', 20, { bearingDeg: 90 })], {
      fix: fixAt(0, 0, 5, { headingDeg: 90, speedMps: 10 }),
    });
    expect(s.status).toBe('MATCHED');
    expect(s.chosen?.chainId).toBe('a');
    expect(s.reasons).toEqual(['HEADING_INCONSISTENT']);
  });

  it('3. R22: the heading narrows only within I and keeps a same-route choice', () => {
    const s = direct([cand('a', 3, { bearingDeg: 0 }), cand('b', 12, { bearingDeg: 90 })], {
      fix: fixAt(0, 0, 5, { headingDeg: 90, speedMps: 10 }),
    });
    expect(s.status).toBe('MATCHED');
    expect(s.chosen?.chainId).toBe('b');
    expect(s.reasons).toEqual(['HEADING_USED']);
  });

  it('3. R22: the heading filter does not apply under a lock', () => {
    // The locked candidate a contradicts the heading; under a lock the heading is not consulted.
    const s = direct([cand('a', 3, { bearingDeg: 0 }), cand('b', 4, { bearingDeg: 90 })], {
      fix: fixAt(0, 0, 5, { headingDeg: 90, speedMps: 10 }),
      lock: { kind: 'chain', chainId: 'a' },
    });
    expect(s.status).toBe('MATCHED');
    expect(s.chosen?.chainId).toBe('a');
    expect(s.reasons).toEqual(['LOCKED_BY_USER']);
  });

  it('4. I = residual <= d_min + max(accuracy, 10 m), boundary included', () => {
    // accuracy 5 -> margin 10: 3 and 13 are inside (13 = 3 + 10), 13.001 is outside.
    const inside = direct([cand('a', 3), cand('b', 13, { chainId: 'b', subdivisionNid: 'sub-1' })]);
    expect(inside.group.map((c) => c.chainId)).toEqual(['a', 'b']);
    const outside = direct([cand('a', 3), cand('b', 13.001)]);
    expect(outside.group.map((c) => c.chainId)).toEqual(['a']);
    // accuracy 30 -> margin 30: 3 and 33 inside.
    const wide = direct([cand('a', 3), cand('b', 33)], { fix: fixAt(0, 0, 30) });
    expect(wide.group).toHaveLength(2);
  });

  it('5. a user lock outside C is LOCK_CONFLICT with LOCK_NOT_SUPPORTED and keeps the choices', () => {
    const s = direct([cand('a', 3)], { lock: { kind: 'chain', chainId: 'zzz' } });
    expect(s.status).toBe('LOCK_CONFLICT');
    expect(s.reasons).toEqual(['LOCK_NOT_SUPPORTED']);
    expect(s.chosen).toBeNull();
    expect(s.selectionOrigin).toBeNull();
    expect(s.group.map((c) => c.chainId)).toEqual(['a']);
  });

  it('5. a chain lock survives a chain split (matches by chainBaseId)', () => {
    const piece = cand('c1#2', 3, { chainBaseId: 'c1' });
    const s = direct([piece, cand('other', 4, { subdivisionNid: 'sub-2' })], {
      lock: { kind: 'chain', chainId: 'c1' },
    });
    expect(s.status).toBe('MATCHED');
    expect(s.chosen?.chainId).toBe('c1#2');
    expect(s.selectionOrigin).toBe('user');
    expect(s.reasons).toEqual(['LOCKED_BY_USER']);
  });

  it('5. R29: a chain lock may name the piece id (id#2) as well as the base id', () => {
    const piece = cand('c1#2', 3, { chainBaseId: 'c1' });
    const s = direct([piece, cand('other', 4, { subdivisionNid: 'sub-2' })], {
      lock: { kind: 'chain', chainId: 'c1#2' },
    });
    expect(s.status).toBe('MATCHED');
    expect(s.chosen?.chainId).toBe('c1#2');
    expect(s.selectionOrigin).toBe('user');
    // A piece-id lock does not capture the other pieces of the base chain.
    const other = direct([cand('c1', 3), cand('x', 30, { subdivisionNid: 'sub-2' })], {
      lock: { kind: 'chain', chainId: 'c1#2' },
    });
    expect(other.status).toBe('LOCK_CONFLICT');
  });

  it('5. a subdivision lock with several tracks is MATCHED_SUBDIVISION with origin user', () => {
    const s = direct(
      [cand('a', 3), cand('b', 5), cand('x', 4, { subdivisionNid: 'sub-2', operator: 'CP' })],
      { lock: { kind: 'subdivision', subdivisionNid: 'sub-1' } },
    );
    expect(s.status).toBe('MATCHED_SUBDIVISION');
    expect(s.chosen).toBeNull();
    expect(s.selectionOrigin).toBe('user');
    expect(s.reasons).toEqual(['LOCKED_BY_USER', 'MULTIPLE_TRACKS']);
    expect(s.group.map((c) => c.chainId)).toEqual(['a', 'b']);
  });

  it('5. a lock skips diamond, continuity and partial-coverage rules', () => {
    const s = direct([cand('a', 3)], {
      lock: { kind: 'chain', chainId: 'a' },
      diamonds: [{}],
      coverage: 'partial',
      previous: { chainId: 'gone', sinceContradictionMs: null },
    });
    expect(s.status).toBe('MATCHED');
    expect(s.reasons).toEqual(['LOCKED_BY_USER']);
  });

  it('6. a diamond blocks automatic selection of a lone candidate', () => {
    const s = direct([cand('a', 3)], { diamonds: [{}] });
    expect(s.status).toBe('AMBIGUOUS_ROUTE');
    expect(s.reasons).toEqual(['DIAMOND_NEARBY']);
    expect(s.chosen).toBeNull();
    expect(s.selectionOrigin).toBeNull();
    expect(s.group.map((c) => c.chainId)).toEqual(['a']);
  });

  it('6b. holds the previous chain when it is in C but outside I, for under 5 s', () => {
    // R23: every member of I ('new') is in the held chain's group (sub-1, CN), so a hold applies.
    const prev: PreviousMatch = { chainId: 'old', sinceContradictionMs: null };
    const cands = [cand('new', 3), cand('old', 40)];
    const s = direct(cands, { previous: prev });
    expect(s.status).toBe('MATCHED');
    expect(s.chosen?.chainId).toBe('old');
    expect(s.selectionOrigin).toBe('auto');
    expect(s.reasons).toEqual(['CONTINUITY_HOLD']);
    expect(s.contradictionStartMs).toBe(100000); // started at this fix
    expect(s.group.map((c) => c.chainId)).toEqual(['new']);
    expect(s.candidates.map((c) => c.chainId)).toEqual(['new']); // chosen is NOT in candidates
  });

  it('6b. R23: no hold when I holds a different railway; the evidence re-selects at once', () => {
    const prev: PreviousMatch = { chainId: 'old', sinceContradictionMs: null };
    const otherSub = direct([cand('new', 3, { subdivisionNid: 'sub-2' }), cand('old', 40)], {
      previous: prev,
    });
    expect(otherSub.status).toBe('MATCHED');
    expect(otherSub.chosen?.chainId).toBe('new');
    expect(otherSub.reasons).toEqual([]);
    expect(otherSub.contradictionStartMs).toBeNull();
    // Same subdivision, other operator: also a different railway.
    const otherOp = direct([cand('new', 3, { operator: 'CPKC' }), cand('old', 40)], {
      previous: { chainId: 'old', sinceContradictionMs: 99000 },
    });
    expect(otherOp.chosen?.chainId).toBe('new');
    expect(otherOp.reasons).toEqual([]);
    // One same-railway track and one other railway in I: the other railway ends the hold.
    const mixed = direct(
      [cand('new', 3), cand('x', 5, { subdivisionNid: 'sub-2' }), cand('old', 40)],
      { previous: prev },
    );
    expect(mixed.status).toBe('AMBIGUOUS_ROUTE');
    expect(mixed.reasons).toEqual(['MULTIPLE_ROUTES']);
  });

  it('6b. continuity hold ends after continuityMaxMs (4999 ms holds, 5000 ms re-selects)', () => {
    const cands = [cand('new', 3), cand('old', 40)];
    const at = (nowMs: number): Selection =>
      direct(cands, {
        fix: { ...fixAt(0, 0), timestampMs: nowMs },
        previous: { chainId: 'old', sinceContradictionMs: 100000 },
      });
    const held = at(104999);
    expect(held.chosen?.chainId).toBe('old');
    expect(held.contradictionStartMs).toBe(100000);
    const exact = at(105000); // T5: exactly continuityMaxMs is no longer a hold (strict <)
    expect(exact.chosen?.chainId).toBe('new');
    expect(exact.reasons).toEqual([]);
    expect(exact.contradictionStartMs).toBeNull();
    const over = at(105001);
    expect(over.status).toBe('MATCHED');
    expect(over.chosen?.chainId).toBe('new');
    expect(over.contradictionStartMs).toBeNull();
    expect(over.reasons).toEqual([]);
  });

  it('6b. no hold when the previous chain is outside the radius, in I, or coverage is partial', () => {
    const newer = cand('new', 3);
    const prev: PreviousMatch = { chainId: 'old', sinceContradictionMs: null };
    expect(direct([newer], { previous: prev }).chosen?.chainId).toBe('new');
    expect(direct([newer, cand('old', 40)], { previous: prev, coverage: 'partial' }).status).toBe(
      'AMBIGUOUS_ROUTE',
    );
    const both = direct([cand('old', 3), cand('x', 4, { subdivisionNid: 'sub-1' })], {
      previous: prev,
    });
    expect(both.reasons).not.toContain('CONTINUITY_HOLD');
  });

  it('6b. a hold is not offered while a diamond blocks selection', () => {
    const s = direct([cand('new', 3), cand('old', 40)], {
      diamonds: [{}],
      previous: { chainId: 'old', sinceContradictionMs: null },
    });
    expect(s.status).toBe('AMBIGUOUS_ROUTE');
  });

  it('7. indistinguishable candidates of different routes are AMBIGUOUS_ROUTE', () => {
    const s = direct([cand('a', 3), cand('b', 5, { operator: 'CP', subdivisionNid: 'sub-2' })]);
    expect(s.status).toBe('AMBIGUOUS_ROUTE');
    expect(s.reasons).toEqual(['MULTIPLE_ROUTES']);
    expect(s.group.map((c) => c.chainId)).toEqual(['a', 'b']);
  });

  it('7. the same subdivision under another operator is a different route', () => {
    const s = direct([cand('a', 3), cand('b', 5, { operator: 'CP' })]);
    expect(s.status).toBe('AMBIGUOUS_ROUTE');
  });

  it('7. continuity keeps the previous chain group among several routes', () => {
    const s = direct(
      [
        cand('a', 3, { subdivisionNid: 'sub-1' }),
        cand('a2', 4, { subdivisionNid: 'sub-1' }),
        cand('b', 5, { subdivisionNid: 'sub-2' }),
      ],
      { previous: { chainId: 'b', sinceContradictionMs: null } },
    );
    expect(s.status).toBe('MATCHED');
    expect(s.chosen?.chainId).toBe('b');
    expect(s.reasons).toEqual(['CONTINUITY']);
    expect(s.selectionOrigin).toBe('auto');
  });

  it('7. continuity with a previous segment-free chain absent from I stays ambiguous', () => {
    const s = direct([cand('a', 3), cand('b', 5, { subdivisionNid: 'sub-2' })], {
      previous: { chainId: 'a', sinceContradictionMs: null },
    });
    expect(s.status).toBe('MATCHED');
    expect(s.chosen?.chainId).toBe('a');
    const none = direct([cand('a', 3), cand('b', 5, { subdivisionNid: 'sub-2' })], {
      previous: { chainId: 'zz', sinceContradictionMs: null },
    });
    expect(none.status).toBe('AMBIGUOUS_ROUTE');
  });

  it('R25: candidates is the full position-based I after CONTINUITY, a lock or the heading', () => {
    const other = cand('b', 5, { subdivisionNid: 'sub-2', operator: 'CP', bearingDeg: 0 });
    const cont = direct([cand('a', 3), other], {
      previous: { chainId: 'a', sinceContradictionMs: null },
    });
    expect(cont.reasons).toEqual(['CONTINUITY']);
    expect(cont.group.map((c) => c.chainId)).toEqual(['a']);
    expect(cont.candidates.map((c) => c.chainId)).toEqual(['a', 'b']);
    const locked = direct([cand('a', 3), other], { lock: { kind: 'chain', chainId: 'a' } });
    expect(locked.status).toBe('MATCHED');
    expect(locked.candidates.map((c) => c.chainId)).toEqual(['a', 'b']);
    const headed = direct([cand('a', 3), other], {
      fix: fixAt(0, 0, 5, { headingDeg: 90, speedMps: 10 }),
    });
    expect(headed.reasons).toEqual(['HEADING_USED']);
    expect(headed.chosen?.chainId).toBe('a');
    expect(headed.candidates.map((c) => c.chainId)).toEqual(['a', 'b']);
    expect(direct([]).candidates).toEqual([]);
    expect(direct([cand('a', 1)], { coverage: 'outside' }).candidates).toEqual([]);
  });

  it('8. partial coverage with one group is AMBIGUOUS_ROUTE (PARTIAL_COVERAGE)', () => {
    const s = direct([cand('a', 3)], { coverage: 'partial' });
    expect(s.status).toBe('AMBIGUOUS_ROUTE');
    expect(s.reasons).toEqual(['PARTIAL_COVERAGE']);
    expect(s.group).toHaveLength(1);
  });

  it('9. one candidate is MATCHED, auto origin, no reasons', () => {
    const s = direct([cand('a', 3)]);
    expect(s.status).toBe('MATCHED');
    expect(s.chosen?.chainId).toBe('a');
    expect(s.selectionOrigin).toBe('auto');
    expect(s.reasons).toEqual([]);
    expect(s.contradictionStartMs).toBeNull();
  });

  it('9. parallel tracks of one subdivision are MATCHED_SUBDIVISION (MULTIPLE_TRACKS)', () => {
    const s = direct([cand('a', 3), cand('b', 6)]);
    expect(s.status).toBe('MATCHED_SUBDIVISION');
    expect(s.chosen).toBeNull();
    expect(s.reasons).toEqual(['MULTIPLE_TRACKS']);
    expect(s.selectionOrigin).toBe('auto');
  });
});

describe('selectCandidate scenarios on real geometry', () => {
  const cn = (id: string, n: number): NetworkChain => eastChain(id, n, { sub: 'sub-cn', op: 'CN' });
  const cp = (id: string, n: number): NetworkChain => eastChain(id, n, { sub: 'sub-cp', op: 'CP' });

  it('two different railways 4 m and 9 m away with 5 m accuracy are AMBIGUOUS_ROUTE', () => {
    const s = run({ chains: [cn('cn', 4), cp('cp', 9)] }); // d_min 4, cut 4 + 10 = 14
    expect(s.status).toBe('AMBIGUOUS_ROUTE');
    expect(s.reasons).toEqual(['MULTIPLE_ROUTES']);
    expect(s.group.map((c) => c.chainId)).toEqual(['cn', 'cp']);
  });

  it('same pair at 4 m and 40 m is MATCHED on the 4 m line', () => {
    const s = run({ chains: [cn('cn', 4), cp('cp', 40)] });
    expect(s.status).toBe('MATCHED');
    expect(s.chosen?.chainId).toBe('cn');
  });

  it('a diamond blocks automatic selection even when one line is closer', () => {
    // The diamond is registered on the farther chain only (ruling R7).
    const net = withDiamond(
      network({
        coverage: [coverageAround(ORIGIN, 5000)],
        chains: [cn('cn', 3), cp('cp', 30)],
      }),
      'dia-1',
      'cp',
      500,
    );
    const s = run({ net });
    expect(s.status).toBe('AMBIGUOUS_ROUTE');
    expect(s.reasons).toEqual(['DIAMOND_NEARBY']);
    expect(s.group.map((c) => c.chainId)).toEqual(['cn']); // 30 m is outside I, still blocks
  });

  it('a chain lock at the diamond matches the locked line with origin user', () => {
    const net = withDiamond(
      network({
        coverage: [coverageAround(ORIGIN, 5000)],
        chains: [cn('cn', 4), cp('cp', 9)],
      }),
      'dia-1',
      'cp',
      500,
    );
    const s = run({ net, lock: { kind: 'chain', chainId: 'cp' } });
    expect(s.status).toBe('MATCHED');
    expect(s.chosen?.chainId).toBe('cp');
    expect(s.selectionOrigin).toBe('user');
    expect(s.reasons).toEqual(['LOCKED_BY_USER']);
  });

  it('R22 probe: 2 m from CN (N-S), 40 m from CPKC (E-W), heading 90 at 4 m/s stays on CN', () => {
    // Final review probe: the heading filter used to drop CN, recompute d_min = 40 and match CPKC.
    const ns = straightChain('cn', ORIGIN, -1000, 1000, {
      bearingDeg: 0,
      lateralM: 502,
      sub: 'sub-cn',
      op: 'CN',
    });
    const s = run({
      chains: [ns, cp('cp', 40)],
      fix: fixAt(500, 0, 5, { headingDeg: 90, speedMps: 4 }),
    });
    expect(s.status).toBe('MATCHED');
    expect(s.chosen?.chainId).toBe('cn');
    expect(s.reasons).toEqual(['HEADING_INCONSISTENT']);
  });

  it('R22: a lock on a line the heading contradicts still matches it (no heading under a lock)', () => {
    const ns = straightChain('ns', ORIGIN, -1000, 1000, {
      bearingDeg: 0,
      lateralM: 509,
      sub: 'sub-ns',
      op: 'CP',
    });
    const s = run({
      chains: [cn('cn', 4), ns],
      fix: fixAt(500, 0, 5, { headingDeg: 90, speedMps: 10 }),
      lock: { kind: 'chain', chainId: 'ns' },
    });
    expect(s.status).toBe('MATCHED');
    expect(s.chosen?.chainId).toBe('ns');
    expect(s.selectionOrigin).toBe('user');
    expect(s.reasons).toEqual(['LOCKED_BY_USER']);
  });

  it('a lock whose line is 45 m away while another is 3 m away is LOCK_CONFLICT', () => {
    const s = run({
      chains: [cn('cn', 3), cp('cp', 45)],
      lock: { kind: 'chain', chainId: 'cp' },
    });
    expect(s.status).toBe('LOCK_CONFLICT');
    expect(s.reasons).toEqual(['LOCK_NOT_SUPPORTED']);
    expect(s.chosen).toBeNull();
    expect(s.group.map((c) => c.chainId)).toEqual(['cn']);
  });

  it('300 m accuracy: two lines 200 m apart are AMBIGUOUS_ROUTE, not a guess', () => {
    const s = run({
      chains: [cn('cn', 0), cp('cp', 200)],
      fix: fixAt(500, 0, 300),
    });
    expect(s.status).toBe('AMBIGUOUS_ROUTE');
    expect(s.reasons).toEqual(['MULTIPLE_ROUTES']);
    expect(s.chosen).toBeNull();
    expect(s.group).toHaveLength(2);
  });

  it('a siding next to the main line is a second track of the same route', () => {
    const s = run({
      chains: [cn('cn', 4)],
      segments: [siding('sd', ORIGIN, 0, 2000, { bearingDeg: 90, lateralM: -8, sub: 'sub-cn' })],
    });
    expect(s.status).toBe('MATCHED_SUBDIVISION');
    expect(s.group).toHaveLength(2);
  });

  it('a fix outside the loaded tiles is NO_COVERAGE', () => {
    const net = network({ coverage: [coverageAround(ORIGIN, 100)], chains: [cn('cn', 4)] });
    const s = run({ net, fix: fixAt(5000, 0) });
    expect(s.status).toBe('NO_COVERAGE');
  });
});

describe('selectCandidate determinism', () => {
  const candidateArb = fc
    .uniqueArray(
      fc.record({
        id: fc.integer({ min: 0, max: 30 }),
        residualM: fc.integer({ min: 0, max: 200 }),
        sub: fc.integer({ min: 0, max: 2 }),
        op: fc.constantFrom('CN', 'CP'),
        bearingDeg: fc.integer({ min: 0, max: 359 }),
      }),
      { selector: (r) => r.id, minLength: 0, maxLength: 8 },
    )
    .map((rs) =>
      rs.map((r) =>
        cand(`c${String(r.id)}`, r.residualM, {
          subdivisionNid: `sub-${String(r.sub)}`,
          operator: r.op,
          bearingDeg: r.bearingDeg,
        }),
      ),
    );

  it('shuffling the candidate input order never changes the Selection', () => {
    fc.assert(
      fc.property(
        candidateArb.chain((cs) =>
          fc.record({
            cs: fc.constant(cs),
            shuffled: fc.shuffledSubarray(cs, { minLength: cs.length, maxLength: cs.length }),
            coverage: fc.constantFrom('covered', 'partial', 'outside'),
            diamonds: fc.constantFrom<unknown[]>([], [{}]),
            lock: fc.constantFrom<Lock | null>(
              null,
              { kind: 'chain', chainId: 'c3' },
              { kind: 'subdivision', subdivisionNid: 'sub-1' },
            ),
            previous: fc.constantFrom<PreviousMatch | null>(
              null,
              { chainId: 'c5', sinceContradictionMs: null },
              { chainId: 'c7', sinceContradictionMs: 99000 },
            ),
            heading: fc.option(fc.integer({ min: 0, max: 359 }), { nil: undefined }),
            accuracyM: fc.integer({ min: 0, max: 40 }),
          }),
        ),
        (p) => {
          const fix = fixAt(0, 0, p.accuracyM, {
            speedMps: 10,
            ...(p.heading === undefined ? {} : { headingDeg: p.heading }),
          });
          const base = {
            net: network(),
            fix,
            coverage: p.coverage,
            diamonds: p.diamonds,
            lock: p.lock,
            previous: p.previous,
            cfg: MATCH_CONFIG,
          };
          const a = selectCandidate({ ...base, candidates: p.cs });
          const b = selectCandidate({ ...base, candidates: p.shuffled });
          expect(b).toEqual(a);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('reasons never repeat', () => {
    const s = direct([cand('a', 3, { bearingDeg: 0 }), cand('b', 4, { bearingDeg: 10 })], {
      fix: fixAt(0, 0, 5, { headingDeg: 90, speedMps: 10 }),
      coverage: 'partial',
    });
    expect(new Set(s.reasons).size).toBe(s.reasons.length);
  });
});
