import { describe, expect, it } from 'vitest';
import { MATCH_REASONS, MATCH_STATUSES } from '@cantre/core';
import {
  CATALOGUES,
  DATA_CLIENT_CODES,
  catalogueMeta,
  getLang,
  setLang,
  t,
} from '../src/i18n/index.js';

const keys = (lang: 'en' | 'fr'): string[] => Object.keys(CATALOGUES[lang]).sort();

describe('message catalogue', () => {
  it('has identical key sets in EN and FR', () => {
    expect(keys('fr')).toEqual(keys('en'));
  });

  it('has a message for every match reason, match status and data-client error code', () => {
    for (const lang of ['en', 'fr'] as const) {
      for (const r of MATCH_REASONS) {
        expect(Object.keys(CATALOGUES[lang]), `${lang} reason.${r}`).toContain(`reason.${r}`);
      }
      for (const s of MATCH_STATUSES) {
        expect(Object.keys(CATALOGUES[lang]), `${lang} status.${s}`).toContain(`status.${s}`);
      }
      for (const c of DATA_CLIENT_CODES) {
        expect(Object.keys(CATALOGUES[lang]), `${lang} error.${c}`).toContain(`error.${c}`);
      }
    }
    expect([...DATA_CLIENT_CODES].sort()).toEqual([
      'FETCH_FAILED',
      'HASH_MISMATCH',
      'MANIFEST_INVALID',
      'NOT_INSTALLED',
    ]);
  });

  it('has no empty value in either language', () => {
    for (const lang of ['en', 'fr'] as const) {
      for (const [k, v] of Object.entries(CATALOGUES[lang])) {
        expect(v.trim().length, `${lang} ${k}`).toBeGreaterThan(0);
      }
    }
  });

  it('marks French as needing native review and English as the source', () => {
    expect(catalogueMeta('fr').reviewStatus).toBe('needs native review');
    expect(catalogueMeta('en').reviewStatus).not.toBe('needs native review');
  });

  it('uses the same {placeholders} in EN and FR for every message', () => {
    const holes = (s: string): string[] => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const k of keys('en')) {
      expect(holes(CATALOGUES.fr[k as keyof typeof CATALOGUES.fr]), k).toEqual(
        holes(CATALOGUES.en[k as keyof typeof CATALOGUES.en]),
      );
    }
  });

  it('keeps the disclaimer footer in both languages (D7)', () => {
    expect(CATALOGUES.en['app.footer']).toBe(
      'Research software. Not for safety, operations or track access.',
    );
    expect(CATALOGUES.fr['app.footer'].length).toBeGreaterThan(10);
  });
});

describe('t()', () => {
  it('reads the active language and switches', () => {
    setLang('en');
    expect(getLang()).toBe('en');
    const en = t('status.STALE');
    setLang('fr');
    expect(getLang()).toBe('fr');
    expect(t('status.STALE')).not.toBe(en);
    setLang('en');
  });

  it('fills {placeholders} and leaves an unknown one visible', () => {
    setLang('en');
    expect(t('data.version', { date: '2026-10-25' })).toContain('2026-10-25');
    expect(t('data.version', {})).toContain('{date}');
  });
});
