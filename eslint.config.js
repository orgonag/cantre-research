import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '.superpowers/**',
      '**/.venv/**',
      '**/test-results/**',
      '**/playwright-report/**',
      '**/dist/**',
      '**/.tsc-check/**',
      'coverage/**',
      'build/**',
      'node_modules/**',
    ],
  },
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['*.config.ts', '*.config.js', 'packages/*/vitest.config.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  { files: ['**/*.js', '**/*.mjs'], extends: [tseslint.configs.disableTypeChecked] },
);
