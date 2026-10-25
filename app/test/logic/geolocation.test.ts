import { describe, expect, it } from 'vitest';
import { MATCH_CONFIG } from '@cantre/core';
import type { MatchEvent } from '@cantre/core';
import { watchFixes } from '../../src/logic/geolocation.js';
import type { GeoErrorLike, GeoLike, GeoPositionLike } from '../../src/logic/geolocation.js';

/** A fake Geolocation that lets a test push positions and errors into the adapter. */
function fakeGeo(): {
  geo: GeoLike;
  push: (p: GeoPositionLike) => void;
  fail: (e: GeoErrorLike) => void;
  cleared: number[];
  options: PositionOptions[];
} {
  let ok: ((p: GeoPositionLike) => void) | null = null;
  let bad: ((e: GeoErrorLike) => void) | null = null;
  const cleared: number[] = [];
  const options: PositionOptions[] = [];
  const geo: GeoLike = {
    watchPosition(success, error, opts) {
      ok = success;
      bad = error ?? null;
      options.push(opts ?? {});
      return 7;
    },
    clearWatch(id) {
      cleared.push(id);
    },
  };
  return {
    geo,
    push: (p) => ok?.(p),
    fail: (e) => bad?.(e),
    cleared,
    options,
  };
}

const NOW = 1_700_000_000_000;
const position = (
  over: Partial<GeoPositionLike['coords']> = {},
  timestamp = NOW,
): GeoPositionLike => ({
  coords: {
    latitude: 52.1,
    longitude: -106.6,
    accuracy: 12,
    heading: null,
    speed: null,
    ...over,
  },
  timestamp,
});
const error = (code: number): GeoErrorLike => ({ code, message: 'x' });

describe('watchFixes', () => {
  it('maps a position to a fix event with accuracy, and omits null heading and speed', () => {
    const { geo, push } = fakeGeo();
    const events: MatchEvent[] = [];
    watchFixes(
      geo,
      () => NOW,
      (e) => events.push(e),
    );
    push(position());
    expect(events).toEqual([
      {
        type: 'fix',
        fix: { lat: 52.1, lon: -106.6, timestampMs: NOW, accuracyM: 12 },
      },
    ]);
    const fix = events[0];
    expect(fix !== undefined && fix.type === 'fix' && 'headingDeg' in fix.fix).toBe(false);
    expect(fix !== undefined && fix.type === 'fix' && 'speedMps' in fix.fix).toBe(false);
  });

  it('keeps a heading of 0 (north) and a speed of 0, as real values', () => {
    const { geo, push } = fakeGeo();
    const events: MatchEvent[] = [];
    watchFixes(
      geo,
      () => NOW,
      (e) => events.push(e),
    );
    push(position({ heading: 0, speed: 0 }));
    expect(events[0]).toMatchObject({ type: 'fix', fix: { headingDeg: 0, speedMps: 0 } });
  });

  it('omits a NaN or infinite heading or speed', () => {
    const { geo, push } = fakeGeo();
    const events: MatchEvent[] = [];
    watchFixes(
      geo,
      () => NOW,
      (e) => events.push(e),
    );
    push(position({ heading: Number.NaN, speed: Number.POSITIVE_INFINITY }, NOW + 1));
    const e = events[0];
    expect(e?.type === 'fix' && 'headingDeg' in e.fix).toBe(false);
    expect(e?.type === 'fix' && 'speedMps' in e.fix).toBe(false);
  });

  it('maps PERMISSION_DENIED to a permission:denied event', () => {
    const { geo, fail } = fakeGeo();
    const events: MatchEvent[] = [];
    watchFixes(
      geo,
      () => NOW,
      (e) => events.push(e),
    );
    fail(error(1));
    expect(events).toEqual([{ type: 'permission', state: 'denied' }]);
  });

  it('maps a timeout to locationError TIMEOUT and other errors to UNAVAILABLE', () => {
    const { geo, fail } = fakeGeo();
    const events: MatchEvent[] = [];
    watchFixes(
      geo,
      () => NOW,
      (e) => events.push(e),
    );
    fail(error(3));
    fail(error(2));
    fail(error(99));
    expect(events).toEqual([
      { type: 'locationError', code: 'TIMEOUT' },
      { type: 'locationError', code: 'UNAVAILABLE' },
      { type: 'locationError', code: 'UNAVAILABLE' },
    ]);
  });

  it('drops a fix 2 s ahead of the clock and counts it', () => {
    const { geo, push } = fakeGeo();
    const events: MatchEvent[] = [];
    const drops: number[] = [];
    const stop = watchFixes(
      geo,
      () => NOW,
      (e) => events.push(e),
      (n) => drops.push(n),
    );
    push(position({}, NOW + 2000));
    expect(events).toEqual([]);
    expect(stop.droppedFutureFixes).toBe(1);
    expect(drops).toEqual([1]);
    push(position({}, NOW + 3000));
    expect(stop.droppedFutureFixes).toBe(2);
  });

  it('keeps a fix exactly at the tolerance and a fix in the past', () => {
    const { geo, push } = fakeGeo();
    const events: MatchEvent[] = [];
    const stop = watchFixes(
      geo,
      () => NOW,
      (e) => events.push(e),
    );
    push(position({}, NOW + MATCH_CONFIG.futureFixToleranceMs));
    push(position({}, NOW - 60_000));
    expect(events).toHaveLength(2);
    expect(stop.droppedFutureFixes).toBe(0);
  });

  it('re-grants permission before the first fix that follows a denial', () => {
    const { geo, push, fail } = fakeGeo();
    const events: MatchEvent[] = [];
    watchFixes(
      geo,
      () => NOW,
      (e) => events.push(e),
    );
    fail(error(1));
    push(position());
    push(position({}, NOW + 1));
    expect(events.map((e) => e.type)).toEqual(['permission', 'permission', 'fix', 'fix']);
    expect(events[1]).toEqual({ type: 'permission', state: 'granted' });
  });

  it('asks for a fresh high-accuracy position and stops the watch on cleanup', () => {
    const { geo, cleared, options } = fakeGeo();
    const stop = watchFixes(
      geo,
      () => NOW,
      () => undefined,
    );
    expect(options[0]).toMatchObject({ enableHighAccuracy: true, maximumAge: 0 });
    stop();
    stop();
    expect(cleared).toEqual([7]);
  });
});
