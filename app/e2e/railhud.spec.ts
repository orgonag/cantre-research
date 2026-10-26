import {
  test,
  expect,
  openApp,
  openScreen,
  closeSheet,
  PLACES,
  countColour,
  TRACK_RGB,
} from './helpers';

// The installed Playwright 1.64.0 / WebKit 2370 mock emits epoch microseconds
// although its protocol is passed Date.now(). Correct this test-provider unit only;
// production's future-fix rejection remains intact. Physical GPS still needs device QA.
test.beforeEach(async ({ page, browserName }) => {
  if (browserName !== 'webkit') return;
  await page.addInitScript(() => {
    const original = navigator.geolocation.watchPosition.bind(navigator.geolocation);
    navigator.geolocation.watchPosition = (success, error, options) =>
      original(
        (p) => {
          success({
            coords: p.coords,
            timestamp: p.timestamp > 100 * Date.now() ? p.timestamp / 1000 : p.timestamp,
            toJSON: () => ({}),
          });
        },
        error,
        options,
      );
  });
});

/** The map-first contract; all traffic also goes through the privacy fixture. */
test('tapping a crossing shows only that feature; the menu still opens the full list', async ({
  page,
  context,
}) => {
  // Synthetic crossing X2 at P(-5.5, 52.1), centered under the GPS dot.
  await context.setGeolocation({ latitude: 52.1, longitude: -106.055, accuracy: 5 });
  await openApp(page);
  await expect(page.locator('.hud-mp')).not.toHaveText('—');
  const canvas = page.locator('.map__canvas');
  await expect(canvas.locator('canvas')).toBeVisible();
  await expect(async () => {
    if (!(await page.getByRole('dialog').isVisible())) await canvas.click();
    await expect(page.getByRole('dialog')).toBeVisible();
  }).toPass();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: 'Level crossing', exact: true })).toBeVisible();
  await expect(sheet.locator('li')).toHaveCount(1);
  await expect(sheet.locator('.feature-source')).not.toHaveAttribute('open', '');
  await expect(sheet.getByText('1002', { exact: true }).first()).toBeVisible();
  await expect(sheet.getByText('Transport Canada ID', { exact: true })).toBeVisible();
  await expect(sheet.getByText('TCID', { exact: true })).not.toBeVisible();
  await expect(sheet.getByText('Alpha', { exact: true })).toBeVisible();
  await expect(sheet.getByText('Published milepost', { exact: true })).toBeVisible();
  await expect(sheet.getByText('Calculated milepost', { exact: true })).toBeVisible();
  await expect(sheet.getByText('MP 11.7', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('feature-details.png') });
  await closeSheet(page);
  await openScreen(page, 'Visible assets');
  await expect(sheet.getByRole('heading', { name: 'Visible assets', exact: true })).toBeVisible();
  expect(await sheet.locator('li').count()).toBeGreaterThan(1);
});

test('first visit loads itself and the route picker works during a normal match', async ({
  page,
}, testInfo) => {
  await openApp(page);
  await expect(page.locator('.hud-mp')).toHaveText(/11\.9\d{2}/);
  await expect(page.locator('.map__canvas canvas')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('railhud.png') });
  await expect(page.getByRole('button', { name: /^Download/ })).toHaveCount(0);
  await page.locator('.hud-route').click();
  await page.getByRole('button', { name: /^Choose this route: Alpha/ }).click();
  await expect(page.locator('dialog')).toHaveCount(0);
  await expect(page.locator('.hud-lock')).toBeVisible();
  await page.locator('.hud-route').click();
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await closeSheet(page);
  await expect(page.locator('.hud-lock')).toHaveCount(0);
});

