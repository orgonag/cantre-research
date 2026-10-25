import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CoreInputError, MATCH_CONFIG, fromLocalM } from '../src/index.js';
import type { Fix, Lock, MatchEvent, MatchState, NetworkView, Result } from '../src/index.js';
import { currentResult, initialMatchState, reduce } from '../src/match/machine.js';
import {
  ORIGIN,
  coverageAround,
  interval,
  network,
  siding,
  straightChain,
  withDiamond,
} from './helpers/network.js';

/** A fix `eastM`/`northM` metres from the origin. */
function fixAt(
  eastM: number,
  northM: number,
  timestampMs: number,
  accuracyM = 5,
  extra: Partial<Fix> = {},
): Fix {
  const p = fromLocalM(ORIGIN, { x: eastM, y: northM }, ORIGIN.lat);
  return { lat: p.lat, lon: p.lon, timestampMs, accuracyM, ...extra };
}

const fixEvent = (fix: Fix): MatchEvent => ({ type: 'fix', fix });

/** Applies events in order and returns the final state. */
function play(net: NetworkView, events: readonly MatchEvent[]): MatchState {
  return events.reduce((s, e) => reduce(s, e).state, initialMatchState(net));
}

/** Chain A runs east on the origin line, calibrated 0..2000 m = mp 0..1 (mp 0 at s 0). */
function oneChain(): NetworkView {
  return network({
    coverage: [coverageAround(ORIGIN, 5000)],
    chains: [straightChain('A', ORIGIN, 0, 2000)],
    intervals: [
      interval('iA', 'A', [
        { s: 0, mp: 0 },
        { s: 2000, mp: 1 },
      ]),
    ],
  });
}

/** A on the origin line; B 30 m north of it in another subdivision (so they are two routes). */
function twoRoutes(): NetworkView {
  return network({
    coverage: [coverageAround(ORIGIN, 5000)],
    chains: [
      straightChain('A', ORIGIN, 0, 2000, { sub: 'sub-A' }),
      straightChain('B', ORIGIN, 0, 2000, { sub: 'sub-B', lateralM: -30 }),
    ],
    intervals: [
      interval('iA', 'A', [
        { s: 0, mp: 10 },
        { s: 2000, mp: 11 },
      ]),
      interval('iB', 'B', [
        { s: 0, mp: 20 },
        { s: 2000, mp: 21 },
      ]),
    ],
  });
}

describe('permission and location errors', () => {
  it('starts NO_FIX, NO_PERMISSION on denial, back to NO_FIX on grant', () => {
    const net = oneChain();
    const s0 = initialMatchState(net);
    expect(currentResult(s0, 1e9)).toMatchObject({
      status: 'NO_FIX',
      reasons: ['NO_FIX_YET'],
      accuracyM: null,
      fixAgeMs: null,
      milepost: null,
      datasetVersion: 'test-1',
    });
    const denied = reduce(s0, { type: 'permission', state: 'denied' });
    expect(denied.ignored).toBeNull();
    expect(currentResult(denied.state, 1e9)).toMatchObject({
      status: 'NO_PERMISSION',
      reasons: ['PERMISSION_DENIED'],
      fixAgeMs: null,
    });
    // Denied again: still NO_PERMISSION.
    expect(currentResult(reduce(denied.state, denied2()).state, 5).status).toBe('NO_PERMISSION');
    const granted = reduce(denied.state, { type: 'permission', state: 'granted' });
    expect(currentResult(granted.state, 0)).toMatchObject({
      status: 'NO_FIX',
      reasons: ['NO_FIX_YET'],
    });
  });

  it('granting when not denied changes nothing', () => {
    const s = play(oneChain(), [fixEvent(fixAt(500, 0, 1000))]);
    const r = reduce(s, { type: 'permission', state: 'granted' });
    expect(r.state).toBe(s);
    expect(r.ignored).toBeNull();
  });

  it('a fix while denied is ignored as invalid and counted; grant drops the result but keeps order', () => {
    const net = oneChain();
    let s = play(net, [fixEvent(fixAt(500, 0, 1000)), { type: 'permission', state: 'denied' }]);
    const r = reduce(s, fixEvent(fixAt(500, 0, 2000)));
    expect(r.ignored).toBe('FIX_IGNORED_INVALID');
    expect(r.state.ignoredFixes).toBe(1);
    expect(currentResult(r.state, 2000).status).toBe('NO_PERMISSION');
    s = reduce(r.state, { type: 'permission', state: 'granted' }).state;
    expect(currentResult(s, 2000).status).toBe('NO_FIX');
    // The kept timestamp still orders fixes: t=1000 is not after the earlier accepted t=1000.
    expect(reduce(s, fixEvent(fixAt(500, 0, 1000))).ignored).toBe('FIX_IGNORED_OUT_OF_ORDER');
    expect(reduce(s, fixEvent(fixAt(500, 0, 1001))).ignored).toBeNull();
  });

  it('a location error before any fix gives NO_FIX / LOCATION_UNAVAILABLE', () => {
    const s = reduce(initialMatchState(oneChain()), { type: 'locationError', code: 'TIMEOUT' });
    expect(s.ignored).toBeNull();
    expect(currentResult(s.state, 0)).toMatchObject({
      status: 'NO_FIX',
      reasons: ['LOCATION_UNAVAILABLE'],
    });
  });

  it('a location error after a fix or while denied leaves the state unchanged', () => {
    const matched = play(oneChain(), [fixEvent(fixAt(500, 0, 1000))]);
    const e = reduce(matched, { type: 'locationError', code: 'UNAVAILABLE' });
    expect(e.state).toBe(matched);
    const denied = play(oneChain(), [{ type: 'permission', state: 'denied' }]);
    expect(reduce(denied, { type: 'locationError', code: 'UNAVAILABLE' }).state).toBe(denied);
  });
});

