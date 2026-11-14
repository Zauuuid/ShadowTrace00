import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', '.venv', '.agents', 'data-raw'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // The engine stays pure: no React, no UI.
    files: ['src/planner/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: [{ group: ['react', 'react-dom', 'zustand', 'three', 'gsap', 'gsap/*', 'lenis', '**/planner-ui/**', '**/journey/**', '**/state/**', '**/hooks/**'], message: 'src/planner must stay pure TypeScript.' }] }] },
  },
  {
    // UI calls the engine through hooks; panels and planner UI never import the terrain/horizon maths directly.
    files: ['src/journey/panels/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: [{ group: ['**/planner/terrain', '**/planner/horizon'], message: 'No science maths in panels.' }] }] },
  },
);
