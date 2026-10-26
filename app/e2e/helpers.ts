import { expect, test as base } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';

/**
 * Shared pieces of the end-to-end tests.
 *
 * Every test in this folder uses {@link test}, which records EVERY request the browser makes
 * (page, workers and map) and, when the test ends, asserts the privacy rules on them:
 * - each URL is one of the allowed files (the app's own files, the manifest, the snapshot and the
 *   asset-details file), with no query string or fragment; the basemap host only in a test that
 *   says the user consented;
 * - no URL, request body or request header holds a mocked latitude or longitude to 3 decimals.
 * So all flows double as privacy tests.
 */

/** The synthetic network's places. All data is invented (pipeline/tests/fixtures/synthetic.py). */
export type Place = { latitude: number; longitude: number; accuracy: number };

export const PLACES = {
  /** On the long Alpha main line, 3.4 km from the diamond: MATCHED, MP 11.91. */
  chain: { latitude: 52.1, longitude: -106.05, accuracy: 5 },
  /** On the golden diamond (a junction of kind Diamond): AMBIGUOUS_ROUTE / DIAMOND_NEARBY. */
  diamond: { latitude: 52.1, longitude: -106.0, accuracy: 5 },
  /** The shared border of the two fake provinces: the end of one chain, the start of the other. */
  border: { latitude: 52.1, longitude: -105.9, accuracy: 5 },
  /** On the second province's own chain, 3.4 km past the border: MATCHED, MP 201.06. */
  secondProvince: { latitude: 52.1, longitude: -105.85, accuracy: 5 },
  /** Near the snapshot's northern edge (coverage ends at 54.25 N), a 2 km search radius. */
  coverageEdge: { latitude: 54.21, longitude: -105.96, accuracy: 2000 },
  /** Nowhere near any track, inside the coverage. */
  offNetwork: { latitude: 52.3, longitude: -106.3, accuracy: 5 },
} as const satisfies Record<string, Place>;

/** The host the optional basemap is fetched from (decision D2). */
export const BASEMAP_HOST = 'tiles.openfreemap.org';

const APP_FILES: readonly RegExp[] = [
  /^\/$/,
  /^\/index\.html$/,
  /^\/registerSW\.js$/,
  /^\/sw\.js$/,
  /^\/sw-cleanup\.js$/,
  /^\/workbox-[\w-]+\.js$/,
  /^\/manifest\.webmanifest$/,
  /^\/third-party-licenses\.txt$/,
  /^\/assets\/[\w.-]+\.(js|mjs|css)$/,
  /^\/icons\/[\w.-]+\.png$/,
];
const DATA_FILES: readonly RegExp[] = [
  /^\/data\/manifest\.json$/,
  /^\/data\/[\w.-]+\/(snapshot\.bin\.gz|asset-details\.json\.gz)$/,
];

/** Why a request is not allowed, or null when it is. Only http(s) requests are network traffic. */
export function disallowed(rawUrl: string, origin: string, basemapAllowed: boolean): string | null {
  const url = new URL(rawUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return null; // data: and blob: URLs never leave the browser
  }
  if (url.host === BASEMAP_HOST) {
    return basemapAllowed ? null : 'basemap host requested without consent';
  }
  if (url.origin !== origin) {
    return 'other host';
  }
  if (url.search !== '' || url.hash !== '') {
    return 'query string or fragment';
  }
  return [...APP_FILES, ...DATA_FILES].some((re) => re.test(url.pathname))
    ? null
    : 'path is not an app file or a data file';
}

/** The strings a mocked position would show up as: latitude and longitude to 3 decimals. */
export function coordinateStrings(places: Iterable<Place> = Object.values(PLACES)): string[] {
  const out = new Set<string>();
  for (const p of places) {
    out.add(p.latitude.toFixed(3));
    out.add(p.longitude.toFixed(3));
  }
  return [...out];
}

export type Traffic = {
  /** Every request seen so far. */
  readonly seen: { readonly url: string; readonly method: string; readonly postData: string }[];
  /** Set by a test that has the user's consent to the basemap: its host is then allowed. */
  basemapConsented: boolean;
  /** Request URLs (http and https), in order. */
  urls(): string[];
};