function denied2(): MatchEvent {
  return { type: 'permission', state: 'denied' };
}

describe('fix validity', () => {
  it('an out-of-order fix is ignored and does not change the result', () => {
    const net = twoRoutes();
    const s1 = play(net, [fixEvent(fixAt(500, 0, 2000))]);
    const before = currentResult(s1, 2000);
    expect(before.status).toBe('MATCHED');
    for (const ts of [1500, 2000]) {
      const r = reduce(s1, fixEvent(fixAt(500, 30, ts)));
      expect(r.ignored).toBe('FIX_IGNORED_OUT_OF_ORDER');
      expect(r.state.ignoredFixes).toBe(1);
      expect(currentResult(r.state, 2000)).toEqual(before);
      expect({ ...r.state, ignoredFixes: 0 }).toEqual(s1);
    }
  });

  it('an invalid fix is ignored and changes only the counter', () => {
    const net = oneChain();
    const s1 = play(net, [fixEvent(fixAt(500, 0, 2000))]);
    const good = fixAt(600, 0, 3000);
    const bads: Fix[] = [
      { ...good, lat: NaN },
      { ...good, lon: Infinity },
      { ...good, timestampMs: NaN },
      { ...good, accuracyM: Infinity },
      { ...good, accuracyM: NaN },
      { ...good, accuracyM: -1 },
      { ...good, headingDeg: NaN },
      { ...good, speedMps: Infinity },
      { ...good, lat: 41.4 },
      { ...good, lat: 83.6 },
      { ...good, lon: -141.6 },
      { ...good, lon: -51.9 },
    ];
    for (const bad of bads) {
      const r = reduce(s1, fixEvent(bad));
      expect(r.ignored).toBe('FIX_IGNORED_INVALID');
      expect({ ...r.state, ignoredFixes: 0 }).toEqual(s1);
      expect(r.state.ignoredFixes).toBe(1);
    }
    // A zero accuracy and present finite heading/speed are valid.
    const ok = reduce(s1, fixEvent({ ...good, accuracyM: 0, headingDeg: 90, speedMps: 0 }));
    expect(ok.ignored).toBeNull();
    // Counter accumulates.
    const two = reduce(reduce(s1, fixEvent(bads[0] as Fix)).state, fixEvent(bads[1] as Fix));
    expect(two.state.ignoredFixes).toBe(2);
  });

  it('reduce returns ignored null for every non-ignored event', () => {
    const net = oneChain();
    const events: MatchEvent[] = [
      fixEvent(fixAt(500, 0, 1000)),
      { type: 'lock', lock: { kind: 'chain', chainId: 'A' } },
      { type: 'unlock' },
      { type: 'locationError', code: 'TIMEOUT' },
      { type: 'permission', state: 'denied' },
      { type: 'permission', state: 'granted' },
    ];
    let s = initialMatchState(net);
    for (const e of events) {
      const r = reduce(s, e);
      expect(r.ignored).toBeNull();
      s = r.state;
    }
  });
});

