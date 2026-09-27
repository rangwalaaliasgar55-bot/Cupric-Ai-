/**
 * ESLint flat config.
 *
 * The previous config imported `eslint-config-next`, which was never a
 * dependency, so ESLint could not start at all. This config parses every
 * TS/TSX/CJS source and enforces the bridge rule that 0.10.0 broke; it runs as
 * part of `npm run check:bridge`.
 *
 * Bridge rule: `window.cupric` / `window.northframe` are defined by
 * contextBridge as READ-ONLY. Assigning to them, to anything under them,
 * deleting from them or redefining them throws in the packaged app ("Cannot
 * assign to read only property 'cupric' of object '#<Window>'") — in 0.10.0
 * that blanked the Studio. Renderer-owned globals get their own names
 * (e.g. window.__cupricStudio).
 */
import tsParser from '@typescript-eslint/parser'
import { BRIDGE_RESTRICTED_SYNTAX } from './scripts/eslint-bridge-rule.mjs'

export default [
  {
    ignores: ['dist/**', 'release/**', 'node_modules/**', 'build/**', 'out/**', '.next/**', 'vendor/**', 'public/**', 'resources/**', '**/*.d.ts'],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
    },
    linterOptions: {
      // Inline `eslint-disable` comments are ignored: the bridge ban cannot be
      // switched off per line, and the existing directives (which name rules
      // from presets this config does not load) do not error.
      noInlineConfig: true,
      reportUnusedDisableDirectives: 'off',
    },
    rules: {
      'no-restricted-syntax': ['error', ...BRIDGE_RESTRICTED_SYNTAX],
    },
  },
  {
    files: ['electron/**/*.cjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'commonjs' },
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'off' },
    rules: {
      'no-restricted-syntax': ['error', ...BRIDGE_RESTRICTED_SYNTAX],
    },
  },
]
