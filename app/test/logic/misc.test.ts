import { describe, expect, it, vi } from 'vitest';
import { CoreInputError } from '@cantre/core';
import { DataClientError } from '@cantre/data-client';
import { errorCode } from '../../src/logic/errorCode.js';
import { onResume } from '../../src/logic/visibility.js';
import type { VisibilityDoc } from '../../src/logic/visibility.js';

describe('errorCode', () => {
  it('reads the code of a data-client or core error, and falls back for anything else', () => {
    expect(errorCode(new DataClientError('HASH_MISMATCH'))).toBe('HASH_MISMATCH');
    expect(errorCode(new CoreInputError('NON_FINITE', 'x'))).toBe('NON_FINITE');
    expect(errorCode(new Error('boom'))).toBe('UNEXPECTED');
    expect(errorCode('text')).toBe('UNEXPECTED');
    expect(errorCode(null)).toBe('UNEXPECTED');
  });
});

describe('onResume', () => {
  function fakeDoc(): {
    doc: VisibilityDoc;
    fire: (s: 'visible' | 'hidden') => void;
    size: () => number;
  } {
    const handlers = new Set<() => void>();
    let state: 'visible' | 'hidden' = 'hidden';
    const doc: VisibilityDoc = {
      get visibilityState() {
        return state;
      },
      addEventListener: (_type, h) => {
        handlers.add(h);
      },
      removeEventListener: (_type, h) => {
        handlers.delete(h);
      },
    };
    return {
      doc,
      fire: (s) => {
        state = s;
        handlers.forEach((h) => {
          h();
        });
      },
      size: () => handlers.size,
    };
  }

  it('calls back only when the page becomes visible, and can be stopped', () => {
    const f = fakeDoc();
    const cb = vi.fn();
    const stop = onResume(f.doc, cb);
    f.fire('hidden');
    expect(cb).not.toHaveBeenCalled();
    f.fire('visible');
    expect(cb).toHaveBeenCalledTimes(1);
    stop();
    f.fire('visible');
    expect(cb).toHaveBeenCalledTimes(1);
    expect(f.size()).toBe(0);
  });
});