describe('results of accepted fixes', () => {
  it('MATCHED carries milepost, band, tier, anchors and the fix accuracy', () => {
    const s = play(oneChain(), [fixEvent(fixAt(500, 0, 1000, 7))]);
    const r = currentResult(s, 1200);
    expect(r.status).toBe('MATCHED');
    expect(r.chosen?.chainId).toBe('A');
    expect(r.s).toBeCloseTo(500, 3);
    expect(r.milepost).toMatchObject({ kind: 'calibrated' });
    if (r.milepost?.kind === 'calibrated') {
      expect(r.milepost.mp).toBeCloseTo(0.25, 6);
    }
    expect(r.mpRange).toBeNull();
    expect(r.mpBandMi).toBeGreaterThan(0);
    expect(r.tier).toBe('posted');
    expect(r.anchorIds).toEqual(['iA-a0', 'iA-a1']);
    expect(r.selectionOrigin).toBe('auto');
    expect(r.accuracyM).toBe(7);
    expect(r.fixAgeMs).toBe(200);
    expect(r.candidates.map((c) => c.chainId)).toEqual(['A']);
    expect(r.historical).toBeNull();
    expect(r.lock).toBeNull();
  });

  it('a calibrated milepost of 0 stays 0 and is not null', () => {
    const r = currentResult(play(oneChain(), [fixEvent(fixAt(0, 0, 1000))]), 1000);
    expect(r.status).toBe('MATCHED');
    expect(r.milepost).toMatchObject({ kind: 'calibrated', mp: 0 });
  });

  it('an uncalibrated chain is MATCHED with a null milepost and its reason', () => {
    const net = network({
      coverage: [coverageAround(ORIGIN, 5000)],
      chains: [straightChain('A', ORIGIN, 0, 2000)],
    });
    const r = currentResult(play(net, [fixEvent(fixAt(500, 0, 1000))]), 1000);
    expect(r.status).toBe('MATCHED');
    expect(r.milepost).toBeNull();
    expect(r.mpBandMi).toBeNull();
    expect(r.tier).toBeNull();
    expect(r.reasons).toEqual(['CHAIN_UNCALIBRATED']);
    expect(r.s).toBeCloseTo(500, 3);
  });

  it('a lone siding is MATCHED with s null and no milepost', () => {
    const net = network({
      coverage: [coverageAround(ORIGIN, 5000)],
      segments: [siding('yard', ORIGIN, 0, 500)],
    });
    const r = currentResult(play(net, [fixEvent(fixAt(200, 0, 1000))]), 1000);
    expect(r.status).toBe('MATCHED');
    expect(r.chosen?.segmentKey).toBe('yard');
    expect(r.s).toBeNull();
    expect(r.milepost).toBeNull();
    expect(r.reasons).toEqual(['UNCHAINED_TRACK']);
  });

  it('NO_COVERAGE and OFF_NETWORK carry no candidates, milepost or chosen', () => {
    const net = oneChain();
    const far = currentResult(play(net, [fixEvent(fixAt(500, 3000, 1000))]), 1000);
    expect(far).toMatchObject({
      status: 'OFF_NETWORK',
      candidates: [],
      chosen: null,
      s: null,
      milepost: null,
      accuracyM: 5,
    });
    const outside = currentResult(play(net, [fixEvent(fixAt(500, 9000, 1000))]), 1000);
    expect(outside).toMatchObject({
      status: 'NO_COVERAGE',
      candidates: [],
      reasons: ['OUTSIDE_LOADED_TILES'],
    });
  });

  it('a diamond gives AMBIGUOUS_ROUTE with the choices and no milepost', () => {
    const net = withDiamond(twoRoutes(), 'dia', 'A', 500);
    const r = currentResult(play(net, [fixEvent(fixAt(500, 15, 1000))]), 1000);
    expect(r.status).toBe('AMBIGUOUS_ROUTE');
    expect(r.reasons).toContain('DIAMOND_NEARBY');
    expect(r.milepost).toBeNull();
    expect(r.chosen).toBeNull();
    expect(r.s).toBeNull();
    expect(r.candidates.map((c) => c.chainId)).toEqual(['A', 'B']);
    expect(r.selectionOrigin).toBeNull();
  });
});

