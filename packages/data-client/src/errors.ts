/**
 * Machine-readable reasons the data client refuses to install or load data. Callers branch on
 * `DataClientError.code`, never on the message.
 *
 * - `MANIFEST_INVALID`: the manifest is not a usable `cantre.manifest/1` national manifest.
 * - `FETCH_FAILED`: a request failed, the download was short, long or interrupted, or the
 *   browser has no usable Cache Storage or SHA-256. The previous install is untouched.
 * - `HASH_MISMATCH`: a file's SHA-256 is not the manifest's. The file is neither stored nor
 *   decoded.
 * - `NOT_INSTALLED`: `loadNetwork` was called with nothing installed.
 *
 * A snapshot that downloads and hashes correctly but cannot be decoded is a core error
 * (`CoreInputError`, code `INVALID_SNAPSHOT`), not one of these.
 */
export type DataClientCode =
  'MANIFEST_INVALID' | 'FETCH_FAILED' | 'HASH_MISMATCH' | 'NOT_INSTALLED';

/** A short text for a caught value of unknown type (an `Error`'s message, or the value as text). */
export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Error thrown by the data client. The message never contains coordinates or user data. */
export class DataClientError extends Error {
  readonly code: DataClientCode;

  /**
   * @param code - Stable reason code.
   * @param message - Optional human-readable detail; defaults to the code.
   */
  constructor(code: DataClientCode, message?: string) {
    super(message ?? code);
    this.name = 'DataClientError';
    this.code = code;
  }
}
