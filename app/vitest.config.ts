import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Tests run against package source, so no build step is needed (same as tsconfig `paths`).
    alias: {
      '@cantre/core': fileURLToPath(new URL('../packages/core/src/index.ts', import.meta.url)),
      '@cantre/data-client': fileURLToPath(
        new URL('../packages/data-client/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    name: 'app',
    include: ['test/**/*.test.ts'],
  },
});
