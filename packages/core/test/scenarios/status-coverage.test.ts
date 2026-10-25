import { readdirSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { MATCH_REASONS, MATCH_STATUSES } from '../../src/index.js';
import type { MatchReason, MatchStatus } from '../../src/index.js';
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

  it('the hand-maintained ALL list covers every *.scenarios.ts file in this folder', () => {
    const files = readdirSync(new URL('./', import.meta.url))
      .filter((f) => f.endsWith('.scenarios.ts'))
      .sort();
    const imported = [coverage, diamond, doubleTrack, golden, junction, lifecycle, parallel];
    expect(files).toHaveLength(imported.length);
    expect(ALL).toHaveLength(imported.flat().length);
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

/**
 * Reason-code coverage guard: every code of the closed MatchReason vocabulary is produced by at
 * least one scenario replay, either in a result's `reasons` or as `reduce`'s `ignored` reason
 * (FIX_IGNORED_*). Each replayed step has already asserted its exact reason list where it states
 * one, so every code is reachable through the public reducer, not only in unit tests.
 */
describe('scenario replays cover every reason code', () => {
  const seen = new Set<MatchReason>();
  beforeAll(() => {
    for (const sc of ALL) {
      const { results, ignored } = replay(sc.net, sc.steps);
      for (const r of results) {
        r.reasons.forEach((x) => seen.add(x));
      }
      ignored.forEach((x) => seen.add(x));
    }
  });

  it.each([...MATCH_REASONS])('produces %s in at least one scenario', (reason) => {
    expect(seen.has(reason)).toBe(true);
  });
});
