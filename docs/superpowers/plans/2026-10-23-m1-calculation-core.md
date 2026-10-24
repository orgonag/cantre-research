# M1 Calculation Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the monorepo, CI and the `@cantre/core` package. The package covers
ellipsoidal distance, projecting a point onto a segment and onto a polyline, and milepost
interpolation between qualified anchors, all tested against the spec's acceptance cases
and GeographicLib.

**Architecture:** An npm-workspaces monorepo. `packages/core` is a pure TypeScript library
with zero runtime dependencies: no DOM, no network, no storage. Each file has one
responsibility (units, ellipsoid, local geometry, segment projection, polyline,
interpolation, uncertainty). Domain outcomes such as "uncalibrated" are returned as
discriminated unions. Invalid input throws `CoreInputError` with a reason code.

**Tech Stack:** Node 24 in CI (≥ 22.12 locally), TypeScript 6.0.3, Vitest 5.0.5 with
@vitest/coverage-v8 5.0.5, fast-check 4.10.2, geographiclib-geodesic 2.2.0 (dev only),
ESLint 10.13.0 with typescript-eslint 8.72.0 and @eslint/js 10.0.1, Prettier 3.9.10.
TypeScript 7 is excluded because typescript-eslint 8.72 supports TypeScript < 6.1.

**Spec:** [2026-10-23-cantre-v1-design.md](../specs/2026-10-23-cantre-v1-design.md)
(§6 Calculation core, §9 Testing), with the acceptance cases in
[ACCEPTANCE.md](../../ACCEPTANCE.md) and the worked math in
[PROJECTION.md](../../PROJECTION.md). Cross-milestone names are in the
[roadmap](2026-10-23-cantre-roadmap.md).

## Global Constraints

- Ellipsoid: GRS80, `a = 6378137` m, `f = 1/298.257222101`.
- `METRES_PER_MILE = 1609.344` (exact). Mileposts are in miles; distances and residuals in
  metres, with a `M` suffix on every metre-valued name.
- Geodesy target: local-plane segment length within **1 mm** of the GeographicLib geodesic
  for segments ≤ 2 km, anywhere in lat 41.5°–83.5°, lon −141°–−52°.
- Segments longer than 2 km are subdivided **for distance only**; no vertices are added to
  the geometry.
- Never return `NaN` or `Infinity` as a usable value. Non-finite input throws
  `CoreInputError`.
- A null or uncalibrated milepost is never zero. A valid milepost of `0` is kept as `0`.
- Never extrapolate beyond the outer anchors. Never interpolate across an invalid interval.
- `@cantre/core` has zero runtime dependencies.
- Every exported function has a doc comment giving its formula, units, source (a spec
  section or doc) and limits. Every non-obvious line of maths has a comment.
- Files use LF line endings (`.gitattributes`). Code licence: MIT, copyright "2026 Orgo
  (orgonag) and CANTRE contributors".
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A fix exactly on a shared vertex** between two segments must give one along-chain
   value, the same from either segment, with no jump. Test in Task 4.
2. **Arctic latitudes** up to 83.5° (Nunavut, northern NWT) shrink the longitude scale; the
   1 mm geodesy target must still hold there. Test in Task 2.
3. **Two anchors at the same position** with different mileposts must be rejected
   (`DUPLICATE_POSITION`), not divided by zero. Test in Task 5.
4. **A fix several kilometres from the track** must still give a finite, correct cross-track
   distance: within 0.1 % of the geodesic distance to the projected point at 5 km. Test in
   Task 3.
5. **Swapped or mis-signed coordinates** (lat/lon reversed, or longitude entered positive
   west) are a common data error. They must be rejected by the range checks, not silently
   placed off Africa or in Asia. Test in Task 2.

---

