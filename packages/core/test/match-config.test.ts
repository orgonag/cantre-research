import { describe, expect, it } from 'vitest';
import { MATCH_CONFIG, MATCH_REASONS, MATCH_STATUSES } from '../src/index.js';

describe('MATCH_CONFIG', () => {
  it('holds the spec defaults and is frozen', () => {
    expect(MATCH_CONFIG).toMatchObject({
      searchRadiusMinM: 50,
      searchRadiusAccuracyFactor: 3,
      indistinguishableMinM: 10,
      staleAfterMs: 15000,
      headingMinSpeedMps: 3,
      headingToleranceDeg: 30,
      continuityMaxMs: 5000,
      futureFixToleranceMs: 1000,
    });
    expect(Object.isFrozen(MATCH_CONFIG)).toBe(true);
  });
});

describe('closed vocabularies', () => {
  it('MATCH_REASONS lists every code once', () => {
    expect(new Set(MATCH_REASONS).size).toBe(MATCH_REASONS.length);
    expect(MATCH_REASONS).toHaveLength(24);
    for (const r of MATCH_REASONS) expect(r).toMatch(/^[A-Z][A-Z_]+$/);
  });

  it('MATCH_STATUSES lists the nine spec statuses once', () => {
    expect(MATCH_STATUSES).toHaveLength(9);
    expect(new Set(MATCH_STATUSES).size).toBe(9);
  });
});
