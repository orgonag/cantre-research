import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  browserLocalStorage,
  browserSessionStorage,
  SETTINGS_KEY,
  loadSettings,
  saveSettings,
} from '../../src/logic/settings.js';
import type { StorageLike } from '../../src/logic/settings.js';
import { blocked, memoryStorage } from './storage.js';

describe('settings', () => {
  it('uses miles, English and no basemap by default', () => {
    expect(loadSettings(memoryStorage())).toEqual({ units: 'mi', lang: 'en', basemap: false });
    expect(DEFAULT_SETTINGS.basemap).toBe(false);
  });

  it('defaults to French only when the device language says so and nothing is stored', () => {
    expect(loadSettings(memoryStorage(), 'fr-CA').lang).toBe('fr');
    expect(loadSettings(memoryStorage(), 'en-CA').lang).toBe('en');
    expect(loadSettings(memoryStorage({ [SETTINGS_KEY]: '{"lang":"en"}' }), 'fr-CA').lang).toBe(
      'en',
    );
  });

  it('round-trips under the one key and stores nothing else', () => {
    const store = memoryStorage();
    saveSettings({ units: 'km', lang: 'fr', basemap: true }, store);
    expect(Object.keys(store.data)).toEqual(['cantre.settings.v1']);
    expect(JSON.parse(store.data[SETTINGS_KEY] ?? '')).toEqual({
      units: 'km',
      lang: 'fr',
      basemap: true,
    });
    expect(loadSettings(store)).toEqual({ units: 'km', lang: 'fr', basemap: true });
  });

  it('ignores bad or foreign values field by field', () => {
    const store = memoryStorage({
      [SETTINGS_KEY]: '{"units":"furlongs","lang":"fr","basemap":"yes","lat":52.1}',
    });
    expect(loadSettings(store)).toEqual({ units: 'mi', lang: 'fr', basemap: false });
    expect(loadSettings(memoryStorage({ [SETTINGS_KEY]: 'not json' }))).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(memoryStorage({ [SETTINGS_KEY]: '[1]' }))).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(memoryStorage({ [SETTINGS_KEY]: 'null' }))).toEqual(DEFAULT_SETTINGS);
  });

  it('never throws when storage is blocked or missing', () => {
    const store: StorageLike = blocked;
    expect(loadSettings(store)).toEqual(DEFAULT_SETTINGS);
    expect(() => {
      saveSettings(DEFAULT_SETTINGS, store);
    }).not.toThrow();
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(() => {
      saveSettings(DEFAULT_SETTINGS, null);
    }).not.toThrow();
  });
});

describe('browser storage accessors', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(globalThis, 'sessionStorage');
  });

  it('return the browser storage, and are used when none is passed', () => {
    const local = memoryStorage();
    const session = memoryStorage();
    vi.stubGlobal('localStorage', local);
    vi.stubGlobal('sessionStorage', session);
    expect(browserLocalStorage()).toBe(local);
    expect(browserSessionStorage()).toBe(session);
    saveSettings({ units: 'km', lang: 'en', basemap: false });
    expect(loadSettings().units).toBe('km');
    expect(Object.keys(session.data)).toEqual([]);
  });

  it('return null when the browser refuses access', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get: () => {
        throw new Error('SecurityError');
      },
    });
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      get: () => {
        throw new Error('SecurityError');
      },
    });
    expect(browserLocalStorage()).toBeNull();
    expect(browserSessionStorage()).toBeNull();
    Reflect.deleteProperty(globalThis, 'localStorage');
  });
});
