import { describe, expect, it } from 'vitest';
import { LOCK_FLAG_KEY, lockFlagIn } from '../../src/logic/lockFlag.js';
import { blocked, memoryStorage } from './storage.js';

describe('lock flag', () => {
  it('stores one boolean, with no route id or coordinates, and removes it on clear', () => {
    const store = memoryStorage();
    const flag = lockFlagIn(store);
    flag.set();
    expect(store.data).toEqual({ [LOCK_FLAG_KEY]: '1' });
    expect(LOCK_FLAG_KEY).toBe('cantre.lockWasSet');
    flag.clear();
    expect(store.data).toEqual({});
  });

  it('consume reads and removes the flag, once', () => {
    const store = memoryStorage({ [LOCK_FLAG_KEY]: '1' });
    const flag = lockFlagIn(store);
    expect(flag.consume()).toBe(true);
    expect(store.data).toEqual({});
    expect(flag.consume()).toBe(false);
  });

  it('never throws when storage is blocked or missing', () => {
    for (const store of [blocked, null]) {
      const flag = lockFlagIn(store);
      expect(() => {
        flag.set();
        flag.clear();
      }).not.toThrow();
      expect(flag.consume()).toBe(false);
    }
  });
});
