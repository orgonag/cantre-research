import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderLicences } from '../licenses-plugin.js';

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
});
