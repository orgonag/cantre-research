/**
 * Where a milepost anchor came from. Descriptive only: the calculation does not weight anchors
 * by source. Source: CANTRE v1 spec §6 (calculation core) and docs/PROJECTION.md.
 */
export type AnchorSource = 'crossing' | 'station' | 'structure' | 'markerpost';

/**
 * Quality tier of an anchor's milepost, best first: `posted` (a milepost posted by the
 * railway), `tc` (a Transport Canada inventory value), `unverified` (a derived or unchecked
 * value). Source: CANTRE v1 spec §6 and the pipeline tile schema (cantre.tile/1).
 * Limits: a rank, not an accuracy; it carries no distance or probability.
 */
export type AnchorTier = 'posted' | 'tc' | 'unverified';

/**
 * A surveyed or published milepost at a known position along one track chain.
 *
 * Units: `s` is metres along the chain from its origin; `mp` is the milepost in miles.
 * Source: spec §6 (milepost). `id` identifies the anchor in results and issues.
 * Limits: an anchor is only as good as its source. This type carries no accuracy field.
 */
export type Anchor = {
  readonly id: string;
  /** Along-chain position, metres. */
  readonly s: number;
  /** Milepost, miles. Zero is a valid milepost. */
  readonly mp: number;
  readonly source: AnchorSource;
  /** Quality tier of the milepost value; a milepost between two anchors takes the lower tier. */
  readonly tier: AnchorTier;
};

/**
 * Reasons an ordered list of anchors cannot be used for interpolation.
 *
 * Source: spec §6 (milepost). Limits: the set is closed; callers branch on `code`.
 */
export type IntervalIssueCode =
  'TOO_FEW_ANCHORS' | 'NON_FINITE' | 'UNSORTED' | 'DUPLICATE_POSITION' | 'NON_MONOTONIC_MILEPOST';

/** One problem found in an interval, with the anchor ids it concerns. */
export type IntervalIssue = {
  readonly code: IntervalIssueCode;
  /** Ids of the anchors involved: one for NON_FINITE, the pair for the other codes. */
  readonly anchorIds: readonly string[];
};

/**
 * Checks an interval of anchors and reports EVERY problem found, not only the first.
 *
 * Rules, applied to the anchors in the order given:
 * - TOO_FEW_ANCHORS: fewer than 2 anchors (reported once, with all ids).
 * - NON_FINITE: an anchor whose `s` or `mp` is NaN or infinite, or a consecutive pair of finite
 *   anchors whose span s₂ − s₁ or mp₂ − mp₁ overflows to infinity (e.g. anchors at ±1e308; the
 *   pair's two ids are reported and the pair is skipped for the other checks).
 * - UNSORTED: for each consecutive pair, `s` decreases.
 * - DUPLICATE_POSITION: for each consecutive pair, `s` is equal.
 * - NON_MONOTONIC_MILEPOST: for each consecutive pair with finite values, Δmp = mp₂ − mp₁ is
 *   zero, or its sign differs from the sign of the first non-zero Δmp. Milepost must strictly
 *   increase or strictly decrease along the chain; an equal pair breaks it.
 *
 * Formula: Δmp = mp₂ − mp₁ per consecutive pair (miles). No tolerance is applied: exact zero
 * is zero. Units: `s` in metres, `mp` in miles.
 * Source: spec §6 (milepost); docs/PROJECTION.md (no bracket means no calculated milepost).
 * Limits: this checks the list as given. It does not sort it, and it does not know whether a
 * physical discontinuity (a split or a re-numbered line) lies between two anchors. An empty
 * result means the list is usable for interpolation, not that the anchors are correct.
 */
export function validateInterval(anchors: readonly Anchor[]): readonly IntervalIssue[] {
  const issues: IntervalIssue[] = [];
  if (anchors.length < 2) {
    issues.push({ code: 'TOO_FEW_ANCHORS', anchorIds: anchors.map((x) => x.id) });
  }
  for (const x of anchors) {
    if (!Number.isFinite(x.s) || !Number.isFinite(x.mp)) {
      issues.push({ code: 'NON_FINITE', anchorIds: [x.id] });
    }
  }

  let direction = 0; // sign of the first non-zero Δmp; 0 until one is seen
  for (let i = 1; i < anchors.length; i += 1) {
    const prev = anchorAt(anchors, i - 1);
    const cur = anchorAt(anchors, i);
    const ids = [prev.id, cur.id];
    if (!isFiniteAnchor(prev) || !isFiniteAnchor(cur)) {
      continue; // already reported as NON_FINITE; deltas would be meaningless
    }
    // Both anchors are finite, but a span such as 1e308 - (-1e308) can still overflow to Infinity;
    // an infinite span would otherwise yield an interval no interpolation can use.
    const ds = cur.s - prev.s; // metres
    const delta = cur.mp - prev.mp; // miles
    if (!Number.isFinite(ds) || !Number.isFinite(delta)) {
      issues.push({ code: 'NON_FINITE', anchorIds: ids });
      continue;
    }
    if (cur.s < prev.s) {
      issues.push({ code: 'UNSORTED', anchorIds: ids });
    } else if (cur.s === prev.s) {
      issues.push({ code: 'DUPLICATE_POSITION', anchorIds: ids });
    }

    if (delta === 0) {
      issues.push({ code: 'NON_MONOTONIC_MILEPOST', anchorIds: ids });
    } else if (direction === 0) {
      direction = Math.sign(delta);
    } else if (Math.sign(delta) !== direction) {
      issues.push({ code: 'NON_MONOTONIC_MILEPOST', anchorIds: ids });
    }
  }
  return issues;
}

/** Element `i` of `anchors`; the loop bounds guarantee it exists, so a hole is a bug. */
function anchorAt(anchors: readonly Anchor[], i: number): Anchor {
  if (i < 0 || i >= anchors.length) {
    throw new RangeError(`anchor index ${String(i)} outside 0..${String(anchors.length - 1)}`);
  }
  return anchors[i] as Anchor;
}

/** True when both coordinates of the anchor are finite numbers. */
function isFiniteAnchor(x: Anchor): boolean {
  return Number.isFinite(x.s) && Number.isFinite(x.mp);
}