/** Parallel tracks of one subdivision, 5 m apart; the fix sits between them. */
function parallel(
  second: 'calibrated' | 'disagree' | 'uncalibrated' | 'siding' | 'tc',
): NetworkView {
  const chains = [
    straightChain('A', ORIGIN, 0, 2000),
    straightChain('A2', ORIGIN, 0, 2000, { lateralM: -5 }),
  ];
  const iA = interval('iA', 'A', [
    { s: 0, mp: 0 },
    { s: 2000, mp: 1 },
  ]);
  const mp2 = second === 'disagree' ? 5 : 0;
  const iA2 = interval('iA2', 'A2', [
    { s: 0, mp: mp2, tier: second === 'tc' ? 'tc' : 'posted' },
    { s: 2000, mp: mp2 + 1 },
  ]);
  if (second === 'siding') {
    return network({
      coverage: [coverageAround(ORIGIN, 5000)],
      chains: [chains[0] as (typeof chains)[0]],
      segments: [siding('sd', ORIGIN, 0, 2000, { lateralM: -5 })],
      intervals: [iA],
    });
  }
  return network({
    coverage: [coverageAround(ORIGIN, 5000)],
    chains,
    intervals: second === 'uncalibrated' ? [iA] : [iA, iA2],
  });
}

describe('MATCHED_SUBDIVISION range (Decision 9, ruling R11)', () => {
  const at = (n: NetworkView): Result =>
    currentResult(play(n, [fixEvent(fixAt(500, 2.5, 1000))]), 1000);

  it('agreeing calibrated tracks give an mpRange with max band, lowest tier, sorted anchors', () => {
    const r = at(parallel('tc'));
    expect(r.status).toBe('MATCHED_SUBDIVISION');
    expect(r.milepost).toBeNull();
    expect(r.chosen).toBeNull();
    expect(r.s).toBeNull();
    expect(r.mpRange).not.toBeNull();
    expect(r.mpRange?.lowerMp).toBeCloseTo(0.25, 5);
    expect(r.mpRange?.upperMp).toBeCloseTo(0.25, 5);
    expect(r.tier).toBe('tc');
    expect(r.anchorIds).toEqual(['iA-a0', 'iA-a1', 'iA2-a0', 'iA2-a1']);
    // Band = accuracy x |d mp| / d s = 5 m x 1 mi / 2000 m, the same on both tracks.
    expect(r.mpBandMi).toBeCloseTo(5 / 2000, 9);
    expect(r.candidates).toHaveLength(2);
    expect(r.reasons).toContain('MULTIPLE_TRACKS');
  });

  it('tracks whose mileposts differ by more than the band give TRACK_MP_DISAGREE', () => {
    const r = at(parallel('disagree'));
    expect(r.status).toBe('MATCHED_SUBDIVISION');
    expect(r.mpRange).toBeNull();
    expect(r.mpBandMi).toBeNull();
    expect(r.tier).toBeNull();
    expect(r.anchorIds).toEqual([]);
    expect(r.reasons).toContain('TRACK_MP_DISAGREE');
    expect(r.candidates).toHaveLength(2);
  });

  it('an uncalibrated track gives TRACK_UNCALIBRATED', () => {
    const r = at(parallel('uncalibrated'));
    expect(r.mpRange).toBeNull();
    expect(r.reasons).toContain('TRACK_UNCALIBRATED');
  });

  it('a siding in the group gives TRACK_UNCALIBRATED', () => {
    const r = at(parallel('siding'));
    expect(r.status).toBe('MATCHED_SUBDIVISION');
    expect(r.mpRange).toBeNull();
    expect(r.reasons).toContain('TRACK_UNCALIBRATED');
  });

  it('a calibrated agreeing range keeps a user lock as origin', () => {
    const lock: Lock = { kind: 'subdivision', subdivisionNid: 'sub-1' };
    const s = play(parallel('calibrated'), [
      { type: 'lock', lock },
      fixEvent(fixAt(500, 2.5, 1000)),
    ]);
    const r = currentResult(s, 1000);
    expect(r.status).toBe('MATCHED_SUBDIVISION');
    expect(r.selectionOrigin).toBe('user');
    expect(r.lock).toEqual(lock);
  });
});

