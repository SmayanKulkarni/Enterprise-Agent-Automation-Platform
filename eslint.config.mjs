import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

const typeCheckedConfigs = tseslint.configs.strictTypeChecked.map((config) => ({
  ...config,
  files: ['**/*.ts'],
}));

export default [
  {
    ignores: ['.artifacts/**', '.scratch/**', '.superpowers/**', 'coverage/**', 'dist/**', 'node_modules/**'],
  },
  eslint.configs.recommended,
  ...typeCheckedConfigs,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        Buffer: 'readonly',
        console: 'readonly',
        process: 'readonly',
      },
    },
    rules: {
      eqeqeq: ['error', 'always'],
    },
  },
];
