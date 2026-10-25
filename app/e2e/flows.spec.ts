import { readFileSync } from 'node:fs';
import {
  BASEMAP_HOST,
  PLACES,
  TRACK_RGB,
  backToPosition,
  card,
  countColour,
  expect,
  headline,
  installData,
  moveTo,
  openAndInstall,
  openApp,
  openScreen,
  test,
} from './helpers';

/**
 * User flows against the built app, on the synthetic two-province network (invented data; see
 * pipeline/tests/fixtures/synthetic.py). Every test also passes the request rules in helpers.ts
 * (allowed files only, no coordinates), because they all use that `test`.
 *
 * What the status card says is what the matcher's `Result` says: these tests check the words the
 * app shows for a status, never a computed value of their own. The mileposts below are the
 * decoded fixture's (Alpha main line, interpolated between its crossings).
 */

const choose = (page: import('@playwright/test').Page, subdivision: string) =>
  page.getByRole('button', { name: new RegExp(`^Choose this route: ${subdivision},`) });

test.describe('first run and a fix on a chain', () => {
  test('asks first, downloads on the button, then shows MATCHED with a milepost', async ({
    page,
    traffic,
  }) => {
    await openApp(page);
    await expect(page.getByRole('heading', { name: 'Get the rail data' })).toBeVisible();
    // Only the small manifest is fetched until the user presses the button.
    const button = page.getByRole('button', { name: /^Download data for Canada \(\d+\.\d MB\)$/ });
    await expect(button).toBeVisible();
    expect(traffic.urls().some((u) => u.includes('snapshot.bin.gz'))).toBe(false);
    expect(traffic.urls().some((u) => u.endsWith('/data/manifest.json'))).toBe(true);

    await button.click();
    await expect(headline(page)).toBeVisible();
    expect(traffic.urls().filter((u) => u.includes('snapshot.bin.gz'))).toHaveLength(1);
    expect(traffic.urls().filter((u) => u.includes('asset-details.json.gz'))).toHaveLength(1);

    await moveTo(page.context(), PLACES.chain);
    await expect(headline(page)).toHaveText('Matched to a track');
    await expect(card(page)).toContainText('Alpha');
    await expect(card(page)).toContainText('Route: auto');
    await expect(card(page).locator('.card__mp')).toHaveText('MP 11.91');
    // The honest labels: the band is GPS-only, the vintage is shown, nothing is a probability.
    await expect(card(page)).toContainText('from GPS accuracy only');
    await expect(card(page)).toContainText('Data: 2026-01-02');
    await expect(card(page)).not.toContainText(/confidence|probab|%/i);
    await expect(
      page.getByText('Research software. Not for safety, operations or track access.'),
    ).toBeVisible();
  });

  test('a milepost from unverified reference points is labelled as such', async ({
    page,
    context,
  }) => {
    await openAndInstall(page);
    await moveTo(context, PLACES.secondProvince);
    await expect(headline(page)).toHaveText('Matched to a track');
    await expect(card(page).locator('.card__mp')).toHaveText('MP 201.06');
    await expect(card(page).locator('.badge--unverified')).toContainText(
      'Unverified reference points',
    );
  });

  test('off every track gives OFF_NETWORK and no milepost', async ({ page, context }) => {
    await openAndInstall(page);
    await moveTo(context, PLACES.offNetwork);
    await expect(headline(page)).toHaveText('Not on a mapped track');
    await expect(card(page).locator('.card__mp')).toHaveCount(0);
  });
});