describe('stale, continuity and time', () => {
  it('STALE after 15 s carries the last result as historical; the next fresh fix re-selects without continuity', () => {
    const net = twoRoutes();
    // t=1000 on A: MATCHED A. t=2000 on B's line: A is held (CONTINUITY_HOLD).
    let s = play(net, [fixEvent(fixAt(500, 0, 1000)), fixEvent(fixAt(500, 30, 2000))]);
    const held = currentResult(s, 2000);
    expect(held.status).toBe('MATCHED');
    expect(held.chosen?.chainId).toBe('A');
    expect(held.reasons).toContain('CONTINUITY_HOLD');

    const atLimit = currentResult(s, 2000 + MATCH_CONFIG.staleAfterMs);
    expect(atLimit.status).toBe('MATCHED'); // exactly staleAfterMs is not stale
    const stale = currentResult(s, 2000 + MATCH_CONFIG.staleAfterMs + 1);
    expect(stale).toMatchObject({
      status: 'STALE',
      reasons: ['FIX_STALE'],
      candidates: [],
      chosen: null,
      s: null,
      milepost: null,
      mpRange: null,
      mpBandMi: null,
      tier: null,
      anchorIds: [],
      selectionOrigin: null,
      accuracyM: 5,
      fixAgeMs: 15001,
    });
    expect(stale.historical).toMatchObject({ status: 'MATCHED', historical: null });
    expect(stale.historical?.chosen?.chainId).toBe('A');

    // A fresh fix 20 s later at the same place: no continuity, evidence alone -> B.
    s = reduce(s, fixEvent(fixAt(500, 30, 22000))).state;
    const fresh = currentResult(s, 22000);
    expect(fresh.status).toBe('MATCHED');
    expect(fresh.chosen?.chainId).toBe('B');
    expect(fresh.reasons).not.toContain('CONTINUITY_HOLD');
  });

  it('continuity holds up to continuityMaxMs from the first contradiction, then re-selects', () => {
    const net = twoRoutes();
    const base = [fixEvent(fixAt(500, 0, 1000)), fixEvent(fixAt(500, 30, 2000))];
    const during = currentResult(play(net, [...base, fixEvent(fixAt(500, 30, 6999))]), 6999);
    expect(during.chosen?.chainId).toBe('A');
    expect(during.reasons).toContain('CONTINUITY_HOLD');
    const after = currentResult(play(net, [...base, fixEvent(fixAt(500, 30, 7000))]), 7000);
    expect(after.chosen?.chainId).toBe('B');
    expect(after.reasons).not.toContain('CONTINUITY_HOLD');
  });

  it('a fix far in the future is STALE with FIX_FROM_FUTURE; 500 ms ahead is within tolerance', () => {
    const s = play(oneChain(), [fixEvent(fixAt(500, 0, 100000))]);
    const future = currentResult(s, 50000);
    expect(future).toMatchObject({
      status: 'STALE',
      reasons: ['FIX_STALE', 'FIX_FROM_FUTURE'],
      milepost: null,
      chosen: null,
      fixAgeMs: -50000,
      accuracyM: 5,
    });
    expect(future.historical?.status).toBe('MATCHED');
    expect(currentResult(s, 100000 - 1000).status).toBe('MATCHED'); // exactly the tolerance
    expect(currentResult(s, 100000 - 1001).status).toBe('STALE');
    const near = currentResult(s, 100000 - 500);
    expect(near.status).toBe('MATCHED');
    expect(near.fixAgeMs).toBe(-500);
    // Later real fixes stay ignored as out of order (documented limit of the pure reducer).
    expect(reduce(s, fixEvent(fixAt(500, 0, 60000))).ignored).toBe('FIX_IGNORED_OUT_OF_ORDER');
  });

  it('R12 (a): a gap longer than staleAfterMs drops continuity, so a contradicting fix re-selects', () => {
    // MATCHED A at t=1000 with no contradiction; at t=22000 B's line is nearest, A is in the
    // radius but not in I. Without the gap rule this would be a CONTINUITY_HOLD on A.
    const s = play(twoRoutes(), [fixEvent(fixAt(500, 0, 1000)), fixEvent(fixAt(500, 30, 22000))]);
    const r = currentResult(s, 22000);
    expect(r.chosen?.chainId).toBe('B');
    expect(r.reasons).not.toContain('CONTINUITY_HOLD');
    // Control: the same two fixes 2 s apart do hold A.
    const held = play(twoRoutes(), [fixEvent(fixAt(500, 0, 1000)), fixEvent(fixAt(500, 30, 3000))]);
    expect(currentResult(held, 3000).reasons).toContain('CONTINUITY_HOLD');
  });

  it('R12 (b): continuity does not resolve an ambiguity across a gap longer than staleAfterMs', () => {
    // A 5 m from the first fix, B 20 m: matched A. At the second fix both are 7.5 m away.
    const net = network({
      coverage: [coverageAround(ORIGIN, 5000)],
      chains: [
        straightChain('A', ORIGIN, 0, 2000, { sub: 'sub-A' }),
        straightChain('B', ORIGIN, 0, 2000, { sub: 'sub-B', lateralM: -15 }),
      ],
    });
    const first = fixEvent(fixAt(500, -5, 1000));
    const quick = currentResult(play(net, [first, fixEvent(fixAt(500, 7.5, 2000))]), 2000);
    expect(quick.status).toBe('MATCHED');
    expect(quick.reasons).toContain('CONTINUITY');
    const gap = currentResult(play(net, [first, fixEvent(fixAt(500, 7.5, 17001))]), 17001);
    expect(gap.status).toBe('AMBIGUOUS_ROUTE');
    expect(gap.reasons).toContain('MULTIPLE_ROUTES');
    expect(gap.reasons).not.toContain('CONTINUITY');
  });

  it('a non-matched result clears continuity', () => {
    const net = twoRoutes();
    // Matched A, then an off-network fix, then B's line: no hold, so B.
    const s = play(net, [
      fixEvent(fixAt(500, 0, 1000)),
      fixEvent(fixAt(500, 3000, 2000)),
      fixEvent(fixAt(500, 30, 3000)),
    ]);
    expect(currentResult(s, 3000).chosen?.chainId).toBe('B');
  });

  it('NO_FIX and NO_PERMISSION results ignore time; fixAgeMs is nowMs minus the fix time', () => {
    const net = oneChain();
    expect(currentResult(initialMatchState(net), 5e12).fixAgeMs).toBeNull();
    const s = play(net, [fixEvent(fixAt(500, 0, 1000))]);
    expect(currentResult(s, 1000).fixAgeMs).toBe(0);
    expect(currentResult(s, 8000).fixAgeMs).toBe(7000);
  });

  it('currentResult throws CoreInputError for a non-finite nowMs', () => {
    const s = initialMatchState(oneChain());
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(() => currentResult(s, bad)).toThrow(CoreInputError);
    }
  });
});

