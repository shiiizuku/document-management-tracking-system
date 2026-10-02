import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/drizzle/meta/**',
      'minio/**',
      '**/*.config.ts',
      '**/*.config.mjs',
      // `allowJs` is false in apps/web, so a .js config cannot be in the TS project either — the
      // type-checked rules have no program to resolve it against. Same reason as the two above.
      '**/*.config.js',
      'packages/contracts/test/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],
    },
  },
  {
    files: ['**/test/**/*.ts', '**/test/**/*.tsx'],
    rules: {
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
);
