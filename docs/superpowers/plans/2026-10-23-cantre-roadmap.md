# CANTRE v1 — plan roadmap

**Spec:** [2026-10-23-cantre-v1-design.md](../specs/2026-10-23-cantre-v1-design.md)

The spec covers six milestones that are separate subsystems. Each milestone gets its own
plan, written when the previous milestone is merged, so that every plan is grounded in
code that exists. Each plan produces working, tested software on its own. This page pins
the contracts that cross milestone boundaries, so the plans agree with each other.

| # | Plan | Builds | Status |
|---|---|---|---|
| M1 | [Calculation core](2026-10-23-m1-calculation-core.md) | Monorepo, CI, `@cantre/core` geodesy, projection, polyline and interpolation | Merged (PR #4) |
| M2 | [Pipeline: one province (SK)](2026-10-24-m2-pipeline-sk.md) | `pipeline/` ingest, audit, chains, anchors, tiles, manifest, coverage report | Merged (PR #6) |
| M3 | [Matching state machine](2026-10-25-m3-matching.md) | `@cantre/core` `network/` and `match/`, synthetic scenario replays | Merged (PR #9) |
| M4 | [National app and public site](2026-10-25-m4-national-app.md) | All NRWN provinces, province bundles, `@cantre/data-client`, `app/`, Playwright, privacy and axe tests, GitHub Pages deploy | Planned |
| M5 | Evaluation | `eval/`, EVALUATION.md, datum study, cross-border chains, threshold tuning | Plan after M4 |
| M6 | Methods and release kit | METHODS.md, release files | Plan after M5 |

## Cross-milestone contracts

These names and shapes are fixed here. A later plan may extend them but must not rename them.

- **Coordinates:** `LatLon = { lat: number; lon: number }`, decimal degrees, NAD83(CSRS)
  for data and WGS 84 for fixes. v1 treats both as the same frame (spec §3, datum note).
- **Units:** distances along track and residuals are metres (`…M` suffix). Mileposts are
  miles (`mp`), because NRWN publishes miles. `METRES_PER_MILE = 1609.344`.
- **Chain position:** `s`, metres from the chain's first vertex (`alongM` in M1 functions).
- **Anchor:** `{ id: string; s: number; mp: number; source: AnchorSource }`, where
  `AnchorSource = 'crossing' | 'station' | 'structure' | 'markerpost'`. M1 defines it, M2
  produces it and M3 consumes it. Extended on 2026-10-24 with `tier: AnchorTier`, where
  `AnchorTier = 'posted' | 'tc' | 'unverified'` (spec §3). M2 writes it into tiles. M3 adds
  it to core's `Anchor`, and every result reports the lower tier of its bracketing anchors.
- **Calibrated interval:** an array of anchors sorted by `s` with strictly monotonic `mp`,
  never crossing a discontinuity (spec §5.5).
- **Milepost result:** M1's `MilepostResult` is reused unchanged inside M3's `Result`.
- **Reason codes:** `SCREAMING_SNAKE_CASE` string literals, each with EN and FR message
  keys from M4 onward. Thresholds live in a single exported config object labelled
  experimental (spec §6).
- **Tile and manifest schema:** built in M2 as JSON Schemas in
  [`pipeline/schema/`](../../../pipeline/schema/) (`cantre.tile/1`, `cantre.manifest/1`), decoded in M3 by
  `@cantre/core` (`src/network/`: `networkFromTiles`, a pure decoder, with its TypeScript types) and
  reused by `@cantre/data-client` (M4), which fetches, caches and version-pins tiles (M3 Decision 1).
