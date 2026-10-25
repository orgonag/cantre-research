import { beforeAll, describe, expect, it } from 'vitest';
import { MATCH_STATUSES } from '../../src/index.js';
import type { MatchStatus } from '../../src/index.js';
import { scenarios as coverage } from './coverage.scenarios.js';
import { scenarios as diamond } from './diamond.scenarios.js';
import { scenarios as doubleTrack } from './double-track.scenarios.js';
import { scenarios as golden } from './golden-tiles.scenarios.js';
import { replay } from './harness.js';
import type { Scenario } from './harness.js';
import { scenarios as junction } from './junction.scenarios.js';
import { scenarios as lifecycle } from './lifecycle.scenarios.js';
import { scenarios as parallel } from './parallel-class1.scenarios.js';

/**
 * Spec §13 done-when for M3: "every status in §6 is reachable and asserted by scenario replays".
 *
 * Each scenario file exports its scenarios; this test replays all of them (so it does not depend
 * on test-file ordering or on module state surviving Vitest's per-file isolation) and takes the
 * union of the statuses seen. `replay` has already asserted the exact status of every step, so a
 * status in the union is both reached and asserted. The scenarios are synthetic replays and
 * committed golden tiles, not field traces.
 */
const ALL: readonly Scenario[] = [
  ...diamond,
  ...parallel,
  ...doubleTrack,
  ...junction,
  ...lifecycle,
  ...coverage,
  ...golden,
];

describe('scenario replays cover every match status', () => {
  const seen = new Set<MatchStatus>();
  beforeAll(() => {
    for (const sc of ALL) {
      for (const status of replay(sc.net, sc.steps).statuses) {
        seen.add(status);
      }
    }
  });

  it('reaches all nine statuses of spec §6', () => {
    expect(MATCH_STATUSES).toHaveLength(9);
    expect([...seen].sort()).toEqual([...MATCH_STATUSES].sort());
  });

  it.each(MATCH_STATUSES)('reaches %s in at least one scenario', (status) => {
    expect(seen.has(status)).toBe(true);
  });

  it('replays are deterministic: a second replay gives deep-equal results', () => {
    for (const sc of ALL) {
      const a = replay(sc.net, sc.steps).results;
      const b = replay(sc.net, sc.steps).results;
      expect(b, sc.name).toEqual(a);
    }
  });
});