describe('locks', () => {
  const lockA: Lock = { kind: 'chain', chainId: 'A' };
  const lockB: Lock = { kind: 'chain', chainId: 'B' };

  it('lock then unlock re-evaluates the last fix immediately', () => {
    const net = twoRoutes();
    let s = play(net, [fixEvent(fixAt(500, 0, 1000))]);
    expect(currentResult(s, 1000).chosen?.chainId).toBe('A');
    const counted = s.ignoredFixes;

    // B is 30 m away, outside I (A at 0 m): the lock conflicts and is kept.
    s = reduce(s, { type: 'lock', lock: lockB }).state;
    const conflict = currentResult(s, 1000);
    expect(conflict.status).toBe('LOCK_CONFLICT');
    expect(conflict.lock).toEqual(lockB);
    expect(conflict.milepost).toBeNull();
    expect(conflict.chosen).toBeNull();
    expect(conflict.candidates.map((c) => c.chainId)).toEqual(['A']);
    expect(s.ignoredFixes).toBe(counted);

    // A fix on A's line with the lock on B: still a conflict, never a silent switch to A.
    s = reduce(s, fixEvent(fixAt(600, 0, 2000))).state;
    expect(currentResult(s, 2000)).toMatchObject({ status: 'LOCK_CONFLICT', lock: lockB });

    s = reduce(s, { type: 'unlock' }).state;
    const freed = currentResult(s, 2000);
    expect(freed.lock).toBeNull();
    expect(freed.status).toBe('MATCHED');
    expect(freed.chosen?.chainId).toBe('A');
    expect(s.ignoredFixes).toBe(counted);
  });

  it('a lock that matches is a user selection, and a new lock replaces the old one', () => {
    const net = twoRoutes();
    let s = play(net, [fixEvent(fixAt(500, 0, 1000)), { type: 'lock', lock: lockB }]);
    expect(currentResult(s, 1000).status).toBe('LOCK_CONFLICT');
    s = reduce(s, { type: 'lock', lock: lockA }).state;
    const r = currentResult(s, 1000);
    expect(r).toMatchObject({ status: 'MATCHED', selectionOrigin: 'user', lock: lockA });
    expect(r.chosen?.chainId).toBe('A');
  });

  it('a lock resolves a diamond', () => {
    const net = withDiamond(twoRoutes(), 'dia', 'A', 500);
    const s = play(net, [{ type: 'lock', lock: lockA }, fixEvent(fixAt(500, 0, 1000))]);
    expect(currentResult(s, 1000)).toMatchObject({ status: 'MATCHED', selectionOrigin: 'user' });
  });

  it('Result.lock shows the current lock in NO_FIX, NO_PERMISSION and STALE', () => {
    const net = oneChain();
    let s = reduce(initialMatchState(net), { type: 'lock', lock: lockA }).state;
    expect(currentResult(s, 0)).toMatchObject({ status: 'NO_FIX', lock: lockA });
    s = reduce(s, { type: 'permission', state: 'denied' }).state;
    expect(currentResult(s, 0)).toMatchObject({ status: 'NO_PERMISSION', lock: lockA });
    s = reduce(s, { type: 'unlock' }).state;
    expect(currentResult(s, 0).lock).toBeNull();
    s = reduce(s, { type: 'lock', lock: lockA }).state;
    s = reduce(s, { type: 'permission', state: 'granted' }).state;
    s = reduce(s, fixEvent(fixAt(500, 0, 1000))).state;
    const stale = currentResult(s, 1000 + 20000);
    expect(stale).toMatchObject({ status: 'STALE', lock: lockA });
    expect(stale.historical?.lock).toEqual(lockA);
    // A lock change while stale still shows in the stale view.
    const s2 = reduce(s, { type: 'unlock' }).state;
    expect(currentResult(s2, 21000)).toMatchObject({ status: 'STALE', lock: null });
  });
});

