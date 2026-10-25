import type { MatchReason, MatchStatus } from '@cantre/core';
import type { DataClientCode } from '@cantre/data-client';
import en from './en.json';
import fr from './fr.json';

/**
 * The message catalogue (spec §13). Every user-visible string goes through `t()`.
 *
 * - EN and FR have identical keys (the tests check this), including one message per
 *   `MATCH_REASONS` code (`reason.<CODE>`), one per `MATCH_STATUSES` code (`status.<CODE>`) and
 *   one per data-client error code (`error.<CODE>`).
 * - FR is a draft marked "needs native review" in its `_meta` (D3). It must not pass as reviewed.
 * - Proper names (CANTRE, NRWN, OGL-Canada) stay as published.
 */

/** Data-client error codes the app shows; the type check ties this list to `DataClientCode`. */
export const DATA_CLIENT_CODES = [
  'MANIFEST_INVALID',
  'FETCH_FAILED',
  'HASH_MISMATCH',
  'NOT_INSTALLED',
] as const satisfies readonly DataClientCode[];

export type Lang = 'en' | 'fr';

/** Every key of the English catalogue. Typed, so a misspelt key is a compile error. */
export type MessageKey = keyof typeof en.messages;

// Compile-time proof that the dynamic key families are all present in the catalogue.
type RequiredKey =
  `reason.${MatchReason}` | `status.${MatchStatus}` | `error.${(typeof DATA_CLIENT_CODES)[number]}`;
export const KEY_FAMILIES_COMPLETE: RequiredKey extends MessageKey ? true : never = true;

export const CATALOGUES: Readonly<Record<Lang, Readonly<Record<MessageKey, string>>>> = {
  en: en.messages,
  fr: fr.messages,
};

const METAS = { en: en._meta, fr: fr._meta } as const;

/** Catalogue metadata, including `reviewStatus` ("needs native review" for French). */
export function catalogueMeta(lang: Lang): {
  readonly lang: string;
  readonly reviewStatus: string;
  readonly note: string;
} {
  return METAS[lang];
}

let active: Lang = 'en';

export function getLang(): Lang {
  return active;
}

export function setLang(lang: Lang): void {
  active = lang;
}

/**
 * Look up a message in the active language and fill `{name}` placeholders from `params`.
 * A placeholder with no value stays visible in the text, so a missing value is noticed.
 */
export function t(key: MessageKey, params: Readonly<Record<string, string | number>> = {}): string {
  return CATALOGUES[active][key].replace(/\{(\w+)\}/g, (hole, name: string) => {
    const value = params[name];
    return value === undefined ? hole : String(value);
  });
}