### Task 1: Monorepo scaffold, units and CI

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `tsconfig.json`, `vitest.config.ts`, `eslint.config.js`,
  `.prettierrc.json`, `.prettierignore`, `.editorconfig`, `.gitattributes`, `.gitignore`,
  `.nvmrc` (`24`), `LICENSE`, `.github/workflows/ci.yml`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`,
  `packages/core/vitest.config.ts`, `packages/core/src/index.ts`,
  `packages/core/src/units.ts`, `packages/core/src/errors.ts`
- Test: `packages/core/test/units.test.ts`

**Interfaces:**
- Produces: `METRES_PER_MILE: 1609.344`; `milesToMetres(mi: number): number`;
  `metresToMiles(m: number): number`; `milesToKilometres(mi: number): number`;
  `class CoreInputError extends Error { readonly code: CoreInputCode }`;
  `type CoreInputCode = 'NON_FINITE' | 'LAT_OUT_OF_RANGE' | 'LON_OUT_OF_RANGE' |
  'OUTSIDE_CANADA_ENVELOPE' | 'EMPTY_POLYLINE' | 'ZERO_LENGTH_POLYLINE' |
  'INVALID_INTERVAL' | 'NEGATIVE_ACCURACY'`.
- Root scripts: `lint` (`eslint .`), `format:check` (`prettier --check .`), `typecheck`
  (`tsc -b`), `test` (`vitest run`), `coverage` (`vitest run --coverage`). The root `vitest.config.ts`
  sets `test.projects: ['packages/*']`.

- [ ] **Step 1: Scaffold the workspace.** Root `package.json` is `"private": true` with
  `"workspaces": ["packages/*"]`, `"engines": {"node": ">=22.12"}`, the scripts above and
  the dev dependencies at the pinned versions. `tsconfig.base.json` sets `strict`,
  `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `target: ES2023`,
  `module`/`moduleResolution: NodeNext`, `declaration`, `sourceMap`. The core
  `package.json` is `@cantre/core`, `"type": "module"`, `"license": "MIT"`, with
  `exports` pointing at `dist/index.js` and its types, and `build: tsc -p .`.
  `.gitattributes` holds `* text=auto eol=lf`. `LICENSE` is the standard MIT text with the
  copyright line from Global Constraints. Run `npm install` to create `package-lock.json`.

- [ ] **Step 2: Write the failing test** `packages/core/test/units.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { METRES_PER_MILE, metresToMiles, milesToKilometres, milesToMetres, CoreInputError } from '../src/index.js';

describe('units', () => {
  it('uses the exact international mile', () => expect(METRES_PER_MILE).toBe(1609.344));
  it('round-trips miles and metres', () => {
    expect(milesToMetres(112.43)).toBeCloseTo(180938.54592, 6);
    expect(metresToMiles(milesToMetres(112.43))).toBeCloseTo(112.43, 12);
  });
  it('converts miles to kilometres', () => expect(milesToKilometres(1)).toBe(1.609344));
  it('keeps zero as zero', () => expect(metresToMiles(0)).toBe(0));
  it('rejects non-finite input', () => {
    expect(() => milesToMetres(Number.NaN)).toThrowError(CoreInputError);
    expect(() => metresToMiles(Infinity)).toThrow(expect.objectContaining({ code: 'NON_FINITE' }));
  });
});
```

- [ ] **Step 3: Run it to verify it fails.** Run `npm test`. Expected: FAIL, cannot resolve
  `../src/index.js` exports.

- [ ] **Step 4: Implement** `units.ts` (the three conversions and the constant; each throws
  `CoreInputError('NON_FINITE')` on non-finite input) and `errors.ts`
  (`CoreInputError(code: CoreInputCode, message?: string)`, with `name = 'CoreInputError'`).
  Re-export both from `index.ts`.

- [ ] **Step 5: Run it to verify it passes.** Run `npm test`. Expected: 5 passed. Also run
  `npm run lint && npm run typecheck && npm run format:check`. Expected: all exit 0.

- [ ] **Step 6: Add CI.** `.github/workflows/ci.yml` runs on `pull_request` and on `push`
  to `main`: `actions/checkout`, `actions/setup-node` with `node-version-file: .nvmrc`
  and `cache: npm`, then `npm ci`, `npm run lint`, `npm run format:check`,
  `npm run typecheck`, `npm run coverage`. Pin each action to a full commit SHA, with the
  version tag in a trailing comment.

