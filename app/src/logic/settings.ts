import type { AssetKind } from '@cantre/core';
import { ASSET_KINDS } from './visibleAssets.js';

/**
 * Settings: the only thing the app keeps in localStorage (ruling P8, spec §9).
 *
 * One key, `cantre.settings.v1`, holds distance units, language, optional asset-layer kinds and basemap
 * consent. No fix, trace, route, lock or position is ever stored. Every storage call is inside
 * try/catch, because storage can be missing or blocked (private window, blocked site data) and
 * the app must work without it.
 */

export type Settings = {
  /** Distance units for display: miles (default) or kilometres by explicit conversion. */
  readonly units: 'mi' | 'km';
  readonly lang: 'en' | 'fr';
  /** Roads and places are on by default; an explicitly saved off choice is respected. */
  readonly basemap: boolean;
  /** Enabled map layers only; no location or asset IDs. Absent uses the default layers. */
  readonly assetKinds?: readonly AssetKind[];
};

export const SETTINGS_KEY = 'cantre.settings.v1';

export const DEFAULT_SETTINGS: Settings = Object.freeze({
  units: 'mi',
  lang: 'en',
  basemap: true,
});

/** The parts of `Storage` the app uses. */
export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

/** `localStorage`, or null when the browser has none or refuses access. */
export function browserLocalStorage(): StorageLike | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/** `sessionStorage`, or null when the browser has none or refuses access. */
export function browserSessionStorage(): StorageLike | null {
  try {
    return globalThis.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Read the settings. Each field is checked on its own: a bad or missing value falls back to
 * the default for that field. With no stored language, `preferredLang` (the device language,
 * for example `fr-CA`) picks French; otherwise English.
 */
export function loadSettings(
  storage: StorageLike | null = browserLocalStorage(),
  preferredLang?: string,
): Settings {
  let stored: Record<string, unknown> = {};
  try {
    const raw = storage?.getItem(SETTINGS_KEY) ?? null;
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      stored = parsed as Record<string, unknown>;
    }
  } catch {
    stored = {};
  }
  const deviceLang = preferredLang?.toLowerCase().startsWith('fr') === true ? 'fr' : 'en';
  const rawKinds = stored['assetKinds'];
  const assetKinds = Array.isArray(rawKinds)
    ? [
        ...new Set(
          rawKinds.filter(
            (value: unknown): value is AssetKind =>
              typeof value === 'string' && ASSET_KINDS.includes(value as AssetKind),
          ),
        ),
      ]
    : undefined;
  return {
    ...(assetKinds === undefined ? {} : { assetKinds }),
    units: stored['units'] === 'km' || stored['units'] === 'mi' ? stored['units'] : 'mi',
    lang: stored['lang'] === 'fr' || stored['lang'] === 'en' ? stored['lang'] : deviceLang,
    basemap: typeof stored['basemap'] === 'boolean' ? stored['basemap'] : true,
  };
}

/** Save the settings. Never throws; if storage is unavailable the setting lasts for the session. */
export function saveSettings(
  settings: Settings,
  storage: StorageLike | null = browserLocalStorage(),
): void {
  try {
    storage?.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        units: settings.units,
        lang: settings.lang,
        basemap: settings.basemap,
        ...(settings.assetKinds === undefined ? {} : { assetKinds: settings.assetKinds }),
      }),
    );
  } catch {
    // Storage is blocked or full: keep working with the in-memory value.
  }
}

/**
 * Apply a change to the CURRENT settings and save the whole object. The caller passes the
 * latest settings (not a copy captured earlier), so two quick changes never overwrite each other
 * with a stale field. Returns the new settings; saving never throws.
 */
export function updateSettings(
  current: Settings,
  change: Partial<Settings>,
  storage: StorageLike | null = browserLocalStorage(),
): Settings {
  const next: Settings = { ...current, ...change };
  saveSettings(next, storage);
  return next;
}
