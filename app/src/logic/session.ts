import { currentResult, initialMatchState, reduce } from '@cantre/core';
import type { Lock, MatchEvent, MatchReason, MatchState, NetworkView, Result } from '@cantre/core';

/**
 * The matcher session: one `MatchState` plus the dataset version it was built for.
 *
 * The session is the app's only holder of matcher state. It keeps the state in memory only;
 * no fix, trace or route id is stored anywhere.
 */

/** What the session tells the outside about "a lock is set" (ruling P8): a boolean, nothing more. */
export type LockFlag = { readonly set: () => void; readonly clear: () => void };

/**
 * Read-only view of the session: every `MatchState` field, plus the dataset version in use and
 * `lockClearedByUpdate` (true after a dataset change removed the user's lock; Review Focus 5).
 */
export type SessionState = MatchState & {
  readonly datasetVersion: string;
  readonly lockClearedByUpdate: boolean;
};

export type Session = {
  /** The current state; a new object after every change. */
  readonly state: SessionState;
  /** Apply an event. Returns why a fix was ignored, or null. `lock`/`unlock` events work too. */
  dispatch(event: MatchEvent): MatchReason | null;
  /** The result at `nowMs` (epoch ms): a fix older than the stale limit reads as `STALE`. */
  result(nowMs: number): Result;
  lock(lock: Lock): void;
  unlock(): void;
  /**
   * Use a newly loaded network. The same `datasetVersion` keeps all state. A different one
   * starts a fresh match state (no old fix, no old route lock); if a lock was set, the session
   * sets `lockClearedByUpdate` so the app can say so. No lock is ever migrated (D6).
   */
  replaceNetwork(net: NetworkView, datasetVersion: string): void;
  /** Hide the "lock cleared by update" notice. */
  dismissNotice(): void;
};

export function createSession(
  net: NetworkView,
  datasetVersion: string,
  lockFlag?: LockFlag,
): Session {
  let match = initialMatchState(net);
  let version = datasetVersion;
  let clearedByUpdate = false;
  let snapshot: SessionState | null = null;
  let flagged = false;

  const view = (): SessionState => {
    snapshot ??= Object.freeze({
      ...match,
      datasetVersion: version,
      lockClearedByUpdate: clearedByUpdate,
    });
    return snapshot;
  };
  const changed = (): void => {
    snapshot = null;
    // Tell the flag only when "a lock is set" changes, not on every fix.
    const hasLock = match.lock !== null;
    if (hasLock !== flagged) {
      flagged = hasLock;
      if (hasLock) {
        lockFlag?.set();
      } else {
        lockFlag?.clear();
      }
    }
  };

  const apply = (event: MatchEvent): MatchReason | null => {
    if (event.type === 'lock') {
      clearedByUpdate = false; // a new choice replaces the notice
    }
    const { state, ignored } = reduce(match, event);
    match = state;
    changed();
    return ignored;
  };

  return {
    get state() {
      return view();
    },
    dispatch: apply,
    result: (nowMs) => currentResult(match, nowMs),
    lock: (lock) => {
      apply({ type: 'lock', lock });
    },
    unlock: () => {
      apply({ type: 'unlock' });
    },
    replaceNetwork(nextNet, nextVersion) {
      if (nextVersion === version) {
        return;
      }
      // `||=`: a pending notice survives a second version change; only a new lock choice or
      // `dismissNotice` removes it.
      clearedByUpdate ||= match.lock !== null;
      match = initialMatchState(nextNet);
      version = nextVersion;
      changed();
    },
    dismissNotice() {
      clearedByUpdate = false;
      snapshot = null;
    },
  };
}
