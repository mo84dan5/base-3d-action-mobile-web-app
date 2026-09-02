// @ts-check
import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import importX from 'eslint-plugin-import-x';
import globals from 'globals';

const browserGlobalsForbiddenInPureLayers = [
  'window',
  'document',
  'localStorage',
  'sessionStorage',
  'navigator',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'performance',
  'screen',
  'location',
  'history',
].map((name) => ({
  name,
  message: `domain / application 層ではブラウザグローバル ${name} を参照できません(F07 レイヤ構成)`,
}));

const threeImportsForbidden = {
  paths: [{ name: 'three', message: 'この層では Three.js を import できません(F07 レイヤ構成)' }],
  patterns: [
    {
      group: ['three/*', 'three-mesh-bvh', 'three-mesh-bvh/*'],
      message: 'この層では Three.js を import できません(F07 レイヤ構成)',
    },
  ],
};

export default defineConfig(
  { ignores: ['dist/**', 'node_modules/**', 'playwright-report/**', 'test-results/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['eslint.config.js', 'scripts/*.mjs'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.browser, __APP_VERSION__: 'readonly' },
    },
    plugins: { 'import-x': importX },
    settings: {
      'import-x/resolver': { typescript: true, node: true },
    },
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-unnecessary-condition': 'off',
      'import-x/no-restricted-paths': [
        'error',
        {
          basePath: import.meta.dirname,
          zones: [
            {
              target: './src/domain',
              from: ['./src/application', './src/infrastructure', './src/ui', './src/main.ts'],
              message: 'domain は他の層に依存できません(F07)',
            },
            {
              target: './src/application',
              from: ['./src/infrastructure', './src/ui', './src/main.ts'],
              message: 'application は infrastructure / ui に依存できません(F07)',
            },
            {
              target: './src/infrastructure',
              from: './src/ui',
              message: 'infrastructure は ui に依存できません(F07)',
            },
            {
              target: './src/ui',
              from: './src/infrastructure',
              message: 'ui は infrastructure に依存できません(F07)',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/domain/**/*.ts', 'src/application/**/*.ts'],
    languageOptions: { globals: {} },
    rules: {
      'no-restricted-imports': ['error', threeImportsForbidden],
      'no-restricted-globals': ['error', ...browserGlobalsForbiddenInPureLayers],
    },
  },
  {
    files: ['src/ui/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', threeImportsForbidden],
    },
  },
  {
    files: ['**/*.js', '**/*.mjs', 'scripts/**'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['vite.config.ts', 'vitest.config.ts', 'playwright.config.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['e2e/**/*.ts'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
);
