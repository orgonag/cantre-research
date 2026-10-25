/**
 * Machine-readable reasons the calculation core rejects an input.
 *
 * Source: CANTRE v1 design spec (docs/superpowers/specs/2026-10-23-cantre-v1-design.md).
 * Limits: the set is closed; callers branch on `CoreInputError.code`, never on the message.
 */
export type CoreInputCode =
  | 'NON_FINITE'
  | 'LAT_OUT_OF_RANGE'
  | 'LON_OUT_OF_RANGE'
  | 'OUTSIDE_CANADA_ENVELOPE'
  | 'EMPTY_POLYLINE'
  | 'ZERO_LENGTH_POLYLINE'
  | 'CUMULATIVE_LENGTH_MISMATCH'
  | 'INVALID_INTERVAL'
  | 'NEGATIVE_ACCURACY'
  | 'INVALID_TILE'
  | 'INVALID_SNAPSHOT'
  | 'MIXED_DATASET_VERSION'
  | 'TILE_MISMATCH';

/**
 * Error thrown when an input violates a precondition of the calculation core.
 *
 * The core never repairs or clamps bad input: it fails loudly with a stable `code`, so a
 * caller cannot mistake a fabricated value for a measurement.
 */
export class CoreInputError extends Error {
  readonly code: CoreInputCode;

  /**
   * @param code - Stable reason code.
   * @param message - Optional human-readable detail; defaults to the code.
   */
  constructor(code: CoreInputCode, message?: string) {
    super(message ?? code);
    this.name = 'CoreInputError';
    this.code = code;
  }
}
