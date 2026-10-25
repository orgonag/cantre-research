import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { licencesPlugin } from './licenses-plugin.js';

const source = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));

/**
 * Build config for the phone app.
 *
 * `@cantre/core` and `@cantre/data-client` are imported by package name and resolved to their
 * TypeScript source (the same mapping tsconfig `paths` and the data-client tests use), so a
 * clean checkout builds with `npm run -w app build` and no earlier build step.
 *
 * `base: './'` keeps every asset URL relative, so the app works from any path on a static host
 * (the planned GitHub Pages sub-path, or a local preview).
 *
 * Service worker (vite-plugin-pwa, Workbox `generateSW`): it precaches the APP SHELL only, the
 * page, its script and style, and the icons, so the app opens offline. It does not cache the
 * data. The manifest, the snapshot and the asset-details file are fetched and stored by the data
 * client in Cache Storage (`cantre-data-<datasetVersion>`), which verifies them against their
 * hashes first; a second copy here would bypass that. Rules, all checked by looking at the
 * built `sw.js` and its precache list:
 * - No precache of anything under `data/`, nor of the maplibre-gl chunk, its CSS or its worker
 *   (ruling P30: they belong to the map library, outside the shell budget).
 * - The maplibre files are cached only at run time, same-origin, after the map was opened once.
 *   That adds no request of its own: it keeps the response of a request the page already made.
 *   The cache has no Workbox size limit, because that keeps its records in IndexedDB and this
 *   app leaves IndexedDB empty (tested). `public/sw-cleanup.js` empties the cache whenever a new
 *   service worker activates, so it holds one release's library files at most.
 * - No runtime caching of any other URL, and none of any other host (the basemap tiles are not
 *   stored by this app). Nothing the user did, and no position, is ever in a cached URL.
 * - `registerType: 'prompt'` with no prompt in the UI: a new service worker waits until every
 *   tab of the app is closed, so the page is never swapped (and the route lock never lost)
 *   in the middle of a session. An app update takes effect on the next start.
 */
export default defineConfig({
  base: './',
  resolve: {
    alias: {
      '@cantre/core': source('../packages/core/src/index.ts'),
      '@cantre/data-client': source('../packages/data-client/src/index.ts'),
    },
  },
  // Preact's automatic JSX runtime (no React shim, no extra preset dependency).
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  // The maplibre-gl chunk (about 1 MB raw) is loaded only when the map is opened and is excluded
  // from the 300 kB shell budget, so the default 500 kB chunk warning is raised above it.
  build: { target: 'es2023', sourcemap: false, chunkSizeWarningLimit: 1200 },
  plugins: [
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icons/*.png'],
      manifest: {
        name: 'CANTRE',
        short_name: 'CANTRE',
        description:
          'Calculated railway milepost from your GPS, on this device. Research software.',
        lang: 'en',
        start_url: './',
        scope: './',
        display: 'standalone',
        theme_color: '#0b4f9e',
        background_color: '#ffffff',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{html,js,css,png,webmanifest,txt}'],
        globIgnores: ['**/maplibre-gl*', '**/data/**'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/\/data\//],
        cleanupOutdatedCaches: true,
        // Empties the maplibre run-time cache when a new service worker activates (no IndexedDB).
        importScripts: ['sw-cleanup.js'],
        runtimeCaching: [
          {
            urlPattern: ({ url, sameOrigin }) =>
              sameOrigin && /\/assets\/maplibre-gl[^/]*$/.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'cantre-shell-maplibre' },
          },
        ],
      },
    }),
    // Must stay AFTER VitePWA: its closeBundle step reads the service-worker files VitePWA writes.
    // Writes third-party-licenses.txt (name, version, licence text of every shipped package,
    // including the Workbox modules found in sw.js and the workbox-*.js runtime).
    licencesPlugin(),
  ],
});
