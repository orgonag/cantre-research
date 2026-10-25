import { browserSessionStorage } from './settings.js';
import type { StorageLike } from './settings.js';

/**
 * The "a lock was set" flag behind D6's "Lock cleared on reload" notice (ruling P8).
 *
 * One sessionStorage boolean, key `cantre.lockWasSet`. It holds no route id and no coordinates:
 * only that a lock existed. It is set while a lock is active, removed on unlock, and read and
 * removed once at start-up to decide whether to show the notice. All access is in try/catch.
 */
export const LOCK_FLAG_KEY = 'cantre.lockWasSet';

export type LockFlagStore = {
  set(): void;
  clear(): void;
  /** Read the flag and remove it. True when a lock was set before this page load. */
  consume(): boolean;
};

export function lockFlagIn(storage: StorageLike | null = browserSessionStorage()): LockFlagStore {
  return {
    set() {
      try {
        storage?.setItem(LOCK_FLAG_KEY, '1');
      } catch {
        // Storage blocked: the notice is simply not shown after a reload.
      }
    },
    clear() {
      try {
        storage?.removeItem(LOCK_FLAG_KEY);
      } catch {
        // Nothing to remove if storage is blocked.
      }
    },
    consume() {
      try {
        const was = storage?.getItem(LOCK_FLAG_KEY) === '1';
        storage?.removeItem(LOCK_FLAG_KEY);
        return was;
      } catch {
        return false;
      }
    },
  };
}
