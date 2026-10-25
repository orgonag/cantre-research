import type { Page } from '@playwright/test';
import {
  BASEMAP_HOST,
  PLACES,
  card,
  coordinateStrings,
  disallowed,
  expect,
  headline,
  moveTo,
  openAndInstall,
  openScreen,
  backToPosition,
  test,
} from './helpers';

/**
 * Privacy evidence (spec section 9; AGENTS.md: location stays on the device).
 *
 * Besides the rules every test gets from helpers.ts (allowed request URLs only; no coordinate in
 * any URL, body or header), these tests inspect what the app KEEPS: localStorage, sessionStorage,
 * cookies, IndexedDB and Cache Storage, after a session that uses every feature that touches a
 * position or a choice. The coordinates searched for are the mocked latitudes and longitudes to
 * 3 decimals (`coordinateStrings`).
 */

type Stored = {
  readonly local: Record<string, string>;
  readonly session: Record<string, string>;
  readonly cookie: string;
  readonly databases: string[];
  /** Cache name -> the URLs of its entries. */
  readonly caches: Record<string, string[]>;
  /** `<cache> <url>` of every cache entry whose body (gunzipped when it is a .gz) holds a needle. */
  readonly bodyHits: string[];
};

/** Reads everything the page keeps, and searches every cached body for the given strings. */
async function stored(page: Page, needles: string[]): Promise<Stored> {
  return page.evaluate(async (wanted) => {
    const text = async (response: Response, gz: boolean): Promise<string> => {
      const body = gz
        ? response.clone().body?.pipeThrough(new DecompressionStream('gzip'))
        : response.clone().body;
      return new TextDecoder('latin1').decode(await new Response(body).arrayBuffer());
    };
    const caches_: Record<string, string[]> = {};
    const bodyHits: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      const urls: string[] = [];
      caches_[name] = urls;
      for (const request of await cache.keys()) {
        urls.push(request.url);
        const response = await cache.match(request);
        if (response === undefined) {
          continue;
        }
        const body = await text(response, request.url.endsWith('.gz'));
        if (wanted.some((needle) => body.includes(needle) || request.url.includes(needle))) {
          bodyHits.push(`${name} ${request.url}`);
        }
      }
    }
    return {
      local: Object.fromEntries(Object.entries(localStorage)),
      session: Object.fromEntries(Object.entries(sessionStorage)),
      cookie: document.cookie,
      databases: (await indexedDB.databases()).map((d) => d.name ?? ''),
      caches: caches_,
      bodyHits,
    };
  }, needles);
}

const choose = (page: Page) => page.getByRole('button', { name: /^Choose this route: Alpha,/ });