- [ ] **Step 7: Commit.**

```bash
git add -A
git commit -m "build: scaffold monorepo, CI and core unit conversions"
```

### Task 2: Ellipsoid, coordinate validation and distance

**Files:**
- Create: `packages/core/src/ellipsoid.ts`, `packages/core/src/coords.ts`,
  `packages/core/src/distance.ts`
- Modify: `packages/core/src/index.ts` (exports)
- Test: `packages/core/test/ellipsoid.test.ts`, `packages/core/test/coords.test.ts`,
  `packages/core/test/distance.test.ts`, `packages/core/test/helpers/geodesic.ts`

**Interfaces:**
- Consumes: `CoreInputError` (Task 1).
- Produces: `GRS80 = { a: 6378137, f: 1 / 298.257222101, e2 }`;
  `meridionalRadiusM(latDeg: number): number` (M);
  `primeVerticalRadiusM(latDeg: number): number` (N);
  `metresPerDegree(latDeg: number): { latM: number; lonM: number }`;
  `type LatLon = { readonly lat: number; readonly lon: number }`;
  `assertLatLon(p: LatLon): void`; `CANADA_ENVELOPE = { minLat: 41.5, maxLat: 83.5,
  minLon: -141.5, maxLon: -52 }`; `toLocalM(origin: LatLon, p: LatLon, scaleLat: number):
  { x: number; y: number }`; `fromLocalM(origin, xy, scaleLat): LatLon`;
  `distanceM(a: LatLon, b: LatLon): number`.
- Test helper (dev only): `geodesicDistanceM(a, b): number` and
  `geodesicDirect(a, azimuthDeg, distanceM): LatLon`, both wrapping
  `geographiclib-geodesic` on GRS80.

- [ ] **Step 1: Write the failing tests.**

```ts
// ellipsoid.test.ts — reference values from the closed-form GRS80 expressions
it('M and N at the equator and pole', () => {
  expect(meridionalRadiusM(0)).toBeCloseTo(6335439.327, 3);
  expect(primeVerticalRadiusM(0)).toBeCloseTo(6378137.0, 6);
  expect(meridionalRadiusM(90)).toBeCloseTo(primeVerticalRadiusM(90), 6);
});
it('metres per degree of longitude shrinks with cos(lat)', () => {
  const s = metresPerDegree(60);
  expect(s.lonM).toBeCloseTo((Math.PI / 180) * primeVerticalRadiusM(60) * 0.5, 9);
});

// coords.test.ts
it('accepts a Canadian point', () => expect(() => assertLatLon({ lat: 52.13, lon: -106.67 })).not.toThrow());
it.each([
  [{ lat: Number.NaN, lon: -100 }, 'NON_FINITE'],
  [{ lat: 91, lon: -100 }, 'LAT_OUT_OF_RANGE'],
  [{ lat: 50, lon: -181 }, 'LON_OUT_OF_RANGE'],
  [{ lat: -106.67, lon: 52.13 }, 'LAT_OUT_OF_RANGE'],         // swapped
  [{ lat: 52.13, lon: 106.67 }, 'OUTSIDE_CANADA_ENVELOPE'],   // positive-west mistake
])('rejects %j with %s', (p, code) => expect(() => assertLatLon(p)).toThrow(expect.objectContaining({ code })));

// distance.test.ts
it('matches GeographicLib within 1 mm for segments up to 2 km across Canada', () => {
  fc.assert(fc.property(
    fc.double({ min: 41.5, max: 83.5, noNaN: true }), fc.double({ min: -141, max: -52, noNaN: true }),
    fc.double({ min: 0, max: 360, noNaN: true }), fc.double({ min: 0, max: 2000, noNaN: true }),
    (lat, lon, az, d) => {
      const a = { lat, lon }; const b = geodesicDirect(a, az, d);
      expect(Math.abs(distanceM(a, b) - geodesicDistanceM(a, b))).toBeLessThan(0.001);
    }), { numRuns: 2000 });
});
it('holds the 1 mm target at 83.5° for an east-west 2 km segment', () => {
  const a = { lat: 83.5, lon: -70 }; const b = geodesicDirect(a, 90, 2000);
  expect(Math.abs(distanceM(a, b) - 2000)).toBeLessThan(0.001);
});
it('subdivides long segments: 50 km within 0.05 %', () => {
  const a = { lat: 52, lon: -106 }; const b = geodesicDirect(a, 45, 50000);
  expect(Math.abs(distanceM(a, b) - 50000) / 50000).toBeLessThan(0.0005);
});
it('is zero for identical points', () => expect(distanceM({ lat: 50, lon: -100 }, { lat: 50, lon: -100 })).toBe(0));
```

