import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { licenceName, renderLicences, workboxPackagesIn } from '../licenses-plugin.js';

const modules = resolve(import.meta.dirname, '..', '..', 'node_modules');

describe('third-party licence notices', () => {
  it('lists maplibre-gl, its dependencies and preact with their licence texts', () => {
    const text = renderLicences([join(modules, 'maplibre-gl'), join(modules, 'preact')]);
    expect(text).toContain('maplibre-gl 6.13.0\nLicence: BSD-3-Clause');
    expect(text).toContain('preact 11.0.1\nLicence: MIT');
    // A dependency of maplibre-gl is followed, and the BSD-3 wording is copied in.
    expect(text).toContain('@mapbox/point-geometry 1.1.0');
    expect(text).toContain('Redistributions in binary form must reproduce');
    // Types-only and dev packages are not listed.
    expect(text).not.toContain('@types/');
    expect(text).not.toContain('vite ');
  });

  it('stops the build when a package has no licence text', () => {
    const root = mkdtempSync(join(tmpdir(), 'cantre-lic-'));
    mkdirSync(join(root, 'pkg'));
    writeFileSync(join(root, 'pkg', 'package.json'), '{"name":"pkg","version":"1.0.0"}');
    expect(() => renderLicences([join(root, 'pkg')])).toThrow(/no licence file in pkg@1.0.0/);
  });

  it('prints the old object form of "license" by its type, never [object Object]', () => {
    expect(licenceName({ name: 'a', version: '1', license: 'MIT' })).toBe('MIT');
    expect(licenceName({ name: 'a', version: '1', license: { type: 'BSD-2-Clause' } })).toBe(
      'BSD-2-Clause',
    );
    expect(
      licenceName({ name: 'a', version: '1', licenses: [{ type: 'MIT' }, { type: 'ISC' }] }),
    ).toBe('MIT OR ISC');
    expect(licenceName({ name: 'a', version: '1' })).toBe('see the text below');

    const root = mkdtempSync(join(tmpdir(), 'cantre-lic-'));
    mkdirSync(join(root, 'old'));
    writeFileSync(
      join(root, 'old', 'package.json'),
      '{"name":"old","version":"2.0.0","license":{"type":"MIT","url":"x"}}',
    );
    writeFileSync(join(root, 'old', 'LICENSE'), 'The MIT text');
    const text = renderLicences([join(root, 'old')]);
    expect(text).toContain('old 2.0.0\nLicence: MIT');
    expect(text).not.toContain('[object Object]');
  });

  it('finds the Workbox packages from the markers in the emitted service-worker code', () => {
    const emitted = [
      'try{self["workbox:core:7.4.0"]&&_()}catch(t){}try{self["workbox:routing:7.4.0"]&&_()}catch(t){}',
      'try{self["workbox:core:7.4.0"]&&_()}catch(t){}try{self["workbox:strategies:7.4.0"]&&_()}catch(t){}',
    ];
    const found = workboxPackagesIn(emitted, import.meta.dirname).map((d) => basename(d));
    expect(found).toEqual(['workbox-core', 'workbox-routing', 'workbox-strategies']);
    expect(workboxPackagesIn(['no markers here'], import.meta.dirname)).toEqual([]);
  });
});
