import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import {
  PLACES,
  details,
  card,
  expect,
  headline,
  moveTo,
  openApp,
  openAndInstall,
  openScreen,
  test,
} from './helpers';

/**
 * Accessibility: axe-core with the WCAG 2.0 A, 2.0 AA and 2.2 AA rule sets on the first-run
 * screen, the status card, the route chooser, Settings and About, in the light and the dark
 * theme (the browser's `prefers-color-scheme`), plus the Offline data screen and the open map
 * section. Zero violations are allowed and no rule is turned off.
 *
 * axe checks what a tool can check (names, roles, contrast, target size, landmarks). It does not
 * replace a keyboard and screen-reader pass; that is a manual check.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag22aa'];

async function expectNoViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const summary = results.violations.map((v) => ({
    rule: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
  }));
  expect(summary, 'axe violations').toEqual([]);
  // A scan that checked nothing would pass trivially.
  expect(results.passes.length).toBeGreaterThan(5);
}

test('the axe check does find a violation when one is seeded', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="><button></button>' +
        '<p style="color:#ccc;background:#fff">faint</p>',
    );
  });
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const ids = results.violations.map((v) => v.id);
  expect(ids).toEqual(expect.arrayContaining(['image-alt', 'button-name', 'color-contrast']));
});

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`axe, ${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    /**
     * The axe check, after proving the requested theme is really in effect: the media query
     * matches, and the page background is dark (or light) as computed by the browser.
     */
    const check = async (page: Page): Promise<void> => {
      const seen = await page.evaluate(() => {
        const [r = 0, g = 0, b = 0] = getComputedStyle(document.body)
          .backgroundColor.match(/\d+(\.\d+)?/g)
          ?.map(Number) ?? [255, 255, 255];
        return {
          dark: matchMedia('(prefers-color-scheme: dark)').matches,
          luminance: (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255,
        };
      });
      expect(seen.dark, 'prefers-color-scheme: dark').toBe(scheme === 'dark');
      if (scheme === 'dark') {
        expect(seen.luminance, 'page background is dark').toBeLessThan(0.3);
      } else {
        expect(seen.luminance, 'page background is light').toBeGreaterThan(0.7);
      }
      await expectNoViolations(page);
    };

    test('first-run screen', async ({ page }) => {
      await openApp(page);
      await expect(page.locator('.hud-route')).toBeEnabled();
      await check(page);
    });

    test('first-run screen with a download error', async ({ page }) => {
      await page.route('**/snapshot.bin.gz', (route) => route.abort('failed'));
      await openApp(page);
      await expect(page.getByRole('alert')).toBeVisible();
      await check(page);
    });

    test('status card with a milepost, assets and the research footer', async ({
      page,
      context,
    }) => {
      await openAndInstall(page);
      await moveTo(context, PLACES.chain);
      await expect(card(page).locator('.card__mp')).toHaveText('MP 11.91');
      await check(page);
    });

    test('status card with an unverified milepost', async ({ page, context }) => {
      await openAndInstall(page);
      await moveTo(context, PLACES.secondProvince);
      await expect(card(page).locator('.badge--unverified')).toBeVisible();
      await check(page);
    });

    test('status card, historical (stale)', async ({ page, context }) => {
      await page.clock.install();
      await openAndInstall(page);
      await moveTo(context, PLACES.chain);
      await expect(card(page).locator('.card__mp')).toBeVisible();
      await page.clock.fastForward(16_000);
      await expect(card(page)).toHaveClass(/card--historical/);
      await check(page);
    });

    test('status card without permission', async ({ page, context }) => {
      await context.clearPermissions();
      await openAndInstall(page);
      await expect(headline(page)).toHaveText('Location permission is off');
      await check(page);
    });

    test('route chooser', async ({ page }) => {
      await openAndInstall(page);
      await moveTo(page.context(), PLACES.diamond);
      await expect(page.locator('section.chooser')).toBeVisible();
      await check(page);
    });

    // Seen first at the border there is no earlier match, so two routes are offered.
    test.describe('starting at the border', () => {
      test.use({ geolocation: PLACES.border });

      test('route chooser with two routes, then locked, then in conflict', async ({
        page,
        context,
      }) => {
        await openAndInstall(page);
        await expect(page.locator('section.chooser li')).toHaveCount(2);
        await check(page);
        await page.getByRole('button', { name: /^Choose this route: Border East,/ }).click();
        await expect(page.locator('.chip--locked')).toBeVisible();
        await check(page);
        await moveTo(context, PLACES.chain);
        await expect(headline(page)).toHaveText('Your chosen route does not fit this fix');
        await check(page);
      });
    });

    test('settings', async ({ page }) => {
      await openAndInstall(page);
      await openScreen(page, 'Settings');
      await expect(page.getByRole('heading', { level: 2, name: 'Settings' })).toBeVisible();
      await check(page);
    });

    test('settings with the basemap notice open', async ({ page }) => {
      await openAndInstall(page);
      await openScreen(page, 'Settings');
      await page.getByRole('button', { name: 'Turn on basemap' }).click();
      await expect(page.getByRole('alertdialog')).toBeVisible();
      await check(page);
    });

    test('about', async ({ page }) => {
      await openAndInstall(page);
      await openScreen(page, 'About');
      await expect(page.getByRole('heading', { level: 3, name: 'About CANTRE' })).toBeVisible();
      await check(page);
    });

    test('about before any data is installed', async ({ page }) => {
      await openApp(page);
      await openScreen(page, 'About');
      await expect(page.getByRole('heading', { level: 3, name: 'About CANTRE' })).toBeVisible();
      await check(page);
    });

    test('offline data', async ({ page }) => {
      await openAndInstall(page);
      await openScreen(page, 'Offline data');
      await expect(page.getByRole('heading', { level: 3, name: 'Offline data' })).toBeVisible();
      await check(page);
    });

    test('find a location with a result, and the open map', async ({ page }) => {
      await openAndInstall(page);
      await openScreen(page, 'Find a location');
      const find = page.locator('section.find');
      await find.getByLabel('Subdivision').selectOption({ label: 'Alpha (CN)' });
      await find.getByLabel('Milepost (miles)').fill('12');
      await find.getByRole('button', { name: 'Find' }).click();
      await expect(find.locator('.find__result li')).toHaveCount(1);
      await find.getByRole('button', { name: 'Show on map' }).click();
      await expect(page.locator('.map__canvas canvas')).toBeVisible();
      await check(page);
    });

    test('French text', async ({ page, context }) => {
      await openAndInstall(page);
      await moveTo(context, PLACES.chain);
      await expect(headline(page)).toHaveText('Matched to a track');
      await openScreen(page, 'Settings');
      await page.getByRole('radio', { name: 'Français' }).check();
      await check(page);
      await details(page);
      await expect(headline(page)).toHaveText('Associé à une voie');
      await check(page);
    });
  });
}

test.describe('keyboard', () => {
  test('every control is reachable with Tab and the first Tab goes to the menu', async ({
    page,
    context,
  }) => {
    await openAndInstall(page);
    await moveTo(context, PLACES.diamond);
    await expect(page.locator('section.chooser')).toBeVisible();
    const stops = new Set<string>();
    for (let i = 0; i < 40; i += 1) {
      await page.keyboard.press('Tab');
      stops.add(
        await page.evaluate(() => {
          const el = document.activeElement;
          return el === null ? '' : `${el.tagName}:${el.textContent.trim().slice(0, 30)}`;
        }),
      );
    }
    expect([...stops].some((s) => s.includes('Choose this route'))).toBe(true);
    expect([...stops].some((s) => s.includes('×'))).toBe(true);
    expect(
      await page.evaluate(() => document.querySelector('dialog')?.contains(document.activeElement)),
    ).toBe(true);
    // And a choice made from the keyboard works.
    await page.getByRole('button', { name: /^Choose this route: Alpha,/ }).focus();
    await page.keyboard.press('Enter');
    await expect(card(page).locator('.chip--locked')).toBeVisible();
  });
});