test.describe('ambiguity, the chooser and the lock', () => {
  test('a fix at the diamond is AMBIGUOUS_ROUTE with no milepost; choose locks, unlock returns', async ({
    page,
    context,
  }) => {
    await openAndInstall(page);
    await moveTo(context, PLACES.diamond);
    await expect(headline(page)).toHaveText('More than one route fits');
    await expect(card(page)).toContainText('A crossing of two tracks is nearby');
    await expect(card(page).locator('.card__mp')).toHaveCount(0);
    // The synthetic diamond is registered on one chain, so the chooser lists the one route the
    // data holds there (the two-route chooser is the border test below).
    const chooser = page.locator('section.chooser');
    await expect(chooser.locator('li')).toHaveCount(1);
    await expect(chooser).toContainText('Your choice does not make the GPS more precise.');

    await choose(page, 'Alpha').click();
    await expect(card(page).locator('.chip--locked')).toContainText('Locked: Alpha');
    await expect(headline(page)).toHaveText('Matched to a track');
    await expect(card(page)).toContainText('The route is the one you chose.');
    // The choice does not change the GPS accuracy shown.
    await expect(card(page)).toContainText('GPS accuracy ± 5 m');

    await page.getByRole('button', { name: 'Unlock' }).click();
    await expect(headline(page)).toHaveText('More than one route fits');
    await expect(card(page).locator('.chip--auto')).toHaveText('Route: auto');
    await expect(chooser.locator('li')).toHaveCount(1);
  });

  test('a fix at the outer edge of the coverage is AMBIGUOUS_ROUTE, shown as partial coverage', async ({
    page,
    context,
  }) => {
    await openAndInstall(page);
    await moveTo(context, PLACES.coverageEdge);
    await expect(headline(page)).toHaveText('More than one route fits');
    await expect(card(page)).toContainText(
      'Part of the search area is outside the loaded data, so a nearer track may be missing.',
    );
    await expect(card(page).locator('.card__mp')).toHaveCount(0);
    await expect(card(page)).not.toContainText(/\bMP \d/);
  });

  // A device that is first seen at the border has no earlier match to carry over, so both
  // provinces' chains are candidates. (A device that arrives from the Alpha line keeps that match
  // by continuity: the matcher's rule, not the border's.)
  test.describe('starting at the border', () => {
    test.use({ geolocation: PLACES.border });

    test('at the shared border both provinces are candidates and no milepost is bridged', async ({
      page,
    }) => {
      await openAndInstall(page);
      await expect(headline(page)).toHaveText('More than one route fits');
      await expect(card(page)).toContainText('Tracks of different routes are close together');
      await expect(card(page).locator('.card__mp')).toHaveCount(0);
      await expect(card(page)).not.toContainText(/\bMP \d/);
      const items = page.locator('section.chooser li');
      await expect(items).toHaveCount(2);
      await expect(items.nth(0)).toContainText('Border East');
      await expect(items.nth(1)).toContainText('Alpha');

      // Choosing the second province's route locks it; unlocking returns to the chooser.
      await choose(page, 'Border East').click();
      await expect(card(page).locator('.chip--locked')).toContainText('Locked: Border East');
      await expect(card(page).locator('.card__mp')).toHaveCount(0);
      await page.getByRole('button', { name: 'Unlock' }).click();
      await expect(headline(page)).toHaveText('More than one route fits');
      await expect(items).toHaveCount(2);
    });

    test('a conflicting fix keeps the visible lock, names it, and Unlock is available', async ({
      page,
      context,
    }) => {
      await openAndInstall(page);
      await choose(page, 'Alpha').click();
      await expect(card(page).locator('.chip--locked')).toContainText('Locked: Alpha');

      // The device moves onto the other province's chain: the chosen route no longer fits.
      await moveTo(context, PLACES.secondProvince);
      await expect(headline(page)).toHaveText('Your chosen route does not fit this fix');
      const chip = card(page).locator('.chip--locked');
      await expect(chip).toContainText('Locked: Alpha'); // the name, never the internal id
      await expect(chip).not.toContainText(/ch_/);
      await expect(chip.getByRole('button', { name: 'Unlock' })).toBeVisible();
      await expect(card(page).locator('.card__mp')).toHaveCount(0);
      await expect(page.locator('section.chooser')).toContainText('Pick another route, or unlock.');

      await chip.getByRole('button', { name: 'Unlock' }).click();
      await expect(headline(page)).toHaveText('Matched to a track');
      await expect(card(page).locator('.card__mp')).toHaveText('MP 201.06');
    });
  });

  test('the lock is cleared by a reload, and the app says so once', async ({ page, context }) => {
    await openAndInstall(page);
    await moveTo(context, PLACES.diamond);
    await choose(page, 'Alpha').click();
    await expect(card(page).locator('.chip--locked')).toBeVisible();

    await page.reload();
    const notice = page.getByText('Lock cleared on reload. Choose the route again if you need it.');
    await expect(notice).toBeVisible();
    await expect(headline(page)).toHaveText('More than one route fits');
    await expect(card(page).locator('.chip--auto')).toBeVisible();
    await page.getByRole('button', { name: 'Dismiss' }).click();
    await expect(notice).toHaveCount(0);

    // Once only: a second reload (no lock was set meanwhile) shows nothing.
    await page.reload();
    await expect(headline(page)).toBeVisible();
    await expect(notice).toHaveCount(0);
  });
});

