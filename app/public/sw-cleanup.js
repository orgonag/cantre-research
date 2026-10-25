/**
 * Extra service-worker code (loaded by the generated sw.js through `importScripts`).
 *
 * The map library's files are kept in the run-time cache `cantre-shell-maplibre` (see
 * vite.config.ts). That cache must not grow with every release, and it must not need IndexedDB:
 * Workbox's usual size limit (`expiration`) keeps its bookkeeping in an IndexedDB database, and
 * the privacy tests promise that this app leaves IndexedDB empty. So instead the cache is emptied
 * when a new service worker activates, which happens once per release (a changed sw.js). The
 * next time the map is opened the current library files are fetched and cached again. Nothing
 * here reads a request, a position or any user data.
 */
/* global self, caches */
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.delete('cantre-shell-maplibre'));
});