- [ ] **Step 2: Run them to verify they fail.** Run `npm test`. Expected: FAIL, missing
  exports.

- [ ] **Step 3: Implement.**
  - `ellipsoid.ts`: `e2 = f(2 − f)`, `M = a(1 − e2) / (1 − e2·sin²φ)^{3/2}`,
    `N = a / (1 − e2·sin²φ)^{1/2}`, `latM = M·π/180`, `lonM = N·cosφ·π/180`.
  - `coords.ts`: check order is finite, then |lat| ≤ 90, then |lon| ≤ 180, then the Canada
    envelope. The envelope is a deliberate v1 scope guard; document it.
  - `toLocalM` is an equirectangular tangent plane at `scaleLat`:
    `x = (lon − lon₀)·lonM(scaleLat)`, `y = (lat − lat₀)·latM(scaleLat)`. `fromLocalM` is
    its inverse.
  - `distanceM(a, b)`: if the rough length is ≤ 2000 m, return the planar length using
    scales at the mid-latitude. Otherwise split a→b into `ceil(L/2000)` equal parts by
    linear interpolation in lat/lon and sum the planar parts. Comment the error bound
    `≈ L³·tan²φ / (24R²)`.

- [ ] **Step 4: Run them to verify they pass.** Run `npm test`. Expected: all pass,
  including 2000 property runs.

- [ ] **Step 5: Commit.**

```bash
git add -A
git commit -m "feat(core): add GRS80 radii, coordinate checks and ellipsoidal distance"
```

### Task 3: Projection onto a segment

**Files:**
- Create: `packages/core/src/segment.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/segment.test.ts`, `packages/core/test/helpers/local.ts`

**Interfaces:**
- Consumes: `LatLon`, `assertLatLon`, `toLocalM`, `fromLocalM`, `metresPerDegree`,
  `distanceM` (Task 2).
- Produces: `type SegmentProjection = { t: number; point: LatLon; crossTrackM: number;
  alongSegmentM: number; segmentLengthM: number; clamped: 'none' | 'start' | 'end' }`;
  `projectOntoSegment(p: LatLon, a: LatLon, b: LatLon): SegmentProjection`.