test.describe('GPS lifecycle', () => {
  test.describe('permission denied', () => {
    test.use({ permissions: [] });
    test('shows NO_PERMISSION with the reason', async ({ page }) => {
      await openAndInstall(page);
      await expect(headline(page)).toHaveText('Location permission is off');
      await expect(card(page)).toContainText('Location permission was denied.');
      await expect(card(page).locator('.card__mp')).toHaveCount(0);
    });
  });

  test('fixes that stop for 16 s become STALE, labelled historical, with no current milepost', async ({
    page,
    context,
  }) => {
    await page.clock.install(); // from the system time; the fix timestamps come from the browser
    await openAndInstall(page);
    await moveTo(context, PLACES.chain);
    await expect(headline(page)).toHaveText('Matched to a track');
    await expect(card(page).locator('.card__mp')).toHaveText('MP 11.91');

    await page.clock.fastForward(16_000);
    await expect(headline(page)).toHaveText('Historical: the last GPS fix is old');
    await expect(card(page)).toHaveClass(/card--historical/);
    await expect(card(page)).toContainText('Last known MP 11.91 (historical)');
    await expect(card(page)).toContainText('older than 15 seconds');
    await expect(card(page).locator('.card__mp')).not.toHaveText('MP 11.91');

    // A new fix makes it current again. The browser stamps fixes with the real time, so the
    // page's clock is set back to it first (the 16 s jump was only to age the old fix).
    await page.clock.setSystemTime(Date.now());
    await moveTo(context, PLACES.secondProvince);
    await expect(headline(page)).toHaveText('Matched to a track');
    await expect(card(page).locator('.card__mp')).toHaveText('MP 201.06');
  });
});

