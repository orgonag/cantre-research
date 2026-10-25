import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end, privacy and accessibility tests against the BUILT app (`npm run -w app build`
 * first). `e2e/server.mjs` serves `app/dist` and the data fixture `app/e2e/fixtures/data` as
 * `/data/`, with the `.gz` data files served as plain bytes (not `vite preview`, which adds
 * `Content-Encoding: gzip` and so breaks the data client's length and hash checks).
 *
 * Projects: desktop Chromium, Pixel 7 (Chromium, Android emulation) and iPhone 13. The iPhone
 * project uses the iPhone 13 viewport, scale, touch and user agent but runs on Chromium, because
 * CI installs only Chromium (`npx playwright install --with-deps chromium`); it is not WebKit and
 * says nothing about Safari engine behaviour.
 */
const PORT = 4179;

// The iPhone 13 descriptor names WebKit as its browser; keep everything else, run it on Chromium.
const iPhone13 = { ...devices['iPhone 13'], defaultBrowserType: 'chromium' as const };

export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.spec.ts',
  fullyParallel: true,
  forbidOnly: process.env['CI'] !== undefined,
  retries: 0,
  // Two workers on the CI runner (small); on a developer machine Playwright picks the count.
  ...(process.env['CI'] === undefined ? {} : { workers: 2 }),
  reporter: [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://127.0.0.1:${String(PORT)}/`,
    // Fixes come from context.setGeolocation; the browser never asks the user.
    permissions: ['geolocation'],
    geolocation: { latitude: 52.1, longitude: -106.05, accuracy: 5 },
    serviceWorkers: 'allow',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'pixel7', use: { ...devices['Pixel 7'] } },
    { name: 'iphone13', use: iPhone13 },
  ],
  webServer: {
    command: 'node e2e/server.mjs',
    url: `http://127.0.0.1:${String(PORT)}/`,
    env: { CANTRE_E2E_PORT: String(PORT) },
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
