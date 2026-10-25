import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Tests run against core's source, so no build step is needed (same as tsconfig `paths`).
    alias: { '@cantre/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)) },
  },
  test: {
    name: 'data-client',
    include: ['test/**/*.test.ts'],
  },
});