test.describe('what the app keeps', () => {
  test('after a session with fixes, a lock, search and the map, only settings and a lock flag are stored', async ({
    page,
    context,
    traffic,
  }) => {
    const needles = coordinateStrings();
    await page.clock.install();
    await openAndInstall(page);

    // Fixes everywhere, then a lock.
    for (const place of [PLACES.chain, PLACES.secondProvince, PLACES.border, PLACES.diamond]) {
      await moveTo(context, place);
      await expect(page.locator('#card-headline')).toBeVisible();
      await page.waitForTimeout(1100); // let the app tick on the new fix
    }
    await expect(headline(page)).toHaveText('Route not certain: a crossing (diamond) is nearby');
    await choose(page).click();
    await expect(card(page).locator('.chip--locked')).toBeVisible();

    // The lock flag is a bare "1" in sessionStorage, with no id and no coordinate.
    let keep = await stored(page, needles);
    expect(Object.keys(keep.session)).toEqual(['cantre.lockWasSet']);
    expect(keep.session['cantre.lockWasSet']).toBe('1');

    // Settings, find-a-location, the map with a tap, and a stale fix.
    await openScreen(page, 'Settings');
    await page.getByRole('radio', { name: 'Kilometres' }).check();
    await page.getByRole('radio', { name: 'Français' }).check();
    await page.getByRole('button', { name: 'Retour à la position' }).click();
    const find = page.locator('section.find');
    await find.getByLabel('Subdivision').selectOption({ label: 'Alpha (CN)' });
    await find.getByLabel('Point milliaire (milles)').fill('12');
    await find.locator('button[type=submit]').click();
    await expect(find.locator('.find__result li')).toHaveCount(1);
    await page.locator('section.map-panel button[aria-expanded]').click();
    await expect(page.locator('.map__canvas canvas')).toBeVisible();
    await page.locator('.map__canvas').click();
    await expect(page.locator('.map__tap')).toBeVisible();
    await page.clock.fastForward(16_000);
    await expect(headline(page)).toContainText('Historique');

    keep = await stored(page, needles);
    // localStorage: exactly one key, three settings, no position, route or lock.
    expect(Object.keys(keep.local)).toEqual(['cantre.settings.v1']);
    expect(JSON.parse(keep.local['cantre.settings.v1'] ?? '{}')).toEqual({
      units: 'km',
      lang: 'fr',
      basemap: false,
    });
    // sessionStorage: at most the lock flag.
    expect(Object.keys(keep.session)).toEqual(['cantre.lockWasSet']);
    expect(keep.session['cantre.lockWasSet']).toBe('1');
    // No cookie, no IndexedDB database.
    expect(keep.cookie).toBe('');
    expect(await context.cookies()).toEqual([]);
    expect(keep.databases).toEqual([]);
    // Cache Storage: the app shell's precache and the data, nothing else.
    const names = Object.keys(keep.caches);
    expect(
      names.every(
        (n) =>
          n.startsWith('workbox-precache') ||
          n === 'cantre-shell-maplibre' ||
          n.startsWith('cantre-data-'),
      ),
    ).toBe(true);
    expect(names.filter((n) => n.startsWith('cantre-data-'))).toHaveLength(1);
    // The data cache holds exactly the three keys the data client names (nothing is fetched from
    // them); every other cache holds only files of the app itself, at most with Workbox's content
    // hash as the query.
    for (const [name, urls] of Object.entries(keep.caches)) {
      if (name.startsWith('cantre-data-')) {
        expect([...urls].sort()).toEqual([
          'https://cantre.invalid/data/asset-details.json.gz',
          'https://cantre.invalid/data/manifest.json',
          'https://cantre.invalid/data/snapshot.bin.gz',
        ]);
        continue;
      }
      for (const url of urls) {
        expect(new URL(url).origin).toBe(new URL(page.url()).origin);
        expect(new URL(url).search).toMatch(/^(\?__WB_REVISION__=[0-9a-f]{32})?$/);
      }
    }
    // No stored URL, and no stored body (the data is searched after gunzip), holds a coordinate.
    expect(keep.bodyHits).toEqual([]);
    for (const value of [...Object.values(keep.local), ...Object.values(keep.session)]) {
      for (const needle of needles) {
        expect(value).not.toContain(needle);
      }
    }

    // Unlocking removes the flag: nothing about the choice remains.
    await page.getByRole('button', { name: 'Déverrouiller' }).click();
    await expect.poll(async () => Object.keys((await stored(page, [])).session)).toEqual([]);

    // The basemap host was never asked for.
    expect(traffic.urls().filter((u) => new URL(u).host === BASEMAP_HOST)).toEqual([]);
  });

  test('the map files cached at run time hold no position, and IndexedDB is still empty', async ({
    page,
    context,
  }) => {
    const needles = coordinateStrings();
    await openAndInstall(page);
    // The service worker only takes over the page on the next load.
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await expect(headline(page)).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
      .toBe(true);

    await moveTo(context, PLACES.chain);
    await expect(card(page).locator('.card__mp')).toBeVisible();
    await page.locator('section.map-panel button[aria-expanded]').click();
    await expect(page.locator('.map__canvas canvas')).toBeVisible();
    await page.locator('.map__canvas').click();
    await expect(page.locator('.map__tap')).toBeVisible();

    await expect
      .poll(async () => (await stored(page, needles)).caches['cantre-shell-maplibre']?.length ?? 0)
      .toBeGreaterThan(0);
    const keep = await stored(page, needles);
    // The runtime cache holds only the map library's own same-origin files.
    for (const url of keep.caches['cantre-shell-maplibre'] ?? []) {
      expect(new URL(url).pathname).toMatch(/^\/assets\/maplibre-gl[\w.-]*$/);
    }
    expect(keep.bodyHits).toEqual([]);
    expect(keep.databases).toEqual([]);
    expect(Object.keys(keep.local)).toEqual(['cantre.settings.v1'].filter((k) => k in keep.local));
  });

  test('a lock flag is the only thing a reload remembers, and it holds no id', async ({
    page,
    context,
  }) => {
    await openAndInstall(page);
    await moveTo(context, PLACES.diamond);
    await choose(page).click();
    const raw = await page.evaluate(() => JSON.stringify(sessionStorage));
    expect(raw).toBe('{"cantre.lockWasSet":"1"}');
    await page.reload();
    await expect(page.getByText('Lock cleared on reload.')).toBeVisible();
    // Read once and removed at start-up.
    expect(await page.evaluate(() => JSON.stringify(sessionStorage))).toBe('{}');
  });
});

