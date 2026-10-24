import { describe, expect, it } from 'vitest';
import { CoreInputError, milesToKilometres } from '../src/index.js';

describe('CoreInputError', () => {
  it('defaults the message to the code and sets name and code', () => {
    const e = new CoreInputError('EMPTY_POLYLINE');
    expect(e.message).toBe('EMPTY_POLYLINE');
    expect(e.name).toBe('CoreInputError');
    expect(e.code).toBe('EMPTY_POLYLINE');
    expect(e).toBeInstanceOf(Error);
  });

  it('keeps an explicit message', () => {
    expect(new CoreInputError('NON_FINITE', 'detail').message).toBe('detail');
  });
});

describe('milesToKilometres', () => {
  it('rejects non-finite input', () => {
    expect(() => milesToKilometres(Number.NaN)).toThrow(
      expect.objectContaining({ code: 'NON_FINITE' }),
    );
  });
});