- Test helper: `atMetres(origin: LatLon, eastM: number, northM: number): LatLon` (uses
  `fromLocalM` at the origin's latitude).

- [ ] **Step 1: Write the failing tests.** These are the PROJECTION.md worked examples,
  placed at O = (52.0, −106.0).

```ts
const O = { lat: 52, lon: -106 };
const A = atMetres(O, 0, 0), B = atMetres(O, 6, 8);
it('interior projection: worked example', () => {
  const r = projectOntoSegment(atMetres(O, 6, 2), A, B);
  expect(r.t).toBeCloseTo(0.52, 6);
  expect(r.alongSegmentM).toBeCloseTo(5.2, 3);
  expect(r.crossTrackM).toBeCloseTo(3.6, 3);
  expect(r.segmentLengthM).toBeCloseTo(10, 3);
  expect(r.clamped).toBe('none');
});
it('clamps past the end', () => {
  const r = projectOntoSegment(atMetres(O, 12, 16), A, B);
  expect(r.t).toBe(1); expect(r.clamped).toBe('end'); expect(r.crossTrackM).toBeCloseTo(10, 3);
});
it('clamps before the start', () => {
  const r = projectOntoSegment(atMetres(O, -3, -4), A, B);
  expect(r.t).toBe(0); expect(r.clamped).toBe('start'); expect(r.crossTrackM).toBeCloseTo(5, 3);
});
it('treats a zero-length segment as a point', () => {
  const r = projectOntoSegment(atMetres(O, 3, 4), A, A);
  expect(r).toMatchObject({ t: 0, alongSegmentM: 0, segmentLengthM: 0 });
  expect(r.crossTrackM).toBeCloseTo(5, 3);
});
it('rejects non-finite input', () =>
  expect(() => projectOntoSegment({ lat: NaN, lon: -106 }, A, B)).toThrow(expect.objectContaining({ code: 'NON_FINITE' })));
it('stays accurate 5 km off the track (Review Focus 4)', () => {
  const a = { lat: 55, lon: -110 }; const b = geodesicDirect(a, 90, 1500);
  const p = geodesicDirect(geodesicDirect(a, 90, 750), 0, 5000);
  const r = projectOntoSegment(p, a, b);
  expect(Math.abs(r.crossTrackM - geodesicDistanceM(p, r.point)) / 5000).toBeLessThan(0.001);
  expect(r.clamped).toBe('none');
});
```

- [ ] **Step 2: Run them to verify they fail.** Run `npm test`. Expected: FAIL, missing
  `projectOntoSegment`.

- [ ] **Step 3: Implement** `projectOntoSegment`. Validate all three points. Work in the
  tangent plane centred on `a`, with scales at the segment mid-latitude. Compute
  `D = B − A`, `V = P − A`, `t_raw = (V·D)/(D·D)` and `t = clamp(t_raw, 0, 1)`, with `D·D = 0`
  handled as a point candidate. Then `Q = A + t·D`, `crossTrackM = |P − Q|` and
  `alongSegmentM = t·segmentLengthM`, where `segmentLengthM = distanceM(a, b)`. Set
  `clamped` from `t_raw < 0` or `t_raw > 1`. Comment each step with its PROJECTION.md step
  number.

- [ ] **Step 4: Run them to verify they pass.** Run `npm test`. Expected: all pass.

- [ ] **Step 5: Commit.**

```bash
git add -A
git commit -m "feat(core): project a point onto a segment with clamping"
```

### Task 4: Polyline length and projection

**Files:**
- Create: `packages/core/src/polyline.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/polyline.test.ts`

**Interfaces:**
- Consumes: `projectOntoSegment`, `SegmentProjection` (Task 3); `distanceM` (Task 2).
- Produces: `type Polyline = readonly LatLon[]`;
  `cumulativeLengthsM(line: Polyline): Float64Array`, where index i is the metres from
  vertex 0 to vertex i;
  `type PolylineProjection = { segmentIndex: number; t: number; point: LatLon;
  crossTrackM: number; alongM: number; totalLengthM: number;
  nearTieAlongM: readonly number[] }`;
  `projectOntoPolyline(p: LatLon, line: Polyline, cumulative?: Float64Array):
  PolylineProjection`;
  `NEAR_TIE_TOLERANCE_M = 1`.

- [ ] **Step 1: Write the failing tests.** These are the PROJECTION.md bend example.

```ts
const O = { lat: 52, lon: -106 };
const bend = [atMetres(O, 0, 0), atMetres(O, 30, 0), atMetres(O, 30, 40)];
it('sums segment lengths, not the chord', () => {
  const c = cumulativeLengthsM(bend);
  expect(c[2]).toBeCloseTo(70, 3);
  expect(distanceM(bend[0]!, bend[2]!)).toBeCloseTo(50, 3);
});
it('projects onto the closest segment of the bend', () => {
  const r = projectOntoPolyline(atMetres(O, 33, 10), bend);
  expect(r.segmentIndex).toBe(1);
  expect(r.alongM).toBeCloseTo(40, 3);
  expect(r.crossTrackM).toBeCloseTo(3, 3);
  expect(r.nearTieAlongM).toEqual([]);
});
it('gives one along value on a shared vertex (Review Focus 1)', () => {
  const r = projectOntoPolyline(bend[1]!, bend);
  expect(r.alongM).toBeCloseTo(30, 6);
  expect(r.crossTrackM).toBeCloseTo(0, 6);
  expect(r.nearTieAlongM).toEqual([]);
});
it('reports a hairpin near-tie instead of hiding it', () => {
  const hairpin = [atMetres(O, 0, 0), atMetres(O, 100, 0), atMetres(O, 100, 4), atMetres(O, 0, 4)];
  const r = projectOntoPolyline(atMetres(O, 50, 2), hairpin);
  expect(r.nearTieAlongM).toHaveLength(1);
  expect(Math.abs(r.nearTieAlongM[0]! - r.alongM)).toBeGreaterThan(1);
});
it('skips duplicate vertices without changing length', () =>
  expect(cumulativeLengthsM([bend[0]!, bend[0]!, ...bend.slice(1)])[3]).toBeCloseTo(70, 3));
it.each([
  [[], 'EMPTY_POLYLINE'],
  [[atMetres(O, 0, 0)], 'ZERO_LENGTH_POLYLINE'],
  [[atMetres(O, 0, 0), atMetres(O, 0, 0)], 'ZERO_LENGTH_POLYLINE'],
])('rejects degenerate polyline %#', (line, code) =>
  expect(() => projectOntoPolyline(O, line)).toThrow(expect.objectContaining({ code })));
```

- [ ] **Step 2: Run them to verify they fail.** Run `npm test`. Expected: FAIL, missing
  exports.

- [ ] **Step 3: Implement.** `cumulativeLengthsM` sums `distanceM` over consecutive pairs; a
  duplicate vertex contributes 0. `projectOntoPolyline` validates the line (empty → 
  `EMPTY_POLYLINE`; total length 0 → `ZERO_LENGTH_POLYLINE`), reuses `cumulative` when
  given, and projects onto every segment, giving `alongM = cumulative[i] + alongSegmentM`.
  The best result has the minimum `crossTrackM`; ties within 1e-9 m go to the lowest
  index. `nearTieAlongM` lists the `alongM` of other segments whose `crossTrackM` is within
  `NEAR_TIE_TOLERANCE_M` of the best and whose `alongM` differs from the best by more than
  `NEAR_TIE_TOLERANCE_M`, de-duplicated within 1 m. This keeps adjacent segments sharing a
  vertex out of the list. Comment that track choice between chains is M3's job, while
  this flags ambiguity *within* one chain.

- [ ] **Step 4: Run them to verify they pass.** Run `npm test`. Expected: all pass.

- [ ] **Step 5: Commit.**

```bash
git add -A
git commit -m "feat(core): add polyline cumulative length and projection with near-tie reporting"
```

### Task 5: Anchors, interval validation, milepost interpolation and GPS band

**Files:**
- Create: `packages/core/src/anchors.ts`, `packages/core/src/interpolate.ts`,
  `packages/core/src/uncertainty.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/interpolate.test.ts`, `packages/core/test/uncertainty.test.ts`

**Interfaces:**
- Consumes: `CoreInputError` (Task 1); `METRES_PER_MILE` (Task 1).
- Produces: `type AnchorSource = 'crossing' | 'station' | 'structure' | 'markerpost'`;
  `type Anchor = { readonly id: string; readonly s: number; readonly mp: number;
  readonly source: AnchorSource }`;
  `type IntervalIssueCode = 'TOO_FEW_ANCHORS' | 'NON_FINITE' | 'UNSORTED' |
  'DUPLICATE_POSITION' | 'NON_MONOTONIC_MILEPOST'`;
  `type IntervalIssue = { code: IntervalIssueCode; anchorIds: readonly string[] }`;
  `validateInterval(anchors: readonly Anchor[]): readonly IntervalIssue[]`;
  `type UncalibratedReason = 'BEFORE_FIRST_ANCHOR' | 'AFTER_LAST_ANCHOR'`;
  `type MilepostResult =
    | { kind: 'calibrated'; mp: number; lower: Anchor; upper: Anchor; intervalLengthM: number }
    | { kind: 'uncalibrated'; reason: UncalibratedReason }`;
  `interpolateMilepost(s: number, interval: readonly Anchor[]): MilepostResult`, which
  throws `CoreInputError('INVALID_INTERVAL')` if `validateInterval` returns any issue;
  `gpsMilepostBandMi(accuracyM: number, lower: Anchor, upper: Anchor): number`.

- [ ] **Step 1: Write the failing tests.**

```ts
const a = (id: string, s: number, mp: number): Anchor => ({ id, s, mp, source: 'crossing' });
it('interpolates along the path, not the chord (PROJECTION.md bend)', () => {
  const r = interpolateMilepost(40, [a('A', 0, 100), a('C', 70, 100.07)]);
  expect(r).toMatchObject({ kind: 'calibrated' });
  if (r.kind === 'calibrated') { expect(r.mp).toBeCloseTo(100.04, 12); expect(r.intervalLengthM).toBe(70); }
});
it('handles decreasing mileposts', () => {
  const r = interpolateMilepost(40, [a('A', 0, 100.07), a('C', 70, 100)]);
  expect(r.kind === 'calibrated' && r.mp).toBeCloseTo(100.03, 12);
});
it('reproduces each anchor exactly and picks the right bracket on uneven spacing', () => {
  const iv = [a('1', 0, 109.88), a('2', 412.7, 110.14), a('3', 2051.3, 111.15)];
  for (const k of iv) expect(interpolateMilepost(k.s, iv)).toMatchObject({ kind: 'calibrated', mp: k.mp });
  const r = interpolateMilepost(1000, iv);
  expect(r.kind === 'calibrated' && [r.lower.id, r.upper.id]).toEqual(['2', '3']);
});
it('keeps a valid zero milepost', () =>
  expect(interpolateMilepost(0, [a('z', 0, 0), a('o', 1609.344, 1)])).toMatchObject({ kind: 'calibrated', mp: 0 }));
it('never extrapolates', () => {
  const iv = [a('A', 100, 5), a('B', 200, 5.1)];
  expect(interpolateMilepost(99.999, iv)).toEqual({ kind: 'uncalibrated', reason: 'BEFORE_FIRST_ANCHOR' });
  expect(interpolateMilepost(200.001, iv)).toEqual({ kind: 'uncalibrated', reason: 'AFTER_LAST_ANCHOR' });
});
it.each([
  [[a('A', 0, 1)], 'TOO_FEW_ANCHORS'],
  [[a('A', 10, 1), a('B', 0, 2)], 'UNSORTED'],
  [[a('A', 0, 1), a('B', 0, 2)], 'DUPLICATE_POSITION'],          // Review Focus 3
  [[a('A', 0, 1), a('B', 10, 2), a('C', 20, 1.5)], 'NON_MONOTONIC_MILEPOST'],
  [[a('A', 0, NaN), a('B', 10, 2)], 'NON_FINITE'],
])('flags invalid interval %#', (iv, code) => {
  expect(validateInterval(iv).map((i) => i.code)).toContain(code);
  expect(() => interpolateMilepost(5, iv)).toThrow(expect.objectContaining({ code: 'INVALID_INTERVAL' }));
});

// uncertainty.test.ts
it('propagates GPS accuracy along the interval slope', () => {
  const lo = a('lo', 0, 112.1), hi = a('hi', 0.42 * 1609.344, 112.52);
  expect(gpsMilepostBandMi(6, lo, hi)).toBeCloseTo(6 / 1609.344, 12);
});
it('rejects negative or non-finite accuracy', () => {
  const lo = a('lo', 0, 1), hi = a('hi', 1609.344, 2);
  expect(() => gpsMilepostBandMi(-1, lo, hi)).toThrow(expect.objectContaining({ code: 'NEGATIVE_ACCURACY' }));
  expect(() => gpsMilepostBandMi(NaN, lo, hi)).toThrow(expect.objectContaining({ code: 'NON_FINITE' }));
});
```

- [ ] **Step 2: Run them to verify they fail.** Run `npm test`. Expected: FAIL, missing
  exports.

- [ ] **Step 3: Implement.** `validateInterval` collects every issue rather than stopping
  at the first; monotonic means every consecutive Δmp has the same strict sign.
  `interpolateMilepost` finds the bracket by binary search on `s`. An exact hit on an
  anchor returns that anchor's `mp` exactly, with `lower` and `upper` set to the bracket
  that contains it (the first bracket for the first anchor). Otherwise
  `mp = mp₁ + (s − s₁)/(s₂ − s₁)·(mp₂ − mp₁)`. `gpsMilepostBandMi = accuracyM·|mp₂ − mp₁| /
  (s₂ − s₁)`; its doc comment says "from GPS accuracy only; not a confidence interval"
  (spec §6).

- [ ] **Step 4: Run them to verify they pass.** Run `npm test`. Expected: all pass.

- [ ] **Step 5: Commit.**

```bash
git add -A
git commit -m "feat(core): add anchor intervals, milepost interpolation and GPS band"
```

### Task 6: Property tests, coverage gate and core documentation

**Files:**
- Create: `packages/core/test/properties.test.ts`, `packages/core/README.md`
- Modify: `packages/core/vitest.config.ts` (coverage thresholds), `README.md` (Start
  here), `docs/RESEARCH.md` (log entry), `docs/superpowers/plans/2026-10-23-cantre-roadmap.md`
  (M1 status)

**Interfaces:**
- Consumes: every export from Tasks 1–5.
- Produces: no new API. `@cantre/core` is complete for M1.

- [ ] **Step 1: Write the property tests.** Run 1000 generated cases each, with points
  inside the Canada envelope and segments 1–2000 m long:

```ts
it('residual is perpendicular for interior projections', () => { /* for clamped === 'none':
  |dot(P−Q, B−A)| in the tangent plane / (|P−Q|·|B−A|) < 1e-9, or |P−Q| < 1e-9 */ });
it('alongM is monotonic as a point moves forward along a straight polyline', () => { /* sample
  increasing t on a 2-vertex line, assert non-decreasing alongM */ });
it('interpolation reproduces anchors and stays between bracket mileposts', () => { /* generated
  sorted, strictly monotonic intervals: every anchor maps to itself; every interior s gives
  min(mp1,mp2) ≤ mp ≤ max(mp1,mp2) */ });
it('never returns NaN or Infinity from any export for valid input', () => { /* all numeric
  fields of projectOntoPolyline and interpolateMilepost results are finite */ });
```

- [ ] **Step 2: Run them.** Run `npm test`. Expected: all pass. If a property fails, fix the
  code, not the property, and add the shrunk counterexample as a named unit test.

- [ ] **Step 3: Add the coverage gate.** In `vitest.config.ts`, set coverage thresholds to
  `lines: 95, branches: 90, functions: 100` for `src/**`. Run `npm run coverage`.
  Expected: thresholds met, exit 0.

- [ ] **Step 4: Write the docs.** `packages/core/README.md` gives a one-paragraph purpose
  and a table of every export (signature, units, spec section). It has a "Method" section
  summarising the tangent-plane distance and its error bound, the projection, the
  interpolation and the GPS band, and a "Limits" section: no datum transform, Canada
  envelope, along-chain ambiguity flagged but not resolved, not survey accuracy. Add a
  "Calculation core" link to the root README's Start here list. Add a dated RESEARCH.md
  entry recording the M1 commands and their results, including the number of property
  runs and the geodesy max error observed. Mark M1 "Built" in the roadmap.

- [ ] **Step 5: Final check.** Run `npm ci && npm run lint && npm run format:check &&
  npm run typecheck && npm run coverage`. Expected: every command exits 0.

- [ ] **Step 6: Commit.**

```bash
git add -A
git commit -m "test(core): add property tests, coverage gate and core docs"
```