export const test = base.extend<{ traffic: Traffic }>({
  traffic: [
    async ({ context, baseURL }, use) => {
      const origin = new URL(baseURL ?? 'http://127.0.0.1').origin;
      const headers: Promise<Record<string, string> | null>[] = [];
      const traffic: Traffic = {
        seen: [],
        basemapConsented: false,
        urls: () => traffic.seen.map((r) => r.url).filter((u) => u.startsWith('http')),
      };
      context.on('request', (request) => {
        traffic.seen.push({
          url: request.url(),
          method: request.method(),
          postData: request.postData() ?? '',
        });
        // A request that never finishes must not hold the test up: give each 2 s.
        headers.push(
          Promise.race([
            request.allHeaders().catch(() => null),
            new Promise<null>((resolve) =>
              setTimeout(() => {
                resolve(null);
              }, 2000),
            ),
          ]),
        );
      });
      await use(traffic);

      // The privacy rules, checked on everything the test made the browser send.
      const wanted = coordinateStrings();
      for (const request of traffic.seen) {
        expect(
          disallowed(request.url, origin, traffic.basemapConsented),
          `request ${request.method} ${request.url}`,
        ).toBeNull();
        for (const text of wanted) {
          expect(request.url, 'a coordinate in a URL').not.toContain(text);
          expect(request.postData, 'a coordinate in a request body').not.toContain(text);
        }
      }
      for (const found of await Promise.all(headers)) {
        const flat = JSON.stringify(found ?? {});
        for (const text of wanted) {
          expect(flat, 'a coordinate in request headers').not.toContain(text);
        }
      }
    },
    { auto: true },
  ],
});

export { expect };

/** Move the mocked device to a place. The page's `watchPosition` callback fires. */
export async function moveTo(context: BrowserContext, place: Place): Promise<void> {
  await context.setGeolocation(place);
}

/** Open the app. */
export async function openApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'CANTRE' })).toBeVisible();
}

/** First run: press the download button and wait until the data is installed and in use. */
export async function installData(page: Page): Promise<void> {
  await expect(page.locator('.hud-route')).toBeEnabled();
  await page.getByRole('button', { name: 'Position details', exact: true }).click();
  await expect(page.locator('#card-headline')).toBeVisible();
}

/** Open the app, install the data (first run) and wait for the first status card. */
export async function openAndInstall(page: Page): Promise<void> {
  await openApp(page);
  await installData(page);
}

/** The status card's headline element. */
export const headline = (page: Page) => page.locator('#card-headline');

/** The status card section. */
export const card = (page: Page) => page.locator('section.card');

/** Menu buttons ("Settings", "About", "Offline data") and "Back to position". */
export async function openScreen(
  page: Page,
  name: 'Settings' | 'About' | 'Offline data' | 'Find a location',
): Promise<void> {
  await closeSheet(page);
  await page.getByRole('button', { name: /^(Menu|RailHUD menu)$/, exact: true }).click();
  await page
    .getByRole('navigation')
    .getByRole('button', {
      name:
        name === 'Offline data'
          ? 'Data and sources'
          : name === 'Find a location'
            ? /^(Find a location|Trouver un emplacement)$/
            : name,
      exact: true,
    })
    .click();
}
export async function backToPosition(page: Page): Promise<void> {
  await details(page);
}

/**
 * Counts the pixels of a PNG screenshot that are within `tolerance` (per channel, 0-255) of an
 * RGB colour, optionally only inside `box` (fractions of the image: x, y, width, height). The
 * image is decoded by the browser, in a blank helper page of the same context (no network).
 */
export async function countColour(
  context: BrowserContext,
  png: Buffer,
  rgb: readonly [number, number, number],
  tolerance: number,
  box: { x: number; y: number; w: number; h: number } = { x: 0, y: 0, w: 1, h: 1 },
): Promise<number> {
  const helper = await context.newPage();
  try {
    return await helper.evaluate(
      async (input) => {
        const image = new Image();
        image.src = `data:image/png;base64,${input.base64}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext('2d');
        if (ctx === null) {
          throw new Error('no 2d canvas');
        }
        ctx.drawImage(image, 0, 0);
        const { x, y, w, h } = input.box;
        const data = ctx.getImageData(
          Math.floor(x * image.width),
          Math.floor(y * image.height),
          Math.max(1, Math.floor(w * image.width)),
          Math.max(1, Math.floor(h * image.height)),
        ).data;
        let count = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (
            Math.abs((data[i] ?? 0) - input.rgb[0]) <= input.tolerance &&
            Math.abs((data[i + 1] ?? 0) - input.rgb[1]) <= input.tolerance &&
            Math.abs((data[i + 2] ?? 0) - input.rgb[2]) <= input.tolerance
          ) {
            count += 1;
          }
        }
        return count;
      },
      { base64: png.toString('base64'), rgb, tolerance, box },
    );
  } finally {
    await helper.close();
  }
}

/** The track colour of the light theme (`PALETTE.light.track` in src/logic/mapdata.ts). */
export const TRACK_RGB = [0x0b, 0x4f, 0x9e] as const;

export async function closeSheet(page: Page): Promise<void> {
  const close = page.getByRole('button', { name: /^(Close|Fermer)$/ });
  if (await close.isVisible()) {
    await close.click();
    await expect(page.locator('dialog')).toHaveCount(0);
  }
}
export async function details(page: Page): Promise<void> {
  await closeSheet(page);
  await page.locator('.hud-reading').click();
  await expect(page.locator('dialog')).toBeVisible();
}
