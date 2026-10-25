import { MATCH_CONFIG } from '@cantre/core';
import type { Fix, MatchEvent } from '@cantre/core';

/**
 * Geolocation adapter: turns the browser's position callbacks into matcher events (spec §6).
 *
 * Privacy: positions go only to `onEvent` (the matcher, in memory). Nothing here stores,
 * logs or sends a position.
 *
 * The app is the only place the clock is read: `nowMs` is injected (the app passes
 * `Date.now`), and `@cantre/core` stays clock-free.
 */

/** The parts of `GeolocationPosition` the adapter reads (structural, so tests need no DOM). */
export type GeoPositionLike = {
  readonly coords: {
    /** Degrees, WGS84. */
    readonly latitude: number;
    readonly longitude: number;
    /** Horizontal accuracy radius in metres, as the device reports it. */
    readonly accuracy: number;
    /** Degrees clockwise from true north, or null when unknown. */
    readonly heading: number | null;
    /** Metres per second, or null when unknown. */
    readonly speed: number | null;
  };
  /** Epoch milliseconds (the device's clock at the time of the fix). */
  readonly timestamp: number;
};

/** The parts of `GeolocationPositionError` the adapter reads. */
export type GeoErrorLike = { readonly code: number; readonly message: string };

/** The parts of `Geolocation` the adapter uses. The real `navigator.geolocation` fits. */
export type GeoLike = {
  watchPosition(
    success: (position: GeoPositionLike) => void,
    error?: ((error: GeoErrorLike) => void) | null,
    options?: PositionOptions,
  ): number;
  clearWatch(id: number): void;
};

/** `GeolocationPositionError.code` values (W3C Geolocation API). */
const PERMISSION_DENIED = 1;
const TIMEOUT = 3;

/**
 * Stops the watch when called (safe to call twice). `droppedFutureFixes` counts the fixes
 * dropped so far because their timestamp was too far ahead of the clock.
 */
export type FixWatch = (() => void) & { readonly droppedFutureFixes: number };

/** Ask for a fresh, high-accuracy position each time; give up on one reading after 10 s. */
const WATCH_OPTIONS: PositionOptions = Object.freeze({
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 10_000,
});

/** A heading or speed counts only when the device gave a finite number (0 is a real value). */
const finiteOrNull = (value: number | null): number | null =>
  value !== null && Number.isFinite(value) ? value : null;

/** Map a device position to a matcher fix. Optional fields are left out, never set to 0. */
function toFix(position: GeoPositionLike): Fix {
  const heading = finiteOrNull(position.coords.heading);
  const speed = finiteOrNull(position.coords.speed);
  return {
    lat: position.coords.latitude,
    lon: position.coords.longitude,
    timestampMs: position.timestamp,
    accuracyM: position.coords.accuracy,
    ...(heading === null ? {} : { headingDeg: heading }),
    ...(speed === null ? {} : { speedMps: speed }),
  };
}

/**
 * Start watching the device position and feed the matcher.
 *
 * - A position becomes `{ type: 'fix', fix }`.
 * - `PERMISSION_DENIED` becomes `permission: denied`; the first position after a denial is
 *   preceded by `permission: granted`, because the matcher ignores fixes while denied.
 * - A timeout becomes `locationError: TIMEOUT`; every other error `locationError: UNAVAILABLE`.
 * - A fix whose timestamp is more than `MATCH_CONFIG.futureFixToleranceMs` (ms) ahead of
 *   `nowMs()` is dropped before the matcher sees it, and counted (`droppedFutureFixes`);
 *   `onDropped` receives the running count. A fix exactly at the tolerance is kept.
 */
export function watchFixes(
  geo: GeoLike,
  nowMs: () => number,
  onEvent: (event: MatchEvent) => void,
  onDropped?: (total: number) => void,
): FixWatch {
  let dropped = 0;
  let denied = false;
  let stopped = false;

  const watchId = geo.watchPosition(
    (position) => {
      if (position.timestamp - nowMs() > MATCH_CONFIG.futureFixToleranceMs) {
        dropped += 1;
        onDropped?.(dropped);
        return;
      }
      if (denied) {
        denied = false;
        onEvent({ type: 'permission', state: 'granted' });
      }
      onEvent({ type: 'fix', fix: toFix(position) });
    },
    (error) => {
      if (error.code === PERMISSION_DENIED) {
        denied = true;
        onEvent({ type: 'permission', state: 'denied' });
        return;
      }
      onEvent({ type: 'locationError', code: error.code === TIMEOUT ? 'TIMEOUT' : 'UNAVAILABLE' });
    },
    WATCH_OPTIONS,
  );

  const stop = (): void => {
    if (!stopped) {
      stopped = true;
      geo.clearWatch(watchId);
    }
  };
  Object.defineProperty(stop, 'droppedFutureFixes', { get: () => dropped });
  return stop as FixWatch;
}