test.describe('what the app sends', () => {
  test('moving the device causes no request at all', async ({ page, context, traffic }) => {
    await openAndInstall(page);
    await moveTo(context, PLACES.chain);
    await expect(card(page).locator('.card__mp')).toBeVisible();
    await page.waitForTimeout(500);
    const before = traffic.urls().length;
    for (const place of [
      PLACES.secondProvince,
      PLACES.border,
      PLACES.diamond,
      PLACES.coverageEdge,
      PLACES.offNetwork,
      PLACES.chain,
    ]) {
      await moveTo(context, place);
      await page.waitForTimeout(1100);
    }
    await expect(card(page).locator('.card__mp')).toHaveText('MP 11.91');
    expect(traffic.urls().length).toBe(before);
  });

  test('the requests are the same wherever the device is', async ({ browser, baseURL }) => {
    const urlsFor = async (place: (typeof PLACES)[keyof typeof PLACES]): Promise<string[]> => {
      const context = await browser.newContext({
        baseURL: baseURL ?? '',
        permissions: ['geolocation'],
        geolocation: place,
      });
      try {
        const seen: string[] = [];
        context.on('request', (r) => {
          if (r.url().startsWith('http')) {
            seen.push(r.url());
          }
        });
        const page = await context.newPage();
        await openAndInstall(page);
        await expect(headline(page)).not.toHaveText('Waiting for a GPS fix');
        await page.locator('section.map-panel button[aria-expanded]').click();
        await expect(page.locator('.map__canvas canvas')).toBeVisible();
        await page.waitForTimeout(500);
        const unique = [...new Set(seen)].sort();
        for (const url of unique) {
          expect(disallowed(url, new URL(baseURL ?? '').origin, false), url).toBeNull();
        }
        return unique;
      } finally {
        await context.close();
      }
    };
    const a = await urlsFor(PLACES.chain);
    const b = await urlsFor(PLACES.secondProvince);
    const c = await urlsFor(PLACES.offNetwork);
    expect(a.length).toBeGreaterThan(5);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  test('settings and about say what is stored and where the data is from', async ({ page }) => {
    await openAndInstall(page);
    await openScreen(page, 'Settings');
    // Everything the storage checks above find is named: the settings, the per-tab lock flag,
    // the app-shell and map-library caches and the data cache.
    const storage = page.getByText(/^What is stored on this device:/);
    await expect(storage).toBeVisible();
    for (const part of [
      "your settings (units, language and the basemap choice) in the browser's local storage",
      'for this browser tab only, a flag saying that a route lock was set',
      "the app's own files and the map library, kept so the app opens offline",
      'the downloaded rail data',
      'Your position, the route you chose and your movements are never stored or sent.',
    ]) {
      await expect(storage).toContainText(part);
    }
    await backToPosition(page);
    await openScreen(page, 'About');
    await expect(
      page.getByText('Contains information licensed under the Open Government Licence – Canada'),
    ).toBeVisible();
    // The third-party notices are linked from About and are served with the site.
    const link = page.getByRole('link', { name: /Third-party software notices/ });
    await expect(link).toHaveAttribute('href', 'third-party-licenses.txt');
    const response = await page.request.get('/third-party-licenses.txt');
    expect(response.ok()).toBe(true);
    const text = await response.text();
    expect(text).toContain('maplibre-gl 6.13.0');
    expect(text).toContain('preact 11.0.1');
    expect(text).toContain('Redistributions in binary form must reproduce');
  });
});

test.describe('the checks themselves', () => {
  const ORIGIN = 'http://127.0.0.1:4179';

  test('the request allowlist accepts the app and data files and rejects anything else', () => {
    const ok = [
      `${ORIGIN}/`,
      `${ORIGIN}/index.html`,
      `${ORIGIN}/assets/index-AbC123.js`,
      `${ORIGIN}/data/manifest.json`,
      `${ORIGIN}/data/nrwn-national-4ecefe56-cantre.0.1.0/snapshot.bin.gz`,
      `${ORIGIN}/data/nrwn-national-4ecefe56-cantre.0.1.0/asset-details.json.gz`,
      'blob:http://127.0.0.1:4179/0f2f',
    ];
    for (const url of ok) {
      expect(disallowed(url, ORIGIN, false), url).toBeNull();
    }
    const bad = [
      `${ORIGIN}/data/manifest.json?lat=52.1`,
      `${ORIGIN}/data/manifest.json#x`,
      `${ORIGIN}/api/locate`,
      `${ORIGIN}/data/tiles/208_-212.json`,
      'https://example.com/index.html',
      `https://${BASEMAP_HOST}/styles/liberty`,
    ];
    for (const url of bad) {
      expect(disallowed(url, ORIGIN, false), url).not.toBeNull();
    }
    // The basemap host is allowed only once the user has consented.
    expect(disallowed(`https://${BASEMAP_HOST}/styles/liberty`, ORIGIN, true)).toBeNull();
    expect(disallowed('https://example.com/x', ORIGIN, true)).not.toBeNull();
  });

  test('the coordinate strings are the mocked fixes to 3 decimals', () => {
    const strings = coordinateStrings();
    expect(strings).toEqual(expect.arrayContaining(['52.100', '-106.050', '-105.850', '54.210']));
  });

  test('the stored-data scan finds a coordinate in a cached body and in a cached URL', async ({
    page,
  }) => {
    await openAndInstall(page);
    await page.evaluate(async () => {
      const cache = await caches.open('cantre-test-seed');
      await cache.put('/seed-body.txt', new Response('lat=52.100'));
      await cache.put('/seed-url-54.210.txt', new Response('x'));
    });
    const keep = await stored(page, coordinateStrings());
    expect(keep.bodyHits).toEqual([
      'cantre-test-seed http://127.0.0.1:4179/seed-body.txt',
      'cantre-test-seed http://127.0.0.1:4179/seed-url-54.210.txt',
    ]);
  });
});