test.describe('find a location, language, units', () => {
  test('find by subdivision and milepost works without GPS and drops a pin on the map', async ({
    page,
  }) => {
    await openAndInstall(page);
    const find = page.locator('section.find');
    await find.getByLabel('Subdivision').selectOption({ label: 'Alpha (CN)' });
    await find.getByLabel('Milepost (miles)').fill('12');
    await find.getByRole('button', { name: 'Find' }).click();
    const pin = find.locator('.find__result li');
    await expect(pin).toHaveCount(1);
    await expect(pin).toContainText(
      /Alpha \(CN\): MP 12\.00 at latitude 52\.1\d*, longitude -106\.\d+/,
    );
    await expect(find).toContainText('not surveyed, and not a GPS position');

    // A milepost outside the calibrated ranges gives a message, not a guessed position.
    await find.getByLabel('Milepost (miles)').fill('500');
    await find.getByRole('button', { name: 'Find' }).click();
    await expect(find.locator('.find__result')).toContainText('Positions are never guessed');
    await expect(pin).toHaveCount(0);

    await find.getByLabel('Milepost (miles)').fill('12');
    await find.getByRole('button', { name: 'Find' }).click();
    await find.getByRole('button', { name: 'Show on map' }).click();
    const toggle = page.getByRole('button', { name: 'Hide map' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.map__canvas canvas')).toBeVisible();
    await expect(page.locator('.map__status')).toHaveCount(0);
    // The pin is drawn at the centre of the map (the view was fitted to it).
    const shot = await page.locator('.map__canvas').screenshot();
    await expect
      .poll(async () =>
        countColour(page.context(), shot, TRACK_RGB, 24, { x: 0.45, y: 0.45, w: 0.1, h: 0.1 }),
      )
      .toBeGreaterThan(0);
  });

  test('switching to French shows the French text for the visible status', async ({
    page,
    context,
  }) => {
    await openAndInstall(page);
    await moveTo(context, PLACES.chain);
    await expect(headline(page)).toHaveText('Matched to a track');
    await openScreen(page, 'Settings');
    await page.getByRole('radio', { name: 'Français' }).check();
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(page.getByRole('heading', { level: 2, name: 'Paramètres' })).toBeVisible();
    await page.getByRole('button', { name: 'Retour à la position' }).click();
    await expect(headline(page)).toHaveText('Associé à une voie');
    await expect(card(page).locator('.card__mp')).toHaveText('PM 11,91');
    await expect(card(page)).toContainText('selon la précision du GPS seulement');
    await moveTo(context, PLACES.diamond);
    await expect(headline(page)).toHaveText("Plus d'un itinéraire possible");
    await expect(page.getByRole('heading', { name: 'Choisissez votre itinéraire' })).toBeVisible();
  });

  test('kilometres change distances only; the milepost stays in miles and says so', async ({
    page,
    context,
  }) => {
    await openAndInstall(page);
    await moveTo(context, PLACES.chain);
    await expect(card(page).locator('.card__mp')).toHaveText('MP 11.91');
    await openScreen(page, 'Settings');
    await page.getByRole('radio', { name: 'Kilometres' }).check();
    await backToPosition(page);
    await expect(card(page).locator('.card__mp')).toHaveText('MP 11.91');
    await expect(card(page)).toContainText(
      'Mileposts are numbered in miles and are not converted.',
    );
    await expect(card(page)).toContainText(/km, from GPS accuracy only/);
  });
});

test.describe('data updates', () => {
  const nextManifest = readFileSync(
    new URL('./fixtures/next-manifest.json', import.meta.url),
    'utf8',
  );
  const next = JSON.parse(nextManifest) as {
    datasetVersion: string;
    snapshot: { path: string };
  };

  test('a new dataset version clears the lock, visibly, and replaces the old data', async ({
    page,
    context,
  }) => {
    await openAndInstall(page);
    await moveTo(context, PLACES.diamond);
    await choose(page, 'Alpha').click();
    await expect(card(page).locator('.chip--locked')).toBeVisible();

    // The site now publishes a new build: the manifest names a new dataset version.
    await page.route('**/data/manifest.json', (route) =>
      route.fulfill({ contentType: 'application/json', body: nextManifest }),
    );
    await openScreen(page, 'Offline data');
    await expect(
      page.getByText('A newer data set is available: snapshot 2026-01-02.'),
    ).toBeVisible();
    await page.getByRole('button', { name: /^Update data \(/ }).click();
    await expect(page.getByText('The data is installed')).toBeAttached();
    await backToPosition(page);

    const notice = page.getByText(
      'Lock cleared because the data was updated. Choose the route again if you need it.',
    );
    await expect(notice).toBeVisible();
    await expect(card(page).locator('.chip--auto')).toBeVisible(); // no lock was migrated
    await expect(headline(page)).toHaveText('More than one route fits');
    await page.getByRole('button', { name: 'Dismiss' }).click();
    await expect(notice).toHaveCount(0);

    // Only the new version is stored.
    const names = await page.evaluate(() => caches.keys());
    expect(names.filter((n) => n.startsWith('cantre-data-'))).toEqual([
      `cantre-data-${next.datasetVersion}`,
    ]);
  });

  test('a download that fails its hash shows a typed error with a retry and keeps the old data', async ({
    page,
    context,
  }) => {
    await openAndInstall(page);
    await moveTo(context, PLACES.chain);
    await expect(card(page).locator('.card__mp')).toHaveText('MP 11.91');
    const before = (await page.evaluate(() => caches.keys())).filter((n) =>
      n.startsWith('cantre-data-'),
    );
    expect(before).toHaveLength(1);

    await page.route('**/data/manifest.json', (route) =>
      route.fulfill({ contentType: 'application/json', body: nextManifest }),
    );
    // The new snapshot arrives with one byte changed: same length, wrong hash.
    await page.route(`**/data/${next.snapshot.path}`, async (route) => {
      const response = await route.fetch();
      const body = await response.body();
      body[body.length - 1] = (body[body.length - 1] ?? 0) ^ 0xff;
      await route.fulfill({ response, body });
    });
    await openScreen(page, 'Offline data');
    await page.getByRole('button', { name: /^Update data \(/ }).click();
    const alert = page.getByRole('alert').filter({ hasText: 'integrity check' });
    await expect(alert).toContainText(
      'The data did not pass its integrity check and was not used.',
    );
    await expect(alert.getByRole('button', { name: 'Try again' })).toBeVisible();

    // The old version is still installed and still in use.
    expect(
      (await page.evaluate(() => caches.keys())).filter((n) => n.startsWith('cantre-data-')),
    ).toEqual(before);
    await expect(page.locator('.facts .mono')).toHaveText(
      before[0]?.replace('cantre-data-', '') ?? '',
    );
    await backToPosition(page);
    await expect(card(page).locator('.card__mp')).toHaveText('MP 11.91');

    // Retry once the file is right: it installs.
    await page.unroute(`**/data/${next.snapshot.path}`);
    await openScreen(page, 'Offline data');
    await page.getByRole('button', { name: /^Update data \(/ }).click();
    await expect(page.getByText('The data is installed')).toBeAttached();
    expect(
      (await page.evaluate(() => caches.keys())).filter((n) => n.startsWith('cantre-data-')),
    ).toEqual([`cantre-data-${next.datasetVersion}`]);
  });

  test('a download that is cut short is rejected and the first run can retry', async ({ page }) => {
    await openApp(page);
    let calls = 0;
    await page.route('**/snapshot.bin.gz', async (route) => {
      calls += 1;
      if (calls === 1) {
        const response = await route.fetch();
        await route.fulfill({ response, body: (await response.body()).subarray(0, 100) });
      } else {
        await route.continue();
      }
    });
    await page.getByRole('button', { name: /^Download data for Canada/ }).click();
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('The data could not be downloaded.');
    expect(await page.evaluate(() => caches.keys())).not.toContain(
      expect.stringMatching(/^cantre-data-/),
    );
    await alert.getByRole('button', { name: 'Try again' }).click();
    await expect(headline(page)).toBeVisible();
  });
});

test.describe('the map and the basemap consent', () => {
  test('with the basemap off the map draws the tracks and asks nothing of the basemap host; a tap says it is not GPS', async ({
    page,
    context,
    traffic,
  }) => {
    await openAndInstall(page);
    await moveTo(context, PLACES.chain);
    await expect(headline(page)).toHaveText('Matched to a track');
    await page.getByRole('button', { name: 'Show map' }).click();
    await expect(page.getByText('The basemap is off.')).toBeVisible();
    await expect(page.locator('.map__canvas canvas')).toBeVisible();
    await expect(page.locator('.map__status')).toHaveCount(0);
    await expect(page.locator('.map__attribution')).toContainText(
      'Contains information licensed under the Open Government Licence – Canada',
    );
    await expect(page.locator('.map__attribution')).not.toContainText('OpenStreetMap');

    // The map is centred on the fix: the track runs through the middle of the view.
    await expect
      .poll(async () => {
        const shot = await page.locator('.map__canvas').screenshot();
        return countColour(context, shot, TRACK_RGB, 24);
      })
      .toBeGreaterThan(100);

    // Tap the map at the fix: the milepost at that spot, labelled as not from GPS.
    await page.locator('.map__canvas').click();
    const tap = page.locator('.map__tap');
    await expect(tap.getByRole('heading')).toHaveText('From map position, no GPS');
    await expect(tap).toContainText('Alpha, Main');
    await expect(tap).toContainText(/MP 11\.9\d/);
    // The tap never became a fix: the card still shows the GPS fix's own milepost.
    await expect(card(page).locator('.card__mp')).toHaveText('MP 11.91');

    expect(traffic.urls().filter((u) => new URL(u).host === BASEMAP_HOST)).toEqual([]);
  });

  test('after consent a blocked basemap host falls back with a message and the tracks still draw', async ({
    page,
    context,
    traffic,
  }) => {
    traffic.basemapConsented = true; // this test has the user's consent; the host is blocked below
    await context.route(`**://${BASEMAP_HOST}/**`, (route) => route.abort('failed'));
    await openAndInstall(page);
    await moveTo(context, PLACES.chain);
    await expect(headline(page)).toHaveText('Matched to a track');
    await page.getByRole('button', { name: 'Show map' }).click();
    expect(traffic.urls().filter((u) => new URL(u).host === BASEMAP_HOST)).toEqual([]);

    // Turning it on first shows the notice; nothing is requested until it is accepted.
    await page.getByRole('button', { name: 'Turn on basemap' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText(
      'That request tells OpenFreeMap which area you are looking at.',
    );
    await expect(dialog).toContainText('Your GPS position is not sent');
    expect(traffic.urls().filter((u) => new URL(u).host === BASEMAP_HOST)).toEqual([]);
    await dialog.getByRole('button', { name: 'Turn on basemap' }).click();

    await expect(
      page.getByText('The basemap could not be loaded, so the plain background is shown.'),
    ).toBeVisible();
    expect(traffic.urls().some((u) => new URL(u).host === BASEMAP_HOST)).toBe(true);
    await expect
      .poll(async () => {
        const shot = await page.locator('.map__canvas').screenshot();
        return countColour(context, shot, TRACK_RGB, 24);
      })
      .toBeGreaterThan(100);
    await expect(page.locator('.map__attribution')).not.toContainText('OpenStreetMap');
    // The consent is the one thing remembered, in settings.
    const settings = await page.evaluate(() => localStorage.getItem('cantre.settings.v1'));
    expect(JSON.parse(settings ?? '{}')).toMatchObject({ basemap: true });
  });
});

test.describe('offline', () => {
  test('after the first load the shell and the installed data open with no network', async ({
    page,
    context,
  }) => {
    await openAndInstall(page);
    // Wait until the service worker is active and has stored the app shell.
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const keys = await caches.keys();
          const precache = keys.find((k) => k.includes('precache'));
          return precache === undefined ? 0 : (await (await caches.open(precache)).keys()).length;
        }),
      )
      .toBeGreaterThan(0);

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'CANTRE' })).toBeVisible();
    await expect(headline(page)).toBeVisible(); // the installed data loads from this device
    await moveTo(context, PLACES.chain);
    await expect(card(page).locator('.card__mp')).toHaveText('MP 11.91');
    await context.setOffline(false);
  });

  test('removing the data returns to the first-run screen', async ({ page }) => {
    await openAndInstall(page);
    await openScreen(page, 'Offline data');
    await page.getByRole('button', { name: 'Remove data' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remove data' }).click();
    await expect(page.getByRole('heading', { name: 'Get the rail data' })).toBeVisible();
    expect(
      (await page.evaluate(() => caches.keys())).filter((n) => n.startsWith('cantre-data-')),
    ).toEqual([]);
    await installData(page);
  });
});
