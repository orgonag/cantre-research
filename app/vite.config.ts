import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const source = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));

/**
 * Build config for the phone app.
 *
 * `@cantre/core` and `@cantre/data-client` are imported by package name and resolved to their
 * TypeScript source (the same mapping tsconfig `paths` and the data-client tests use), so a
 * clean checkout builds with `npm run -w app build` and no earlier build step.
 *
 * `base: './'` keeps every asset URL relative, so the app works from any path on a static host
 * (the planned GitHub Pages sub-path, or a local preview).
 */
export default defineConfig({
  base: './',
  resolve: {
    alias: {
      '@cantre/core': source('../packages/core/src/index.ts'),
      '@cantre/data-client': source('../packages/data-client/src/index.ts'),
    },
  },
  // Preact's automatic JSX runtime (no React shim, no extra preset dependency).
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  build: { target: 'es2023', sourcemap: false },
});