describe('purity and determinism', () => {
  const events: MatchEvent[] = [
    fixEvent(fixAt(500, 0, 1000)),
    { type: 'lock', lock: { kind: 'chain', chainId: 'B' } },
    fixEvent(fixAt(520, 30, 2000)),
    fixEvent(fixAt(520, 30, 1500)),
    { type: 'locationError', code: 'TIMEOUT' },
    { type: 'unlock' },
    fixEvent(fixAt(540, 30, 3000)),
    { type: 'permission', state: 'denied' },
    { type: 'permission', state: 'granted' },
  ];

  it('reduce never mutates its input state', () => {
    const net = twoRoutes();
    let s = initialMatchState(net);
    for (const e of events) {
      const snapshot = structuredClone(s);
      const eventSnapshot = structuredClone(e);
      const next = reduce(s, e).state;
      expect(s).toEqual(snapshot);
      expect(e).toEqual(eventSnapshot);
      s = next;
    }
  });

  it('the same events give deep-equal results', () => {
    const a = events.map((_, i) => currentResult(play(twoRoutes(), events.slice(0, i + 1)), 4000));
    const b = events.map((_, i) => currentResult(play(twoRoutes(), events.slice(0, i + 1)), 4000));
    expect(a).toEqual(b);
  });

  it('states and results are frozen', () => {
    const s = play(oneChain(), [fixEvent(fixAt(500, 0, 1000))]);
    expect(Object.isFrozen(s)).toBe(true);
    expect(Object.isFrozen(currentResult(s, 1000))).toBe(true);
  });
});

