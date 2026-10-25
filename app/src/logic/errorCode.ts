/**
 * The short code shown on the error screen (spec §8). Core and data-client errors carry a
 * stable `code`; anything else is `UNEXPECTED`. Only the code is shown, never a stack trace or
 * a message that might contain a value.
 */
export function errorCode(error: unknown): string {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return 'UNEXPECTED';
}
