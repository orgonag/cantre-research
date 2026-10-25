import type { StorageLike } from '../../src/logic/settings.js';

/** An in-memory Storage for tests. `data` exposes exactly what was stored. */
export function memoryStorage(
  initial: Record<string, string> = {},
): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
    removeItem: (k) => {
      Reflect.deleteProperty(data, k);
    },
  };
}

/** A Storage that throws on every call, like a private window or blocked site data. */
export const blocked: StorageLike = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
};