test('one GPS watch starts before delayed data and survives panels', async ({ page }) => {
  await page.addInitScript(() => {
    const original = navigator.geolocation.watchPosition.bind(navigator.geolocation);
    navigator.geolocation.watchPosition = (...args) => {
      document.documentElement.dataset['watches'] = String(
        Number(document.documentElement.dataset['watches'] ?? 0) + 1,
      );
      return original(...args);
    };
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/snapshot.bin.gz', async (route) => {
    await gate;
    await route.continue();
  });
  await openApp(page);
  await expect(page.locator('html')).toHaveAttribute('data-watches', '1');
  await expect(page.locator('.hud-route')).toBeDisabled();
  release();
  await expect(page.locator('.hud-mp')).toHaveText(/11\.9\d{2}/);
  const canvas = page.locator('.map__canvas canvas');
  await expect(canvas).toBeVisible();
  await canvas.evaluate((el) => {
    el.setAttribute('data-original', 'yes');
  });
  await page.getByRole('button', { name: /^Layers/ }).click();
  await page.getByRole('checkbox', { name: 'Level crossing', exact: true }).uncheck();
  await page.keyboard.press('Escape');
  await expect(canvas).toHaveAttribute('data-original', 'yes');
  await expect(page.locator('html')).toHaveAttribute('data-watches', '1');
  await page.reload();
  await expect(page.locator('.hud-route')).toBeEnabled();
  await page.getByRole('button', { name: /^Layers/ }).click();
  await expect(
    page.getByRole('checkbox', { name: 'Level crossing', exact: true }),
  ).not.toBeChecked();
});

test('drag pauses follow, new fixes do not resume it, recenter restores it', async ({
  page,
  context,
}) => {
  await openApp(page);
  await expect(page.locator('.hud-mp')).toHaveText(/11\.9\d{2}/);
  const canvas = page.locator('.map__canvas canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no map');
  await page.mouse.move(box.width * 0.5, box.height * 0.7);
  await page.mouse.down();
  await page.mouse.move(box.width * 0.7, box.height * 0.8, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('.hud-recenter')).toHaveAttribute('aria-pressed', 'false');
  await context.setGeolocation(PLACES.secondProvince);
  await expect(page.locator('.hud-mp')).toHaveText(/201\.0\d{2}/);
  await expect(page.locator('.hud-recenter')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('.hud-recenter').click();
  await expect(page.locator('.hud-recenter')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(page.locator('.hud-recenter')).toHaveAttribute('aria-pressed', 'true');
});

test('stale readings are dashes in the live HUD', async ({ page }) => {
  await page.clock.install();
  await openApp(page);
  await expect(page.locator('.hud-mp')).toHaveText(/11\.9\d{2}/);
  await page.clock.fastForward(16_000);
  await expect(page.locator('.hud-mp')).toHaveText('—');
  await expect(page.locator('.hud-stats')).toContainText('STALE');
  await expect(page.locator('.hud-recenter')).toBeDisabled();
});

test('blocked cache storage still permits a verified online session', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'caches', {
      get() {
        throw new DOMException('blocked', 'SecurityError');
      },
    });
  });
  await openApp(page);
  await expect(page.locator('.hud-mp')).toHaveText(/11\.9\d{2}/);
});

test('wake indicator follows the held lock, release, resume and toggle off', async ({ page }) => {
  await page.addInitScript(() => {
    let sentinel: EventTarget | null = null;
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: () => {
          sentinel = new EventTarget();
          const current = sentinel;
          return Promise.resolve(
            Object.assign(current, {
              released: false,
              type: 'screen',
              release: () => {
                current.dispatchEvent(new Event('release'));
                return Promise.resolve();
              },
            }),
          );
        },
      },
    });
    document.addEventListener('test-release-lock', () =>
      sentinel?.dispatchEvent(new Event('release')),
    );
  });
  await openApp(page);
  const wake = page.getByRole('button', { name: 'Keep screen awake', exact: true });
  await wake.click();
  await expect(wake).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => document.dispatchEvent(new Event('test-release-lock')));
  await expect(wake).toHaveAttribute('aria-pressed', 'false');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(wake).toHaveAttribute('aria-pressed', 'true');
  await wake.click();
  await expect(wake).toHaveAttribute('aria-pressed', 'false');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(wake).toHaveAttribute('aria-pressed', 'false');
});

