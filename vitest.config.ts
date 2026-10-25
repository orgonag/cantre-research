import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*', 'app'],
    coverage: {
      provider: 'v8',
      // UI components (app/src/ui, app/src/main.tsx) are excluded: Playwright covers them.
      include: ['packages/*/src/**/*.ts', 'app/src/logic/**/*.ts', 'app/src/i18n/**/*.ts'],
      thresholds: {
        // Per-glob gates only, no global one (ruling P16): package code keeps 95 / 90 / 100, app logic 90 / 85 / 95.
        'packages/*/src/**': { lines: 95, branches: 90, functions: 100 },
        'app/src/{logic,i18n}/**': { lines: 90, branches: 85, functions: 95 },
      },
    },
  },
});