describe('result invariants (property)', () => {
  const net = withDiamond(
    network({
      coverage: [coverageAround(ORIGIN, 600)],
      chains: [
        straightChain('A', ORIGIN, 0, 1000, { sub: 'sub-A' }),
        straightChain('B', ORIGIN, 0, 1000, { sub: 'sub-B', lateralM: -20 }),
        straightChain('C', ORIGIN, 0, 1000, { sub: 'sub-A', lateralM: 4 }),
        straightChain('D', ORIGIN, 0, 1000, { sub: 'sub-D', lateralM: 120 }),
      ],
      segments: [siding('sd', ORIGIN, 200, 600, { lateralM: -40 })],
      intervals: [
        interval('iA', 'A', [
          { s: 0, mp: 0 },
          { s: 400, mp: 0.25 },
        ]),
        interval('iC', 'C', [
          { s: 0, mp: 0 },
          { s: 1000, mp: 0.62 },
        ]),
        interval('iB', 'B', [
          { s: 100, mp: 5, tier: 'unverified' },
          { s: 900, mp: 5.5 },
        ]),
      ],
    }),
    'dia',
    'B',
    800,
  );

  const fixArb = fc.record({
    east: fc.double({ min: -300, max: 1300, noNaN: true }),
    north: fc.double({ min: -200, max: 200, noNaN: true }),
    accuracy: fc.double({ min: 0, max: 60, noNaN: true }),
    dt: fc.integer({ min: 1, max: 30000 }),
  });
  const lockArb = fc.constantFrom<Lock | null>(
    null,
    { kind: 'chain', chainId: 'A' },
    { kind: 'chain', chainId: 'B' },
    { kind: 'subdivision', subdivisionNid: 'sub-A' },
    { kind: 'subdivision', subdivisionNid: 'nope' },
  );

  function check(r: Result, accuracyM: number | null): void {
    if (r.milepost !== null) {
      expect(r.status).toBe('MATCHED');
    }
    if (r.mpRange !== null) {
      expect(r.status).toBe('MATCHED_SUBDIVISION');
      expect(r.mpRange.lowerMp).toBeLessThanOrEqual(r.mpRange.upperMp);
    }
    if (r.chosen !== null || r.s !== null) {
      expect(r.status).toBe('MATCHED');
    }
    expect(r.accuracyM).toBe(accuracyM);
    expect(r.datasetVersion).toBe('test-1');
    if (r.status === 'STALE') {
      expect(r.historical).not.toBeNull();
    } else {
      expect(r.historical).toBeNull();
    }
    // No NaN anywhere in the serialised result (JSON turns NaN into null, so scan the tree).
    const scan = (v: unknown): void => {
      if (typeof v === 'number') {
        expect(Number.isNaN(v)).toBe(false);
      } else if (typeof v === 'object' && v !== null) {
        Object.values(v).forEach(scan);
      }
    };
    scan(r);
  }

  const stepArb = fc.oneof(
    fc.record({ kind: fc.constant('fix' as const), f: fixArb }),
    fc.record({ kind: fc.constant('invalid' as const), f: fixArb, which: fc.nat(3) }),
    fc.record({ kind: fc.constant('old' as const), f: fixArb }),
    fc.record({ kind: fc.constant('lock' as const), lock: lockArb }),
    fc.record({ kind: fc.constant('perm' as const), granted: fc.boolean() }),
    fc.record({ kind: fc.constant('err' as const) }),
  );

  it('holds over random fix, lock, permission, error, invalid and old-fix sequences', () => {
    fc.assert(
      fc.property(
        fc.array(stepArb, { minLength: 1, maxLength: 16 }),
        fc.integer({ min: -60000, max: 60000 }),
        (steps, lagMs) => {
          let s = initialMatchState(net);
          let t = 1000;
          let expectedAccuracy: number | null = null;
          for (const step of steps) {
            if (step.kind === 'fix') {
              t += step.f.dt;
              const fix = fixAt(step.f.east, step.f.north, t, step.f.accuracy);
              const r = reduce(s, fixEvent(fix));
              if (r.ignored === null) {
                expectedAccuracy = fix.accuracyM;
              }
              s = r.state;
            } else if (step.kind === 'invalid') {
              const good = fixAt(step.f.east, step.f.north, t + 1, step.f.accuracy);
              const bad = [
                { ...good, lat: NaN },
                { ...good, accuracyM: -1 },
                { ...good, lon: 10 },
                { ...good, speedMps: Infinity },
              ][step.which] as Fix;
              const r = reduce(s, fixEvent(bad));
              expect(r.ignored).toBe('FIX_IGNORED_INVALID');
              s = r.state;
            } else if (step.kind === 'old') {
              // t=500 is older than any fix after the first; as the very first fix it is valid.
              const fix = fixAt(step.f.east, step.f.north, 500, step.f.accuracy);
              const first = s.lastFixTimestampMs === null && s.permission === 'granted';
              const r = reduce(s, fixEvent(fix));
              expect(r.ignored === null).toBe(first);
              if (first) {
                expectedAccuracy = fix.accuracyM;
              }
              s = r.state;
            } else if (step.kind === 'lock') {
              s = reduce(
                s,
                step.lock === null ? { type: 'unlock' } : { type: 'lock', lock: step.lock },
              ).state;
            } else if (step.kind === 'perm') {
              s = reduce(s, {
                type: 'permission',
                state: step.granted ? 'granted' : 'denied',
              }).state;
              if (s.lastFix === null) {
                expectedAccuracy = null;
              }
            } else {
              s = reduce(s, { type: 'locationError', code: 'TIMEOUT' }).state;
            }
            check(currentResult(s, t), expectedAccuracy);
            check(currentResult(s, t + lagMs), expectedAccuracy);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});