test('wake rejection leaves the indicator off and explains the failure', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: { request: () => Promise.reject(new DOMException('not allowed', 'NotAllowedError')) },
    });
  });
  await openApp(page);
  const wake = page.getByRole('button', { name: 'Keep screen awake', exact: true });
  await wake.click();
  await expect(wake).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('status').filter({ hasText: /Could not keep/ })).toHaveCount(1);
});

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    await testInfo.attach('visible-state', {
      body: await page.locator('body').innerText(),
      contentType: 'text/plain',
    });
    await page.screenshot({ path: testInfo.outputPath('failure.png') });
  }
});

test('position dot renders when rail sources and GPS arrive together', async ({
  page,
  context,
}, testInfo) => {
  await openApp(page);
  await expect(page.locator('.hud-mp')).toHaveText(/11\.9\d{2}/);
  const canvas = page.locator('.map__canvas');
  await expect(canvas.locator('canvas')).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('missing map');
  expect(box.y).toBe(0);
  const scale = await page.evaluate(() => devicePixelRatio);
  // A 30 CSS-pixel square has more blue area with the 8 px position dot than
  // the track line alone. This catches source-loading races that hide the dot.
  await expect
    .poll(async () =>
      countColour(context, await canvas.screenshot(), TRACK_RGB, 24, {
        x: 0.5 - 15 / box.width,
        y: 0.5 - 15 / box.height,
        w: 30 / box.width,
        h: 30 / box.height,
      }),
    )
    .toBeGreaterThan(160 * scale * scale);
  await page.screenshot({ path: testInfo.outputPath('railhud-position.png') });
});

test('controls remain reachable in narrow and landscape layouts and sheets restore focus', async ({
  page,
}) => {
  await openApp(page);
  await expect(page.locator('.hud-route')).toBeEnabled();
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await expect(page.locator('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeFocused();
    const controls = await page.locator('.hud-controls').boundingBox();
    expect(controls).not.toBeNull();
    expect((controls?.y ?? 0) + (controls?.height ?? 0)).toBeLessThan(viewport.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      viewport.width,
    );
  }
});

test('HUD is centered at phone and desktop widths', async ({ page }) => {
  await openApp(page);
  for (const width of [320, 390, 430, 844, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    const box = await page.locator('.rail-hud').boundingBox();
    if (!box) throw new Error('HUD missing');
    expect(Math.abs(box.x + box.width / 2 - width / 2)).toBeLessThan(1);
    expect(box.x).toBeGreaterThanOrEqual(12);
  }
});

test('far from track still shows nearest route and milepost, then clears on stale GPS', async ({
  page,
  context,
}) => {
  await context.setGeolocation({ ...PLACES.chain, latitude: PLACES.chain.latitude - 0.029 });
  await openApp(page);
  await expect(page.locator('.hud-caption')).toHaveText('NEAREST TRACK MILEPOST');
  await expect(page.locator('.hud-mp')).not.toHaveText('—');
  await expect(page.locator('.hud-exploring').filter({ hasText: 'from track' })).toBeVisible();
  await page.clock.install();
  await page.clock.fastForward(16000);
  await expect(page.locator('.hud-mp')).toHaveText('—');
  await expect(page.locator('.hud-caption')).toHaveText('CALCULATED MILEPOST');
});

test.describe('new visit basemap default', () => {
  test.use({ freshBasemapDefault: true });
  test('loads roads automatically and preserves an explicit off choice', async ({
    page,
    traffic,
  }) => {
    traffic.basemapConsented = true;
    await page.route('https://tiles.openfreemap.org/**', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          version: 8,
          sources: {},
          layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#eee' } }],
        }),
      }),
    );
    await openApp(page);
    await expect
      .poll(() => traffic.urls().some((url) => url.startsWith('https://tiles.openfreemap.org/')))
      .toBe(true);
    await page.getByRole('button', { name: 'Layers ▴' }).click();
    await page.getByRole('button', { name: 'Turn off basemap' }).click();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Show roads and places' })).toBeVisible();
  });
});
