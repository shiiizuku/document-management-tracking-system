import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '.claude/**',
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
    // The role-to-capability map describes a role in the user-administration role picker, and
    // nothing may gate on it (decision 175 as amended): gating reads the session's own capability
    // array. A comment cannot enforce "display only"; keeping the map unreachable outside the admin
    // feature can.
    files: ['apps/web/src/**/*.ts', 'apps/web/src/**/*.tsx'],
    ignores: ['apps/web/src/features/admin/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/features/admin/role-grants', '**/admin/role-grants'],
              message:
                'The role table is display data for the admin role picker; gate on the session capabilities from /auth/me instead.',
            },
          ],
        },
      ],
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
