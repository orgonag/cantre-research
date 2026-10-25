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

/**
 * Whether an uncaught `error` or `unhandledrejection` event should stop the app with the
 * full-screen error boundary. An event that carries no value at all (`undefined` or `null`:
 * for example `Promise.reject()` with no reason in a library, or a browser-generated error event
 * such as a ResizeObserver notice, which has no error object) gives no code and no evidence of a
 * broken state, so it is not fatal: the caller logs it as non-fatal and keeps the app running.
 * Every other value, typed or not, is fatal and shown by its code.
 */
export function isFatalUncaught(value: unknown): boolean {
  return value !== undefined && value !== null;
}
