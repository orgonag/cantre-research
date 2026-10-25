import { describe, expect, it } from 'vitest';
import { MATCH_CONFIG } from '@cantre/core';
import type { Fix, NetworkView } from '@cantre/core';
import { createSession } from '../../src/logic/session.js';
import type { LockFlag } from '../../src/logic/session.js';

const emptyNet = (datasetVersion: string): NetworkView => ({
  datasetVersion,
  coverage: [],
  chains: [],
  segments: [],
  intervals: [],
  diamonds: [],
  assets: [],
});

const T0 = 1_700_000_000_000;
const fix = (timestampMs: number): Fix => ({ lat: 52.1, lon: -106.6, timestampMs, accuracyM: 10 });

const lockedChain = { kind: 'chain', chainId: 'C1' } as const;

describe('createSession', () => {
  it('starts with no fix, no lock and no update notice', () => {
    const s = createSession(emptyNet('v1'), 'v1');
    expect(s.state.datasetVersion).toBe('v1');
    expect(s.state.lock).toBeNull();
    expect(s.state.lockClearedByUpdate).toBe(false);
    expect(s.result(T0).status).toBe('NO_FIX');
  });

  it('shows STALE (historical) 16 s after the last fix, never a fresh match (Review Focus 3)', () => {
    const s = createSession(emptyNet('v1'), 'v1');
    s.dispatch({ type: 'fix', fix: fix(T0) });
    expect(s.result(T0 + 1000).status).not.toBe('STALE');
    const resumed = s.result(T0 + 16_000);
    expect(resumed.status).toBe('STALE');
    expect(resumed.reasons).toContain('FIX_STALE');
    expect(resumed.fixAgeMs).toBeGreaterThan(MATCH_CONFIG.staleAfterMs);
    expect(resumed.historical).not.toBeNull();
  });

  it('reports an ignored fix (out of order) and counts it', () => {
    const s = createSession(emptyNet('v1'), 'v1');
    expect(s.dispatch({ type: 'fix', fix: fix(T0) })).toBeNull();
    expect(s.dispatch({ type: 'fix', fix: fix(T0 - 5) })).toBe('FIX_IGNORED_OUT_OF_ORDER');
    expect(s.state.ignoredFixes).toBe(1);
  });

  it('gives NO_PERMISSION after a denial', () => {
    const s = createSession(emptyNet('v1'), 'v1');
    s.dispatch({ type: 'permission', state: 'denied' });
    expect(s.result(T0).status).toBe('NO_PERMISSION');
    expect(s.result(T0).reasons).toContain('PERMISSION_DENIED');
  });

  it('keeps a lock within a session, by lock() and by a lock event', () => {
    const s = createSession(emptyNet('v1'), 'v1');
    s.dispatch({ type: 'fix', fix: fix(T0) });
    s.lock(lockedChain);
    expect(s.state.lock).toEqual(lockedChain);
    s.dispatch({ type: 'fix', fix: fix(T0 + 1000) });
    expect(s.state.lock).toEqual(lockedChain);
    s.unlock();
    expect(s.state.lock).toBeNull();
    s.dispatch({ type: 'lock', lock: lockedChain });
    expect(s.state.lock).toEqual(lockedChain);
    s.dispatch({ type: 'unlock' });
    expect(s.state.lock).toBeNull();
  });

  it('keeps all state when the same dataset version is replaced (P7)', () => {
    const s = createSession(emptyNet('v1'), 'v1');
    s.dispatch({ type: 'fix', fix: fix(T0) });
    s.lock(lockedChain);
    s.replaceNetwork(emptyNet('v1'), 'v1');
    expect(s.state.lock).toEqual(lockedChain);
    expect(s.state.lockClearedByUpdate).toBe(false);
    expect(s.state.lastFix).not.toBeNull();
  });

  it('clears the lock visibly when the dataset version changes (Review Focus 5)', () => {
    const s = createSession(emptyNet('v1'), 'v1');
    s.dispatch({ type: 'fix', fix: fix(T0) });
    s.lock(lockedChain);
    s.replaceNetwork(emptyNet('v2'), 'v2');
    expect(s.state.lock).toBeNull();
    expect(s.state.lockClearedByUpdate).toBe(true);
    expect(s.state.datasetVersion).toBe('v2');
    expect(s.state.lastFix).toBeNull();
    expect(s.result(T0).datasetVersion).toBe('v2');
    // The notice goes when the user makes a new choice.
    s.lock(lockedChain);
    expect(s.state.lockClearedByUpdate).toBe(false);
  });

  it('starts fresh on a new version without a notice when no lock was set', () => {
    const s = createSession(emptyNet('v1'), 'v1');
    s.dispatch({ type: 'fix', fix: fix(T0) });
    s.replaceNetwork(emptyNet('v2'), 'v2');
    expect(s.state.lockClearedByUpdate).toBe(false);
    expect(s.state.lastFix).toBeNull();
  });

  it('lets the user dismiss the update notice', () => {
    const s = createSession(emptyNet('v1'), 'v1');
    s.lock(lockedChain);
    s.replaceNetwork(emptyNet('v2'), 'v2');
    s.dismissNotice();
    expect(s.state.lockClearedByUpdate).toBe(false);
  });

  it('keeps a pending "lock cleared" notice through a second version change (until dismissed)', () => {
    const s = createSession(emptyNet('v1'), 'v1');
    s.lock(lockedChain);
    s.replaceNetwork(emptyNet('v2'), 'v2');
    expect(s.state.lockClearedByUpdate).toBe(true);
    s.replaceNetwork(emptyNet('v3'), 'v3');
    expect(s.state.lockClearedByUpdate).toBe(true);
    s.dismissNotice();
    expect(s.state.lockClearedByUpdate).toBe(false);
  });

  it('mirrors "a lock is set" to the flag, and only that', () => {
    const calls: string[] = [];
    const flag: LockFlag = { set: () => calls.push('set'), clear: () => calls.push('clear') };
    const s = createSession(emptyNet('v1'), 'v1', flag);
    s.lock(lockedChain);
    s.unlock();
    s.lock(lockedChain);
    s.replaceNetwork(emptyNet('v2'), 'v2');
    expect(calls).toEqual(['set', 'clear', 'set', 'clear']);
  });
});
